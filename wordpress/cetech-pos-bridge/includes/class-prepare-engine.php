<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * HPOS-safe idempotent prepare. Claims atomically before any Woo order create.
 * Does not copy WoodMart/B2BKing formulas. Does not finalize payment.
 */
final class Cetech_Pos_Bridge_Prepare_Engine {
	const EXISTING_ORDER_NOT_PAYABLE = 'This existing order cannot yet be safely opened for payment.';

	/** @var Cetech_Pos_Bridge_Woo_Runtime */
	private $runtime;
	/** @var Cetech_Pos_Bridge_Quote_Engine */
	private $quotes;
	/** @var Cetech_Pos_Bridge_Quote_Store */
	private $quote_store;
	/** @var Cetech_Pos_Bridge_Claim_Store */
	private $claims;
	/** @var Cetech_Pos_Bridge_Command_Store */
	private $commands;

	/** @var callable|null test seam after claim insert, before lock/create */
	public $after_claim = null;
	/** @var callable|null test seam after Woo order create, before outcome persist */
	public $after_order_create = null;

	public function __construct(
		Cetech_Pos_Bridge_Woo_Runtime $runtime,
		Cetech_Pos_Bridge_Quote_Engine $quotes,
		Cetech_Pos_Bridge_Quote_Store $quote_store,
		Cetech_Pos_Bridge_Claim_Store $claims,
		$commands = null
	) {
		$this->runtime     = $runtime;
		$this->quotes      = $quotes;
		$this->quote_store = $quote_store;
		$this->claims      = $claims;
		$this->commands    = $commands instanceof Cetech_Pos_Bridge_Command_Store
			? $commands
			: new Cetech_Pos_Bridge_Command_Store();
	}

	/**
	 * @param array<string,mixed> $raw
	 * @param string              $idempotency_key
	 * @return array<string,mixed>|WP_Error PreparedSale or error
	 */
	public function prepare( array $raw, $idempotency_key ) {
		$violation = Cetech_Pos_Bridge_Schema::instance()->validate( $raw, 'PrepareSaleRequest' );
		if ( $violation !== null ) {
			return $this->invalid_request( Cetech_Pos_Bridge_Schema::field_of( $violation ) );
		}
		$hash   = Cetech_Pos_Bridge_Request_Hash::hash( $raw );
		$op     = Cetech_Pos_Bridge_Constants::OPERATION_PREPARE;
		$result = $this->claims->insert_preparing(
			array(
				'operation_type'  => $op,
				'idempotency_key' => $idempotency_key,
				'transaction_id'  => $raw['transactionId'],
				'request_hash'    => $hash,
				'quote_id'        => $raw['quoteId'],
			)
		);
		if ( $result === Cetech_Pos_Bridge_Claim_Store::INSERT_DUPLICATE_KEY ) {
			return $this->replay_or_conflict( $op, $idempotency_key, $hash, $raw );
		}
		if ( $result === Cetech_Pos_Bridge_Claim_Store::INSERT_DUPLICATE_TX ) {
			return $this->transaction_conflict( $raw['transactionId'] );
		}
		return $this->create_with_lock( $raw, $idempotency_key, $hash );
	}

	public function resolve( $transaction_id ) {
		if ( ! Cetech_Pos_Bridge_Quote_Request::is_uuid( $transaction_id ) ) {
			return Cetech_Pos_Bridge_Response::wp_error(
				'VALIDATION_ERROR',
				'transactionId must be a contract UUID.',
				false,
				'none',
				400,
				array( 'field' => 'transactionId' )
			);
		}
		$claim = $this->claims->get_by_transaction( $transaction_id );
		if ( $claim === null ) {
			return $this->resolution( $transaction_id, 'not_found' );
		}
		if ( $claim['internal_status'] === Cetech_Pos_Bridge_Claim_Store::STATUS_PREPARED ) {
			$prepared = $this->decode_prepared( $claim );
			if ( Cetech_Pos_Bridge_Quote_Request::is_error( $prepared ) ) {
				$this->mark_attention( $claim, 'Stored PreparedSale could not be decoded.' );
				return $this->overlay_command_resolution(
					$transaction_id,
					$this->resolution( $transaction_id, 'requires_attention', null, null, 'Stored PreparedSale could not be decoded.' )
				);
			}
			return $this->overlay_command_resolution(
				$transaction_id,
				$this->resolution(
					$transaction_id,
					'prepared',
					isset( $prepared['saleId'] ) ? $prepared['saleId'] : null,
					isset( $prepared['orderReference'] ) ? $prepared['orderReference'] : null
				)
			);
		}
		if ( $claim['internal_status'] === Cetech_Pos_Bridge_Claim_Store::STATUS_REQUIRES_ATTENTION ) {
			return $this->overlay_command_resolution(
				$transaction_id,
				$this->resolution( $transaction_id, 'requires_attention', null, null, $claim['error_message'] )
			);
		}
		if ( $claim['internal_status'] === Cetech_Pos_Bridge_Claim_Store::STATUS_TERMINAL_FAILURE ) {
			return $this->resolution( $transaction_id, 'not_found', null, null, $claim['error_message'] );
		}
		$inspected = $this->inspect_recoverable_order( $claim );
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $inspected ) ) {
			$message = method_exists( $inspected, 'get_error_message' ) ? $inspected->get_error_message() : 'Prepared sale requires attention.';
			return $this->overlay_command_resolution(
				$transaction_id,
				$this->resolution( $transaction_id, 'requires_attention', null, null, $message )
			);
		}
		if ( is_array( $inspected ) ) {
			return $this->overlay_command_resolution(
				$transaction_id,
				$this->resolution(
					$transaction_id,
					'prepared',
					isset( $inspected['saleId'] ) ? $inspected['saleId'] : null,
					isset( $inspected['orderReference'] ) ? $inspected['orderReference'] : null
				)
			);
		}
		if ( ! empty( $claim['woo_create_entered'] ) ) {
			$located = $this->lookup_recoverable_order( $claim, false );
			if ( Cetech_Pos_Bridge_Quote_Request::is_error( $located ) ) {
				$message = method_exists( $located, 'get_error_message' ) ? $located->get_error_message() : 'Prepared sale requires attention.';
				return $this->overlay_command_resolution( $transaction_id, $this->resolution( $transaction_id, 'requires_attention', null, null, $message ) );
			}
			if ( is_array( $located ) && count( $located ) === 1 ) {
				$sale_id = isset( $located[0]['saleId'] ) ? (string) $located[0]['saleId'] : null;
				$order   = isset( $located[0]['orderReference'] ) ? (string) $located[0]['orderReference'] : null;
				return $this->overlay_command_resolution(
					$transaction_id,
					$this->resolution( $transaction_id, 'requires_attention', $sale_id, $order, self::EXISTING_ORDER_NOT_PAYABLE )
				);
			}
			return $this->overlay_command_resolution(
				$transaction_id,
				$this->resolution( $transaction_id, 'requires_attention', null, null, 'Woo order create was entered and no matching order could be reconciled.' )
			);
		}
		return $this->overlay_command_resolution( $transaction_id, $this->resolution( $transaction_id, 'preparing' ) );
	}

	private function create_with_lock( array $raw, $idempotency_key, $hash ) {
		$op = Cetech_Pos_Bridge_Constants::OPERATION_PREPARE;
		if ( ! $this->claims->acquire_lock( $op, $idempotency_key ) ) {
			return $this->in_progress();
		}
		try {
			if ( is_callable( $this->after_claim ) ) {
				$cb = $this->after_claim;
				$this->after_claim = null;
				$cb( $this );
			}
			$claim = $this->claims->get_by_idempotency( $op, $idempotency_key );
			if ( ! is_array( $claim ) ) {
				return $this->unavailable( 'Prepare claim vanished after insert.' );
			}
			if ( $claim['internal_status'] === Cetech_Pos_Bridge_Claim_Store::STATUS_PREPARED ) {
				return $this->decode_prepared( $claim );
			}
			$recovered = $this->try_repair_order( $claim );
			if ( Cetech_Pos_Bridge_Quote_Request::is_error( $recovered ) ) {
				return $recovered;
			}
			if ( is_array( $recovered ) ) {
				return $recovered;
			}
			if ( ! empty( $claim['woo_create_entered'] ) ) {
				$this->mark_attention( $claim, 'Woo order create was entered and the order could not be reconciled by transaction and request hash.' );
				return $this->attention_error( 'Woo order create was entered and the order could not be reconciled by transaction and request hash.' );
			}
			return $this->execute_prepare( $raw, $claim, $hash );
		} finally {
			$this->claims->release_lock( $op, $idempotency_key );
		}
	}

	private function replay_or_conflict( $op, $idempotency_key, $hash, array $raw ) {
		$existing = $this->claims->get_by_idempotency( $op, $idempotency_key );
		if ( ! is_array( $existing ) ) {
			return $this->unavailable( 'Idempotency claim could not be loaded after a uniqueness collision.' );
		}
		if ( (string) $existing['request_hash'] !== (string) $hash ) {
			return Cetech_Pos_Bridge_Response::wp_error(
				'IDEMPOTENCY_CONFLICT',
				'Idempotency-Key was reused with a different PrepareSaleRequest.',
				false,
				'contact_manager',
				409
			);
		}
		if ( $existing['internal_status'] === Cetech_Pos_Bridge_Claim_Store::STATUS_PREPARED ) {
			return $this->decode_prepared( $existing );
		}
		if ( $existing['internal_status'] === Cetech_Pos_Bridge_Claim_Store::STATUS_TERMINAL_FAILURE ) {
			return $this->replay_terminal( $existing );
		}
		if ( $existing['internal_status'] === Cetech_Pos_Bridge_Claim_Store::STATUS_REQUIRES_ATTENTION ) {
			return $this->attention_error( $existing['error_message'] );
		}
		return $this->create_with_lock( $raw, $idempotency_key, $hash );
	}

	private function transaction_conflict( $transaction_id ) {
		$existing = $this->claims->get_by_transaction( $transaction_id );
		if ( is_array( $existing ) && $existing['internal_status'] === Cetech_Pos_Bridge_Claim_Store::STATUS_PREPARING ) {
			return $this->in_progress();
		}
		return Cetech_Pos_Bridge_Response::wp_error(
			'REQUIRES_ATTENTION',
			'This transactionId is already claimed by another prepare command.',
			false,
			'contact_manager',
			409
		);
	}

	private function execute_prepare( array $raw, array $claim, $hash ) {
		$quote = $this->quote_store->get( $raw['quoteId'] );
		if ( ! is_array( $quote ) ) {
			return $this->fail_terminal( $claim, 'NOT_FOUND', 'Quote snapshot was not found.', 404, array( 'field' => 'quoteId' ) );
		}
		if ( (string) $quote['fingerprint'] !== (string) $raw['quoteFingerprint'] ) {
			return $this->fail_terminal( $claim, 'QUOTE_CHANGED', 'quoteFingerprint does not match the stored quote.', 409, array( 'field' => 'quoteFingerprint' ) );
		}
		if ( $this->quote_expired( $quote ) ) {
			return $this->fail_terminal( $claim, 'QUOTE_EXPIRED', 'Quote has expired.', 409, array( 'field' => 'quoteId' ) );
		}
		$request_lines = array();
		foreach ( $quote['lines'] as $line ) {
			$entry = array(
				'lineId'    => $line['lineId'],
				'productId' => $line['productId'],
				'quantity'  => $line['quantity'],
			);
			if ( isset( $line['variationId'] ) ) {
				$entry['variationId'] = $line['variationId'];
			}
			$request_lines[] = $entry;
		}
		$fresh = $this->quotes->quote(
			array(
				'cartId'       => $quote['cartId'],
				'cartRevision' => $quote['cartRevision'],
				'customer'     => $quote['customer'],
				'locationId'   => $quote['locationId'],
				'lines'        => $request_lines,
			)
		);
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $fresh ) ) {
			$code = is_object( $fresh ) && method_exists( $fresh, 'get_error_code' ) ? $fresh->get_error_code() : 'STOCK_CHANGED';
			if ( $code === 'VALIDATION_ERROR' || $code === 'NOT_FOUND' || $code === 'FORBIDDEN' ) {
				return $this->fail_terminal( $claim, 'STOCK_CHANGED', 'Authoritative Woo stock or purchasability changed.', 409, array( 'field' => 'lines' ) );
			}
			return $fresh;
		}
		if ( $this->quotes->commercial_fingerprint( $fresh ) !== $this->quotes->commercial_fingerprint( $quote ) ) {
			return $this->fail_terminal(
				$claim,
				'QUOTE_CHANGED',
				'Authoritative Woo commercial facts no longer match the quoted fingerprint.',
				409,
				array( 'currentQuoteId' => (string) $fresh['id'] )
			);
		}
		if ( empty( $fresh['purchasable'] ) ) {
			return $this->fail_terminal( $claim, 'STOCK_CHANGED', 'Quoted lines are no longer purchasable.', 409, array( 'field' => 'lines' ) );
		}
		foreach ( $fresh['lines'] as $line ) {
			if ( isset( $line['stockStatus'] ) && $line['stockStatus'] === 'out_of_stock' ) {
				return $this->fail_terminal( $claim, 'STOCK_CHANGED', 'Quoted stock is no longer available.', 409, array( 'field' => 'lines' ) );
			}
		}
		if ( ! $this->runtime->available() ) {
			return $this->unavailable( 'WooCommerce runtime is not available for prepare.' );
		}
		$token = $this->new_recovery_token();
		if ( $token === null ) {
			return $this->unavailable( 'A high-entropy Woo recovery token could not be generated.' );
		}
		$claim['woo_recovery_token'] = $token;
		$claim['woo_create_entered']  = 1;
		$this->claims->save( $claim );
		$sale_quote = $fresh;
		$sale_quote['id'] = (string) $raw['quoteId'];
		if ( isset( $quote['fingerprint'] ) ) {
			$sale_quote['fingerprint'] = (string) $quote['fingerprint'];
		}
		$order = $this->runtime->create_prepared_order(
			$sale_quote,
			$raw['transactionId'],
			$hash,
			$token,
			function ( $order_id, $sale_id ) use ( $claim ) {
				return $this->accept_created_order_identity( $claim, $order_id, $sale_id );
			}
		);
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $order ) ) {
			if ( is_object( $order ) && method_exists( $order, 'get_error_code' ) && $order->get_error_code() === 'STOCK_CHANGED' ) {
				return $this->fail_terminal_from_error( $claim, $order );
			}
			return $order;
		}
		if ( is_callable( $this->after_order_create ) ) {
			$cb = $this->after_order_create;
			$this->after_order_create = null;
			$cb( $this, $order );
		}
		return $this->persist_prepared( $claim, $raw, $fresh, $order );
	}

	private function persist_prepared( array $claim, array $raw, array $quote, array $order ) {
		$claim          = $this->current_claim( $claim );
		$existing_order = isset( $claim['woo_order_id'] ) && $claim['woo_order_id'] !== null ? (string) $claim['woo_order_id'] : '';
		$existing_sale  = isset( $claim['sale_id'] ) && $claim['sale_id'] !== null ? (string) $claim['sale_id'] : '';
		if ( $existing_order !== '' && $existing_order !== (string) $order['orderId'] ) {
			$this->mark_attention( $claim, 'Prepare claim is already bound to a different Woo order.' );
			return $this->attention_error( 'Prepare claim is already bound to a different Woo order.' );
		}
		if ( $existing_sale !== '' && $existing_sale !== (string) $order['saleId'] ) {
			$this->mark_attention( $claim, 'Prepare claim is already bound to a different sale.' );
			return $this->attention_error( 'Prepare claim is already bound to a different sale.' );
		}
		if ( empty( $order['reservationProven'] ) || ! isset( $order['stockCommitment'] ) || ( $order['stockCommitment'] !== 'reserved' && $order['stockCommitment'] !== 'reduced' ) ) {
			$this->mark_attention( $claim, 'Woo order outcome did not prove a stock commitment.' );
			return $this->unavailable( 'PreparedSale was not returned because stock commitment was not proven.' );
		}
		if ( empty( $order['reservationExpiresAt'] ) || ! is_string( $order['reservationExpiresAt'] ) ) {
			$this->mark_attention( $claim, 'Proven reservation did not expose an actual expiry.' );
			return $this->unavailable( 'PreparedSale was not returned because reservation expiry was not proven.' );
		}
		$expiry_unix = strtotime( $order['reservationExpiresAt'] );
		if ( $expiry_unix === false || $expiry_unix <= time() ) {
			$this->mark_attention( $claim, 'Proven reservation expiry is not in the future.' );
			return $this->unavailable( 'PreparedSale was not returned because reservation expiry was not current.' );
		}
		if ( ! isset( $quote['total'] ) || ! is_array( $quote['total'] ) || ! isset( $quote['total']['minor'] ) ) {
			$this->mark_attention( $claim, 'Authoritative Quote total is unreadable.' );
			return $this->unavailable( 'PreparedSale was not returned because Quote.total could not be proven.' );
		}
		$matched = $this->runtime->assert_saved_order_matches_quote( isset( $order['orderId'] ) ? $order['orderId'] : '', $quote );
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $matched ) ) {
			$this->mark_attention( $claim, 'Prepared Woo order economics diverged from the authoritative Quote.' );
			return $matched;
		}
		$now      = gmdate( 'Y-m-d\TH:i:s\Z' );
		$prepared = array(
			'transactionId'    => $raw['transactionId'],
			'saleId'           => (string) $order['saleId'],
			'orderReference'   => (string) $order['orderReference'],
			'quoteFingerprint' => (string) $quote['fingerprint'],
			'total'            => $quote['total'],
			'status'           => 'prepared',
			'stockCommitment'  => (string) $order['stockCommitment'],
			'preparedAt'       => $now,
			'expiresAt'        => gmdate( 'Y-m-d\TH:i:s\Z', $expiry_unix ),
		);
		$violation = Cetech_Pos_Bridge_Schema::instance()->validate( $prepared, 'PreparedSale' );
		if ( $violation !== null ) {
			$this->mark_attention( $claim, 'PreparedSale did not satisfy the v1 contract schema.' );
			return $this->unavailable( 'PreparedSale did not satisfy the v1 contract schema and was not returned.' );
		}
		$json = function_exists( 'wp_json_encode' ) ? wp_json_encode( $prepared ) : json_encode( $prepared );
		$claim['internal_status']    = Cetech_Pos_Bridge_Claim_Store::STATUS_PREPARED;
		$claim['woo_order_id']       = (string) $order['orderId'];
		$claim['sale_id']            = (string) $order['saleId'];
		$claim['outcome_json']       = is_string( $json ) ? $json : null;
		$claim['error_code']         = null;
		$claim['error_message']      = null;
		$claim['error_details_json'] = null;
		$this->claims->save( $claim );
		return $prepared;
	}

	private function inspect_recoverable_order( array $claim ) {
		$located = $this->lookup_recoverable_order( $claim, false );
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $located ) ) {
			return $located;
		}
		if ( ! is_array( $located ) || count( $located ) === 0 ) {
			return null;
		}
		if ( count( $located ) > 1 ) {
			return $this->attention_error( 'Multiple Woo orders carry this recovery identity.' );
		}
		$order = $located[0];
		$hash  = isset( $order['requestHash'] ) ? (string) $order['requestHash'] : '';
		if ( $hash !== '' && $hash !== (string) $claim['request_hash'] ) {
			return $this->attention_error( 'Woo order recovery identity did not match the claimed request hash.' );
		}
		$quote = $this->recovery_quote( $claim, $order );
		if ( ! is_array( $quote ) ) {
			return null;
		}
		return $this->runtime->inspect_recovered_order(
			$order,
			$quote,
			$claim['transaction_id'],
			$claim['request_hash']
		);
	}

	private function try_repair_order( array $claim ) {
		$located = $this->lookup_recoverable_order( $claim, true );
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $located ) ) {
			return $located;
		}
		if ( ! is_array( $located ) || count( $located ) === 0 ) {
			return null;
		}
		if ( count( $located ) > 1 ) {
			$this->mark_attention( $claim, 'Multiple Woo orders carry this recovery identity.' );
			return $this->attention_error( 'Multiple Woo orders carry this recovery identity.' );
		}
		$order = $located[0];
		$hash  = isset( $order['requestHash'] ) ? (string) $order['requestHash'] : '';
		if ( $hash !== '' && $hash !== (string) $claim['request_hash'] ) {
			$this->mark_attention( $claim, 'Woo order recovery identity did not match the claimed request hash.' );
			return $this->attention_error( 'Woo order recovery identity did not match the claimed request hash.' );
		}
		$quote = $this->recovery_quote( $claim, $order );
		if ( ! is_array( $quote ) ) {
			$this->mark_attention( $claim, self::EXISTING_ORDER_NOT_PAYABLE );
			return $this->attention_error( self::EXISTING_ORDER_NOT_PAYABLE );
		}
		$repaired = $this->runtime->repair_recovered_order(
			$order,
			$quote,
			$claim['transaction_id'],
			$claim['request_hash']
		);
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $repaired ) ) {
			$code = method_exists( $repaired, 'get_error_code' ) ? $repaired->get_error_code() : '';
			if ( $code === 'REQUIRES_ATTENTION' ) {
				$this->mark_attention( $claim, method_exists( $repaired, 'get_error_message' ) ? $repaired->get_error_message() : 'Recovered Woo order requires attention.' );
				return $repaired;
			}
			return $repaired;
		}
		if ( empty( $repaired['reservationProven'] ) || ! isset( $repaired['stockCommitment'] ) || ( $repaired['stockCommitment'] !== 'reserved' && $repaired['stockCommitment'] !== 'reduced' ) ) {
			$this->mark_attention( $claim, 'Recovered Woo order did not prove a stock commitment.' );
			return $this->attention_error( 'Recovered Woo order did not prove a stock commitment.' );
		}
		$raw = array(
			'transactionId'    => $claim['transaction_id'],
			'quoteId'          => $quote['id'],
			'quoteFingerprint' => $quote['fingerprint'],
		);
		return $this->persist_prepared( $claim, $raw, $quote, $repaired );
	}

	/**
	 * Locate the original Woo order by transaction+hash and/or recovery token.
	 *
	 * @param array<string,mixed> $claim
	 * @param bool                $persist_attention
	 * @return array<int,array<string,mixed>>|WP_Error
	 */
	private function lookup_recoverable_order( array $claim, $persist_attention = true ) {
		$bound = isset( $claim['woo_order_id'] ) && $claim['woo_order_id'] !== null ? trim( (string) $claim['woo_order_id'] ) : '';
		if ( $bound !== '' ) {
			return $this->lookup_bound_order( $claim, $bound, $persist_attention );
		}
		$found = $this->runtime->find_orders_by_transaction( $claim['transaction_id'] );
		if ( ! is_array( $found ) ) {
			return $this->unavailable( 'Woo order recovery lookup failed.' );
		}
		$matched = array();
		foreach ( $found as $candidate ) {
			$hash = isset( $candidate['requestHash'] ) ? (string) $candidate['requestHash'] : '';
			if ( $hash !== '' && $hash === (string) $claim['request_hash'] ) {
				$matched[] = $candidate;
			}
		}
		if ( count( $found ) > 0 && count( $matched ) === 0 ) {
			if ( $persist_attention ) {
				$this->mark_attention( $claim, 'Woo order recovery identity did not match the claimed request hash.' );
			}
			return $this->attention_error( 'Woo order recovery identity did not match the claimed request hash.' );
		}
		if ( count( $matched ) > 1 ) {
			if ( $persist_attention ) {
				$this->mark_attention( $claim, 'Multiple Woo orders carry this transaction identity.' );
			}
			return $this->attention_error( 'Multiple Woo orders carry this transaction identity.' );
		}
		if ( count( $matched ) === 1 ) {
			return $matched;
		}
		$token = isset( $claim['woo_recovery_token'] ) ? (string) $claim['woo_recovery_token'] : '';
		if ( $token === '' ) {
			return array();
		}
		$by_token = $this->runtime->find_orders_by_recovery_token( $token );
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $by_token ) ) {
			$code = method_exists( $by_token, 'get_error_code' ) ? $by_token->get_error_code() : '';
			if ( $code === 'REQUIRES_ATTENTION' && $persist_attention ) {
				$this->mark_attention( $claim, method_exists( $by_token, 'get_error_message' ) ? $by_token->get_error_message() : 'Recovery token matched more than one Woo order.' );
			}
			return $by_token;
		}
		if ( ! is_array( $by_token ) ) {
			return array();
		}
		return $by_token;
	}

	private function lookup_bound_order( array $claim, $order_id, $persist_attention ) {
		$one = $this->runtime->find_order_by_id( $order_id );
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $one ) ) {
			if ( $persist_attention ) {
				$message = method_exists( $one, 'get_error_message' ) ? $one->get_error_message() : 'Claimed Woo order could not be trusted.';
				$this->mark_attention( $claim, $message );
			}
			return $one;
		}
		if ( ! is_array( $one ) ) {
			$message = 'The claimed Woo order could not be loaded.';
			if ( $persist_attention ) {
				$this->mark_attention( $claim, $message );
			}
			return $this->attention_error( $message );
		}
		$contradiction = $this->bound_order_contradicts( $claim, $one );
		if ( $contradiction !== null ) {
			if ( $persist_attention ) {
				$this->mark_attention( $claim, $contradiction );
			}
			return $this->attention_error( $contradiction );
		}
		$token = isset( $claim['woo_recovery_token'] ) ? (string) $claim['woo_recovery_token'] : '';
		if ( $token !== '' ) {
			$by_token = $this->runtime->find_orders_by_recovery_token( $token );
			if ( Cetech_Pos_Bridge_Quote_Request::is_error( $by_token ) ) {
				$code = method_exists( $by_token, 'get_error_code' ) ? $by_token->get_error_code() : '';
				if ( $code === 'REQUIRES_ATTENTION' && $persist_attention ) {
					$this->mark_attention( $claim, method_exists( $by_token, 'get_error_message' ) ? $by_token->get_error_message() : 'Recovery token matched more than one Woo order.' );
				}
				return $by_token;
			}
			if ( is_array( $by_token ) && count( $by_token ) === 1 ) {
				$token_id = isset( $by_token[0]['orderId'] ) ? (string) $by_token[0]['orderId'] : '';
				if ( $token_id !== '' && $token_id !== (string) $order_id ) {
					$message = 'Recovery token identifies a different Woo order than the prepare claim.';
					if ( $persist_attention ) {
						$this->mark_attention( $claim, $message );
					}
					return $this->attention_error( $message );
				}
			}
		}
		return array( $one );
	}

	private function bound_order_contradicts( array $claim, array $order ) {
		$hash = isset( $order['requestHash'] ) ? (string) $order['requestHash'] : '';
		if ( $hash !== '' && $hash !== (string) $claim['request_hash'] ) {
			return 'Woo order recovery identity did not match the claimed request hash.';
		}
		$tx = isset( $order['transactionId'] ) ? (string) $order['transactionId'] : '';
		if ( $tx !== '' && $tx !== (string) $claim['transaction_id'] ) {
			return 'Recovered Woo order transaction identity contradicts the claim.';
		}
		$claim_token = isset( $claim['woo_recovery_token'] ) ? (string) $claim['woo_recovery_token'] : '';
		$order_token = isset( $order['recoveryToken'] ) ? (string) $order['recoveryToken'] : '';
		if ( $claim_token !== '' && $order_token !== '' && $claim_token !== $order_token ) {
			return 'Recovered Woo order does not carry the claimed recovery token.';
		}
		return null;
	}

	private function recovery_quote( array $claim, array $order ) {
		$stored_id = isset( $claim['quote_id'] ) ? (string) $claim['quote_id'] : '';
		$stored    = $this->quote_store->get( $stored_id );
		if ( is_array( $stored ) && ! $this->quote_expired( $stored ) ) {
			return $stored;
		}
		$order_id = isset( $order['orderId'] ) ? (string) $order['orderId'] : '';
		$frozen   = $this->runtime->frozen_quote_for_order( $order_id );
		if ( ! is_array( $frozen ) ) {
			return null;
		}
		if ( $stored_id !== '' && (string) $frozen['id'] !== $stored_id ) {
			return null;
		}
		return $frozen;
	}

	private function accept_created_order_identity( array $claim, $order_id, $sale_id ) {
		$result = $this->claims->bind_created_order_identity(
			$claim['operation_type'],
			$claim['idempotency_key'],
			$claim['transaction_id'],
			$claim['request_hash'],
			$order_id,
			$sale_id
		);
		if ( $result === Cetech_Pos_Bridge_Claim_Store::BIND_NEWLY_BOUND || $result === Cetech_Pos_Bridge_Claim_Store::BIND_ALREADY_BOUND ) {
			return true;
		}
		$messages = array(
			Cetech_Pos_Bridge_Claim_Store::BIND_NOT_FOUND             => 'Prepare claim was not found when binding the Woo order.',
			Cetech_Pos_Bridge_Claim_Store::BIND_TRANSACTION_MISMATCH  => 'Prepare claim transaction did not match the created Woo order.',
			Cetech_Pos_Bridge_Claim_Store::BIND_REQUEST_HASH_MISMATCH => 'Prepare claim request hash did not match the created Woo order.',
			Cetech_Pos_Bridge_Claim_Store::BIND_CONFLICTING_ORDER_ID  => 'Prepare claim is already bound to a different Woo order.',
			Cetech_Pos_Bridge_Claim_Store::BIND_CONFLICTING_SALE_ID   => 'Prepare claim is already bound to a different sale.',
			Cetech_Pos_Bridge_Claim_Store::BIND_PERSISTENCE_FAILED    => 'The Woo order was created, but its recovery identity could not be confirmed in the prepare claim.',
		);
		$message = isset( $messages[ $result ] ) ? $messages[ $result ] : 'Prepare claim could not bind the Woo order.';
		$this->mark_attention( $claim, $message );
		return $this->attention_error( $message );
	}

	private function current_claim( array $claim ) {
		$operation = isset( $claim['operation_type'] ) ? $claim['operation_type'] : Cetech_Pos_Bridge_Constants::OPERATION_PREPARE;
		$loaded    = $this->claims->get_by_idempotency( $operation, $claim['idempotency_key'] );
		return is_array( $loaded ) ? $loaded : $claim;
	}

	private function new_recovery_token() {
		if ( ! function_exists( 'random_bytes' ) ) {
			return null;
		}
		try {
			return bin2hex( random_bytes( 32 ) );
		} catch ( Exception $e ) {
			return null;
		}
	}

	private function quote_expired( array $quote ) {
		if ( empty( $quote['expiresAt'] ) || ! is_string( $quote['expiresAt'] ) ) {
			return true;
		}
		$expiry = strtotime( $quote['expiresAt'] );
		return $expiry === false || $expiry <= time();
	}

	private function decode_prepared( array $claim ) {
		$decoded = json_decode( (string) $claim['outcome_json'], true );
		if ( ! is_array( $decoded ) ) {
			return $this->unavailable( 'Stored PreparedSale is not valid JSON.' );
		}
		$violation = Cetech_Pos_Bridge_Schema::instance()->validate( $decoded, 'PreparedSale' );
		if ( $violation !== null ) {
			return $this->unavailable( 'Stored PreparedSale did not satisfy the v1 contract schema.' );
		}
		return $decoded;
	}

	private function fail_terminal( array $claim, $code, $message, $status, $details = null ) {
		$policy = Cetech_Pos_Bridge_Response::POLICY[ $code ];
		$error  = Cetech_Pos_Bridge_Response::wp_error( $code, $message, $policy[1], $policy[2], $status, $details );
		return $this->fail_terminal_from_error( $claim, $error );
	}

	private function fail_terminal_from_error( array $claim, $error ) {
		$claim = $this->current_claim( $claim );
		$data  = method_exists( $error, 'get_error_data' ) ? (array) $error->get_error_data() : array();
		$claim['internal_status']    = Cetech_Pos_Bridge_Claim_Store::STATUS_TERMINAL_FAILURE;
		$claim['error_code']         = $error->get_error_code();
		$claim['error_message']      = $error->get_error_message();
		$details                     = isset( $data['details'] ) && is_array( $data['details'] ) ? $data['details'] : array();
		$json                        = function_exists( 'wp_json_encode' ) ? wp_json_encode( $details ) : json_encode( $details );
		$claim['error_details_json'] = is_string( $json ) ? $json : null;
		$this->claims->save( $claim );
		return $error;
	}

	private function replay_terminal( array $claim ) {
		$code    = (string) $claim['error_code'];
		$message = (string) $claim['error_message'];
		$policy  = isset( Cetech_Pos_Bridge_Response::POLICY[ $code ] ) ? Cetech_Pos_Bridge_Response::POLICY[ $code ] : Cetech_Pos_Bridge_Response::POLICY['VALIDATION_ERROR'];
		$details = json_decode( (string) $claim['error_details_json'], true );
		return Cetech_Pos_Bridge_Response::wp_error(
			$code,
			$message,
			$policy[1],
			$policy[2],
			$policy[0],
			is_array( $details ) ? $details : null
		);
	}

	private function mark_attention( array $claim, $message ) {
		$claim                    = $this->current_claim( $claim );
		$claim['internal_status'] = Cetech_Pos_Bridge_Claim_Store::STATUS_REQUIRES_ATTENTION;
		$claim['error_code']      = 'REQUIRES_ATTENTION';
		$claim['error_message']   = $message;
		$this->claims->save( $claim );
	}

	private function overlay_command_resolution( $transaction_id, $base ) {
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $base ) || ! is_array( $base ) ) {
			return $base;
		}
		$finalize = $this->commands->get_by_transaction_operation( $transaction_id, Cetech_Pos_Bridge_Constants::OPERATION_FINALIZE );
		$cancel   = $this->commands->get_by_transaction_operation( $transaction_id, Cetech_Pos_Bridge_Constants::OPERATION_CANCEL );
		$claim    = $this->claims->get_by_transaction( $transaction_id );
		$snap     = null;
		if ( is_array( $claim ) && isset( $claim['woo_order_id'] ) && $claim['woo_order_id'] !== '' && $claim['woo_order_id'] !== null ) {
			$snap = $this->runtime->inspect_commercial_snapshot( $claim['woo_order_id'] );
		}
		$sale_id = isset( $base['saleId'] ) ? $base['saleId'] : null;
		$order   = isset( $base['orderReference'] ) ? $base['orderReference'] : null;
		if ( is_array( $snap ) ) {
			if ( $sale_id === null && isset( $snap['saleId'] ) && $snap['saleId'] !== '' ) {
				$sale_id = $snap['saleId'];
			}
			if ( $order === null && isset( $snap['orderReference'] ) && $snap['orderReference'] !== '' ) {
				$order = $snap['orderReference'];
			}
		}
		if ( is_array( $snap ) && ! empty( $snap['paid'] ) && ! empty( $snap['cancelled'] ) ) {
			return $this->resolution( $transaction_id, 'requires_attention', $sale_id, $order, 'Woo paid and cancelled state is contradictory.', isset( $snap['paymentId'] ) ? $snap['paymentId'] : null );
		}
		if ( is_array( $finalize ) && $finalize['internal_status'] === Cetech_Pos_Bridge_Command_Store::STATUS_REQUIRES_ATTENTION ) {
			$outcome = $this->decode_command_outcome( $finalize );
			if ( is_array( $outcome ) ) {
				return $outcome;
			}
			return $this->resolution( $transaction_id, 'requires_attention', $sale_id, $order, $finalize['error_message'] );
		}
		if ( is_array( $snap ) && ! empty( $snap['paid'] ) ) {
			$payment_id = isset( $snap['paymentId'] ) ? $snap['paymentId'] : null;
			if ( is_array( $finalize ) && isset( $finalize['payment_id'] ) && $finalize['payment_id'] !== '' && $payment_id !== null && (string) $finalize['payment_id'] !== (string) $payment_id ) {
				return $this->resolution( $transaction_id, 'requires_attention', $sale_id, $order, 'Woo payment identity contradicts the finalize claim.' );
			}
			if ( $payment_id === null ) {
				return $this->resolution( $transaction_id, 'requires_attention', $sale_id, $order, 'Woo order is paid but payment identity cannot be proven.' );
			}
			return $this->resolution( $transaction_id, 'completed', $sale_id, $order, null, $payment_id );
		}
		if ( is_array( $finalize ) && $finalize['internal_status'] === Cetech_Pos_Bridge_Command_Store::STATUS_COMPLETED ) {
			$outcome = $this->decode_command_outcome( $finalize );
			if ( is_array( $outcome ) ) {
				return $outcome;
			}
		}
		if ( is_array( $snap ) && ! empty( $snap['cancelled'] ) ) {
			return $this->resolution( $transaction_id, 'cancelled', $sale_id, $order );
		}
		if ( is_array( $cancel ) && $cancel['internal_status'] === Cetech_Pos_Bridge_Command_Store::STATUS_COMPLETED ) {
			$outcome = $this->decode_command_outcome( $cancel );
			if ( is_array( $outcome ) ) {
				return $outcome;
			}
			return $this->resolution( $transaction_id, 'cancelled', $sale_id, $order );
		}
		if ( is_array( $finalize ) && in_array( $finalize['internal_status'], array( Cetech_Pos_Bridge_Command_Store::STATUS_PENDING, Cetech_Pos_Bridge_Command_Store::STATUS_IN_PROGRESS ), true ) ) {
			return $this->resolution( $transaction_id, 'finalizing', $sale_id, $order );
		}
		return $base;
	}

	/**
	 * @param array<string,mixed> $claim
	 * @return array<string,mixed>|null
	 */
	private function decode_command_outcome( array $claim ) {
		if ( ! isset( $claim['outcome_json'] ) || ! is_string( $claim['outcome_json'] ) || $claim['outcome_json'] === '' ) {
			return null;
		}
		$decoded = json_decode( $claim['outcome_json'], true );
		if ( ! is_array( $decoded ) ) {
			return null;
		}
		$violation = Cetech_Pos_Bridge_Schema::instance()->validate( $decoded, 'SaleResolution' );
		return $violation === null ? $decoded : null;
	}

	private function resolution( $transaction_id, $status, $sale_id = null, $order_reference = null, $message = null, $payment_id = null ) {
		$payload = array(
			'transactionId' => $transaction_id,
			'status'        => $status,
		);
		if ( is_string( $sale_id ) && $sale_id !== '' ) {
			$payload['saleId'] = $sale_id;
		}
		if ( is_string( $order_reference ) && $order_reference !== '' ) {
			$payload['orderReference'] = $order_reference;
		}
		if ( is_string( $payment_id ) && $payment_id !== '' ) {
			$payload['paymentId'] = $payment_id;
		}
		if ( is_string( $message ) && $message !== '' ) {
			$payload['message'] = $message;
		}
		$violation = Cetech_Pos_Bridge_Schema::instance()->validate( $payload, 'SaleResolution' );
		if ( $violation !== null ) {
			return $this->unavailable( 'SaleResolution did not satisfy the v1 contract schema and was not returned.' );
		}
		return $payload;
	}

	private function invalid_request( $field ) {
		return Cetech_Pos_Bridge_Response::wp_error(
			'VALIDATION_ERROR',
			'PrepareSaleRequest does not satisfy the v1 contract schema.',
			false,
			'none',
			400,
			array( 'field' => $field )
		);
	}

	private function in_progress() {
		return Cetech_Pos_Bridge_Response::wp_error(
			'OPERATION_IN_PROGRESS',
			'Prepare is still in progress for this Idempotency-Key.',
			true,
			'resolve',
			202
		);
	}

	private function attention_error( $message = null ) {
		return Cetech_Pos_Bridge_Response::wp_error(
			'REQUIRES_ATTENTION',
			is_string( $message ) && $message !== '' ? $message : 'Prepared sale requires attention.',
			false,
			'contact_manager',
			409
		);
	}

	private function unavailable( $message ) {
		return Cetech_Pos_Bridge_Response::wp_error(
			'INTEGRATION_UNAVAILABLE',
			$message,
			true,
			'resolve',
			503
		);
	}
}

<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Test double for the Woo runtime boundary.
 * Catalog rows are injected authoritative totals, not WoodMart/B2BKing formulas.
 */
class Cetech_Pos_Bridge_Fake_Woo_Runtime extends Cetech_Pos_Bridge_Woo_Runtime {
	/** @var array<string,string> customerId => kind */
	public $customers = array();
	/** @var array<string,array<string,array<string,array<string,mixed>>>> */
	public $catalog = array();
	public $throw_on_calculate = false;
	/** @var callable|null */
	public $during_calculate = null;
	public $bag_key          = 'cetech_pos_fake_wc';
	/** @var int */
	public $hold_stock_minutes = 60;
	/** @var array<string,int> productId => remaining units */
	public $stock = array();
	/** @var array<int,array<string,mixed>> */
	public $orders = array();
	/** @var array<string,array<string,int>> orderId => productId => qty */
	public $reservations = array();
	/** @var int */
	public $next_order_id = 1001;
	/** @var int storefront competing checkouts that took stock */
	public $storefront_orders = 0;
	/** @var callable|null */
	public $during_create = null;
	/** @var callable|null */
	public $during_reserve = null;
	/** @var callable|null fired after each managed product reservation row is written */
	public $after_product_reserve = null;
	/** @var string|null force an invalid PreparedSale stockCommitment */
	public $force_commitment = null;
	/** @var int */
	public $create_calls = 0;
	/** @var int */
	public $calculate_totals_calls = 0;
	/** @var array<int,array<string,mixed>> */
	public $refunds = array();
	/** @var int */
	public $next_refund_id = 9001;
	/** @var int */
	public $commercial_refund_creates = 0;
	/** @var int */
	public $stock_increase_calls = 0;
	/** @var int */
	public $payment_provider_refund_calls = 0;
	/** @var bool */
	public $duplicate_refund_on_create = false;
	/** @var bool */
	public $throw_after_refund_create = false;
	/**
	 * Fail inside wc_create_refund after the claim has crossed the uncertainty
	 * boundary and before any native refund row exists.
	 *
	 * @var bool
	 */
	public $fail_commercial_refund_before_native = false;
	/** @var int|null throw after this many official stock increases */
	public $throw_on_stock_increase_n = null;
	/** @var array<string,int> last wc_create_refund flags */
	public $last_refund_flags = array(
		'refund_payment' => null,
		'restock_items'  => null,
	);
	/** @var int */
	public $payment_complete_calls = 0;
	/** @var int */
	public $stock_reduce_calls = 0;
	/** @var int */
	public $reservation_release_calls = 0;
	/** @var int */
	public $order_cancel_calls = 0;
	/** @var int|null unix expiry written onto fake reservation rows */
	public $reservation_expiry_unix = null;
	/** @var array<string,array<string,mixed>> productId => managing_stock/backorders_allowed/stock_managed_by */
	public $product_stock_rules = array();
	/** @var string|null ReserveStockException error code to throw from reserve */
	public $reserve_exception = null;
	/** @var array<string,array<string,array<string,mixed>>> orderId => productId => row */
	public $reservation_rows = array();
	/** @var int|null force a divergent saved Woo grand total in minor units */
	public $force_saved_total_minor = null;

	public function available() {
		return (bool) $this->environment->wc_available();
	}

	public function currency() {
		return Cetech_Pos_Bridge_Constants::SETTLEMENT_CURRENCY;
	}

	public function price_decimals() {
		return Cetech_Pos_Bridge_Constants::PRICE_DECIMALS;
	}

	public function snapshot() {
		$bag = $this->bag();
		return array(
			'customer' => $bag['customer'],
			'cart'     => $bag['cart'],
		);
	}

	public function restore( array $snapshot ) {
		$this->write_bag(
			isset( $snapshot['customer'] ) ? $snapshot['customer'] : '__idle__',
			isset( $snapshot['cart'] ) ? $snapshot['cart'] : array()
		);
	}

	public function install_customer_context( array $customer ) {
		if ( $customer['kind'] === 'walkin' ) {
			$this->write_bag( 'walkin', $this->bag()['cart'] );
			return true;
		}
		$id = $customer['customerId'];
		if ( ! isset( $this->customers[ $id ] ) ) {
			return Cetech_Pos_Bridge_Response::wp_error(
				'NOT_FOUND',
				'Customer context was not found.',
				false,
				'none',
				404,
				array( 'field' => 'customer' )
			);
		}
		if ( $this->customers[ $id ] !== $customer['kind'] ) {
			return Cetech_Pos_Bridge_Response::wp_error(
				'FORBIDDEN',
				'Requested customer kind does not match the authorized commercial context.',
				false,
				'none',
				403,
				array( 'field' => 'customer' )
			);
		}
		$this->write_bag( $customer['kind'] . ':' . $id, $this->bag()['cart'] );
		return true;
	}

	public function reset_cart() {
		$bag = $this->bag();
		$this->write_bag( $bag['customer'], array() );
		return true;
	}

	public function add_line( array $line ) {
		$bag   = $this->bag();
		$cart  = $bag['cart'];
		$cart[] = $line;
		$this->write_bag( $bag['customer'], $cart );
		return true;
	}

	public function calculate_totals() {
		++$this->calculate_totals_calls;
		if ( $this->throw_on_calculate ) {
			throw new RuntimeException( 'forced calculate_totals failure' );
		}
		if ( is_callable( $this->during_calculate ) ) {
			$cb = $this->during_calculate;
			$this->during_calculate = null;
			$cb( $this );
		}
		$bag  = $this->bag();
		$cart = array();
		foreach ( $bag['cart'] as $line ) {
			$key = $this->catalog_key( $line );
			if ( ! isset( $this->catalog[ $bag['customer'] ][ $key ][ $line['quantity'] ] ) ) {
				return Cetech_Pos_Bridge_Response::wp_error(
					'VALIDATION_ERROR',
					'WooCommerce rejected a quote line.',
					false,
					'none',
					400,
					array( 'field' => 'lines' )
				);
			}
			$priced         = $this->catalog[ $bag['customer'] ][ $key ][ $line['quantity'] ];
			$priced['line'] = $line;
			$cart[]         = $priced;
		}
		$this->write_bag( $bag['customer'], $cart );
		return true;
	}

	public function get_priced_cart() {
		$bag                     = $this->bag();
		$lines                   = array();
		$subtotal                = 0;
		$discount                = 0;
		$tax                     = 0;
		$this->last_provider_tax = array();
		foreach ( $bag['cart'] as $priced ) {
			$lines[]   = array(
				'productId'    => $priced['line']['productId'],
				'variationId'  => isset( $priced['line']['variationId'] ) ? $priced['line']['variationId'] : null,
				'quantity'     => $priced['line']['quantity'],
				'unitPrice'    => $priced['unitPrice'],
				'subtotal'     => $priced['subtotal'],
				'discount'     => $priced['discount'],
				'tax'          => $priced['tax'],
				'stockStatus'  => $priced['stockStatus'],
				'purchasable'  => $priced['purchasable'],
				'pricingLabel' => isset( $priced['pricingLabel'] ) ? $priced['pricingLabel'] : null,
				'problems'     => isset( $priced['problems'] ) ? $priced['problems'] : array(),
			);
			if ( isset( $priced['taxRates'] ) && is_array( $priced['taxRates'] ) ) {
				$key                             = $this->line_tax_key( $lines[ count( $lines ) - 1 ] );
				$this->last_provider_tax[ $key ] = $priced['taxRates'];
			}
			$subtotal += Cetech_Pos_Bridge_Money::from_decimal_string( $priced['subtotal'], 'GHS' );
			$discount += Cetech_Pos_Bridge_Money::from_decimal_string( $priced['discount'], 'GHS' );
			$tax      += Cetech_Pos_Bridge_Money::from_decimal_string( $priced['tax'], 'GHS' );
		}
		$total = $subtotal - $discount + $tax;
		return array(
			'currency' => 'GHS',
			'lines'    => $lines,
			'subtotal' => $this->minor_to_decimal( $subtotal ),
			'discount' => $this->minor_to_decimal( $discount ),
			'tax'      => $this->minor_to_decimal( $tax ),
			'total'    => $this->minor_to_decimal( $total ),
		);
	}

	public function bag() {
		if ( ! isset( $GLOBALS[ $this->bag_key ] ) ) {
			$GLOBALS[ $this->bag_key ] = array(
				'customer' => '__idle__',
				'cart'     => array(),
			);
		}
		return $GLOBALS[ $this->bag_key ];
	}

	public function write_bag( $customer, $cart ) {
		$GLOBALS[ $this->bag_key ] = array(
			'customer' => $customer,
			'cart'     => $cart,
		);
	}

	public function hold_stock_seconds() {
		$minutes = (int) $this->hold_stock_minutes;
		if ( $minutes <= 0 ) {
			return 0;
		}
		return $minutes * 60;
	}

	public function pos_order_count() {
		$count = 0;
		foreach ( $this->orders as $order ) {
			if ( ! empty( $order['pos'] ) ) {
				++$count;
			}
		}
		return $count;
	}

	protected function count_orders() {
		return count( $this->orders );
	}

	/**
	 * Competing storefront checkout against the same catalog unit. Not a POS prepare.
	 *
	 * @param string $product_id
	 * @param int    $qty
	 * @return bool
	 */
	public function competing_checkout( $product_id, $qty = 1 ) {
		$qty = (int) $qty;
		if ( ! isset( $this->stock[ $product_id ] ) || $this->stock[ $product_id ] < $qty ) {
			return false;
		}
		$this->stock[ $product_id ] -= $qty;
		++$this->storefront_orders;
		++$this->side_effects['orders'];
		++$this->side_effects['stock'];
		$this->orders[] = array(
			'id'             => 'storefront-' . $this->next_order_id,
			'pos'            => false,
			'transaction_id' => null,
			'status'         => 'processing',
		);
		++$this->next_order_id;
		return true;
	}

	public function create_prepared_order( array $quote, $transaction_id, $request_hash, $recovery_token = '', $on_order_identity = null ) {
		$hold = $this->hold_stock_seconds();
		if ( $hold <= 0 ) {
			return Cetech_Pos_Bridge_Response::wp_error(
				'INTEGRATION_UNAVAILABLE',
				'Woo hold-stock minutes is not configured; prepare cannot claim a bounded reserved commitment.',
				true,
				'resolve',
				503
			);
		}
		if ( ! is_string( $recovery_token ) || ! preg_match( '/^[0-9a-f]{64}$/', $recovery_token ) ) {
			return Cetech_Pos_Bridge_Response::wp_error(
				'INTEGRATION_UNAVAILABLE',
				'A high-entropy Woo recovery token is required before order create.',
				true,
				'resolve',
				503
			);
		}
		if ( is_callable( $this->during_create ) ) {
			$cb = $this->during_create;
			$this->during_create = null;
			$cb( $this );
		}
		++$this->create_calls;
		$order_id = (string) $this->next_order_id;
		++$this->next_order_id;
		$sale_id  = 'sale-' . $order_id;
		$customer = isset( $quote['customer'] ) && is_array( $quote['customer'] ) ? $quote['customer'] : array( 'kind' => 'walkin' );
		$frozen   = $this->build_frozen_prepare_document( $quote, $transaction_id, $request_hash );
		$this->orders[] = array(
			'id'              => $order_id,
			'pos'             => true,
			'transaction_id'  => (string) $transaction_id,
			'request_hash'    => (string) $request_hash,
			'sale_id'         => $sale_id,
			'status'          => 'pending',
			'created_via'     => 'cetech-pos',
			'reserved'        => false,
			'items'           => array(),
			'quote_lines'     => array(),
			'recovery_token'  => $recovery_token,
			'order_key'       => $recovery_token,
			'customer_kind'   => isset( $customer['kind'] ) ? $customer['kind'] : 'walkin',
			'customer_id'     => ( isset( $customer['kind'] ) && $customer['kind'] !== 'walkin' && isset( $customer['customerId'] ) )
				? $customer['customerId']
				: 0,
			'quote_id'        => isset( $quote['id'] ) ? $quote['id'] : null,
			'quote_fp'        => isset( $quote['fingerprint'] ) ? $quote['fingerprint'] : null,
			'frozen_prepare'  => $frozen,
		);
		$this->record_woo_mutation( 'order_creates' );
		if ( is_callable( $on_order_identity ) ) {
			$bound = call_user_func( $on_order_identity, $order_id, $sale_id );
			if ( Cetech_Pos_Bridge_Quote_Request::is_error( $bound ) ) {
				return $bound;
			}
		}
		$this->fire_seam( $this->after_initial_order_save );
		$applied = $this->apply_quote_snapshot_to_order_id( $order_id, $quote );
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $applied ) ) {
			return $applied;
		}
		$this->fire_seam( $this->after_quote_snapshot );
		$this->attach_recovery_meta( $order_id, $transaction_id, $request_hash );
		$this->fire_seam( $this->after_meta_save );
		$reserved = $this->reserve_order_stock( $order_id );
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $reserved ) ) {
			if ( is_object( $reserved ) && method_exists( $reserved, 'get_error_code' ) && $reserved->get_error_code() === 'STOCK_CHANGED' ) {
				$this->trash_pos_order( $order_id );
			}
			return $reserved;
		}
		$matched = $this->assert_saved_order_matches_quote( $order_id, $quote );
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $matched ) ) {
			return $matched;
		}
		$described = $this->describe_order( $this->order_as_proof_object_by_id( $order_id ), $hold );
		if ( $described === null || empty( $described['reservationProven'] ) ) {
			return $this->unavailable( 'Woo did not expose a complete current stock reservation after wc_reserve_stock_for_order.' );
		}
		++$this->side_effects['orders'];
		++$this->side_effects['stock'];
		$commitment = $this->force_commitment !== null ? $this->force_commitment : 'reserved';
		if ( $commitment !== 'reserved' && $commitment !== 'reduced' ) {
			$described['reservationProven'] = false;
			unset( $described['stockCommitment'], $described['reservationExpiresAt'] );
			$described['stockCommitment'] = $commitment;
		}
		return $described;
	}

	public function find_orders_by_transaction( $transaction_id ) {
		$out  = array();
		$hold = $this->hold_stock_seconds();
		foreach ( $this->orders as $order ) {
			if ( empty( $order['pos'] ) || $order['transaction_id'] === null || (string) $order['transaction_id'] !== (string) $transaction_id ) {
				continue;
			}
			$described = $this->describe_order( $this->order_as_proof_object( $order ), $hold );
			if ( $described !== null ) {
				$out[] = $described;
			}
		}
		return $out;
	}

	public function find_orders_by_recovery_token( $recovery_token ) {
		if ( ! is_string( $recovery_token ) || ! preg_match( '/^[0-9a-f]{64}$/', $recovery_token ) ) {
			return array();
		}
		$out  = array();
		$hold = $this->hold_stock_seconds();
		foreach ( $this->orders as $order ) {
			if ( empty( $order['pos'] ) ) {
				continue;
			}
			$token = isset( $order['recovery_token'] ) ? (string) $order['recovery_token'] : '';
			$key   = isset( $order['order_key'] ) ? (string) $order['order_key'] : '';
			if ( $token !== (string) $recovery_token && $key !== (string) $recovery_token ) {
				continue;
			}
			$described = $this->describe_order( $this->order_as_proof_object( $order ), $hold );
			if ( $described !== null ) {
				$described['recoveryToken'] = $recovery_token;
				$out[]                      = $described;
			}
		}
		if ( count( $out ) > 1 ) {
			return Cetech_Pos_Bridge_Response::wp_error(
				'REQUIRES_ATTENTION',
				'Multiple Woo orders carry this recovery token.',
				false,
				'contact_manager',
				409
			);
		}
		return $out;
	}

	public function find_order_by_id( $order_id ) {
		$order = $this->order_array_by_id( $order_id );
		if ( ! is_array( $order ) || empty( $order['pos'] ) ) {
			return null;
		}
		$via = isset( $order['created_via'] ) ? (string) $order['created_via'] : '';
		if ( $via !== '' && $via !== 'cetech-pos' ) {
			return Cetech_Pos_Bridge_Response::wp_error(
				'REQUIRES_ATTENTION',
				'Claimed Woo order was not created via cetech-pos.',
				false,
				'contact_manager',
				409
			);
		}
		$described = $this->describe_order( $this->order_as_proof_object( $order ), $this->hold_stock_seconds() );
		if ( ! is_array( $described ) ) {
			return null;
		}
		$described['transactionId'] = isset( $order['transaction_id'] ) && $order['transaction_id'] !== null ? (string) $order['transaction_id'] : '';
		return $described;
	}

	public function frozen_quote_for_order( $order_id ) {
		$order = $this->order_array_by_id( $order_id );
		if ( ! is_array( $order ) || ! isset( $order['frozen_prepare'] ) ) {
			return null;
		}
		$tx   = isset( $order['transaction_id'] ) && $order['transaction_id'] !== null ? (string) $order['transaction_id'] : '';
		$hash = isset( $order['request_hash'] ) && $order['request_hash'] !== null ? (string) $order['request_hash'] : '';
		return $this->quote_from_frozen_document( $order['frozen_prepare'], $tx, $hash );
	}

	public function inspect_recovered_order( array $found, array $quote, $transaction_id, $request_hash ) {
		$order_id = isset( $found['orderId'] ) ? (string) $found['orderId'] : '';
		$order    = $this->order_array_by_id( $order_id );
		if ( ! is_array( $order ) ) {
			return $this->unavailable( 'Woo order could not be loaded to inspect recovered prepare.' );
		}
		$owned = $this->assert_fake_order_is_cetech_owned( $order, $found, $transaction_id, $request_hash );
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $owned ) ) {
			return $owned;
		}
		$records = $this->fake_line_records( $order );
		$state   = $this->classify_quote_snapshot_state( $records, $quote );
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $state ) ) {
			return $state;
		}
		if ( $state !== 'complete' ) {
			return null;
		}
		$matched = $this->assert_saved_order_matches_quote( $order_id, $quote );
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $matched ) ) {
			return null;
		}
		$hold      = $this->hold_stock_seconds();
		$described = $this->describe_order( $this->order_as_proof_object( $order ), $hold );
		if ( $described === null ) {
			return $this->unavailable( 'Recovered Woo order could not be described.' );
		}
		if ( ! empty( $described['reservationProven'] ) && isset( $described['stockCommitment'] ) ) {
			return $described;
		}
		return null;
	}

	public function repair_recovered_order( array $found, array $quote, $transaction_id, $request_hash ) {
		$order_id = isset( $found['orderId'] ) ? (string) $found['orderId'] : '';
		$order    = $this->order_array_by_id( $order_id );
		if ( ! is_array( $order ) ) {
			return $this->unavailable( 'Woo order could not be loaded to repair recovered prepare.' );
		}
		$owned = $this->assert_fake_order_is_cetech_owned( $order, $found, $transaction_id, $request_hash );
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $owned ) ) {
			return $owned;
		}
		$records = $this->fake_line_records( $order );
		$state   = $this->classify_quote_snapshot_state( $records, $quote );
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $state ) ) {
			return $state;
		}
		if ( $state === 'incomplete' && $this->fake_order_has_reservation_rows( $order_id ) ) {
			return Cetech_Pos_Bridge_Response::wp_error(
				'REQUIRES_ATTENTION',
				'Existing reservation makes Quote line repair unsafe.',
				false,
				'contact_manager',
				409
			);
		}
		$applied = $this->apply_quote_snapshot_to_order_id( $order_id, $quote, true );
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $applied ) ) {
			return $applied;
		}
		$sale_id = isset( $found['saleId'] ) && is_string( $found['saleId'] ) && $found['saleId'] !== ''
			? $found['saleId']
			: ( 'sale-' . $order_id );
		$this->attach_recovery_meta( $order_id, $transaction_id, $request_hash );
		foreach ( $this->orders as $index => $row ) {
			if ( (string) $row['id'] === $order_id ) {
				$this->orders[ $index ]['sale_id'] = $sale_id;
				if ( isset( $quote['id'] ) ) {
					$this->orders[ $index ]['quote_id'] = $quote['id'];
				}
				if ( isset( $quote['fingerprint'] ) ) {
					$this->orders[ $index ]['quote_fp'] = $quote['fingerprint'];
				}
			}
		}
		$hold      = $this->hold_stock_seconds();
		$described = $this->describe_order( $this->order_as_proof_object_by_id( $order_id ), $hold );
		if ( $described === null ) {
			return $this->unavailable( 'Recovered Woo order could not be described.' );
		}
		if ( ! empty( $described['reservationProven'] ) && isset( $described['stockCommitment'] ) ) {
			$matched = $this->assert_saved_order_matches_quote( $order_id, $quote );
			return Cetech_Pos_Bridge_Quote_Request::is_error( $matched ) ? $matched : $described;
		}
		$completed = $this->complete_stock_reservation( $described );
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $completed ) ) {
			return $completed;
		}
		$matched = $this->assert_saved_order_matches_quote( $order_id, $quote );
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $matched ) ) {
			return $matched;
		}
		return $completed;
	}

	public function assert_saved_order_matches_quote( $order_id, array $quote ) {
		$saved = $this->order_array_by_id( $order_id );
		$q     = $this->quote_order_economics( $quote );
		if ( ! is_array( $saved ) || $q === null ) {
			return $this->unavailable( 'Prepared Woo order economics could not be compared to the authoritative Quote.' );
		}
		$total = isset( $saved['total_minor'] ) ? (int) $saved['total_minor'] : null;
		if ( $total === null
			|| ! isset( $saved['subtotal_minor'], $saved['discount_minor'], $saved['tax_minor'], $saved['currency'] )
			|| (int) $saved['subtotal_minor'] !== $q['subtotal']
			|| (int) $saved['discount_minor'] !== $q['discount']
			|| (int) $saved['tax_minor'] !== $q['tax']
			|| $total !== $q['total']
			|| (string) $saved['currency'] !== $q['currency']
		) {
			return $this->unavailable( 'Prepared Woo order economics diverged from the authoritative Quote.' );
		}
		$lines = isset( $saved['line_economics'] ) && is_array( $saved['line_economics'] ) ? $saved['line_economics'] : array();
		if ( count( $lines ) !== count( $quote['lines'] ) ) {
			return $this->unavailable( 'Prepared Woo order line economics diverged from the authoritative Quote.' );
		}
		foreach ( $quote['lines'] as $index => $line ) {
			$mapped = $this->quote_line_economics( $line );
			if ( $mapped === null || ! isset( $lines[ $index ] ) ) {
				return $this->unavailable( 'Prepared Woo order line economics diverged from the authoritative Quote.' );
			}
			$saved_line = $lines[ $index ];
			if ( (int) $saved_line['subtotal'] !== $mapped['subtotal']
				|| (int) $saved_line['discount'] !== $mapped['discount']
				|| (int) $saved_line['tax'] !== $mapped['tax']
				|| (int) $saved_line['total'] !== $mapped['total']
				|| (string) $saved_line['quantity'] !== (string) $line['quantity']
			) {
				return $this->unavailable( 'Prepared Woo order line economics diverged from the authoritative Quote.' );
			}
		}
		return true;
	}

	public function apply_quote_snapshot_to_order_id( $order_id, array $quote, $repair_save = false ) {
		$q = $this->quote_order_economics( $quote );
		if ( $q === null ) {
			return $this->unavailable( 'Authoritative Quote order economics could not be read as minor units.' );
		}
		$order = $this->order_array_by_id( $order_id );
		if ( ! is_array( $order ) ) {
			return $this->unavailable( 'Prepared Woo order could not be loaded to prove economics.' );
		}
		$records = $this->fake_line_records( $order );
		$state   = $this->classify_quote_snapshot_state( $records, $quote );
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $state ) ) {
			return $state;
		}
		if ( $state === 'incomplete' ) {
			$written = $this->write_fake_missing_and_partial_lines( $order_id, $quote, $records );
			if ( Cetech_Pos_Bridge_Quote_Request::is_error( $written ) ) {
				return $written;
			}
		}
		$line_econs = array();
		$quote_lines = array();
		foreach ( $quote['lines'] as $line ) {
			$mapped = $this->quote_line_economics( $line );
			if ( $mapped === null ) {
				return $this->unavailable( 'Authoritative Quote line economics could not be read as minor units.' );
			}
			$entry = array(
				'productId'   => isset( $line['productId'] ) ? (string) $line['productId'] : '',
				'variationId' => isset( $line['variationId'] ) ? (string) $line['variationId'] : '',
				'quantity'    => (string) $line['quantity'],
				'subtotal'    => $mapped['subtotal'],
				'discount'    => $mapped['discount'],
				'tax'         => $mapped['tax'],
				'total'       => $mapped['total'],
				'lineId'      => isset( $line['lineId'] ) ? (string) $line['lineId'] : '',
			);
			if ( $mapped['tax'] > 0 ) {
				$entry['taxRates'] = $this->provider_tax_for_line( $line );
			}
			$line_econs[]  = $entry;
			$quote_lines[] = $line;
		}
		$total = $q['total'];
		if ( $this->force_saved_total_minor !== null ) {
			$total = (int) $this->force_saved_total_minor;
		}
		foreach ( $this->orders as $index => $row ) {
			if ( (string) $row['id'] === (string) $order_id ) {
				$this->orders[ $index ]['currency']       = $q['currency'];
				$this->orders[ $index ]['subtotal_minor'] = $q['subtotal'];
				$this->orders[ $index ]['discount_minor'] = $q['discount'];
				$this->orders[ $index ]['tax_minor']      = $q['tax'];
				$this->orders[ $index ]['total_minor']    = $total;
				$this->orders[ $index ]['line_economics'] = $line_econs;
				$this->orders[ $index ]['quote_lines']    = $quote_lines;
				$customer = isset( $quote['customer'] ) && is_array( $quote['customer'] ) ? $quote['customer'] : array( 'kind' => 'walkin' );
				$this->orders[ $index ]['customer_kind'] = isset( $customer['kind'] ) ? $customer['kind'] : 'walkin';
				$this->orders[ $index ]['customer_id']   = ( isset( $customer['kind'] ) && $customer['kind'] !== 'walkin' && isset( $customer['customerId'] ) )
					? $customer['customerId']
					: 0;
				$this->record_woo_mutation( 'quote_snapshot_writes' );
				if ( $repair_save ) {
					$this->record_woo_mutation( 'repair_saves' );
				}
				return $this->assert_saved_order_matches_quote( $order_id, $quote );
			}
		}
		return $this->unavailable( 'Prepared Woo order could not be loaded to prove economics.' );
	}

	/**
	 * @param string                         $order_id
	 * @param array<string,mixed>            $quote
	 * @param array<int,array<string,mixed>> $records
	 * @return true|WP_Error
	 */
	private function write_fake_missing_and_partial_lines( $order_id, array $quote, array $records ) {
		$by_id = array();
		foreach ( $records as $index => $record ) {
			$lid = isset( $record['lineId'] ) ? (string) $record['lineId'] : '';
			if ( $lid !== '' ) {
				$by_id[ $lid ][] = $index;
			}
		}
		foreach ( $quote['lines'] as $line ) {
			$lid = isset( $line['lineId'] ) ? (string) $line['lineId'] : '';
			if ( $lid === '' ) {
				return $this->unavailable( 'Authoritative Quote line identity is required to persist Woo order items.' );
			}
			$mapped = $this->quote_line_economics( $line );
			if ( $mapped === null ) {
				return $this->unavailable( 'Authoritative Quote line economics could not be read as minor units.' );
			}
			$item = $this->fake_item_from_quote_line( $line, $mapped );
			$matches = isset( $by_id[ $lid ] ) ? $by_id[ $lid ] : array();
			if ( count( $matches ) === 0 ) {
				foreach ( $this->orders as $oindex => $row ) {
					if ( (string) $row['id'] === (string) $order_id ) {
						if ( ! isset( $this->orders[ $oindex ]['items'] ) || ! is_array( $this->orders[ $oindex ]['items'] ) ) {
							$this->orders[ $oindex ]['items'] = array();
						}
						$this->orders[ $oindex ]['items'][] = $item;
						if ( ! isset( $this->orders[ $oindex ]['quote_lines'] ) || ! is_array( $this->orders[ $oindex ]['quote_lines'] ) ) {
							$this->orders[ $oindex ]['quote_lines'] = array();
						}
						$this->orders[ $oindex ]['quote_lines'][] = $line;
						$this->record_woo_mutation( 'item_adds' );
						$this->record_woo_mutation( 'quote_snapshot_writes' );
						$this->fire_seam( $this->after_quote_line );
						break;
					}
				}
				continue;
			}
			$record_index = $matches[0];
			$record       = $records[ $record_index ];
			if ( $this->line_record_matches_quote( $record, $line, $mapped ) ) {
				continue;
			}
			foreach ( $this->orders as $oindex => $row ) {
				if ( (string) $row['id'] !== (string) $order_id ) {
					continue;
				}
				foreach ( $this->orders[ $oindex ]['items'] as $iindex => $existing ) {
					if ( isset( $existing['line_id'] ) && (string) $existing['line_id'] === $lid ) {
						$this->orders[ $oindex ]['items'][ $iindex ] = $item;
						$this->record_woo_mutation( 'item_updates' );
						$this->record_woo_mutation( 'quote_snapshot_writes' );
						break;
					}
				}
			}
		}
		return true;
	}

	/**
	 * @param array<string,mixed> $line
	 * @param array<string,mixed> $mapped
	 * @return array<string,mixed>
	 */
	private function fake_item_from_quote_line( array $line, array $mapped ) {
		return array(
			'line_id'     => isset( $line['lineId'] ) ? (string) $line['lineId'] : '',
			'productId'   => isset( $line['productId'] ) ? (string) $line['productId'] : '',
			'variationId' => isset( $line['variationId'] ) ? (string) $line['variationId'] : '',
			'quantity'    => (string) $line['quantity'],
			'subtotal'    => $mapped['subtotal'],
			'discount'    => $mapped['discount'],
			'tax'         => $mapped['tax'],
			'total'       => $mapped['total'],
		);
	}

	/**
	 * @param array<string,mixed> $order
	 * @return array<int,array<string,mixed>>
	 */
	private function fake_line_records( array $order ) {
		$items = array();
		if ( isset( $order['items'] ) && is_array( $order['items'] ) && count( $order['items'] ) > 0 ) {
			$items = $order['items'];
		} elseif ( isset( $order['quote_lines'] ) && is_array( $order['quote_lines'] ) ) {
			foreach ( $order['quote_lines'] as $line ) {
				$items[] = array(
					'line_id'     => isset( $line['lineId'] ) ? (string) $line['lineId'] : '',
					'productId'   => isset( $line['productId'] ) ? (string) $line['productId'] : '',
					'variationId' => isset( $line['variationId'] ) ? (string) $line['variationId'] : '',
					'quantity'    => isset( $line['quantity'] ) ? (string) $line['quantity'] : '',
					'subtotal'    => null,
					'discount'    => null,
					'tax'         => null,
					'total'       => null,
				);
			}
		}
		$out = array();
		foreach ( $items as $item ) {
			$out[] = array(
				'item'        => $item,
				'lineId'      => isset( $item['line_id'] ) ? (string) $item['line_id'] : '',
				'productId'   => isset( $item['productId'] ) ? (string) $item['productId'] : '',
				'variationId' => isset( $item['variationId'] ) ? (string) $item['variationId'] : '',
				'quantity'    => isset( $item['quantity'] ) ? (string) $item['quantity'] : '',
				'subtotal'    => isset( $item['subtotal'] ) ? $item['subtotal'] : null,
				'discount'    => isset( $item['discount'] ) ? $item['discount'] : null,
				'tax'         => isset( $item['tax'] ) ? $item['tax'] : null,
				'total'       => isset( $item['total'] ) ? $item['total'] : null,
			);
		}
		return $out;
	}

	/**
	 * @param array<string,mixed> $order
	 * @param array<string,mixed> $found
	 * @param string              $transaction_id
	 * @param string              $request_hash
	 * @return true|WP_Error
	 */
	private function assert_fake_order_is_cetech_owned( array $order, array $found, $transaction_id, $request_hash ) {
		$status = isset( $order['status'] ) ? (string) $order['status'] : '';
		if ( in_array( $status, array( 'processing', 'completed', 'cancelled', 'refunded', 'failed' ), true ) ) {
			return $this->attention_recovery( 'Recovered Woo order status is not prepared-compatible.' );
		}
		$via = isset( $order['created_via'] ) ? (string) $order['created_via'] : '';
		if ( $via !== '' && $via !== 'cetech-pos' ) {
			return $this->attention_recovery( 'Recovered Woo order was not created via cetech-pos.' );
		}
		$token = isset( $found['recoveryToken'] ) ? (string) $found['recoveryToken'] : '';
		if ( $token !== '' ) {
			$have = isset( $order['recovery_token'] ) ? (string) $order['recovery_token'] : '';
			$key  = isset( $order['order_key'] ) ? (string) $order['order_key'] : '';
			if ( $have !== $token && $key !== $token ) {
				return $this->attention_recovery( 'Recovered Woo order does not carry the claimed recovery token.' );
			}
		}
		$tx = isset( $order['transaction_id'] ) && $order['transaction_id'] !== null ? (string) $order['transaction_id'] : '';
		if ( $tx !== '' && $tx !== (string) $transaction_id ) {
			return $this->attention_recovery( 'Recovered Woo order transaction identity contradicts the claim.' );
		}
		$hash = isset( $order['request_hash'] ) && $order['request_hash'] !== null ? (string) $order['request_hash'] : '';
		if ( $hash !== '' && $hash !== (string) $request_hash ) {
			return $this->attention_recovery( 'Woo order recovery identity did not match the claimed request hash.' );
		}
		return true;
	}

	private function fake_order_has_reservation_rows( $order_id ) {
		return isset( $this->reservation_rows[ (string) $order_id ] ) && is_array( $this->reservation_rows[ (string) $order_id ] ) && count( $this->reservation_rows[ (string) $order_id ] ) > 0;
	}

	/**
	 * Deep snapshot for GET zero-write proof. Not live HPOS.
	 *
	 * @return array<string,mixed>
	 */
	public function snapshot_woo_state() {
		return array(
			'orders'           => unserialize( serialize( $this->orders ) ),
			'reservations'     => unserialize( serialize( $this->reservations ) ),
			'reservation_rows' => unserialize( serialize( $this->reservation_rows ) ),
			'stock'            => $this->stock,
			'mutations'        => $this->woo_mutation_counts(),
			'create_calls'     => $this->create_calls,
			'side_effects'     => $this->side_effect_counts(),
		);
	}

	public function inject_duplicate_recovery_token( $recovery_token ) {
		$order_id = (string) $this->next_order_id;
		++$this->next_order_id;
		$this->orders[] = array(
			'id'             => $order_id,
			'pos'            => true,
			'recovery_token' => (string) $recovery_token,
			'order_key'      => (string) $recovery_token,
			'transaction_id' => null,
			'request_hash'   => null,
			'sale_id'        => 'sale-' . $order_id,
			'status'         => 'pending',
			'created_via'    => 'cetech-pos',
			'reserved'       => false,
		);
	}

	public function complete_stock_reservation( array $found ) {
		if ( ! empty( $found['reservationProven'] ) && isset( $found['stockCommitment'] ) && isset( $found['reservationExpiresAt'] ) && $found['stockCommitment'] === 'reserved' ) {
			return $found;
		}
		$reserved = $this->reserve_order_stock( $found['orderId'] );
		if ( Cetech_Pos_Bridge_Quote_Request::is_error( $reserved ) ) {
			if ( is_object( $reserved ) && method_exists( $reserved, 'get_error_code' ) && $reserved->get_error_code() === 'STOCK_CHANGED' ) {
				return Cetech_Pos_Bridge_Response::wp_error(
					'REQUIRES_ATTENTION',
					'Existing Woo order reservation could not be completed.',
					false,
					'contact_manager',
					409
				);
			}
			return $reserved;
		}
		++$this->side_effects['stock'];
		$hold      = $this->hold_stock_seconds();
		$described = $this->describe_order( $this->order_as_proof_object_by_id( $found['orderId'] ), $hold );
		if ( $described === null || empty( $described['reservationProven'] ) ) {
			return Cetech_Pos_Bridge_Response::wp_error(
				'REQUIRES_ATTENTION',
				'Existing Woo order reservation could not be proven after retry.',
				false,
				'contact_manager',
				409
			);
		}
		return $described;
	}

	public function inject_duplicate_transaction_order( $transaction_id ) {
		$order_id = (string) $this->next_order_id;
		++$this->next_order_id;
		$this->orders[] = array(
			'id'             => $order_id,
			'pos'            => true,
			'transaction_id' => (string) $transaction_id,
			'request_hash'   => 'dup',
			'sale_id'        => 'sale-' . $order_id,
			'status'         => 'pending',
			'reserved'       => true,
		);
	}

	public function inject_pos_order( $transaction_id, $request_hash, $reserved = true, $quote = null ) {
		$order_id = (string) $this->next_order_id;
		++$this->next_order_id;
		$items       = array();
		$quote_lines = array(
			array(
				'productId' => '101',
				'quantity'  => '1',
			),
		);
		$line_econs = array();
		if ( is_array( $quote ) && isset( $quote['lines'] ) && is_array( $quote['lines'] ) ) {
			$quote_lines = $quote['lines'];
			foreach ( $quote['lines'] as $line ) {
				$mapped = $this->quote_line_economics( $line );
				$items[] = array(
					'line_id'     => isset( $line['lineId'] ) ? (string) $line['lineId'] : '',
					'productId'   => isset( $line['productId'] ) ? (string) $line['productId'] : '',
					'variationId' => isset( $line['variationId'] ) ? (string) $line['variationId'] : '',
					'quantity'    => isset( $line['quantity'] ) ? (string) $line['quantity'] : '1',
					'subtotal'    => $mapped !== null ? $mapped['subtotal'] : null,
					'discount'    => $mapped !== null ? $mapped['discount'] : null,
					'tax'         => $mapped !== null ? $mapped['tax'] : null,
					'total'       => $mapped !== null ? $mapped['total'] : null,
				);
				if ( $mapped !== null ) {
					$line_econs[] = array(
						'productId'   => isset( $line['productId'] ) ? (string) $line['productId'] : '',
						'variationId' => isset( $line['variationId'] ) ? (string) $line['variationId'] : '',
						'quantity'    => (string) $line['quantity'],
						'subtotal'    => $mapped['subtotal'],
						'discount'    => $mapped['discount'],
						'tax'         => $mapped['tax'],
						'total'       => $mapped['total'],
						'lineId'      => isset( $line['lineId'] ) ? (string) $line['lineId'] : '',
					);
				}
			}
		}
		$row = array(
			'id'             => $order_id,
			'pos'            => true,
			'transaction_id' => (string) $transaction_id,
			'request_hash'   => (string) $request_hash,
			'sale_id'        => 'sale-' . $order_id,
			'status'         => 'pending',
			'created_via'    => 'cetech-pos',
			'reserved'       => false,
			'items'          => $items,
			'quote_lines'    => $quote_lines,
		);
		if ( is_array( $quote ) ) {
			$q = $this->quote_order_economics( $quote );
			if ( $q !== null ) {
				$row['currency']       = $q['currency'];
				$row['subtotal_minor'] = $q['subtotal'];
				$row['discount_minor'] = $q['discount'];
				$row['tax_minor']      = $q['tax'];
				$row['total_minor']    = $q['total'];
				$row['line_economics'] = $line_econs;
			}
		}
		$this->orders[] = $row;
		if ( $reserved ) {
			$obj = $this->order_as_proof_object_by_id( $order_id );
			$required = $obj !== null ? $this->expected_managed_reservation_quantities( $obj ) : array( '101' => 1 );
			if ( is_array( $required ) ) {
				foreach ( $required as $pid => $qty ) {
					$this->write_reservation_row( $order_id, (string) $pid, $qty, $this->current_reservation_expiry() );
				}
			}
			$this->mark_reserved( $order_id );
		}
	}

	public function inject_unexpected_product_line( $order_id, $product_id = '999' ) {
		$this->append_fake_item(
			$order_id,
			array(
				'line_id'     => 'ffffffff-ffff-4fff-8fff-ffffffffffff',
				'productId'   => (string) $product_id,
				'variationId' => '',
				'quantity'    => '1',
				'subtotal'    => 100,
				'discount'    => 0,
				'tax'         => 0,
				'total'       => 100,
			)
		);
	}

	public function inject_duplicate_line_identity( $order_id, $line_id ) {
		$order = $this->order_array_by_id( $order_id );
		if ( ! is_array( $order ) || empty( $order['items'] ) ) {
			return;
		}
		$copy = $order['items'][0];
		$copy['line_id'] = (string) $line_id;
		$this->append_fake_item( $order_id, $copy );
	}

	public function inject_wrong_product_for_line( $order_id, $line_id, $product_id ) {
		foreach ( $this->orders as $index => $order ) {
			if ( (string) $order['id'] !== (string) $order_id || empty( $order['items'] ) ) {
				continue;
			}
			foreach ( $this->orders[ $index ]['items'] as $iindex => $item ) {
				if ( isset( $item['line_id'] ) && (string) $item['line_id'] === (string) $line_id ) {
					$this->orders[ $index ]['items'][ $iindex ]['productId'] = (string) $product_id;
					return;
				}
			}
		}
	}

	public function inject_unidentifiable_item( $order_id ) {
		$this->append_fake_item(
			$order_id,
			array(
				'line_id'     => '',
				'productId'   => '101',
				'variationId' => '',
				'quantity'    => '1',
				'subtotal'    => 1000,
				'discount'    => 0,
				'tax'         => 0,
				'total'       => 1000,
			)
		);
	}

	public function make_partial_identifiable_line( $order_id, $line_id ) {
		foreach ( $this->orders as $index => $order ) {
			if ( (string) $order['id'] !== (string) $order_id || empty( $order['items'] ) ) {
				continue;
			}
			foreach ( $this->orders[ $index ]['items'] as $iindex => $item ) {
				if ( isset( $item['line_id'] ) && (string) $item['line_id'] === (string) $line_id ) {
					$this->orders[ $index ]['items'][ $iindex ]['subtotal'] = 0;
					$this->orders[ $index ]['items'][ $iindex ]['total']    = 0;
					unset( $this->orders[ $index ]['subtotal_minor'], $this->orders[ $index ]['total_minor'], $this->orders[ $index ]['line_economics'] );
					return;
				}
			}
		}
	}

	private function append_fake_item( $order_id, array $item ) {
		foreach ( $this->orders as $index => $order ) {
			if ( (string) $order['id'] === (string) $order_id ) {
				if ( ! isset( $this->orders[ $index ]['items'] ) || ! is_array( $this->orders[ $index ]['items'] ) ) {
					$this->orders[ $index ]['items'] = array();
				}
				$this->orders[ $index ]['items'][] = $item;
				return;
			}
		}
	}

	public function inject_reservation_row( $order_id, $product_id, $quantity, $expires_unix ) {
		$this->write_reservation_row( $order_id, $product_id, $quantity, $expires_unix );
	}

	public function reservation_is_proven( $order_id ) {
		$obj = $this->order_as_proof_object_by_id( $order_id );
		return $obj !== null && is_array( $this->prove_order_reservation( $obj ) );
	}

	private function attach_recovery_meta( $order_id, $transaction_id, $request_hash ) {
		foreach ( $this->orders as $index => $order ) {
			if ( (string) $order['id'] === (string) $order_id ) {
				$this->orders[ $index ]['transaction_id'] = (string) $transaction_id;
				$this->orders[ $index ]['request_hash']   = (string) $request_hash;
				$this->record_woo_mutation( 'recovery_meta_writes' );
				return;
			}
		}
	}

	private function reserve_order_stock( $order_id ) {
		$target = $this->order_array_by_id( $order_id );
		if ( $target === null ) {
			return Cetech_Pos_Bridge_Response::wp_error(
				'STOCK_CHANGED',
				'Quoted stock is no longer available.',
				false,
				'review_quote',
				409,
				array( 'field' => 'lines' )
			);
		}
		$obj = $this->order_as_proof_object( $target );
		if ( is_array( $this->prove_order_reservation( $obj ) ) ) {
			$this->mark_reserved( $order_id );
			return true;
		}
		if ( is_callable( $this->during_reserve ) ) {
			$cb = $this->during_reserve;
			$this->during_reserve = null;
			$cb( $this );
		}
		if ( is_string( $this->reserve_exception ) && $this->reserve_exception !== '' ) {
			$ex = new Cetech_Pos_Bridge_Test_ReserveStockException( $this->reserve_exception, 'forced reserve failure' );
			$this->reserve_exception = null;
			return $this->reservation_failure_from_exception( $ex, false );
		}
		$required = $this->expected_managed_reservation_quantities( $obj );
		if ( ! is_array( $required ) || $required === array() ) {
			return $this->unavailable( 'Woo did not expose a complete current stock reservation after wc_reserve_stock_for_order.' );
		}
		ksort( $required );
		foreach ( $required as $pid => $qty ) {
			$pid = (string) $pid;
			$qty = (float) $qty;
			$row = $this->current_reservation_row( $order_id, $pid );
			if ( $row !== null && ( (float) $row['stock_quantity'] + 0.0000001 ) >= $qty ) {
				continue;
			}
			$available = isset( $this->stock[ $pid ] ) ? (int) $this->stock[ $pid ] : 0;
			$already   = isset( $this->reservations[ $order_id ][ $pid ] ) ? (int) $this->reservations[ $order_id ][ $pid ] : 0;
			$need      = (int) $qty - $already;
			if ( $need > 0 && $available < $need ) {
				$this->trash_pos_order( $order_id );
				return Cetech_Pos_Bridge_Response::wp_error(
					'STOCK_CHANGED',
					'Quoted stock is no longer available.',
					false,
					'review_quote',
					409,
					array( 'field' => 'lines' )
				);
			}
			if ( $need > 0 ) {
				$this->stock[ $pid ] -= $need;
				if ( ! isset( $this->reservations[ $order_id ] ) ) {
					$this->reservations[ $order_id ] = array();
				}
				$this->reservations[ $order_id ][ $pid ] = (int) $qty;
			}
			$this->write_reservation_row( $order_id, $pid, $qty, $this->current_reservation_expiry() );
			$this->record_woo_mutation( 'stock_reservations' );
			if ( is_callable( $this->after_product_reserve ) ) {
				$cb = $this->after_product_reserve;
				$this->after_product_reserve = null;
				$cb( $this, $pid );
			}
		}
		if ( is_array( $this->prove_order_reservation( $this->order_as_proof_object_by_id( $order_id ) ) ) ) {
			$this->mark_reserved( $order_id );
		}
		return true;
	}

	protected function read_current_reservation_rows( $order ) {
		if ( ! $order instanceof Cetech_Pos_Bridge_Fake_Order ) {
			return parent::read_current_reservation_rows( $order );
		}
		$order_id = (string) $order->get_id();
		$out      = array();
		if ( ! isset( $this->reservation_rows[ $order_id ] ) || ! is_array( $this->reservation_rows[ $order_id ] ) ) {
			return $out;
		}
		foreach ( $this->reservation_rows[ $order_id ] as $pid => $row ) {
			$exp = isset( $row['expires'] ) ? (int) $row['expires'] : 0;
			if ( $exp <= time() ) {
				continue;
			}
			$out[ (string) $pid ] = array(
				'product_id'     => (string) $pid,
				'stock_quantity' => $row['stock_quantity'],
				'expires'        => $exp,
			);
		}
		return $out;
	}

	private function order_as_proof_object_by_id( $order_id ) {
		$order = $this->order_array_by_id( $order_id );
		return $order === null ? null : $this->order_as_proof_object( $order );
	}

	private function order_array_by_id( $order_id ) {
		foreach ( $this->orders as $order ) {
			if ( (string) $order['id'] === (string) $order_id ) {
				return $order;
			}
		}
		return null;
	}

	private function order_as_proof_object( array $order ) {
		$obj     = new Cetech_Pos_Bridge_Fake_Order( $order['id'] );
		$obj->id = $order['id'];
		$obj->meta[ Cetech_Pos_Bridge_Constants::ORDER_META_TX ]       = isset( $order['transaction_id'] ) ? (string) $order['transaction_id'] : '';
		$obj->meta[ Cetech_Pos_Bridge_Constants::ORDER_META_HASH ]     = isset( $order['request_hash'] ) ? (string) $order['request_hash'] : '';
		$obj->meta[ Cetech_Pos_Bridge_Constants::ORDER_META_SALE ]     = isset( $order['sale_id'] ) ? (string) $order['sale_id'] : '';
		$obj->meta[ Cetech_Pos_Bridge_Constants::ORDER_META_RECOVERY ] = isset( $order['recovery_token'] ) ? (string) $order['recovery_token'] : '';
		$obj->order_key   = isset( $order['order_key'] ) ? (string) $order['order_key'] : ( isset( $order['recovery_token'] ) ? (string) $order['recovery_token'] : '' );
		$obj->created_via = isset( $order['created_via'] ) ? (string) $order['created_via'] : '';
		$obj->status      = isset( $order['status'] ) ? (string) $order['status'] : 'pending';
		$lines            = array();
		if ( isset( $order['items'] ) && is_array( $order['items'] ) && count( $order['items'] ) > 0 ) {
			foreach ( $order['items'] as $item_row ) {
				$lines[] = array(
					'productId'   => isset( $item_row['productId'] ) ? (string) $item_row['productId'] : '',
					'variationId' => isset( $item_row['variationId'] ) ? (string) $item_row['variationId'] : '',
					'quantity'    => isset( $item_row['quantity'] ) ? $item_row['quantity'] : 1,
					'lineId'      => isset( $item_row['line_id'] ) ? (string) $item_row['line_id'] : '',
				);
			}
		} elseif ( isset( $order['quote_lines'] ) && is_array( $order['quote_lines'] ) ) {
			$lines = $order['quote_lines'];
		}
		foreach ( $lines as $line ) {
			$pid = ( isset( $line['variationId'] ) && (string) $line['variationId'] !== '' )
				? (string) $line['variationId']
				: (string) $line['productId'];
			$rules = $this->product_reserve_rules( $pid, isset( $line['productId'] ) ? (string) $line['productId'] : $pid );
			$item  = new Cetech_Pos_Bridge_Fake_Order_Item(
				new Cetech_Pos_Bridge_Fake_Stock_Product( $rules['managing_stock'], $rules['backorders_allowed'], $rules['stock_managed_by'] ),
				isset( $line['quantity'] ) ? $line['quantity'] : 1
			);
			$obj->items[] = $item;
		}
		return $obj;
	}

	private function product_reserve_rules( $pid, $parent ) {
		$defaults = array(
			'managing_stock'     => true,
			'backorders_allowed' => false,
			'stock_managed_by'   => (string) $pid,
		);
		$rules = isset( $this->product_stock_rules[ $pid ] ) ? $this->product_stock_rules[ $pid ] : ( isset( $this->product_stock_rules[ $parent ] ) ? $this->product_stock_rules[ $parent ] : array() );
		return array_merge( $defaults, $rules );
	}

	private function current_reservation_row( $order_id, $product_id ) {
		if ( ! isset( $this->reservation_rows[ $order_id ][ $product_id ] ) ) {
			return null;
		}
		$row = $this->reservation_rows[ $order_id ][ $product_id ];
		$exp = isset( $row['expires'] ) ? (int) $row['expires'] : 0;
		if ( $exp <= time() ) {
			return null;
		}
		return $row;
	}

	private function write_reservation_row( $order_id, $product_id, $quantity, $expires_unix ) {
		$order_id   = (string) $order_id;
		$product_id = (string) $product_id;
		if ( ! isset( $this->reservation_rows[ $order_id ] ) ) {
			$this->reservation_rows[ $order_id ] = array();
		}
		$this->reservation_rows[ $order_id ][ $product_id ] = array(
			'stock_quantity' => $quantity,
			'expires'        => (int) $expires_unix,
		);
	}

	private function current_reservation_expiry() {
		if ( $this->reservation_expiry_unix !== null ) {
			return (int) $this->reservation_expiry_unix;
		}
		return time() + $this->hold_stock_seconds();
	}

	private function mark_reserved( $order_id ) {
		foreach ( $this->orders as $index => $order ) {
			if ( (string) $order['id'] === (string) $order_id ) {
				$this->orders[ $index ]['reserved'] = true;
				return;
			}
		}
	}

	private function trash_pos_order( $order_id ) {
		$order_id = (string) $order_id;
		if ( isset( $this->reservations[ $order_id ] ) ) {
			foreach ( $this->reservations[ $order_id ] as $pid => $qty ) {
				if ( ! isset( $this->stock[ $pid ] ) ) {
					$this->stock[ $pid ] = 0;
				}
				$this->stock[ $pid ] += $qty;
			}
			unset( $this->reservations[ $order_id ] );
		}
		unset( $this->reservation_rows[ $order_id ] );
		$kept = array();
		foreach ( $this->orders as $order ) {
			if ( (string) $order['id'] !== (string) $order_id ) {
				$kept[] = $order;
			}
		}
		$this->orders = $kept;
	}

	private function catalog_key( array $line ) {
		$key = $line['productId'];
		if ( isset( $line['variationId'] ) ) {
			$key .= ':' . $line['variationId'];
		}
		return $key;
	}

	private function minor_to_decimal( $minor ) {
		$minor = (int) $minor;
		return sprintf( '%d.%02d', intdiv( $minor, 100 ), $minor % 100 );
	}

	public function inspect_commercial_snapshot( $order_id ) {
		$order = $this->order_array_by_id( $order_id );
		if ( ! is_array( $order ) ) {
			return null;
		}
		$obj    = $this->order_as_proof_object( $order );
		$proven = $obj !== null && $this->order_has_proven_reservation( $obj );
		$paid   = ! empty( $order['paid'] ) || in_array( isset( $order['status'] ) ? $order['status'] : '', array( 'processing', 'completed' ), true );
		$status = isset( $order['status'] ) ? (string) $order['status'] : 'pending';
		return array(
			'found'             => true,
			'orderId'           => (string) $order['id'],
			'saleId'            => isset( $order['sale_id'] ) ? (string) $order['sale_id'] : '',
			'orderReference'    => (string) $order['id'],
			'transactionId'     => isset( $order['transaction_id'] ) ? (string) $order['transaction_id'] : '',
			'requestHash'       => isset( $order['request_hash'] ) ? (string) $order['request_hash'] : '',
			'createdVia'        => isset( $order['created_via'] ) ? (string) $order['created_via'] : '',
			'status'            => $status,
			'paid'              => $paid,
			'paymentId'         => isset( $order['payment_id'] ) && $order['payment_id'] !== '' && $order['payment_id'] !== null
				? (string) $order['payment_id']
				: null,
			'evidenceId'        => isset( $order['evidence_id'] ) && $order['evidence_id'] !== '' && $order['evidence_id'] !== null
				? (string) $order['evidence_id']
				: null,
			'currency'          => isset( $order['currency'] ) ? (string) $order['currency'] : Cetech_Pos_Bridge_Constants::SETTLEMENT_CURRENCY,
			'totalMinor'        => $this->force_saved_total_minor !== null
				? (int) $this->force_saved_total_minor
				: ( isset( $order['total_minor'] ) ? (int) $order['total_minor'] : null ),
			'cancelled'         => in_array( $status, array( 'cancelled', 'canceled' ), true ),
			'reservationProven' => $proven,
			'stockReduced'      => ! empty( $order['stock_reduced'] ),
			'cetechOwned'       => ( isset( $order['created_via'] ) && $order['created_via'] === 'cetech-pos' && ! empty( $order['pos'] ) ),
			'holdSeconds'       => $this->hold_stock_seconds(),
		);
	}

	public function bind_verified_payment( $order_id, array $payment ) {
		$order = $this->order_array_by_id( $order_id );
		if ( ! is_array( $order ) ) {
			return $this->unavailable( 'Woo order could not be loaded to bind verified payment evidence.' );
		}
		$order['payment_id']          = (string) $payment['paymentId'];
		$order['evidence_id']         = (string) $payment['evidenceId'];
		$order['tender']              = (string) $payment['tender'];
		$order['verification_source'] = (string) $payment['verificationSource'];
		$order['verified_at']         = (string) $payment['verifiedAt'];
		$this->replace_order( $order_id, $order );
		$this->record_woo_mutation( 'payment_meta_writes' );
		$this->fire_seam( $this->after_payment_binding );
		return true;
	}

	public function complete_verified_payment( $order_id, $payment_id ) {
		$order = $this->order_array_by_id( $order_id );
		if ( ! is_array( $order ) ) {
			return $this->unavailable( 'Woo order could not be loaded to complete payment.' );
		}
		$paid = ! empty( $order['paid'] ) || in_array( isset( $order['status'] ) ? $order['status'] : '', array( 'processing', 'completed' ), true );
		if ( $paid ) {
			$existing = isset( $order['payment_id'] ) ? (string) $order['payment_id'] : '';
			if ( $existing === (string) $payment_id ) {
				return true;
			}
			return Cetech_Pos_Bridge_Response::wp_error(
				'REQUIRES_ATTENTION',
				'Woo order is already paid with a different payment identity.',
				false,
				'contact_manager',
				409
			);
		}
		$order['paid']       = true;
		$order['status']     = 'processing';
		$order['payment_id'] = (string) $payment_id;
		if ( empty( $order['stock_reduced'] ) ) {
			$this->commit_reserved_stock( $order_id );
			$order                   = $this->order_array_by_id( $order_id );
			$order['stock_reduced']  = true;
			$order['paid']           = true;
			$order['status']         = 'processing';
			$order['payment_id']     = (string) $payment_id;
			++$this->stock_reduce_calls;
			$this->record_woo_mutation( 'stock_reductions' );
			++$this->side_effects['stock'];
		}
		$this->replace_order( $order_id, $order );
		++$this->payment_complete_calls;
		$this->record_woo_mutation( 'payment_completes' );
		++$this->side_effects['payments'];
		if ( $this->throw_after_payment_complete ) {
			$this->throw_after_payment_complete = false;
			throw new RuntimeException( 'payment_complete threw after commercial effect' );
		}
		return true;
	}

	public function release_reserved_stock( $order_id ) {
		$order = $this->order_array_by_id( $order_id );
		if ( ! is_array( $order ) ) {
			return $this->unavailable( 'Woo order could not be loaded to release reserved stock.' );
		}
		if ( ! empty( $order['stock_reduced'] ) ) {
			return Cetech_Pos_Bridge_Response::wp_error(
				'REQUIRES_ATTENTION',
				'Prepared order stock is already reduced; cancel will not invent a restock.',
				false,
				'contact_manager',
				409
			);
		}
		$had = isset( $this->reservations[ $order_id ] ) || isset( $this->reservation_rows[ $order_id ] );
		if ( $had ) {
			if ( isset( $this->reservations[ $order_id ] ) && is_array( $this->reservations[ $order_id ] ) ) {
				foreach ( $this->reservations[ $order_id ] as $pid => $qty ) {
					if ( ! isset( $this->stock[ $pid ] ) ) {
						$this->stock[ $pid ] = 0;
					}
					$this->stock[ $pid ] += (int) $qty;
				}
			}
			unset( $this->reservations[ $order_id ], $this->reservation_rows[ $order_id ] );
			++$this->reservation_release_calls;
			$this->record_woo_mutation( 'reservation_releases' );
		}
		$order['reserved'] = false;
		$this->replace_order( $order_id, $order );
		$this->fire_seam( $this->after_reservation_release );
		return true;
	}

	public function cancel_unpaid_order( $order_id, $reason ) {
		unset( $reason );
		$order = $this->order_array_by_id( $order_id );
		if ( ! is_array( $order ) ) {
			return $this->unavailable( 'Woo order could not be loaded to cancel.' );
		}
		if ( in_array( isset( $order['status'] ) ? $order['status'] : '', array( 'cancelled', 'canceled' ), true ) ) {
			return true;
		}
		$order['status'] = 'cancelled';
		$this->replace_order( $order_id, $order );
		++$this->order_cancel_calls;
		$this->record_woo_mutation( 'order_cancels' );
		$this->fire_seam( $this->after_order_cancelled );
		return true;
	}

	public function expire_reservations( $order_id ) {
		if ( ! isset( $this->reservation_rows[ $order_id ] ) || ! is_array( $this->reservation_rows[ $order_id ] ) ) {
			return;
		}
		foreach ( $this->reservation_rows[ $order_id ] as $pid => $row ) {
			$row['expires'] = time() - 30;
			$this->reservation_rows[ $order_id ][ $pid ] = $row;
		}
		$order = $this->order_array_by_id( $order_id );
		if ( is_array( $order ) ) {
			$order['reserved'] = false;
			$this->replace_order( $order_id, $order );
		}
	}

	public function mark_stock_reduced_unpaid( $order_id ) {
		$order = $this->order_array_by_id( $order_id );
		if ( ! is_array( $order ) ) {
			return;
		}
		$order['stock_reduced'] = true;
		$order['paid']          = false;
		$order['status']        = 'pending';
		$this->replace_order( $order_id, $order );
	}

	public function mark_paid_with_payment( $order_id, $payment_id ) {
		$order = $this->order_array_by_id( $order_id );
		if ( ! is_array( $order ) ) {
			return;
		}
		$order['paid']          = true;
		$order['status']        = 'processing';
		$order['payment_id']    = (string) $payment_id;
		$order['stock_reduced'] = true;
		$this->replace_order( $order_id, $order );
	}

	private function commit_reserved_stock( $order_id ) {
		unset( $this->reservations[ $order_id ], $this->reservation_rows[ $order_id ] );
		$order = $this->order_array_by_id( $order_id );
		if ( is_array( $order ) ) {
			$order['reserved'] = false;
			$this->replace_order( $order_id, $order );
		}
	}

	private function replace_order( $order_id, array $row ) {
		foreach ( $this->orders as $i => $order ) {
			if ( (string) $order['id'] === (string) $order_id ) {
				$this->orders[ $i ] = $row;
				return;
			}
		}
	}

	public function inspect_historic_order_lines( $order_id ) {
		$order = $this->order_array_by_id( $order_id );
		if ( ! is_array( $order ) ) {
			return $this->unavailable( 'Woo order could not be loaded to inspect historic sale lines.' );
		}
		return $this->fake_line_records( $order );
	}

	public function create_commercial_refund( $order_id, $amount_minor, $currency, $commercial_refund_id, $transaction_id, $request_hash, $reason ) {
		unset( $reason, $currency );
		$found = $this->find_commercial_refunds( $order_id, $commercial_refund_id );
		if ( count( $found ) > 1 ) {
			return $this->attention_recovery( 'Multiple native Woo refunds carry this commercialRefundId.' );
		}
		if ( count( $found ) === 1 ) {
			$match = $found[0];
			if ( ! $this->commercial_refund_matches( $match, $order_id, $amount_minor, $transaction_id, $request_hash ) ) {
				return $this->attention_recovery( 'Native Woo refund identity contradicts the commercial refund claim.' );
			}
			return $match;
		}
		$this->armed_commercial_refund = array(
			'commercialRefundId' => (string) $commercial_refund_id,
			'transactionId'      => (string) $transaction_id,
			'requestHash'        => (string) $request_hash,
			'orderId'            => (string) $order_id,
			'amountMinor'        => (int) $amount_minor,
		);
		$this->fire_seam( $this->before_refund_create );
		if ( $this->fail_commercial_refund_before_native ) {
			$this->fail_commercial_refund_before_native = false;
			$this->armed_commercial_refund = null;
			return $this->unavailable( 'Native Woo refund was not created.' );
		}
		++$this->commercial_refund_creates;
		$this->last_refund_flags = array(
			'refund_payment' => false,
			'restock_items'  => false,
		);
		$refund_id = (string) $this->next_refund_id;
		++$this->next_refund_id;
		$row       = array(
			'id'                   => $refund_id,
			'parent'               => (string) $order_id,
			'amount_minor'         => (int) $amount_minor,
			'commercial_refund_id' => (string) $commercial_refund_id,
			'transaction_id'       => (string) $transaction_id,
			'request_hash'         => (string) $request_hash,
			'refund_payment'       => false,
			'restock_items'        => false,
		);
		$this->refunds[] = $row;
		if ( $this->duplicate_refund_on_create ) {
			$dup         = $row;
			$dup['id']   = (string) $this->next_refund_id;
			++$this->next_refund_id;
			$this->refunds[] = $dup;
		}
		$this->record_woo_mutation( 'commercial_refunds' );
		if ( $this->throw_after_refund_create ) {
			$this->throw_after_refund_create = false;
			throw new RuntimeException( 'wc_create_refund threw after native refund' );
		}
		$this->armed_commercial_refund = null;
		return array(
			'refundId'           => $refund_id,
			'parentOrderId'      => (string) $order_id,
			'amountMinor'        => (int) $amount_minor,
			'commercialRefundId' => (string) $commercial_refund_id,
			'transactionId'      => (string) $transaction_id,
			'requestHash'        => (string) $request_hash,
			'refundPayment'      => false,
			'restockItems'       => false,
		);
	}

	public function find_commercial_refunds( $order_id, $commercial_refund_id ) {
		$out = array();
		foreach ( $this->refunds as $row ) {
			if ( (string) $row['commercial_refund_id'] !== (string) $commercial_refund_id ) {
				continue;
			}
			if ( (string) $row['parent'] !== (string) $order_id ) {
				continue;
			}
			$out[] = array(
				'refundId'           => (string) $row['id'],
				'parentOrderId'      => (string) $row['parent'],
				'amountMinor'        => (int) $row['amount_minor'],
				'commercialRefundId' => (string) $row['commercial_refund_id'],
				'transactionId'      => (string) $row['transaction_id'],
				'requestHash'        => (string) $row['request_hash'],
				'refundPayment'      => false,
				'restockItems'       => false,
			);
		}
		return $out;
	}

	public function increase_sellable_stock( $owner_id, $quantity ) {
		$qty = (int) $quantity;
		if ( $qty <= 0 ) {
			return $this->unavailable( 'Sellable restock quantity must be a positive integer for the supported Woo stock API.' );
		}
		$owner_id = (string) $owner_id;
		if ( ! isset( $this->stock[ $owner_id ] ) ) {
			$this->stock[ $owner_id ] = 0;
		}
		$this->stock[ $owner_id ] += $qty;
		++$this->stock_increase_calls;
		$this->record_woo_mutation( 'stock_increases' );
		++$this->side_effects['stock'];
		if ( $this->throw_on_stock_increase_n !== null && $this->stock_increase_calls === (int) $this->throw_on_stock_increase_n ) {
			$this->throw_on_stock_increase_n = null;
			throw new RuntimeException( 'stock increase threw after native mutation' );
		}
		return true;
	}

	public function stock_managed_owner_id( $product_id, $variation_id = null ) {
		$candidate = ( is_string( $variation_id ) && $variation_id !== '' ) ? $variation_id : (string) $product_id;
		if ( isset( $this->product_stock_rules[ $candidate ]['stock_managed_by'] ) ) {
			return (string) $this->product_stock_rules[ $candidate ]['stock_managed_by'];
		}
		return (string) $candidate;
	}

	public function inject_line_economics( $order_id, $line_id, $field, $minor ) {
		foreach ( $this->orders as $index => $order ) {
			if ( (string) $order['id'] !== (string) $order_id || empty( $order['items'] ) ) {
				continue;
			}
			foreach ( $this->orders[ $index ]['items'] as $iindex => $item ) {
				if ( isset( $item['line_id'] ) && (string) $item['line_id'] === (string) $line_id ) {
					$this->orders[ $index ]['items'][ $iindex ][ $field ] = (int) $minor;
					return;
				}
			}
		}
	}

	public function inject_line_quantity( $order_id, $line_id, $quantity ) {
		foreach ( $this->orders as $index => $order ) {
			if ( (string) $order['id'] !== (string) $order_id || empty( $order['items'] ) ) {
				continue;
			}
			foreach ( $this->orders[ $index ]['items'] as $iindex => $item ) {
				if ( isset( $item['line_id'] ) && (string) $item['line_id'] === (string) $line_id ) {
					$this->orders[ $index ]['items'][ $iindex ]['quantity'] = (string) $quantity;
					return;
				}
			}
		}
	}

	public function inject_line_variation( $order_id, $line_id, $variation_id ) {
		foreach ( $this->orders as $index => $order ) {
			if ( (string) $order['id'] !== (string) $order_id || empty( $order['items'] ) ) {
				continue;
			}
			foreach ( $this->orders[ $index ]['items'] as $iindex => $item ) {
				if ( isset( $item['line_id'] ) && (string) $item['line_id'] === (string) $line_id ) {
					$this->orders[ $index ]['items'][ $iindex ]['variationId'] = (string) $variation_id;
					return;
				}
			}
		}
	}

	public function native_refund_count_for( $commercial_refund_id ) {
		$count = 0;
		foreach ( $this->refunds as $row ) {
			if ( (string) $row['commercial_refund_id'] === (string) $commercial_refund_id ) {
				++$count;
			}
		}
		return $count;
	}
}

class Cetech_Pos_Bridge_Fake_Order {
	public $id;
	public $items = array();
	public $meta  = array();
	public $order_key = '';
	public $created_via = '';
	public $status = 'pending';

	public function __construct( $id ) {
		$this->id = $id;
	}

	public function get_id() {
		return $this->id;
	}

	public function get_items() {
		return $this->items;
	}

	public function get_meta( $key ) {
		return isset( $this->meta[ $key ] ) ? $this->meta[ $key ] : '';
	}

	public function get_order_key() {
		return (string) $this->order_key;
	}

	public function get_order_number() {
		return (string) $this->id;
	}

	public function get_created_via() {
		return (string) $this->created_via;
	}

	public function get_status() {
		return (string) $this->status;
	}

	public function is_paid() {
		return in_array( $this->status, array( 'processing', 'completed' ), true );
	}
}

class Cetech_Pos_Bridge_Fake_Order_Item {
	public $product;
	public $qty;

	public function __construct( $product, $qty ) {
		$this->product = $product;
		$this->qty     = $qty;
	}

	public function is_type( $type ) {
		return $type === 'line_item';
	}

	public function get_quantity() {
		return $this->qty;
	}

	public function get_product() {
		return $this->product;
	}
}

class Cetech_Pos_Bridge_Fake_Stock_Product {
	public $managing;
	public $backorders;
	public $managed_by;

	public function __construct( $managing, $backorders, $managed_by ) {
		$this->managing   = (bool) $managing;
		$this->backorders = (bool) $backorders;
		$this->managed_by = (string) $managed_by;
	}

	public function managing_stock() {
		return $this->managing;
	}

	public function backorders_allowed() {
		return $this->backorders;
	}

	public function get_stock_managed_by_id() {
		return $this->managed_by;
	}
}

class Cetech_Pos_Bridge_Test_ReserveStockException extends Exception {
	private $error_code;

	public function __construct( $code, $message = '', $http = 403 ) {
		$this->error_code = (string) $code;
		parent::__construct( $message, $http );
	}

	public function getErrorCode() {
		return $this->error_code;
	}
}

class Cetech_Pos_Bridge_Fake_Pricing_Rules extends Cetech_Pos_Bridge_Pricing_Rules {
	/** @var array<int,array<string,mixed>>|null */
	public $woodmart_records = null;
	/** @var array<string,mixed>|null */
	public $b2bking_records  = null;

	protected function read_woodmart_discount_records() {
		return $this->woodmart_records;
	}

	protected function read_b2bking_rule_records() {
		return $this->b2bking_records;
	}
}

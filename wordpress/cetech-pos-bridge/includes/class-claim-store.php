<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Durable prepare claim.
 *
 * Installation scope is the WordPress site/blog ID (`get_current_blog_id()`,
 * otherwise "1" in the unit harness). That is the real WordPress installation
 * identity, not a fabricated organization UUID. The bridge is a single Woo
 * store per installation. Idempotency uniqueness is:
 *   site_scope + operation_type + Idempotency-Key
 * Transaction uniqueness is:
 *   site_scope + transactionId
 *
 * Woo order metadata is recovery evidence only. It is never the atomic lock.
 */
class Cetech_Pos_Bridge_Claim_Store {
	const STATUS_PREPARING          = 'preparing';
	const STATUS_PREPARED           = 'prepared';
	const STATUS_TERMINAL_FAILURE   = 'terminal_failure';
	const STATUS_REQUIRES_ATTENTION = 'requires_attention';

	const INSERT_CREATED        = 'created';
	const INSERT_DUPLICATE_KEY  = 'duplicate_key';
	const INSERT_DUPLICATE_TX   = 'duplicate_transaction';

	const BIND_NEWLY_BOUND            = 'newly_bound';
	const BIND_ALREADY_BOUND          = 'already_bound';
	const BIND_NOT_FOUND              = 'not_found';
	const BIND_TRANSACTION_MISMATCH   = 'transaction_mismatch';
	const BIND_REQUEST_HASH_MISMATCH  = 'request_hash_mismatch';
	const BIND_CONFLICTING_ORDER_ID   = 'conflicting_woo_order_id';
	const BIND_CONFLICTING_SALE_ID    = 'conflicting_sale_id';
	const BIND_PERSISTENCE_FAILED     = 'persistence_failed';

	/** @var array<string,bool> */
	private $locks = array();

	/** @var array<string,array<string,mixed>> */
	private $by_key = array();

	/** @var array<string,string> */
	private $tx_index = array();

	/** @var callable|null */
	public $during_insert = null;

	public function site_scope() {
		if ( function_exists( 'get_current_blog_id' ) ) {
			return (string) get_current_blog_id();
		}
		return '1';
	}

	/**
	 * @param array<string,mixed> $row
	 * @return string One of INSERT_* constants
	 */
	public function insert_preparing( array $row ) {
		$scope = $this->site_scope();
		$key   = $this->key_index( $scope, $row['operation_type'], $row['idempotency_key'] );
		$tx    = $this->tx_index_key( $scope, $row['transaction_id'] );
		if ( is_callable( $this->during_insert ) ) {
			$cb = $this->during_insert;
			$this->during_insert = null;
			$cb( $this );
		}
		if ( $this->has_wpdb() ) {
			return $this->insert_wpdb( $scope, $row, $key, $tx );
		}
		if ( isset( $this->by_key[ $key ] ) ) {
			return self::INSERT_DUPLICATE_KEY;
		}
		if ( isset( $this->tx_index[ $tx ] ) ) {
			return self::INSERT_DUPLICATE_TX;
		}
		$now  = gmdate( 'Y-m-d H:i:s' );
		$full = array_merge(
			$row,
			array(
				'site_scope'      => $scope,
				'internal_status' => self::STATUS_PREPARING,
				'quote_id'        => isset( $row['quote_id'] ) ? $row['quote_id'] : null,
				'woo_order_id'    => null,
				'sale_id'         => null,
				'outcome_json'    => null,
				'error_code'      => null,
				'error_message'   => null,
				'error_details_json' => null,
				'woo_create_entered' => isset( $row['woo_create_entered'] ) ? (int) $row['woo_create_entered'] : 0,
				'woo_recovery_token' => isset( $row['woo_recovery_token'] ) ? $row['woo_recovery_token'] : null,
				'created_at'      => $now,
				'updated_at'      => $now,
			)
		);
		$this->by_key[ $key ]   = $full;
		$this->tx_index[ $tx ] = $key;
		return self::INSERT_CREATED;
	}

	public function get_by_idempotency( $operation, $idempotency_key ) {
		$scope = $this->site_scope();
		$key   = $this->key_index( $scope, $operation, $idempotency_key );
		if ( $this->has_wpdb() ) {
			return $this->row_wpdb( 'site_scope = %s AND operation_type = %s AND idempotency_key = %s', array( $scope, $operation, $idempotency_key ) );
		}
		return isset( $this->by_key[ $key ] ) ? $this->by_key[ $key ] : null;
	}

	public function get_by_transaction( $transaction_id ) {
		$scope = $this->site_scope();
		$tx    = $this->tx_index_key( $scope, $transaction_id );
		if ( $this->has_wpdb() ) {
			return $this->row_wpdb( 'site_scope = %s AND transaction_id = %s', array( $scope, $transaction_id ) );
		}
		if ( ! isset( $this->tx_index[ $tx ] ) ) {
			return null;
		}
		$key = $this->tx_index[ $tx ];
		return isset( $this->by_key[ $key ] ) ? $this->by_key[ $key ] : null;
	}

	public function save( array $row ) {
		$scope = $this->site_scope();
		$row['site_scope'] = $scope;
		$row['updated_at'] = gmdate( 'Y-m-d H:i:s' );
		if ( $this->has_wpdb() ) {
			$wpdb  = $GLOBALS['wpdb'];
			$table = Cetech_Pos_Bridge_Schema_Install::table_name( $wpdb );
			$wpdb->update(
				$table,
				array(
					'internal_status'    => $row['internal_status'],
					'woo_order_id'       => $row['woo_order_id'],
					'sale_id'            => $row['sale_id'],
					'outcome_json'       => $row['outcome_json'],
					'error_code'         => $row['error_code'],
					'error_message'      => $row['error_message'],
					'error_details_json' => $row['error_details_json'],
					'quote_id'           => isset( $row['quote_id'] ) ? $row['quote_id'] : null,
					'woo_create_entered' => isset( $row['woo_create_entered'] ) ? (int) $row['woo_create_entered'] : 0,
					'woo_recovery_token' => isset( $row['woo_recovery_token'] ) && is_string( $row['woo_recovery_token'] ) && $row['woo_recovery_token'] !== ''
						? $row['woo_recovery_token']
						: null,
					'updated_at'         => $row['updated_at'],
				),
				array(
					'site_scope'      => $scope,
					'operation_type'  => $row['operation_type'],
					'idempotency_key' => $row['idempotency_key'],
				)
			);
			return;
		}
		$key                  = $this->key_index( $scope, $row['operation_type'], $row['idempotency_key'] );
		$this->by_key[ $key ] = $row;
		$this->tx_index[ $this->tx_index_key( $scope, $row['transaction_id'] ) ] = $key;
	}

	/**
	 * Bind the Woo order created for this prepare claim.
	 *
	 * Writes only woo_order_id and sale_id. Does not change status, the
	 * recovery token, the transaction id, or the request hash. The same
	 * identity is idempotent. A different order or sale is a conflict.
	 *
	 * @param string $operation
	 * @param string $idempotency_key
	 * @param string $transaction_id
	 * @param string $request_hash
	 * @param string $woo_order_id
	 * @param string $sale_id
	 * @return string One of BIND_* constants
	 */
	public function bind_created_order_identity( $operation, $idempotency_key, $transaction_id, $request_hash, $woo_order_id, $sale_id ) {
		$woo_order_id = (string) $woo_order_id;
		$sale_id      = (string) $sale_id;
		if ( $woo_order_id === '' || $sale_id === '' ) {
			return self::BIND_NOT_FOUND;
		}
		if ( $this->has_wpdb() ) {
			return $this->bind_wpdb( $operation, $idempotency_key, $transaction_id, $request_hash, $woo_order_id, $sale_id );
		}
		$scope = $this->site_scope();
		$key   = $this->key_index( $scope, $operation, $idempotency_key );
		if ( ! isset( $this->by_key[ $key ] ) ) {
			return self::BIND_NOT_FOUND;
		}
		$row        = $this->by_key[ $key ];
		$classified = $this->classify_bind( $row, $transaction_id, $request_hash, $woo_order_id, $sale_id );
		if ( $classified !== self::BIND_NEWLY_BOUND ) {
			return $classified;
		}
		$row['woo_order_id']      = $woo_order_id;
		$row['sale_id']           = $sale_id;
		$row['updated_at']        = gmdate( 'Y-m-d H:i:s' );
		$this->by_key[ $key ]     = $row;
		return self::BIND_NEWLY_BOUND;
	}

	/**
	 * Non-blocking creator lock. wpdb uses GET_LOCK (released on connection
	 * close). Memory uses a flag; tests simulate crash by throwing inside try
	 * so the engine's finally releases the lock.
	 */
	public function acquire_lock( $operation, $idempotency_key ) {
		$name = $this->lock_name( $operation, $idempotency_key );
		if ( $this->has_wpdb() ) {
			$wpdb = $GLOBALS['wpdb'];
			$got  = $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, 0)', $name ) );
			return (string) $got === '1';
		}
		if ( ! empty( $this->locks[ $name ] ) ) {
			return false;
		}
		$this->locks[ $name ] = true;
		return true;
	}

	public function release_lock( $operation, $idempotency_key ) {
		$name = $this->lock_name( $operation, $idempotency_key );
		if ( $this->has_wpdb() ) {
			$wpdb = $GLOBALS['wpdb'];
			$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $name ) );
			return;
		}
		unset( $this->locks[ $name ] );
	}

	private function insert_wpdb( $scope, array $row, $key, $tx ) {
		unset( $key, $tx );
		$wpdb  = $GLOBALS['wpdb'];
		$table = Cetech_Pos_Bridge_Schema_Install::table_name( $wpdb );
		$now   = gmdate( 'Y-m-d H:i:s' );
		$ok    = $wpdb->insert(
			$table,
			array(
				'site_scope'         => $scope,
				'operation_type'     => $row['operation_type'],
				'idempotency_key'    => $row['idempotency_key'],
				'transaction_id'     => $row['transaction_id'],
				'request_hash'       => $row['request_hash'],
				'quote_id'           => isset( $row['quote_id'] ) ? $row['quote_id'] : null,
				'internal_status'    => self::STATUS_PREPARING,
				'woo_create_entered' => 0,
				'woo_recovery_token' => null,
				'created_at'         => $now,
				'updated_at'         => $now,
			)
		);
		if ( $ok ) {
			return self::INSERT_CREATED;
		}
		if ( $this->get_by_idempotency( $row['operation_type'], $row['idempotency_key'] ) ) {
			return self::INSERT_DUPLICATE_KEY;
		}
		if ( $this->get_by_transaction( $row['transaction_id'] ) ) {
			return self::INSERT_DUPLICATE_TX;
		}
		return self::INSERT_DUPLICATE_KEY;
	}

	private function bind_wpdb( $operation, $idempotency_key, $transaction_id, $request_hash, $woo_order_id, $sale_id ) {
		$claim = $this->get_by_idempotency( $operation, $idempotency_key );
		$seen  = $this->classify_bind( $claim, $transaction_id, $request_hash, $woo_order_id, $sale_id );
		if ( $seen !== self::BIND_NEWLY_BOUND ) {
			return $seen;
		}
		$wpdb  = $GLOBALS['wpdb'];
		$table = Cetech_Pos_Bridge_Schema_Install::table_name( $wpdb );
		$now   = gmdate( 'Y-m-d H:i:s' );
		$sql   = $wpdb->prepare(
			'UPDATE ' . $table . ' SET woo_order_id = %s, sale_id = %s, updated_at = %s WHERE site_scope = %s AND operation_type = %s AND idempotency_key = %s AND transaction_id = %s AND request_hash = %s AND (woo_order_id IS NULL OR woo_order_id = %s OR woo_order_id = %s) AND (sale_id IS NULL OR sale_id = %s OR sale_id = %s)',
			$woo_order_id,
			$sale_id,
			$now,
			$this->site_scope(),
			$operation,
			$idempotency_key,
			$transaction_id,
			$request_hash,
			'',
			$woo_order_id,
			'',
			$sale_id
		);
		$updated = $wpdb->query( $sql );
		if ( $updated === false ) {
			return self::BIND_PERSISTENCE_FAILED;
		}
		$after = $this->classify_bind(
			$this->get_by_idempotency( $operation, $idempotency_key ),
			$transaction_id,
			$request_hash,
			$woo_order_id,
			$sale_id
		);
		if ( (int) $updated > 0 ) {
			if ( $after === self::BIND_ALREADY_BOUND ) {
				return self::BIND_NEWLY_BOUND;
			}
			if ( $after === self::BIND_NEWLY_BOUND ) {
				return self::BIND_PERSISTENCE_FAILED;
			}
			return $after;
		}
		if ( $after === self::BIND_ALREADY_BOUND ) {
			return self::BIND_ALREADY_BOUND;
		}
		if ( $after === self::BIND_NEWLY_BOUND ) {
			return self::BIND_PERSISTENCE_FAILED;
		}
		return $after;
	}

	/**
	 * @param array<string,mixed>|null $claim
	 * @param string                   $transaction_id
	 * @param string                   $request_hash
	 * @param string                   $woo_order_id
	 * @param string                   $sale_id
	 * @return string
	 */
	private function classify_bind( $claim, $transaction_id, $request_hash, $woo_order_id, $sale_id ) {
		if ( ! is_array( $claim ) ) {
			return self::BIND_NOT_FOUND;
		}
		if ( (string) $claim['transaction_id'] !== (string) $transaction_id ) {
			return self::BIND_TRANSACTION_MISMATCH;
		}
		if ( (string) $claim['request_hash'] !== (string) $request_hash ) {
			return self::BIND_REQUEST_HASH_MISMATCH;
		}
		$existing_order = isset( $claim['woo_order_id'] ) && $claim['woo_order_id'] !== null ? (string) $claim['woo_order_id'] : '';
		$existing_sale  = isset( $claim['sale_id'] ) && $claim['sale_id'] !== null ? (string) $claim['sale_id'] : '';
		if ( $existing_order !== '' && $existing_order !== (string) $woo_order_id ) {
			return self::BIND_CONFLICTING_ORDER_ID;
		}
		if ( $existing_sale !== '' && $existing_sale !== (string) $sale_id ) {
			return self::BIND_CONFLICTING_SALE_ID;
		}
		if ( $existing_order === (string) $woo_order_id && $existing_sale === (string) $sale_id ) {
			return self::BIND_ALREADY_BOUND;
		}
		return self::BIND_NEWLY_BOUND;
	}

	private function row_wpdb( $where, array $args ) {
		$wpdb  = $GLOBALS['wpdb'];
		$table = Cetech_Pos_Bridge_Schema_Install::table_name( $wpdb );
		$sql   = $wpdb->prepare( 'SELECT * FROM ' . $table . ' WHERE ' . $where . ' LIMIT 1', $args );
		$row   = $wpdb->get_row( $sql, ARRAY_A );
		return is_array( $row ) ? $row : null;
	}

	private function has_wpdb() {
		return isset( $GLOBALS['wpdb'] ) && is_object( $GLOBALS['wpdb'] ) && method_exists( $GLOBALS['wpdb'], 'insert' );
	}

	private function key_index( $scope, $operation, $idempotency_key ) {
		return $scope . '|' . $operation . '|' . $idempotency_key;
	}

	private function tx_index_key( $scope, $transaction_id ) {
		return $scope . '|tx|' . $transaction_id;
	}

	private function lock_name( $operation, $idempotency_key ) {
		return 'cetech_pos_prep_' . md5( $this->site_scope() . '|' . $operation . '|' . $idempotency_key );
	}
}

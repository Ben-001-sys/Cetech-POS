<?php
/**
 * BR-06 / issue #18 — HPOS-safe idempotent prepare and resolve.
 *
 * Local PHP assertions against an injected Woo runtime. Not live WordPress/Woo
 * evidence. Does not set pricingParityVerified. Database uniqueness is proven
 * by the CREATE TABLE UNIQUE indexes; in-memory interleaving is not a DB
 * concurrency PASS.
 */

$br06_corr     = '550e8400-e29b-41d4-a716-446655440070';
$br06_location = 'loc-training-1';
$br06_seq      = 70;

function br06_uuid( $n ) {
	return sprintf( 'aaaaaaaa-aaaa-4aaa-8aaa-%012d', (int) $n );
}

function br06_next_uuid() {
	global $br06_seq;
	++$br06_seq;
	return br06_uuid( $br06_seq );
}

function br06_runtime() {
	$env              = br01_authorized_env();
	$runtime          = new Cetech_Pos_Bridge_Fake_Woo_Runtime( $env );
	$runtime->bag_key = 'cetech_pos_fake_wc_br06_' . bin2hex( random_bytes( 4 ) );
	$runtime->write_bag( '__idle__', array() );
	$runtime->customers['cust_retail_1'] = 'retail';
	$priced                              = array(
		'unitPrice'   => '10.00',
		'subtotal'    => '10.00',
		'discount'    => '0.00',
		'tax'         => '0.00',
		'stockStatus' => 'in_stock',
		'purchasable' => true,
	);
	$runtime->catalog['walkin']['101']['1']               = $priced;
	$runtime->catalog['retail:cust_retail_1']['101']['1'] = $priced;
	$runtime->stock['101']                                = 10;
	$runtime->hold_stock_minutes                          = 60;
	return $runtime;
}

function br06_stack( Cetech_Pos_Bridge_Fake_Woo_Runtime $runtime ) {
	$store  = new Cetech_Pos_Bridge_Quote_Store();
	$quotes = new Cetech_Pos_Bridge_Quote_Engine( $runtime, $store );
	$claims = new Cetech_Pos_Bridge_Claim_Store();
	$prep   = new Cetech_Pos_Bridge_Prepare_Engine( $runtime, $quotes, $store, $claims );
	return array(
		'quotes' => $quotes,
		'prep'   => $prep,
		'claims' => $claims,
		'store'  => $store,
	);
}

function br06_quote_request() {
	return array(
		'cartId'       => br06_next_uuid(),
		'cartRevision' => 1,
		'customer'     => array( 'kind' => 'walkin' ),
		'locationId'   => $GLOBALS['br06_location'],
		'lines'        => array(
			array(
				'lineId'    => br06_next_uuid(),
				'productId' => '101',
				'quantity'  => '1',
			),
		),
	);
}

function br06_prepare_body( array $quote, $transaction_id = null ) {
	return array(
		'transactionId'    => $transaction_id !== null ? $transaction_id : br06_next_uuid(),
		'registerId'       => 'reg-training-1',
		'shiftId'          => br06_next_uuid(),
		'deviceId'         => br06_next_uuid(),
		'quoteId'          => $quote['id'],
		'quoteFingerprint' => $quote['fingerprint'],
	);
}

function br06_headers( $idempotency_key ) {
	return array(
		'X-Correlation-ID' => $GLOBALS['br06_corr'],
		'Idempotency-Key'  => $idempotency_key,
	);
}

function br06_dispatch_prepare( Cetech_Pos_Bridge_Plugin $plugin, array $body, array $headers ) {
	$controller = $plugin->get_prepare_controller();
	$request    = new Cetech_Pos_Bridge_Test_Request( $headers, '/cetech-pos/v1/sales/prepare', $body );
	$permission = $controller->permission_callback( $request );
	if ( $permission !== true ) {
		return $plugin->normalize_error_response( $permission, null, $request );
	}
	return $controller->handle( $request );
}

function br06_dispatch_resolve( Cetech_Pos_Bridge_Plugin $plugin, $transaction_id, array $headers ) {
	$controller = $plugin->get_resolve_controller();
	$request    = new Cetech_Pos_Bridge_Test_Request(
		$headers,
		'/cetech-pos/v1/sales/' . $transaction_id,
		array(),
		array( 'transactionId' => $transaction_id )
	);
	$permission = $controller->permission_callback( $request );
	if ( $permission !== true ) {
		return $plugin->normalize_error_response( $permission, null, $request );
	}
	return $controller->handle( $request );
}

function br06_error_code( $result ) {
	if ( Cetech_Pos_Bridge_Quote_Request::is_error( $result ) ) {
		return $result->get_error_code();
	}
	return null;
}

function br06_thrower( $message ) {
	return function () use ( $message ) {
		throw new RuntimeException( $message );
	};
}

function br06_prepare_crashed( $prep, array $body, $key, $message ) {
	$crashed = false;
	try {
		$prep->prepare( $body, $key );
	} catch ( RuntimeException $e ) {
		$crashed = ( $e->getMessage() === $message );
	}
	br01_assert( $crashed, $message . ' seam fired' );
}

function br06_order_reserved( Cetech_Pos_Bridge_Fake_Woo_Runtime $runtime ) {
	foreach ( $runtime->orders as $order ) {
		if ( ! empty( $order['pos'] ) && $runtime->reservation_is_proven( $order['id'] ) ) {
			return true;
		}
	}
	return false;
}

function br06_assert_honest_commitment( $result, Cetech_Pos_Bridge_Fake_Woo_Runtime $runtime, $label ) {
	if ( is_array( $result ) && isset( $result['stockCommitment'] ) ) {
		br01_assert(
			$result['stockCommitment'] === 'reserved' || $result['stockCommitment'] === 'reduced',
			$label . ' reports only a contract stockCommitment'
		);
		br01_assert( br06_order_reserved( $runtime ), $label . ' reports reserved only when reservation is proven' );
	}
}

function br06_last_pos_order( Cetech_Pos_Bridge_Fake_Woo_Runtime $runtime ) {
	$last = null;
	foreach ( $runtime->orders as $order ) {
		if ( ! empty( $order['pos'] ) ) {
			$last = $order;
		}
	}
	return $last;
}

function br06_assert_woo_frozen( Cetech_Pos_Bridge_Fake_Woo_Runtime $runtime, array $before, $label ) {
	$after = $runtime->snapshot_woo_state();
	br01_assert_eq( serialize( $before['orders'] ), serialize( $after['orders'] ), $label . ' Woo order state unchanged' );
	br01_assert_eq( serialize( $before['reservations'] ), serialize( $after['reservations'] ), $label . ' reservation map unchanged' );
	br01_assert_eq( serialize( $before['reservation_rows'] ), serialize( $after['reservation_rows'] ), $label . ' reservation rows unchanged' );
	br01_assert_eq( $before['stock'], $after['stock'], $label . ' catalog stock unchanged' );
	br01_assert_eq( $before['mutations'], $after['mutations'], $label . ' Woo mutation counters unchanged' );
	br01_assert_eq( $before['create_calls'], $after['create_calls'], $label . ' create_calls unchanged' );
	br01_assert_eq( $before['side_effects'], $after['side_effects'], $label . ' side-effect counters unchanged' );
}

function br06_assert_saved_matches_quote( Cetech_Pos_Bridge_Fake_Woo_Runtime $runtime, array $quote, array $prepared, $label ) {
	$order = br06_last_pos_order( $runtime );
	br01_assert( is_array( $order ), $label . ' saved a POS Woo order' );
	br01_assert_eq( (int) $quote['subtotal']['minor'], (int) $order['subtotal_minor'], $label . ' Woo subtotal equals Quote.subtotal' );
	br01_assert_eq( (int) $quote['discount']['minor'], (int) $order['discount_minor'], $label . ' Woo discount equals Quote.discount' );
	br01_assert_eq( (int) $quote['tax']['minor'], (int) $order['tax_minor'], $label . ' Woo tax equals Quote.tax' );
	br01_assert_eq( (int) $quote['total']['minor'], (int) $order['total_minor'], $label . ' Woo grand total equals Quote.total' );
	br01_assert_eq( (int) $quote['total']['minor'], (int) $prepared['total']['minor'], $label . ' PreparedSale.total equals Quote.total' );
	br01_assert_eq( (string) $quote['currency'], (string) $order['currency'], $label . ' Woo currency equals Quote.currency' );
	$lines = isset( $order['line_economics'] ) ? $order['line_economics'] : array();
	br01_assert_eq( count( $quote['lines'] ), count( $lines ), $label . ' Woo line count equals Quote line count' );
	foreach ( $quote['lines'] as $index => $line ) {
		br01_assert_eq( (int) $line['subtotal']['minor'], (int) $lines[ $index ]['subtotal'], $label . ' line subtotal matches' );
		br01_assert_eq( (int) $line['discount']['minor'], (int) $lines[ $index ]['discount'], $label . ' line discount matches' );
		br01_assert_eq( (int) $line['tax']['minor'], (int) $lines[ $index ]['tax'], $label . ' line tax matches' );
		br01_assert_eq( (int) $line['total']['minor'], (int) $lines[ $index ]['total'], $label . ' line total matches' );
		br01_assert_eq( (string) $line['quantity'], (string) $lines[ $index ]['quantity'], $label . ' line quantity matches' );
	}
}

$br06_schema = Cetech_Pos_Bridge_Schema::instance();

/* ---------------------------------------------------------------------------
 * Contract / hashing / SQL uniqueness (not live DB concurrency)
 * ------------------------------------------------------------------------ */

$hash_a = Cetech_Pos_Bridge_Request_Hash::hash( array( 'b' => 1, 'a' => array( 'z' => 2, 'y' => 3 ) ) );
$hash_b = Cetech_Pos_Bridge_Request_Hash::hash( array( 'a' => array( 'y' => 3, 'z' => 2 ), 'b' => 1 ) );
br01_assert_eq( $hash_a, $hash_b, 'semantic request hash is key-order independent' );
br01_assert_eq( 64, strlen( $hash_a ), 'request hash is SHA-256 hex' );

$sql = Cetech_Pos_Bridge_Schema_Install::create_table_sql( 'wp_cetech_pos_prepare_claims' );
br01_assert( strpos( $sql, 'UNIQUE KEY uniq_idempotency (site_scope, operation_type, idempotency_key)' ) !== false, 'claim table UNIQUE idempotency identity' );
br01_assert( strpos( $sql, 'UNIQUE KEY uniq_transaction (site_scope, transaction_id)' ) !== false, 'claim table UNIQUE transaction identity' );
br01_assert( strpos( $sql, 'woo_create_entered tinyint(1) NOT NULL DEFAULT 0' ) !== false, 'claim table persists woo_create_entered before wc_create_order' );
br01_assert( strpos( $sql, 'woo_recovery_token char(64) NULL' ) !== false, 'claim table persists opaque Woo recovery token' );
br01_assert( strpos( $sql, 'UNIQUE KEY uniq_recovery_token (site_scope, woo_recovery_token)' ) !== false, 'recovery token uniqueness is bridge-owned' );
$cmd_sql = Cetech_Pos_Bridge_Schema_Install::create_command_table_sql( 'wp_cetech_pos_command_claims' );
br01_assert( strpos( $cmd_sql, 'UNIQUE KEY uniq_command (site_scope, transaction_id, operation_type)' ) !== false, 'command table retains per-transaction uniqueness' );

$fx_sql = Cetech_Pos_Bridge_Schema_Install::create_return_effect_table_sql( 'wp_cetech_pos_return_effect_claims' );
br01_assert( strpos( $fx_sql, 'UNIQUE KEY uniq_idempotency (site_scope, operation_type, idempotency_key)' ) !== false, 'return-effect UNIQUE idempotency identity' );
br01_assert( strpos( $fx_sql, 'UNIQUE KEY uniq_effect (site_scope, operation_type, effect_id)' ) !== false, 'return-effect UNIQUE effect identity' );
br01_assert( strpos( $fx_sql, 'UNIQUE KEY uniq_command' ) === false, 'return-effect table does not unique on transaction_id' );
br01_assert( strpos( $fx_sql, 'transaction_id, operation_type' ) === false, 'return-effect table allows multiple partial effects per sale' );
$ln_sql = Cetech_Pos_Bridge_Schema_Install::create_return_effect_line_table_sql( 'wp_cetech_pos_return_effect_lines' );
br01_assert( strpos( $ln_sql, 'UNIQUE KEY uniq_effect_line (site_scope, operation_type, effect_id, line_id)' ) !== false, 'return-effect line UNIQUE identity' );
br01_assert_eq( '5', Cetech_Pos_Bridge_Constants::DB_VERSION, 'claim schema version includes return-effect claims' );
br01_assert_eq( $sql, Cetech_Pos_Bridge_Schema_Install::create_table_sql( 'wp_cetech_pos_prepare_claims' ), 'CREATE TABLE SQL is deterministic across calls' );
br01_assert_eq( 'wp_cetech_pos_prepare_claims', Cetech_Pos_Bridge_Schema_Install::table_name( (object) array( 'prefix' => 'wp_' ) ), 'bridge-owned table name' );

$install_src = file_get_contents( dirname( __DIR__, 2 ) . '/wordpress/cetech-pos-bridge/includes/class-schema-install.php' );
br01_assert( strpos( $install_src, 'function maybe_upgrade' ) !== false, 'install has a version-gated maybe_upgrade' );
br01_assert( strpos( $install_src, 'cetech_pos_bridge_db_version' ) !== false, 'install versions the claim table' );

$woo_src = file_get_contents( dirname( __DIR__, 2 ) . '/wordpress/cetech-pos-bridge/includes/class-woo-runtime.php' );
br01_assert( strpos( $woo_src, 'wp_insert_post' ) === false, 'production Woo runtime does not wp_insert_post' );
br01_assert( ! preg_match( '/\$wpdb->(insert|update|query).*(posts|postmeta)/', $woo_src ), 'production Woo runtime does not write legacy post tables' );
br01_assert( strpos( $woo_src, 'wc_create_order' ) !== false, 'production create uses wc_create_order' );
br01_assert( strpos( $woo_src, 'woocommerce_before_order_object_save' ) !== false, 'production binds recovery identity during the initial Woo save' );
br01_assert( strpos( $woo_src, 'set_order_key' ) !== false, 'production recovery token uses Woo order_key CRUD' );
br01_assert( strpos( $woo_src, 'ORDER_META_RECOVERY' ) !== false || strpos( $woo_src, '_cetech_pos_woo_recovery_token' ) !== false, 'production recovery token is also Woo order meta on the initial save' );
br01_assert( strpos( $woo_src, 'wc_get_order_id_by_order_key' ) !== false, 'production recovery lookup uses Woo order_key query' );
br01_assert( strpos( $woo_src, 'update_meta_data' ) !== false, 'production recovery meta uses Woo CRUD' );
br01_assert( strpos( $woo_src, 'wc_reserve_stock_for_order' ) !== false, 'production stock uses wc_reserve_stock_for_order' );
br01_assert( strpos( $woo_src, 'wc_get_orders' ) !== false, 'production recovery lookup uses wc_get_orders' );
br01_assert( strpos( $woo_src, 'after_initial_order_save' ) !== false, 'production exposes crash seam after initial Woo save before Quote items' );
$br06_create_fn = substr( $woo_src, (int) strpos( $woo_src, 'function create_prepared_order' ) );
$br06_identity_at = strpos( $br06_create_fn, 'call_user_func( $on_order_identity' );
$br06_seam_at     = strpos( $br06_create_fn, 'fire_seam( $this->after_initial_order_save )' );
br01_assert( $br06_identity_at !== false && $br06_seam_at !== false && $br06_identity_at < $br06_seam_at, 'production binds claim identity before the post-create seam' );
br01_assert( strpos( $woo_src, 'ORDER_META_FROZEN_PREPARE' ) !== false, 'production persists versioned frozen prepare evidence on the Woo order' );
br01_assert( strpos( $woo_src, 'after_quote_line' ) !== false, 'production exposes crash seam after each durable Quote line' );
br01_assert( strpos( $woo_src, 'after_quote_snapshot' ) !== false, 'production exposes crash seam after complete Quote snapshot' );
br01_assert( strpos( $woo_src, 'after_wc_create' ) === false, 'production does not keep a misnamed after_wc_create seam' );
br01_assert( strpos( $woo_src, 'inspect_recovered_order' ) !== false, 'production separates GET inspect from repair' );
br01_assert( strpos( $woo_src, 'repair_recovered_order' ) !== false, 'production POST repair is a distinct method' );
br01_assert( strpos( $woo_src, 'finish_recovered_order' ) === false, 'production does not mix writes with a may_complete boolean' );
br01_assert( strpos( $woo_src, 'ORDER_ITEM_META_LINE' ) !== false, 'production persists bridge-private Quote line identity' );
br01_assert( strpos( $woo_src, 'WC_Order_Item_Product' ) !== false, 'production constructs order items so line identity exists on first save' );
br01_assert( strpos( $woo_src, 'add_product' ) === false || strpos( $woo_src, 'Does not use add_product()' ) !== false, 'production does not rely on add_product for Quote snapshot identity' );
br01_assert( strpos( $woo_src, 'after_meta_save' ) !== false, 'production exposes crash seam B after recovery metadata save' );
br01_assert( strpos( $woo_src, 'calculate_totals( false )' ) === false, 'production does not reprice prepared orders via calculate_totals' );
br01_assert( strpos( $woo_src, 'set_subtotal' ) !== false, 'production writes authoritative line subtotals' );
br01_assert( strpos( $woo_src, 'set_discount_total' ) !== false, 'production writes authoritative order discount' );
br01_assert( strpos( $woo_src, 'line_tax_data' ) !== false, 'production captures provider tax-rate breakdown from the quote cart' );
br01_assert( strpos( $woo_src, 'wc_reserved_stock' ) !== false, 'production proves reservation from Woo reserved-stock state' );
br01_assert( strpos( $woo_src, 'expires > NOW()' ) !== false, 'production reservation proof rejects expired holds' );
br01_assert( strpos( $woo_src, 'stock_quantity' ) !== false, 'production reservation proof checks reserved quantity' );
br01_assert( strpos( $woo_src, 'get_stock_managed_by_id' ) !== false, 'production expected reservation uses Woo stock-managed-by identity' );
br01_assert( strpos( $woo_src, 'ReserveStockException' ) !== false, 'production normalizes Woo ReserveStockException' );
br01_assert( strpos( $woo_src, 'reservationExpiresAt' ) !== false, 'production describes actual reservation expiry' );

$prep_src = file_get_contents( dirname( __DIR__, 2 ) . '/wordpress/cetech-pos-bridge/includes/class-prepare-engine.php' );
br01_assert( strpos( $prep_src, 'bind_created_order_identity' ) !== false, 'prepare engine binds the Woo order onto the existing claim' );
br01_assert( strpos( $prep_src, 'wp_insert_post' ) === false, 'prepare engine does not insert posts' );
br01_assert( strpos( $prep_src, 'wc_update_product_stock' ) === false, 'prepare engine does not decrement _stock itself' );
br01_assert( strpos( $prep_src, 'woo_create_entered' ) !== false, 'prepare persists create-entered before wc_create_order' );
br01_assert( strpos( $prep_src, 'woo_recovery_token' ) !== false, 'prepare persists recovery token before wc_create_order' );
br01_assert( strpos( $prep_src, 'inspect_recoverable_order' ) !== false, 'GET resolve inspects without repair' );
br01_assert( strpos( $prep_src, 'try_repair_order' ) !== false, 'POST retry repairs under the creator lock' );
br01_assert( strpos( $prep_src, 'function resolve' ) !== false && strpos( substr( $prep_src, strpos( $prep_src, 'function resolve' ), 1800 ), 'acquire_lock' ) === false, 'GET resolve does not acquire the creator lock' );

br01_assert_eq( null, $br06_schema->validate(
	array(
		'transactionId'    => br06_uuid( 1 ),
		'registerId'       => 'reg-1',
		'shiftId'          => br06_uuid( 2 ),
		'deviceId'         => br06_uuid( 3 ),
		'quoteId'          => 'q1',
		'quoteFingerprint' => str_repeat( 'a', 64 ),
	),
	'PrepareSaleRequest'
), 'valid PrepareSaleRequest satisfies the schema' );

$closed_prepare = array(
	'transactionId'    => br06_uuid( 1 ),
	'registerId'       => 'reg-1',
	'shiftId'          => br06_uuid( 2 ),
	'deviceId'         => br06_uuid( 3 ),
	'quoteId'          => 'q1',
	'quoteFingerprint' => str_repeat( 'a', 64 ),
	'rush'             => true,
);
br01_assert( $br06_schema->validate( $closed_prepare, 'PrepareSaleRequest' ) !== null, 'unexpected PrepareSaleRequest field rejected' );
br01_assert( $br06_schema->validate( array(), 'PrepareSaleRequest' ) !== null, 'empty PrepareSaleRequest rejected' );

$closed_prepared = array(
	'transactionId'    => br06_uuid( 1 ),
	'saleId'           => 'sale-1',
	'orderReference'   => '1',
	'quoteFingerprint' => str_repeat( 'a', 64 ),
	'total'            => array( 'minor' => 1000, 'currency' => 'GHS' ),
	'status'           => 'prepared',
	'stockCommitment'  => 'held',
	'preparedAt'       => '2026-09-14T10:00:00Z',
	'expiresAt'        => '2026-09-14T11:00:00Z',
);
br01_assert( $br06_schema->validate( $closed_prepared, 'PreparedSale' ) !== null, 'invalid PreparedSale stockCommitment rejected' );
$closed_prepared['stockCommitment'] = 'reserved';
$closed_prepared['extra']           = 'nope';
br01_assert( $br06_schema->validate( $closed_prepared, 'PreparedSale' ) !== null, 'unexpected PreparedSale field rejected' );

$closed_resolution = array(
	'transactionId' => br06_uuid( 1 ),
	'status'        => 'prepared',
	'secretDump'    => 'nope',
);
br01_assert( $br06_schema->validate( $closed_resolution, 'SaleResolution' ) !== null, 'unexpected SaleResolution field rejected' );
br01_assert_eq( null, $br06_schema->validate( array( 'transactionId' => br06_uuid( 1 ), 'status' => 'not_found' ), 'SaleResolution' ), 'minimal SaleResolution is valid' );

/* ---------------------------------------------------------------------------
 * Ingress rejects before claim / order effects
 * ------------------------------------------------------------------------ */

$br06_runtime = br06_runtime();
$br06_stack   = br06_stack( $br06_runtime );
$br06_key     = br06_next_uuid();
$br06_invalid = $br06_stack['prep']->prepare(
	array(
		'transactionId' => 'not-a-uuid',
	),
	$br06_key
);
br01_assert_eq( 'VALIDATION_ERROR', br06_error_code( $br06_invalid ), 'malformed PrepareSaleRequest is VALIDATION_ERROR' );
br01_assert_eq( null, $br06_stack['claims']->get_by_idempotency( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, $br06_key ), 'malformed request creates no claim' );
br01_assert_eq( 0, $br06_runtime->pos_order_count(), 'malformed request creates no Woo order' );
br01_assert_eq( 0, $br06_runtime->side_effect_counts()['stock'], 'malformed request mutates no stock' );

$br06_extra = $br06_stack['prep']->prepare(
	array(
		'transactionId'    => br06_next_uuid(),
		'registerId'       => 'reg-training-1',
		'shiftId'          => br06_next_uuid(),
		'deviceId'         => br06_next_uuid(),
		'quoteId'          => 'q1',
		'quoteFingerprint' => str_repeat( 'b', 64 ),
		'rush'             => true,
	),
	br06_next_uuid()
);
br01_assert_eq( 'VALIDATION_ERROR', br06_error_code( $br06_extra ), 'closed-schema extra field rejected before effects' );
br01_assert_eq( 0, $br06_runtime->pos_order_count(), 'closed-schema rejection creates no order' );

/* ---------------------------------------------------------------------------
 * Happy path + HTTP headers + replay
 * ------------------------------------------------------------------------ */

$br06_ok_runtime = br06_runtime();
$br06_ok_plugin  = new Cetech_Pos_Bridge_Plugin( $br06_ok_runtime->get_environment(), $br06_ok_runtime );
$br06_quote_http = $br06_ok_plugin->get_quote_controller()->handle(
	new Cetech_Pos_Bridge_Test_Request(
		array( 'X-Correlation-ID' => $br06_corr ),
		'/cetech-pos/v1/quotes',
		br06_quote_request()
	)
);
$br06_quote_payload = br01_payload( $br06_quote_http );
br01_assert_eq( true, $br06_quote_payload['ok'], 'quote for prepare succeeds' );
$br06_quote = $br06_quote_payload['data'];
$br06_body  = br06_prepare_body( $br06_quote );
$br06_key   = br06_next_uuid();
$br06_first = br06_dispatch_prepare( $br06_ok_plugin, $br06_body, br06_headers( $br06_key ) );
$br06_first_payload = br01_payload( $br06_first );
br01_assert_eq( 200, br01_status( $br06_first ), 'first prepare HTTP 200' );
br01_assert_eq( true, $br06_first_payload['ok'], 'first prepare ok=true' );
br01_assert_eq( null, $br06_schema->validate( $br06_first_payload['data'], 'PreparedSale' ), 'PreparedSale egress satisfies schema' );
br01_assert_eq( 'prepared', $br06_first_payload['data']['status'], 'PreparedSale status is prepared' );
br01_assert_eq( 'reserved', $br06_first_payload['data']['stockCommitment'], 'truthful reserved commitment' );
br01_assert_eq( 1, $br06_ok_runtime->pos_order_count(), 'first prepare creates exactly one POS order' );
br01_assert_eq( 1, $br06_ok_runtime->side_effect_counts()['stock'], 'stock committed once' );
br01_assert_eq( 0, $br06_ok_runtime->side_effect_counts()['payments'], 'prepare takes no payment' );
br01_assert_eq( 0, $br06_ok_runtime->side_effect_counts()['mail'], 'prepare sends no mail' );
br01_assert_eq( 'pending', $br06_ok_runtime->orders[0]['status'], 'Woo order remains unpaid pending' );
br06_assert_saved_matches_quote( $br06_ok_runtime, $br06_quote, $br06_first_payload['data'], 'walk-in happy path' );
br01_assert_eq( 'walkin', $br06_ok_runtime->orders[0]['customer_kind'], 'walk-in Woo order is guest/walk-in' );
br01_assert_eq( 0, $br06_ok_runtime->orders[0]['customer_id'], 'walk-in Woo customer id is 0' );
br01_assert( isset( $br06_first->headers['Cache-Control'] ) && $br06_first->headers['Cache-Control'] === 'no-store', 'prepare Cache-Control no-store' );

$br06_replay = br06_dispatch_prepare( $br06_ok_plugin, $br06_body, br06_headers( $br06_key ) );
$br06_replay_payload = br01_payload( $br06_replay );
br01_assert_eq( true, $br06_replay_payload['ok'], 'same-key same-request replay ok' );
br01_assert_eq( $br06_first_payload['data']['saleId'], $br06_replay_payload['data']['saleId'], 'replay returns the original saleId' );
br01_assert_eq( $br06_first_payload['data']['orderReference'], $br06_replay_payload['data']['orderReference'], 'replay returns the original orderReference' );
br01_assert_eq( 1, $br06_ok_runtime->pos_order_count(), 'replay creates zero additional orders' );
br01_assert_eq( 1, $br06_ok_runtime->side_effect_counts()['stock'], 'replay does not reserve again' );

$br06_conflict_body                      = $br06_body;
$br06_conflict_body['quoteFingerprint']  = str_repeat( 'c', 64 );
$br06_conflict                             = br06_dispatch_prepare( $br06_ok_plugin, $br06_conflict_body, br06_headers( $br06_key ) );
$br06_conflict_payload                     = br01_payload( $br06_conflict );
br01_assert_eq( 409, br01_status( $br06_conflict ), 'same-key different-request HTTP 409' );
br01_assert_eq( 'IDEMPOTENCY_CONFLICT', $br06_conflict_payload['error']['code'], 'same-key different-request IDEMPOTENCY_CONFLICT' );
br01_assert_eq( false, $br06_conflict_payload['error']['retryable'], 'idempotency conflict retryable=false' );
br01_assert_eq( 'contact_manager', $br06_conflict_payload['error']['nextAction'], 'idempotency conflict nextAction' );
br01_assert_eq( 1, $br06_ok_runtime->pos_order_count(), 'conflict creates no second order' );
br01_assert_eq( 1, $br06_ok_runtime->side_effect_counts()['stock'], 'conflict has no additional stock effect' );

$br06_other_key = br06_dispatch_prepare( $br06_ok_plugin, $br06_body, br06_headers( br06_next_uuid() ) );
$br06_other_payload = br01_payload( $br06_other_key );
br01_assert_eq( 409, br01_status( $br06_other_key ), 'same transaction different key HTTP 409' );
br01_assert_eq( 'REQUIRES_ATTENTION', $br06_other_payload['error']['code'], 'same transaction different key REQUIRES_ATTENTION' );
br01_assert_eq( 1, $br06_ok_runtime->pos_order_count(), 'second key cannot map the transaction to another Woo order' );

$br06_missing_key = br06_dispatch_prepare(
	$br06_ok_plugin,
	$br06_body,
	array( 'X-Correlation-ID' => $br06_corr )
);
br01_assert_eq( 400, br01_status( $br06_missing_key ), 'missing Idempotency-Key HTTP 400' );
br01_assert_eq( 'VALIDATION_ERROR', br01_payload( $br06_missing_key )['error']['code'], 'missing Idempotency-Key VALIDATION_ERROR' );
br01_assert_eq( 'Idempotency-Key', br01_payload( $br06_missing_key )['error']['details']['field'], 'missing Idempotency-Key field' );

$br06_bad_key = br06_dispatch_prepare(
	$br06_ok_plugin,
	$br06_body,
	array(
		'X-Correlation-ID' => $br06_corr,
		'Idempotency-Key'  => 'NOT-A-UUID',
	)
);
br01_assert_eq( 400, br01_status( $br06_bad_key ), 'malformed Idempotency-Key HTTP 400' );
br01_assert( br01_payload( $br06_bad_key )['correlationId'] === $br06_corr, 'correlation remains distinct from the rejected idempotency key' );

/* ---------------------------------------------------------------------------
 * Resolve
 * ------------------------------------------------------------------------ */

$br06_unknown = br06_dispatch_resolve(
	$br06_ok_plugin,
	br06_next_uuid(),
	array( 'X-Correlation-ID' => $br06_corr )
);
$br06_unknown_payload = br01_payload( $br06_unknown );
br01_assert_eq( 200, br01_status( $br06_unknown ), 'unknown transaction resolve HTTP 200' );
br01_assert_eq( 'not_found', $br06_unknown_payload['data']['status'], 'unknown transaction not_found' );
br01_assert_eq( null, $br06_schema->validate( $br06_unknown_payload['data'], 'SaleResolution' ), 'not_found SaleResolution satisfies schema' );
br01_assert_eq( 1, $br06_ok_runtime->pos_order_count(), 'unknown resolve creates no order' );

$br06_resolved = br06_dispatch_resolve(
	$br06_ok_plugin,
	$br06_body['transactionId'],
	array( 'X-Correlation-ID' => $br06_corr )
);
$br06_resolved_payload = br01_payload( $br06_resolved );
br01_assert_eq( 'prepared', $br06_resolved_payload['data']['status'], 'prepared resolve status' );
br01_assert_eq( $br06_first_payload['data']['saleId'], $br06_resolved_payload['data']['saleId'], 'resolve echoes original saleId' );
br01_assert_eq( $br06_first_payload['data']['orderReference'], $br06_resolved_payload['data']['orderReference'], 'resolve echoes original orderReference' );

$br06_stock_before = $br06_ok_runtime->side_effect_counts()['stock'];
$br06_again        = br06_dispatch_resolve(
	$br06_ok_plugin,
	$br06_body['transactionId'],
	array( 'X-Correlation-ID' => $br06_corr )
);
br01_assert_eq( 'prepared', br01_payload( $br06_again )['data']['status'], 'repeated resolve stays prepared' );
br01_assert_eq( 1, $br06_ok_runtime->pos_order_count(), 'repeated resolve creates no order' );
br01_assert_eq( $br06_stock_before, $br06_ok_runtime->side_effect_counts()['stock'], 'repeated resolve changes no stock' );

$br06_prep_runtime = br06_runtime();
$br06_prep_stack   = br06_stack( $br06_prep_runtime );
$br06_prep_quote   = $br06_prep_stack['quotes']->quote( br06_quote_request() );
$br06_prep_body    = br06_prepare_body( $br06_prep_quote );
$br06_in_progress  = null;
$br06_prep_stack['prep']->after_claim = function ( $eng ) use ( $br06_prep_body, &$br06_in_progress ) {
	$br06_in_progress = $eng->resolve( $br06_prep_body['transactionId'] );
};
$br06_prep_stack['prep']->prepare( $br06_prep_body, br06_next_uuid() );
br01_assert( is_array( $br06_in_progress ), 'in-progress resolve returned a payload' );
br01_assert_eq( 'preparing', $br06_in_progress['status'], 'active claim resolves as preparing' );
br01_assert_eq( null, $br06_schema->validate( $br06_in_progress, 'SaleResolution' ), 'preparing SaleResolution satisfies schema' );

$br06_attn_runtime = br06_runtime();
$br06_attn_stack   = br06_stack( $br06_attn_runtime );
$br06_attn_quote   = $br06_attn_stack['quotes']->quote( br06_quote_request() );
$br06_attn_body    = br06_prepare_body( $br06_attn_quote );
$br06_attn_key     = br06_next_uuid();
$br06_attn_stack['claims']->insert_preparing(
	array(
		'operation_type'  => Cetech_Pos_Bridge_Constants::OPERATION_PREPARE,
		'idempotency_key' => $br06_attn_key,
		'transaction_id'  => $br06_attn_body['transactionId'],
		'request_hash'    => Cetech_Pos_Bridge_Request_Hash::hash( $br06_attn_body ),
		'quote_id'        => $br06_attn_quote['id'],
	)
);
$br06_attn_runtime->inject_duplicate_transaction_order( $br06_attn_body['transactionId'] );
$br06_attn_runtime->inject_duplicate_transaction_order( $br06_attn_body['transactionId'] );
$br06_attn = $br06_attn_stack['prep']->resolve( $br06_attn_body['transactionId'] );
br01_assert_eq( 'requires_attention', $br06_attn['status'], 'duplicate Woo recovery identity is requires_attention' );
br01_assert_eq( null, $br06_schema->validate( $br06_attn, 'SaleResolution' ), 'requires_attention SaleResolution satisfies schema' );

$br06_bad_tx = $br06_ok_plugin->get_prepare_engine()->resolve( 'not-a-uuid' );
br01_assert_eq( 'VALIDATION_ERROR', br06_error_code( $br06_bad_tx ), 'resolve rejects a non-UUID transactionId' );

/* ---------------------------------------------------------------------------
 * Concurrent same-key interleaving (in-memory lock, not DB concurrency)
 * ------------------------------------------------------------------------ */

$br06_conc_runtime = br06_runtime();
$br06_conc_stack   = br06_stack( $br06_conc_runtime );
$br06_conc_quote   = $br06_conc_stack['quotes']->quote( br06_quote_request() );
$br06_conc_body    = br06_prepare_body( $br06_conc_quote );
$br06_conc_key     = br06_next_uuid();
$br06_waiter       = null;
$br06_conc_stack['prep']->after_claim = function ( $eng ) use ( $br06_conc_body, $br06_conc_key, &$br06_waiter ) {
	$br06_waiter = $eng->prepare( $br06_conc_body, $br06_conc_key );
};
$br06_winner = $br06_conc_stack['prep']->prepare( $br06_conc_body, $br06_conc_key );
br01_assert( is_array( $br06_winner ), 'lock holder prepares successfully' );
br01_assert_eq( 'OPERATION_IN_PROGRESS', br06_error_code( $br06_waiter ), 'same-key waiter while in progress is OPERATION_IN_PROGRESS' );
br01_assert_eq( 1, $br06_conc_runtime->pos_order_count(), 'concurrent same-key creates at most one order' );
$br06_waiter_retry = $br06_conc_stack['prep']->prepare( $br06_conc_body, $br06_conc_key );
br01_assert( is_array( $br06_waiter_retry ), 'waiter retry recovers the original PreparedSale' );
br01_assert_eq( $br06_winner['saleId'], $br06_waiter_retry['saleId'], 'waiter retry saleId matches' );

$br06_insert_runtime = br06_runtime();
$br06_insert_stack   = br06_stack( $br06_insert_runtime );
$br06_insert_quote   = $br06_insert_stack['quotes']->quote( br06_quote_request() );
$br06_insert_body    = br06_prepare_body( $br06_insert_quote );
$br06_insert_key     = br06_next_uuid();
$br06_nested         = null;
$br06_insert_stack['claims']->during_insert = function ( $store ) use ( $br06_insert_stack, $br06_insert_body, $br06_insert_key, &$br06_nested ) {
	unset( $store );
	$br06_nested = $br06_insert_stack['prep']->prepare( $br06_insert_body, $br06_insert_key );
};
$br06_outer = $br06_insert_stack['prep']->prepare( $br06_insert_body, $br06_insert_key );
br01_assert( is_array( $br06_nested ) || br06_error_code( $br06_nested ) === 'OPERATION_IN_PROGRESS' || is_array( $br06_outer ), 'during_insert interleaving remains defined' );
br01_assert_eq( 1, $br06_insert_runtime->pos_order_count(), 'during_insert interleaving still creates exactly one order' );

/* ---------------------------------------------------------------------------
 * Crash seams at actual runtime boundaries
 * A: after initial Woo save with recovery token, before first Quote item write
 * B: mid-Quote-snapshot after at least one durable line (covered below)
 * C: after complete Quote snapshot, before ordinary recovery metadata
 * D: after recovery metadata save, before wc_reserve_stock_for_order
 * E: partial reservation / after one managed stock row
 * F: after reservation succeeds, before claim PreparedSale persistence
 * ------------------------------------------------------------------------ */

$br06_a_runtime = br06_runtime();
$br06_a_stack   = br06_stack( $br06_a_runtime );
$br06_a_quote   = $br06_a_stack['quotes']->quote( br06_quote_request() );
$br06_a_body    = br06_prepare_body( $br06_a_quote );
$br06_a_key     = br06_next_uuid();
$br06_a_runtime->after_initial_order_save = br06_thrower( 'crash seam A after initial Woo save' );
br06_prepare_crashed( $br06_a_stack['prep'], $br06_a_body, $br06_a_key, 'crash seam A after initial Woo save' );
br01_assert_eq( 1, $br06_a_runtime->pos_order_count(), 'seam A leaves at most one Woo order' );
br01_assert_eq( 1, $br06_a_runtime->create_calls, 'seam A called wc_create_order once' );
br01_assert( ! br06_order_reserved( $br06_a_runtime ), 'seam A does not invent a reservation' );
$br06_a_claim = $br06_a_stack['claims']->get_by_idempotency( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, $br06_a_key );
br01_assert_eq( 1, (int) $br06_a_claim['woo_create_entered'], 'seam A persisted woo_create_entered before create' );
br01_assert( is_string( $br06_a_claim['woo_recovery_token'] ) && strlen( $br06_a_claim['woo_recovery_token'] ) === 64, 'seam A persisted recovery token before create' );
br01_assert_eq( $br06_a_claim['woo_recovery_token'], $br06_a_runtime->orders[0]['recovery_token'], 'seam A bound the claim token into the created Woo order' );
br01_assert_eq( $br06_a_claim['woo_recovery_token'], $br06_a_runtime->orders[0]['order_key'], 'seam A persisted recovery identity as Woo order_key' );
br01_assert_eq( (string) $br06_a_runtime->orders[0]['id'], (string) $br06_a_claim['woo_order_id'], 'seam A bound the Woo order id before later work' );
br01_assert_eq( 'sale-' . $br06_a_runtime->orders[0]['id'], (string) $br06_a_claim['sale_id'], 'seam A bound the deterministic sale id' );
br01_assert_eq( $br06_a_body['transactionId'], $br06_a_runtime->orders[0]['transaction_id'], 'seam A persisted the transaction id on the Woo order' );
br01_assert_eq( Cetech_Pos_Bridge_Request_Hash::hash( $br06_a_body ), $br06_a_runtime->orders[0]['request_hash'], 'seam A persisted the request hash on the Woo order' );
br01_assert_eq( Cetech_Pos_Bridge_Claim_Store::STATUS_PREPARING, $br06_a_claim['internal_status'], 'seam A crash leaves the claim unfinished so the locked retry can classify it' );
br01_assert( is_array( $br06_a_runtime->orders[0]['frozen_prepare'] ), 'seam A stored frozen prepare evidence before later work' );
br01_assert_eq( 1, (int) $br06_a_runtime->orders[0]['frozen_prepare']['version'], 'seam A frozen evidence is version 1' );
br01_assert_eq( 0, count( isset( $br06_a_runtime->orders[0]['items'] ) ? $br06_a_runtime->orders[0]['items'] : array() ), 'seam A has zero Quote line items' );
br01_assert( ! isset( $br06_a_runtime->orders[0]['line_economics'] ), 'seam A has no Quote snapshot economics' );
$br06_a_before = $br06_a_runtime->snapshot_woo_state();
br01_assert_eq( 1, $br06_a_before['mutations']['order_creates'], 'seam A GET baseline counted the one order create' );
br01_assert_eq( 0, $br06_a_before['mutations']['item_adds'], 'seam A GET baseline has no item writes' );
br01_assert_eq( 0, $br06_a_before['mutations']['stock_reservations'], 'seam A GET baseline has no reservation writes' );
br01_assert_eq( 0, $br06_a_before['mutations']['payment_completes'], 'seam A GET baseline has no payment writes' );
br01_assert_eq( 0, $br06_a_before['mutations']['order_cancels'], 'seam A GET baseline has no cancel writes' );
$br06_a_resolved = $br06_a_stack['prep']->resolve( $br06_a_body['transactionId'] );
br01_assert_eq( 'requires_attention', $br06_a_resolved['status'], 'seam A resolve reports the existing order as not yet payable' );
br01_assert_eq( 'sale-' . $br06_a_runtime->orders[0]['id'], $br06_a_resolved['saleId'], 'seam A resolve returns the bound sale id' );
br01_assert_eq( (string) $br06_a_runtime->orders[0]['id'], $br06_a_resolved['orderReference'], 'seam A resolve returns the bound order reference' );
br01_assert( strpos( $br06_a_resolved['message'], 'cannot yet be safely opened for payment' ) !== false, 'seam A resolve explains the order cannot yet be opened for payment' );
br01_assert( ! isset( $br06_a_resolved['stockCommitment'] ), 'seam A resolve does not report stockCommitment' );
br01_assert_eq( Cetech_Pos_Bridge_Claim_Store::STATUS_PREPARING, $br06_a_stack['claims']->get_by_idempotency( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, $br06_a_key )['internal_status'], 'seam A GET does not rewrite the claim' );
br06_assert_woo_frozen( $br06_a_runtime, $br06_a_before, 'seam A GET' );
$br06_a_resolved_again = $br06_a_stack['prep']->resolve( $br06_a_body['transactionId'] );
br01_assert_eq( 'requires_attention', $br06_a_resolved_again['status'], 'repeated seam A GET stays requires_attention' );
br06_assert_woo_frozen( $br06_a_runtime, $br06_a_before, 'repeated seam A GET' );
br01_assert_eq( 1, $br06_a_runtime->pos_order_count(), 'seam A resolve creates no second Woo order' );
br01_assert_eq( 1, $br06_a_runtime->create_calls, 'seam A resolve does not call wc_create_order' );
$br06_a_retry = $br06_a_stack['prep']->prepare( $br06_a_body, $br06_a_key );
br01_assert( is_array( $br06_a_retry ), 'seam A retry recovers the original order as PreparedSale' );
br01_assert_eq( 'prepared', $br06_a_retry['status'], 'seam A retry is prepared' );
br01_assert_eq( 'reserved', $br06_a_retry['stockCommitment'], 'seam A retry reports reserved only after proven reservation' );
br06_assert_honest_commitment( $br06_a_retry, $br06_a_runtime, 'seam A retry' );
br06_assert_saved_matches_quote( $br06_a_runtime, $br06_a_quote, $br06_a_retry, 'seam A retry' );
br01_assert_eq( (string) $br06_a_runtime->orders[0]['id'], $br06_a_retry['orderReference'], 'seam A recovery maps the original Woo order' );
br01_assert_eq( 1, $br06_a_runtime->pos_order_count(), 'seam A retry creates no second Woo order' );
br01_assert_eq( 1, $br06_a_runtime->create_calls, 'seam A recovery does not call wc_create_order again' );
$br06_a_after_repair = $br06_a_runtime->snapshot_woo_state();
$br06_a_resolved_ok = $br06_a_stack['prep']->resolve( $br06_a_body['transactionId'] );
br01_assert_eq( 'prepared', $br06_a_resolved_ok['status'], 'seam A resolve after repair is prepared' );
br06_assert_woo_frozen( $br06_a_runtime, $br06_a_after_repair, 'seam A GET after prepared' );

$br06_tok_runtime = br06_runtime();
$br06_tok_stack   = br06_stack( $br06_tok_runtime );
$br06_tok_quote   = $br06_tok_stack['quotes']->quote( br06_quote_request() );
$br06_tok_body    = br06_prepare_body( $br06_tok_quote );
$br06_tok_key     = br06_next_uuid();
$br06_tok_runtime->after_initial_order_save = br06_thrower( 'crash seam A wrong token' );
br06_prepare_crashed( $br06_tok_stack['prep'], $br06_tok_body, $br06_tok_key, 'crash seam A wrong token' );
$br06_tok_claim = $br06_tok_stack['claims']->get_by_idempotency( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, $br06_tok_key );
$br06_tok_claim['woo_recovery_token'] = str_repeat( 'ab', 32 );
$br06_tok_stack['claims']->save( $br06_tok_claim );
$br06_tok_resolved = $br06_tok_stack['prep']->resolve( $br06_tok_body['transactionId'] );
br01_assert_eq( 'requires_attention', $br06_tok_resolved['status'], 'wrong recovery token is not adopted' );
br01_assert_eq( 1, $br06_tok_runtime->create_calls, 'wrong-token resolve does not create another order' );
$br06_tok_retry = $br06_tok_stack['prep']->prepare( $br06_tok_body, $br06_tok_key );
br01_assert_eq( 'REQUIRES_ATTENTION', br06_error_code( $br06_tok_retry ), 'wrong recovery token retry is requires_attention' );
br01_assert_eq( 1, $br06_tok_runtime->create_calls, 'wrong-token retry does not call wc_create_order again' );
br01_assert_eq( 1, $br06_tok_runtime->pos_order_count(), 'wrong-token retry creates no second Woo order' );

$br06_dup_runtime = br06_runtime();
$br06_dup_stack   = br06_stack( $br06_dup_runtime );
$br06_dup_quote   = $br06_dup_stack['quotes']->quote( br06_quote_request() );
$br06_dup_body    = br06_prepare_body( $br06_dup_quote );
$br06_dup_key     = br06_next_uuid();
$br06_dup_runtime->after_initial_order_save = br06_thrower( 'crash seam A duplicate token' );
br06_prepare_crashed( $br06_dup_stack['prep'], $br06_dup_body, $br06_dup_key, 'crash seam A duplicate token' );
$br06_dup_claim = $br06_dup_stack['claims']->get_by_idempotency( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, $br06_dup_key );
$br06_dup_runtime->inject_duplicate_recovery_token( $br06_dup_claim['woo_recovery_token'] );
$br06_dup_resolved = $br06_dup_stack['prep']->resolve( $br06_dup_body['transactionId'] );
br01_assert_eq( 'requires_attention', $br06_dup_resolved['status'], 'duplicate recovery token is requires_attention' );
$br06_dup_retry = $br06_dup_stack['prep']->prepare( $br06_dup_body, $br06_dup_key );
br01_assert_eq( 'REQUIRES_ATTENTION', br06_error_code( $br06_dup_retry ), 'duplicate recovery token retry is requires_attention' );
br01_assert_eq( 1, $br06_dup_runtime->create_calls, 'duplicate-token retry does not call wc_create_order again' );

$br06_b_runtime = br06_runtime();
$br06_b_stack   = br06_stack( $br06_b_runtime );
$br06_b_quote   = $br06_b_stack['quotes']->quote( br06_quote_request() );
$br06_b_body    = br06_prepare_body( $br06_b_quote );
$br06_b_key     = br06_next_uuid();
$br06_b_runtime->after_meta_save = br06_thrower( 'crash seam D after recovery metadata save' );
br06_prepare_crashed( $br06_b_stack['prep'], $br06_b_body, $br06_b_key, 'crash seam D after recovery metadata save' );
br01_assert_eq( 1, $br06_b_runtime->pos_order_count(), 'seam D leaves at most one Woo order' );
br01_assert_eq( 1, $br06_b_runtime->create_calls, 'seam D called wc_create_order once' );
br01_assert( ! br06_order_reserved( $br06_b_runtime ), 'seam D reservation is incomplete' );
$br06_b_before = $br06_b_runtime->snapshot_woo_state();
$br06_b_resolved = $br06_b_stack['prep']->resolve( $br06_b_body['transactionId'] );
br01_assert_eq( 'requires_attention', $br06_b_resolved['status'], 'seam D resolve does not report prepared without reservation' );
br01_assert_eq( (string) $br06_b_runtime->orders[0]['id'], (string) $br06_b_stack['claims']->get_by_idempotency( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, $br06_b_key )['woo_order_id'], 'seam D claim keeps the Woo order id' );
br01_assert( ! isset( $br06_b_resolved['stockCommitment'] ), 'seam D resolve does not report stockCommitment' );
br01_assert( ! br06_order_reserved( $br06_b_runtime ), 'seam D resolve does not complete or invent reservation' );
br06_assert_woo_frozen( $br06_b_runtime, $br06_b_before, 'seam D GET' );
br01_assert_eq( 1, $br06_b_runtime->pos_order_count(), 'seam D resolve creates no second Woo order' );
br01_assert_eq( 1, $br06_b_runtime->create_calls, 'seam D resolve does not call wc_create_order' );
$br06_b_retry = $br06_b_stack['prep']->prepare( $br06_b_body, $br06_b_key );
br01_assert( is_array( $br06_b_retry ), 'seam D retry recovers PreparedSale after completing reservation' );
br01_assert_eq( 'prepared', $br06_b_retry['status'], 'seam D retry is prepared' );
br01_assert_eq( 'reserved', $br06_b_retry['stockCommitment'], 'seam D retry reports reserved only after proven reservation' );
br06_assert_honest_commitment( $br06_b_retry, $br06_b_runtime, 'seam D retry' );
br01_assert_eq( 1, $br06_b_runtime->pos_order_count(), 'seam D retry creates no second Woo order' );
br01_assert_eq( 1, $br06_b_runtime->create_calls, 'seam D retry does not call wc_create_order again' );
$br06_b_resolved_ok = $br06_b_stack['prep']->resolve( $br06_b_body['transactionId'] );
br01_assert_eq( 'prepared', $br06_b_resolved_ok['status'], 'seam D resolve after repair is prepared' );
br01_assert_eq( 1, $br06_b_runtime->pos_order_count(), 'seam D post-repair resolve creates no second Woo order' );

$br06_c_runtime = br06_runtime();
$br06_c_stack   = br06_stack( $br06_c_runtime );
$br06_c_quote   = $br06_c_stack['quotes']->quote( br06_quote_request() );
$br06_c_body    = br06_prepare_body( $br06_c_quote );
$br06_c_key     = br06_next_uuid();
$br06_c_stack['prep']->after_order_create = br06_thrower( 'crash seam C after reservation before claim persist' );
br06_prepare_crashed( $br06_c_stack['prep'], $br06_c_body, $br06_c_key, 'crash seam C after reservation before claim persist' );
br01_assert_eq( 1, $br06_c_runtime->pos_order_count(), 'seam C leaves at most one Woo order' );
br01_assert_eq( 1, $br06_c_runtime->create_calls, 'seam C called wc_create_order once' );
br01_assert( br06_order_reserved( $br06_c_runtime ), 'seam C reservation is proven before claim persist' );
$br06_c_claim = $br06_c_stack['claims']->get_by_idempotency( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, $br06_c_key );
br01_assert_eq( Cetech_Pos_Bridge_Claim_Store::STATUS_PREPARING, $br06_c_claim['internal_status'], 'seam F claim remains preparing before repair' );
br01_assert_eq( (string) $br06_c_runtime->orders[0]['id'], (string) $br06_c_claim['woo_order_id'], 'seam F claim already knows the Woo order' );
br01_assert_eq( 'sale-' . $br06_c_runtime->orders[0]['id'], (string) $br06_c_claim['sale_id'], 'seam F claim already knows the sale id' );
$br06_c_before = $br06_c_runtime->snapshot_woo_state();
$br06_c_resolved = $br06_c_stack['prep']->resolve( $br06_c_body['transactionId'] );
br01_assert_eq( 'prepared', $br06_c_resolved['status'], 'seam F resolve reports prepared from proven Woo without writing' );
br06_assert_woo_frozen( $br06_c_runtime, $br06_c_before, 'seam F GET' );
br01_assert_eq( Cetech_Pos_Bridge_Claim_Store::STATUS_PREPARING, $br06_c_stack['claims']->get_by_idempotency( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, $br06_c_key )['internal_status'], 'seam F GET does not persist PreparedSale onto the claim' );
br01_assert_eq( 1, $br06_c_runtime->pos_order_count(), 'seam C resolve creates no second Woo order' );
br01_assert_eq( 1, $br06_c_runtime->create_calls, 'seam C resolve does not call wc_create_order' );
$br06_c_retry = $br06_c_stack['prep']->prepare( $br06_c_body, $br06_c_key );
br01_assert( is_array( $br06_c_retry ), 'seam C retry returns the recovered PreparedSale' );
br01_assert_eq( 'prepared', $br06_c_retry['status'], 'seam C retry is prepared' );
br01_assert_eq( 'reserved', $br06_c_retry['stockCommitment'], 'seam C retry reports reserved from proven reservation' );
br06_assert_honest_commitment( $br06_c_retry, $br06_c_runtime, 'seam C retry' );
br01_assert_eq( (string) $br06_c_runtime->orders[0]['id'], $br06_c_retry['orderReference'], 'seam C recovery maps the original Woo order' );
br01_assert_eq( 1, $br06_c_runtime->pos_order_count(), 'seam C retry creates no second Woo order' );
br01_assert_eq( 1, $br06_c_runtime->create_calls, 'seam C retry does not call wc_create_order again' );

$br06_hash_runtime = br06_runtime();
$br06_hash_stack   = br06_stack( $br06_hash_runtime );
$br06_hash_quote   = $br06_hash_stack['quotes']->quote( br06_quote_request() );
$br06_hash_body    = br06_prepare_body( $br06_hash_quote );
$br06_hash_key     = br06_next_uuid();
$br06_hash_stack['claims']->insert_preparing(
	array(
		'operation_type'  => Cetech_Pos_Bridge_Constants::OPERATION_PREPARE,
		'idempotency_key' => $br06_hash_key,
		'transaction_id'  => $br06_hash_body['transactionId'],
		'request_hash'    => Cetech_Pos_Bridge_Request_Hash::hash( $br06_hash_body ),
		'quote_id'        => $br06_hash_quote['id'],
	)
);
$br06_hash_runtime->inject_pos_order( $br06_hash_body['transactionId'], 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', true );
$br06_hash_resolved = $br06_hash_stack['prep']->resolve( $br06_hash_body['transactionId'] );
br01_assert_eq( 'requires_attention', $br06_hash_resolved['status'], 'wrong request hash is not accepted as prepared' );
br01_assert_eq( 1, $br06_hash_runtime->pos_order_count(), 'wrong-hash resolve creates no extra Woo order' );
br01_assert_eq( 0, $br06_hash_runtime->create_calls, 'wrong-hash resolve does not call wc_create_order' );
$br06_hash_retry = $br06_hash_stack['prep']->prepare( $br06_hash_body, $br06_hash_key );
br01_assert_eq( 'REQUIRES_ATTENTION', br06_error_code( $br06_hash_retry ), 'wrong request hash is not recovered as PreparedSale' );
br06_assert_honest_commitment( $br06_hash_retry, $br06_hash_runtime, 'wrong-hash retry' );
br01_assert_eq( 1, $br06_hash_runtime->pos_order_count(), 'wrong-hash retry creates no second Woo order' );
br01_assert_eq( 0, $br06_hash_runtime->create_calls, 'wrong-hash retry does not call wc_create_order' );

$br06_id_runtime = br06_runtime();
$br06_id_stack   = br06_stack( $br06_id_runtime );
$br06_id_quote   = $br06_id_stack['quotes']->quote( br06_quote_request() );
$br06_id_body    = br06_prepare_body( $br06_id_quote );
$br06_id_key     = br06_next_uuid();
$br06_id_hash    = Cetech_Pos_Bridge_Request_Hash::hash( $br06_id_body );
$br06_id_stack['claims']->insert_preparing(
	array(
		'operation_type'  => Cetech_Pos_Bridge_Constants::OPERATION_PREPARE,
		'idempotency_key' => $br06_id_key,
		'transaction_id'  => $br06_id_body['transactionId'],
		'request_hash'    => $br06_id_hash,
		'quote_id'        => $br06_id_quote['id'],
	)
);
$br06_id_runtime->inject_pos_order( $br06_id_body['transactionId'], $br06_id_hash, true, $br06_id_quote );
$br06_id_recovered = $br06_id_stack['prep']->prepare( $br06_id_body, $br06_id_key );
br01_assert( is_array( $br06_id_recovered ), 'exactly one tx+hash match with proven reservation recovers PreparedSale' );
br01_assert_eq( 'prepared', $br06_id_recovered['status'], 'identified proven order is prepared' );
br01_assert_eq( 'reserved', $br06_id_recovered['stockCommitment'], 'identified proven order reports reserved' );
br06_assert_honest_commitment( $br06_id_recovered, $br06_id_runtime, 'identified recovery' );
br01_assert_eq( 1, $br06_id_runtime->pos_order_count(), 'identified recovery creates no second Woo order' );
br01_assert_eq( 0, $br06_id_runtime->create_calls, 'identified recovery does not call wc_create_order' );
$br06_id_resolved = $br06_id_stack['prep']->resolve( $br06_id_body['transactionId'] );
br01_assert_eq( 'prepared', $br06_id_resolved['status'], 'identified recovery resolve stays prepared' );
br01_assert_eq( 0, $br06_id_runtime->create_calls, 'identified recovery resolve does not call wc_create_order' );

/* ---------------------------------------------------------------------------
 * GET read-only interleaving, mid-snapshot crash, exact line reconciliation
 * ------------------------------------------------------------------------ */

$br06_get_runtime = br06_runtime();
$br06_get_stack   = br06_stack( $br06_get_runtime );
$br06_get_quote   = $br06_get_stack['quotes']->quote( br06_quote_request() );
$br06_get_body    = br06_prepare_body( $br06_get_quote );
$br06_get_key     = br06_next_uuid();
$br06_get_runtime->after_initial_order_save = br06_thrower( 'GET interleaving after initial save' );
br06_prepare_crashed( $br06_get_stack['prep'], $br06_get_body, $br06_get_key, 'GET interleaving after initial save' );
$br06_get_before = $br06_get_runtime->snapshot_woo_state();
$br06_get_r1 = $br06_get_stack['prep']->resolve( $br06_get_body['transactionId'] );
$br06_get_r2 = $br06_get_stack['prep']->resolve( $br06_get_body['transactionId'] );
$br06_get_r3 = $br06_get_stack['prep']->resolve( $br06_get_body['transactionId'] );
br01_assert_eq( 'requires_attention', $br06_get_r1['status'], 'interleaved GET 1 reports the unfinished order' );
br01_assert_eq( 'requires_attention', $br06_get_r2['status'], 'interleaved GET 2 reports the unfinished order' );
br01_assert_eq( 'requires_attention', $br06_get_r3['status'], 'interleaved GET 3 reports the unfinished order' );
br06_assert_woo_frozen( $br06_get_runtime, $br06_get_before, 'in-memory interleaved GET (not a DB concurrency PASS)' );
br01_assert_eq( 1, $br06_get_runtime->pos_order_count(), 'interleaved GET creates no order #2' );
$br06_get_post = $br06_get_stack['prep']->prepare( $br06_get_body, $br06_get_key );
br01_assert( is_array( $br06_get_post ), 'POST retry after interleaved GET repairs once under creator lock' );
br01_assert_eq( 'prepared', $br06_get_post['status'], 'POST retry after GET inspect is prepared' );
br01_assert_eq( 1, $br06_get_runtime->create_calls, 'GET then POST keeps provider create count 1' );
br01_assert_eq( 1, $br06_get_runtime->pos_order_count(), 'GET then POST keeps Woo order count 1' );
$br06_get_after = $br06_get_runtime->snapshot_woo_state();
$br06_get_final = $br06_get_stack['prep']->resolve( $br06_get_body['transactionId'] );
br01_assert_eq( 'prepared', $br06_get_final['status'], 'GET after POST repair is prepared' );
br06_assert_woo_frozen( $br06_get_runtime, $br06_get_after, 'GET after POST repair' );

$br06_snap_runtime = br06_runtime();
$br06_snap_stack   = br06_stack( $br06_snap_runtime );
$br06_snap_quote   = $br06_snap_stack['quotes']->quote( br06_quote_request() );
$br06_snap_body    = br06_prepare_body( $br06_snap_quote );
$br06_snap_key     = br06_next_uuid();
$br06_snap_runtime->after_quote_snapshot = br06_thrower( 'crash after complete Quote snapshot' );
br06_prepare_crashed( $br06_snap_stack['prep'], $br06_snap_body, $br06_snap_key, 'crash after complete Quote snapshot' );
br01_assert_eq( 1, count( $br06_snap_runtime->orders[0]['items'] ), 'after_quote_snapshot persisted the Quote line set' );
br01_assert_eq( $br06_snap_quote['lines'][0]['lineId'], $br06_snap_runtime->orders[0]['items'][0]['line_id'], 'Quote line identity is bound on the first durable item save' );
br01_assert_eq( $br06_snap_body['transactionId'], $br06_snap_runtime->orders[0]['transaction_id'], 'after_quote_snapshot already has the transaction id from the first order save' );
$br06_snap_before = $br06_snap_runtime->snapshot_woo_state();
$br06_snap_get = $br06_snap_stack['prep']->resolve( $br06_snap_body['transactionId'] );
br01_assert_eq( 'requires_attention', $br06_snap_get['status'], 'complete snapshot without reservation is not prepared' );
br06_assert_woo_frozen( $br06_snap_runtime, $br06_snap_before, 'GET after_quote_snapshot' );
$br06_snap_retry = $br06_snap_stack['prep']->prepare( $br06_snap_body, $br06_snap_key );
br01_assert( is_array( $br06_snap_retry ), 'POST after complete snapshot repairs PreparedSale' );
br01_assert_eq( 1, $br06_snap_runtime->create_calls, 'after_quote_snapshot retry does not create again' );

$br06_mid_runtime = br06_runtime();
$br06_mid_priced  = $br06_mid_runtime->catalog['walkin']['101']['1'];
$br06_mid_runtime->catalog['walkin']['102']['1']               = $br06_mid_priced;
$br06_mid_runtime->catalog['retail:cust_retail_1']['102']['1'] = $br06_mid_priced;
$br06_mid_runtime->stock['102']                                = 10;
$br06_mid_stack = br06_stack( $br06_mid_runtime );
$br06_mid_req   = br06_quote_request();
$br06_mid_req['lines'][] = array(
	'lineId'    => br06_next_uuid(),
	'productId' => '102',
	'quantity'  => '1',
);
$br06_mid_quote = $br06_mid_stack['quotes']->quote( $br06_mid_req );
br01_assert( is_array( $br06_mid_quote ), 'mid-snapshot two-line quote succeeds' );
$br06_mid_body = br06_prepare_body( $br06_mid_quote );
$br06_mid_key  = br06_next_uuid();
$br06_mid_runtime->after_quote_line = br06_thrower( 'crash mid Quote snapshot after line A' );
br06_prepare_crashed( $br06_mid_stack['prep'], $br06_mid_body, $br06_mid_key, 'crash mid Quote snapshot after line A' );
br01_assert_eq( 1, $br06_mid_runtime->pos_order_count(), 'mid-snapshot crash leaves one Woo order' );
br01_assert_eq( (string) $br06_mid_runtime->orders[0]['id'], (string) $br06_mid_stack['claims']->get_by_idempotency( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, $br06_mid_key )['woo_order_id'], 'mid-snapshot claim already knows the Woo order' );
br01_assert_eq( 1, $br06_mid_runtime->create_calls, 'mid-snapshot crash create_calls=1' );
br01_assert_eq( 1, count( $br06_mid_runtime->orders[0]['items'] ), 'mid-snapshot persisted only line A' );
br01_assert_eq( $br06_mid_quote['lines'][0]['lineId'], $br06_mid_runtime->orders[0]['items'][0]['line_id'], 'mid-snapshot line A keeps Quote line identity' );
br01_assert_eq( '101', $br06_mid_runtime->orders[0]['items'][0]['productId'], 'mid-snapshot line A product matches Quote' );
br01_assert( ! isset( $br06_mid_runtime->orders[0]['total_minor'] ), 'mid-snapshot order totals are not final' );
br01_assert_eq( $br06_mid_body['transactionId'], $br06_mid_runtime->orders[0]['transaction_id'], 'mid-snapshot already has the transaction id from the first order save' );
br01_assert( ! br06_order_reserved( $br06_mid_runtime ), 'mid-snapshot has no reservation' );
$br06_mid_before = $br06_mid_runtime->snapshot_woo_state();
$br06_mid_get = $br06_mid_stack['prep']->resolve( $br06_mid_body['transactionId'] );
br01_assert_eq( 'requires_attention', $br06_mid_get['status'], 'mid-snapshot GET does not report a partial snapshot as prepared' );
br06_assert_woo_frozen( $br06_mid_runtime, $br06_mid_before, 'mid-snapshot GET' );
$br06_mid_retry = $br06_mid_stack['prep']->prepare( $br06_mid_body, $br06_mid_key );
br01_assert( is_array( $br06_mid_retry ), 'mid-snapshot POST repair returns PreparedSale' );
br01_assert_eq( 'prepared', $br06_mid_retry['status'], 'mid-snapshot POST is prepared' );
br01_assert_eq( 2, count( $br06_mid_runtime->orders[0]['items'] ), 'mid-snapshot repair has exactly two product lines' );
$br06_mid_ids = array();
foreach ( $br06_mid_runtime->orders[0]['items'] as $item ) {
	$br06_mid_ids[] = $item['line_id'];
}
br01_assert_eq( 2, count( array_unique( $br06_mid_ids ) ), 'mid-snapshot repair does not duplicate line A' );
br01_assert( in_array( $br06_mid_quote['lines'][0]['lineId'], $br06_mid_ids, true ), 'mid-snapshot keeps line A identity' );
br01_assert( in_array( $br06_mid_quote['lines'][1]['lineId'], $br06_mid_ids, true ), 'mid-snapshot adds line B exactly once' );
br06_assert_saved_matches_quote( $br06_mid_runtime, $br06_mid_quote, $br06_mid_retry, 'mid-snapshot repair' );
br01_assert_eq( 1, $br06_mid_runtime->create_calls, 'mid-snapshot repair create_calls stays 1' );
br01_assert_eq( 1, $br06_mid_runtime->pos_order_count(), 'mid-snapshot repair Woo order count stays 1' );
br01_assert( br06_order_reserved( $br06_mid_runtime ), 'mid-snapshot repair completes reservation' );

$br06_amb_runtime = br06_runtime();
$br06_amb_stack   = br06_stack( $br06_amb_runtime );
$br06_amb_quote   = $br06_amb_stack['quotes']->quote( br06_quote_request() );
$br06_amb_body    = br06_prepare_body( $br06_amb_quote );
$br06_amb_key     = br06_next_uuid();
$br06_amb_runtime->after_initial_order_save = br06_thrower( 'ambiguous unexpected line' );
br06_prepare_crashed( $br06_amb_stack['prep'], $br06_amb_body, $br06_amb_key, 'ambiguous unexpected line' );
$br06_amb_runtime->inject_unexpected_product_line( $br06_amb_runtime->orders[0]['id'] );
$br06_amb_before = $br06_amb_runtime->snapshot_woo_state();
$br06_amb_get = $br06_amb_stack['prep']->resolve( $br06_amb_body['transactionId'] );
br01_assert_eq( 'requires_attention', $br06_amb_get['status'], 'unexpected third product line is requires_attention' );
br06_assert_woo_frozen( $br06_amb_runtime, $br06_amb_before, 'unexpected-line GET' );
$br06_amb_retry = $br06_amb_stack['prep']->prepare( $br06_amb_body, $br06_amb_key );
br01_assert_eq( 'REQUIRES_ATTENTION', br06_error_code( $br06_amb_retry ), 'unexpected line POST does not invent PreparedSale' );
br01_assert_eq( 1, $br06_amb_runtime->pos_order_count(), 'unexpected line creates no order #2' );
br01_assert_eq( 1, $br06_amb_runtime->create_calls, 'unexpected line does not create again' );
br01_assert_eq( 1, count( $br06_amb_runtime->orders[0]['items'] ), 'unexpected line is not blindly deleted' );
br01_assert( ! br06_order_reserved( $br06_amb_runtime ), 'unproven snapshot does not complete reservation' );

$br06_dupl_runtime = br06_runtime();
$br06_dupl_stack   = br06_stack( $br06_dupl_runtime );
$br06_dupl_quote   = $br06_dupl_stack['quotes']->quote( br06_quote_request() );
$br06_dupl_body    = br06_prepare_body( $br06_dupl_quote );
$br06_dupl_key     = br06_next_uuid();
$br06_dupl_runtime->after_quote_line = br06_thrower( 'duplicate line identity crash' );
br06_prepare_crashed( $br06_dupl_stack['prep'], $br06_dupl_body, $br06_dupl_key, 'duplicate line identity crash' );
$br06_dupl_runtime->inject_duplicate_line_identity( $br06_dupl_runtime->orders[0]['id'], $br06_dupl_quote['lines'][0]['lineId'] );
$br06_dupl_retry = $br06_dupl_stack['prep']->prepare( $br06_dupl_body, $br06_dupl_key );
br01_assert_eq( 'REQUIRES_ATTENTION', br06_error_code( $br06_dupl_retry ), 'duplicate bridge line identity is requires_attention' );
br01_assert_eq( 1, $br06_dupl_runtime->pos_order_count(), 'duplicate line identity creates no order #2' );
br01_assert_eq( 2, count( $br06_dupl_runtime->orders[0]['items'] ), 'duplicate line identity is not silently collapsed' );
br01_assert( ! br06_order_reserved( $br06_dupl_runtime ), 'duplicate line identity does not reserve' );

$br06_wrong_runtime = br06_runtime();
$br06_wrong_stack   = br06_stack( $br06_wrong_runtime );
$br06_wrong_quote   = $br06_wrong_stack['quotes']->quote( br06_quote_request() );
$br06_wrong_body    = br06_prepare_body( $br06_wrong_quote );
$br06_wrong_key     = br06_next_uuid();
$br06_wrong_runtime->after_quote_line = br06_thrower( 'wrong product identity crash' );
br06_prepare_crashed( $br06_wrong_stack['prep'], $br06_wrong_body, $br06_wrong_key, 'wrong product identity crash' );
$br06_wrong_runtime->inject_wrong_product_for_line( $br06_wrong_runtime->orders[0]['id'], $br06_wrong_quote['lines'][0]['lineId'], '999' );
$br06_wrong_retry = $br06_wrong_stack['prep']->prepare( $br06_wrong_body, $br06_wrong_key );
br01_assert_eq( 'REQUIRES_ATTENTION', br06_error_code( $br06_wrong_retry ), 'wrong product/variation for line identity is requires_attention' );
br01_assert_eq( '999', $br06_wrong_runtime->orders[0]['items'][0]['productId'], 'wrong product is not silently overwritten' );
br01_assert_eq( 1, $br06_wrong_runtime->pos_order_count(), 'wrong product creates no order #2' );

$br06_noid_runtime = br06_runtime();
$br06_noid_stack   = br06_stack( $br06_noid_runtime );
$br06_noid_quote   = $br06_noid_stack['quotes']->quote( br06_quote_request() );
$br06_noid_body    = br06_prepare_body( $br06_noid_quote );
$br06_noid_key     = br06_next_uuid();
$br06_noid_runtime->after_initial_order_save = br06_thrower( 'unidentifiable item crash' );
br06_prepare_crashed( $br06_noid_stack['prep'], $br06_noid_body, $br06_noid_key, 'unidentifiable item crash' );
$br06_noid_runtime->inject_unidentifiable_item( $br06_noid_runtime->orders[0]['id'] );
$br06_noid_retry = $br06_noid_stack['prep']->prepare( $br06_noid_body, $br06_noid_key );
br01_assert_eq( 'REQUIRES_ATTENTION', br06_error_code( $br06_noid_retry ), 'unidentifiable existing item is requires_attention' );
br01_assert_eq( 1, $br06_noid_runtime->pos_order_count(), 'unidentifiable item creates no order #2' );
br01_assert_eq( '', $br06_noid_runtime->orders[0]['items'][0]['line_id'], 'unidentifiable item is not silently labeled' );

$br06_part_runtime = br06_runtime();
$br06_part_stack   = br06_stack( $br06_part_runtime );
$br06_part_quote   = $br06_part_stack['quotes']->quote( br06_quote_request() );
$br06_part_body    = br06_prepare_body( $br06_part_quote );
$br06_part_key     = br06_next_uuid();
$br06_part_runtime->after_quote_line = br06_thrower( 'partial identifiable line crash' );
br06_prepare_crashed( $br06_part_stack['prep'], $br06_part_body, $br06_part_key, 'partial identifiable line crash' );
$br06_part_runtime->make_partial_identifiable_line( $br06_part_runtime->orders[0]['id'], $br06_part_quote['lines'][0]['lineId'] );
$br06_part_before = $br06_part_runtime->snapshot_woo_state();
$br06_part_get = $br06_part_stack['prep']->resolve( $br06_part_body['transactionId'] );
br01_assert_eq( 'requires_attention', $br06_part_get['status'], 'partial identifiable GET is not prepared' );
br06_assert_woo_frozen( $br06_part_runtime, $br06_part_before, 'partial identifiable GET' );
$br06_part_retry = $br06_part_stack['prep']->prepare( $br06_part_body, $br06_part_key );
br01_assert( is_array( $br06_part_retry ), 'partial identifiable POST repairs the Quote snapshot' );
br01_assert_eq( 'prepared', $br06_part_retry['status'], 'partial identifiable POST is prepared' );
br01_assert_eq( 1, count( $br06_part_runtime->orders[0]['items'] ), 'partial identifiable repair does not duplicate the line' );
br06_assert_saved_matches_quote( $br06_part_runtime, $br06_part_quote, $br06_part_retry, 'partial identifiable repair' );
br01_assert_eq( 1, $br06_part_runtime->create_calls, 'partial identifiable repair create_calls stays 1' );

/* ---------------------------------------------------------------------------
 * Quote revalidation and stock
 * ------------------------------------------------------------------------ */

$br06_fp_runtime = br06_runtime();
$br06_fp_stack   = br06_stack( $br06_fp_runtime );
$br06_fp_quote   = $br06_fp_stack['quotes']->quote( br06_quote_request() );
$br06_fp_body    = br06_prepare_body( $br06_fp_quote );
$br06_fp_body['quoteFingerprint'] = str_repeat( 'd', 64 );
$br06_fp = $br06_fp_stack['prep']->prepare( $br06_fp_body, br06_next_uuid() );
br01_assert_eq( 'QUOTE_CHANGED', br06_error_code( $br06_fp ), 'wrong quoteFingerprint is QUOTE_CHANGED' );
br01_assert_eq( 0, $br06_fp_runtime->pos_order_count(), 'wrong fingerprint creates no order' );
$br06_fp_replay = $br06_fp_stack['prep']->prepare( $br06_fp_body, $br06_fp_stack['claims']->get_by_transaction( $br06_fp_body['transactionId'] )['idempotency_key'] );
br01_assert_eq( 'QUOTE_CHANGED', br06_error_code( $br06_fp_replay ), 'terminal QUOTE_CHANGED is replayed without a second Woo attempt' );
br01_assert_eq( 0, $br06_fp_runtime->pos_order_count(), 'replayed QUOTE_CHANGED still creates no order' );

$br06_exp_runtime = br06_runtime();
$br06_exp_stack   = br06_stack( $br06_exp_runtime );
$br06_exp_quote   = $br06_exp_stack['quotes']->quote( br06_quote_request() );
$br06_exp_quote['expiresAt'] = '2020-01-01T00:00:00Z';
$br06_exp_stack['store']->put( $br06_exp_quote );
$br06_exp = $br06_exp_stack['prep']->prepare( br06_prepare_body( $br06_exp_quote ), br06_next_uuid() );
br01_assert_eq( 'QUOTE_EXPIRED', br06_error_code( $br06_exp ), 'expired quote is QUOTE_EXPIRED' );
br01_assert_eq( 0, $br06_exp_runtime->pos_order_count(), 'expired quote creates no order' );

$br06_chg_runtime = br06_runtime();
$br06_chg_stack   = br06_stack( $br06_chg_runtime );
$br06_chg_quote   = $br06_chg_stack['quotes']->quote( br06_quote_request() );
$br06_chg_runtime->catalog['walkin']['101']['1']['unitPrice'] = '12.00';
$br06_chg_runtime->catalog['walkin']['101']['1']['subtotal']  = '12.00';
$br06_chg = $br06_chg_stack['prep']->prepare( br06_prepare_body( $br06_chg_quote ), br06_next_uuid() );
br01_assert_eq( 'QUOTE_CHANGED', br06_error_code( $br06_chg ), 'authoritative commercial change is QUOTE_CHANGED' );
$br06_chg_data = $br06_chg->get_error_data();
br01_assert( isset( $br06_chg_data['details']['currentQuoteId'] ), 'commercial change may return currentQuoteId' );
br01_assert_eq( 0, $br06_chg_runtime->pos_order_count(), 'commercial change creates no order' );

$br06_st_runtime = br06_runtime();
$br06_st_stack   = br06_stack( $br06_st_runtime );
$br06_st_quote   = $br06_st_stack['quotes']->quote( br06_quote_request() );
$br06_st_runtime->stock['101'] = 0;
$br06_st = $br06_st_stack['prep']->prepare( br06_prepare_body( $br06_st_quote ), br06_next_uuid() );
br01_assert_eq( 'STOCK_CHANGED', br06_error_code( $br06_st ), 'changed stock is STOCK_CHANGED' );
br01_assert_eq( 0, $br06_st_runtime->pos_order_count(), 'changed stock creates no order' );

$br06_hold_runtime = br06_runtime();
$br06_hold_runtime->hold_stock_minutes = 0;
$br06_hold_stack = br06_stack( $br06_hold_runtime );
$br06_hold_quote = $br06_hold_stack['quotes']->quote( br06_quote_request() );
$br06_hold = $br06_hold_stack['prep']->prepare( br06_prepare_body( $br06_hold_quote ), br06_next_uuid() );
br01_assert_eq( 'INTEGRATION_UNAVAILABLE', br06_error_code( $br06_hold ), 'unconfigured hold-stock minutes fails closed' );
br01_assert_eq( 0, $br06_hold_runtime->pos_order_count(), 'unconfigured hold-stock creates no order' );

$br06_bad_sale_runtime = br06_runtime();
$br06_bad_sale_runtime->force_commitment = 'held';
$br06_bad_sale_stack = br06_stack( $br06_bad_sale_runtime );
$br06_bad_sale_quote = $br06_bad_sale_stack['quotes']->quote( br06_quote_request() );
$br06_bad_sale = $br06_bad_sale_stack['prep']->prepare( br06_prepare_body( $br06_bad_sale_quote ), br06_next_uuid() );
br01_assert_eq( 'INTEGRATION_UNAVAILABLE', br06_error_code( $br06_bad_sale ), 'invalid PreparedSale cannot leave as ok' );

/* ---------------------------------------------------------------------------
 * Last-unit race
 * ------------------------------------------------------------------------ */

$br06_lu_runtime = br06_runtime();
$br06_lu_runtime->stock['101'] = 1;
$br06_lu_stack = br06_stack( $br06_lu_runtime );
$br06_lu_quote = $br06_lu_stack['quotes']->quote( br06_quote_request() );
$br06_lu_runtime->during_reserve = function ( $rt ) {
	$rt->competing_checkout( '101', 1 );
};
$br06_lu = $br06_lu_stack['prep']->prepare( br06_prepare_body( $br06_lu_quote ), br06_next_uuid() );
br01_assert_eq( 'STOCK_CHANGED', br06_error_code( $br06_lu ), 'last-unit competing checkout blocks prepare' );
br01_assert_eq( 0, $br06_lu_runtime->pos_order_count(), 'losing prepare does not keep a POS order' );
br01_assert_eq( 1, $br06_lu_runtime->storefront_orders, 'competing checkout took the last unit' );
br01_assert_eq( 0, $br06_lu_runtime->stock['101'], 'last unit is not double-committed' );

$br06_two_runtime = br06_runtime();
$br06_two_runtime->stock['101'] = 1;
$br06_two_stack = br06_stack( $br06_two_runtime );
$br06_two_q1 = $br06_two_stack['quotes']->quote( br06_quote_request() );
$br06_two_q2 = $br06_two_stack['quotes']->quote( br06_quote_request() );
$br06_two_b1 = br06_prepare_body( $br06_two_q1 );
$br06_two_b2 = br06_prepare_body( $br06_two_q2 );
$br06_two_k2 = br06_next_uuid();
$br06_two_second = null;
$br06_two_runtime->during_reserve = function () use ( $br06_two_stack, $br06_two_b2, $br06_two_k2, &$br06_two_second ) {
	$br06_two_second = $br06_two_stack['prep']->prepare( $br06_two_b2, $br06_two_k2 );
};
$br06_two_first = $br06_two_stack['prep']->prepare( $br06_two_b1, br06_next_uuid() );
$br06_two_wins  = 0;
if ( is_array( $br06_two_first ) ) {
	++$br06_two_wins;
}
if ( is_array( $br06_two_second ) ) {
	++$br06_two_wins;
}
br01_assert_eq( 1, $br06_two_wins, 'two competing prepares cannot both commit the last unit' );
br01_assert_eq( 1, $br06_two_runtime->pos_order_count(), 'last-unit POS race leaves exactly one POS order' );
br01_assert_eq( 0, $br06_two_runtime->stock['101'], 'last unit stock is exhausted once' );

/* ---------------------------------------------------------------------------
 * Complete reservation proof, actual expiry, exception normalization, partial A/B crash
 * ------------------------------------------------------------------------ */

$br06_exp_hold_runtime = br06_runtime();
$br06_exp_hold_runtime->hold_stock_minutes       = 60;
$br06_exp_hold_runtime->reservation_expiry_unix  = time() + 600;
$br06_exp_hold_stack = br06_stack( $br06_exp_hold_runtime );
$br06_exp_hold_quote = $br06_exp_hold_stack['quotes']->quote( br06_quote_request() );
$br06_exp_hold       = $br06_exp_hold_stack['prep']->prepare( br06_prepare_body( $br06_exp_hold_quote ), br06_next_uuid() );
br01_assert( is_array( $br06_exp_hold ), 'prepare with distinct reservation expiry returns PreparedSale' );
br01_assert_eq( gmdate( 'Y-m-d\TH:i:s\Z', $br06_exp_hold_runtime->reservation_expiry_unix ), $br06_exp_hold['expiresAt'], 'PreparedSale.expiresAt comes from proven reservation expiry' );
br01_assert( $br06_exp_hold['expiresAt'] !== gmdate( 'Y-m-d\TH:i:s\Z', time() + 3600 ), 'PreparedSale.expiresAt is not the guessed global hold-stock TTL' );

$br06_ex_runtime = br06_runtime();
$br06_ex_runtime->reserve_exception = 'woocommerce_product_not_enough_stock';
$br06_ex_stack = br06_stack( $br06_ex_runtime );
$br06_ex_quote = $br06_ex_stack['quotes']->quote( br06_quote_request() );
$br06_ex       = $br06_ex_stack['prep']->prepare( br06_prepare_body( $br06_ex_quote ), br06_next_uuid() );
br01_assert_eq( 'STOCK_CHANGED', br06_error_code( $br06_ex ), 'ReserveStockException is normalized to STOCK_CHANGED' );
br01_assert_eq( 0, $br06_ex_runtime->pos_order_count(), 'normalized reserve exception does not keep a POS order' );

$br06_ab_runtime = br06_runtime();
$br06_ab_priced  = $br06_ab_runtime->catalog['walkin']['101']['1'];
$br06_ab_runtime->catalog['walkin']['102']['1']               = $br06_ab_priced;
$br06_ab_runtime->catalog['retail:cust_retail_1']['102']['1'] = $br06_ab_priced;
$br06_ab_runtime->stock['102']                                = 10;
$br06_ab_stack = br06_stack( $br06_ab_runtime );
$br06_ab_req   = br06_quote_request();
$br06_ab_req['lines'][] = array(
	'lineId'    => br06_next_uuid(),
	'productId' => '102',
	'quantity'  => '1',
);
$br06_ab_quote = $br06_ab_stack['quotes']->quote( $br06_ab_req );
br01_assert( is_array( $br06_ab_quote ), 'two-line quote succeeds' );
$br06_ab_body = br06_prepare_body( $br06_ab_quote );
$br06_ab_key  = br06_next_uuid();
$br06_ab_runtime->after_product_reserve = function () {
	throw new RuntimeException( 'partial reservation after product A' );
};
br06_prepare_crashed( $br06_ab_stack['prep'], $br06_ab_body, $br06_ab_key, 'partial reservation after product A' );
br01_assert_eq( 1, $br06_ab_runtime->pos_order_count(), 'partial A/B crash leaves exactly one Woo order' );
br01_assert_eq( 1, $br06_ab_runtime->create_calls, 'partial A/B crash called create once' );
br01_assert( ! $br06_ab_runtime->reservation_is_proven( $br06_ab_runtime->orders[0]['id'] ), 'partial A-only reservation is not proven' );
$br06_ab_oid = $br06_ab_runtime->orders[0]['id'];
br01_assert( isset( $br06_ab_runtime->reservation_rows[ $br06_ab_oid ]['101'] ), 'product A reservation row exists after crash' );
br01_assert( ! isset( $br06_ab_runtime->reservation_rows[ $br06_ab_oid ]['102'] ), 'product B reservation row is missing after crash' );
$br06_ab_resolved = $br06_ab_stack['prep']->resolve( $br06_ab_body['transactionId'] );
br01_assert_eq( 'requires_attention', $br06_ab_resolved['status'], 'resolve alone does not report prepared for a partial reservation' );
br01_assert( ! $br06_ab_runtime->reservation_is_proven( $br06_ab_oid ), 'resolve alone does not complete stock reservation' );
br01_assert_eq( 1, $br06_ab_runtime->create_calls, 'resolve after partial crash does not call wc_create_order' );
br01_assert_eq( 1, $br06_ab_runtime->pos_order_count(), 'resolve after partial crash creates no second order' );
$br06_ab_retry = $br06_ab_stack['prep']->prepare( $br06_ab_body, $br06_ab_key );
br01_assert( is_array( $br06_ab_retry ), 'retry after partial A/B crash recovers PreparedSale' );
br01_assert_eq( 'prepared', $br06_ab_retry['status'], 'retry after partial reservation is prepared' );
br01_assert_eq( 'reserved', $br06_ab_retry['stockCommitment'], 'retry reports reserved only after A and B are proven' );
br01_assert( isset( $br06_ab_retry['expiresAt'] ), 'retry PreparedSale includes proven expiry' );
br01_assert( $br06_ab_runtime->reservation_is_proven( $br06_ab_oid ), 'retry proves both required reservation rows' );
br01_assert( isset( $br06_ab_runtime->reservation_rows[ $br06_ab_oid ]['101'] ), 'retry keeps product A reservation' );
br01_assert( isset( $br06_ab_runtime->reservation_rows[ $br06_ab_oid ]['102'] ), 'retry completed product B reservation' );
br01_assert_eq( 1, $br06_ab_runtime->create_calls, 'retry after partial crash does not create a second Woo order' );
br01_assert_eq( 1, $br06_ab_runtime->pos_order_count(), 'retry after partial crash order count remains one' );

/* ---------------------------------------------------------------------------
 * Quote-to-order economics snapshot (walk-in, retail/B2B, discount, ADR-013, tax, divergence)
 * ------------------------------------------------------------------------ */

$br06_retail_runtime = br06_runtime();
$br06_retail_runtime->catalog['retail:cust_retail_1']['101']['1'] = array(
	'unitPrice'   => '9.00',
	'subtotal'    => '9.00',
	'discount'    => '0.00',
	'tax'         => '0.00',
	'stockStatus' => 'in_stock',
	'purchasable' => true,
);
$br06_retail_stack = br06_stack( $br06_retail_runtime );
$br06_retail_req   = br06_quote_request();
$br06_retail_req['customer'] = array(
	'kind'       => 'retail',
	'customerId' => 'cust_retail_1',
);
$br06_retail_quote = $br06_retail_stack['quotes']->quote( $br06_retail_req );
br01_assert( is_array( $br06_retail_quote ), 'registered retail quote succeeds' );
br01_assert_eq( 900, (int) $br06_retail_quote['total']['minor'], 'registered retail uses customer-context price, not walk-in/staff' );
$br06_retail_prep = $br06_retail_stack['prep']->prepare( br06_prepare_body( $br06_retail_quote ), br06_next_uuid() );
br01_assert( is_array( $br06_retail_prep ), 'registered retail prepare succeeds' );
br06_assert_saved_matches_quote( $br06_retail_runtime, $br06_retail_quote, $br06_retail_prep, 'registered retail' );
br01_assert_eq( 'retail', $br06_retail_runtime->orders[0]['customer_kind'], 'registered retail Woo order keeps buyer context' );
br01_assert_eq( 'cust_retail_1', $br06_retail_runtime->orders[0]['customer_id'], 'registered retail Woo order keeps customer id' );

$br06_b2b_runtime = br06_runtime();
$br06_b2b_runtime->customers['cust_b2b_1'] = 'b2b';
$br06_b2b_runtime->catalog['b2b:cust_b2b_1']['101']['1'] = array(
	'unitPrice'   => '8.00',
	'subtotal'    => '8.00',
	'discount'    => '0.00',
	'tax'         => '0.00',
	'stockStatus' => 'in_stock',
	'purchasable' => true,
);
$br06_b2b_stack = br06_stack( $br06_b2b_runtime );
$br06_b2b_req   = br06_quote_request();
$br06_b2b_req['customer'] = array(
	'kind'       => 'b2b',
	'customerId' => 'cust_b2b_1',
);
$br06_b2b_quote = $br06_b2b_stack['quotes']->quote( $br06_b2b_req );
br01_assert( is_array( $br06_b2b_quote ), 'B2B quote succeeds' );
$br06_b2b_prep = $br06_b2b_stack['prep']->prepare( br06_prepare_body( $br06_b2b_quote ), br06_next_uuid() );
br01_assert( is_array( $br06_b2b_prep ), 'B2B prepare succeeds' );
br06_assert_saved_matches_quote( $br06_b2b_runtime, $br06_b2b_quote, $br06_b2b_prep, 'B2B' );
br01_assert_eq( 'b2b', $br06_b2b_runtime->orders[0]['customer_kind'], 'B2B Woo order keeps buyer context' );

$br06_disc_runtime = br06_runtime();
$br06_disc_runtime->catalog['walkin']['101']['1'] = array(
	'unitPrice'   => '10.00',
	'subtotal'    => '10.00',
	'discount'    => '2.00',
	'tax'         => '0.00',
	'stockStatus' => 'in_stock',
	'purchasable' => true,
);
$br06_disc_stack = br06_stack( $br06_disc_runtime );
$br06_disc_quote = $br06_disc_stack['quotes']->quote( br06_quote_request() );
br01_assert( is_array( $br06_disc_quote ), 'discount quote succeeds' );
br01_assert_eq( 200, (int) $br06_disc_quote['discount']['minor'], 'discount quote has non-zero discount' );
$br06_disc_prep = $br06_disc_stack['prep']->prepare( br06_prepare_body( $br06_disc_quote ), br06_next_uuid() );
br01_assert( is_array( $br06_disc_prep ), 'discount prepare succeeds' );
br06_assert_saved_matches_quote( $br06_disc_runtime, $br06_disc_quote, $br06_disc_prep, 'discount-bearing' );

$br06_alloc_runtime = br06_runtime();
$br06_alloc_priced_a = array(
	'unitPrice'   => '10.00',
	'subtotal'    => '10.00',
	'discount'    => '1.50',
	'tax'         => '0.00',
	'stockStatus' => 'in_stock',
	'purchasable' => true,
);
$br06_alloc_priced_b = array(
	'unitPrice'   => '10.00',
	'subtotal'    => '10.00',
	'discount'    => '0.50',
	'tax'         => '0.00',
	'stockStatus' => 'in_stock',
	'purchasable' => true,
);
$br06_alloc_runtime->catalog['walkin']['101']['1']               = $br06_alloc_priced_a;
$br06_alloc_runtime->catalog['walkin']['102']['1']               = $br06_alloc_priced_b;
$br06_alloc_runtime->catalog['retail:cust_retail_1']['101']['1'] = $br06_alloc_priced_a;
$br06_alloc_runtime->catalog['retail:cust_retail_1']['102']['1'] = $br06_alloc_priced_b;
$br06_alloc_runtime->stock['102']                                = 10;
$br06_alloc_stack = br06_stack( $br06_alloc_runtime );
$br06_alloc_req   = br06_quote_request();
$br06_alloc_req['lines'][] = array(
	'lineId'    => br06_next_uuid(),
	'productId' => '102',
	'quantity'  => '1',
);
$br06_alloc_quote = $br06_alloc_stack['quotes']->quote( $br06_alloc_req );
br01_assert( is_array( $br06_alloc_quote ), 'ADR-013 allocated two-line quote succeeds' );
br01_assert_eq( 150, (int) $br06_alloc_quote['lines'][0]['discount']['minor'], 'first line keeps allocated discount' );
br01_assert_eq( 50, (int) $br06_alloc_quote['lines'][1]['discount']['minor'], 'second line keeps allocated discount' );
br01_assert_eq( 1800, (int) $br06_alloc_quote['total']['minor'], 'allocated lines sum to quote total' );
$br06_alloc_prep = $br06_alloc_stack['prep']->prepare( br06_prepare_body( $br06_alloc_quote ), br06_next_uuid() );
br01_assert( is_array( $br06_alloc_prep ), 'ADR-013 prepare succeeds' );
br06_assert_saved_matches_quote( $br06_alloc_runtime, $br06_alloc_quote, $br06_alloc_prep, 'ADR-013 allocation' );
$br06_alloc_sum = (int) $br06_alloc_runtime->orders[0]['line_economics'][0]['total'] + (int) $br06_alloc_runtime->orders[0]['line_economics'][1]['total'];
br01_assert_eq( (int) $br06_alloc_quote['total']['minor'], $br06_alloc_sum, 'summed Woo lines equal quote/order total' );

$br06_tax_runtime = br06_runtime();
$br06_tax_runtime->catalog['walkin']['101']['1'] = array(
	'unitPrice'   => '10.00',
	'subtotal'    => '10.00',
	'discount'    => '0.00',
	'tax'         => '1.50',
	'taxRates'    => array(
		'total'    => array( '1' => '1.50' ),
		'subtotal' => array( '1' => '1.50' ),
	),
	'stockStatus' => 'in_stock',
	'purchasable' => true,
);
$br06_tax_stack = br06_stack( $br06_tax_runtime );
$br06_tax_quote = $br06_tax_stack['quotes']->quote( br06_quote_request() );
br01_assert( is_array( $br06_tax_quote ), 'tax-capable quote succeeds' );
br01_assert_eq( 150, (int) $br06_tax_quote['tax']['minor'], 'tax-capable quote preserves accepted tax' );
$br06_tax_prep = $br06_tax_stack['prep']->prepare( br06_prepare_body( $br06_tax_quote ), br06_next_uuid() );
br01_assert( is_array( $br06_tax_prep ), 'tax-capable prepare succeeds' );
br06_assert_saved_matches_quote( $br06_tax_runtime, $br06_tax_quote, $br06_tax_prep, 'tax-capable' );
br01_assert( isset( $br06_tax_runtime->orders[0]['line_economics'][0]['taxRates']['total']['1'] ), 'tax-rate breakdown came from the Woo cart snapshot' );
br01_assert_eq( '1.50', $br06_tax_runtime->orders[0]['line_economics'][0]['taxRates']['total']['1'], 'persisted tax rate matches provider snapshot' );

$br06_div_runtime = br06_runtime();
$br06_div_runtime->force_saved_total_minor = 9999;
$br06_div_stack = br06_stack( $br06_div_runtime );
$br06_div_quote = $br06_div_stack['quotes']->quote( br06_quote_request() );
$br06_div_body  = br06_prepare_body( $br06_div_quote );
$br06_div_key   = br06_next_uuid();
$br06_div       = $br06_div_stack['prep']->prepare( $br06_div_body, $br06_div_key );
br01_assert_eq( 'INTEGRATION_UNAVAILABLE', br06_error_code( $br06_div ), 'forced economic divergence fails closed' );
br01_assert( ! is_array( $br06_div ) || ! isset( $br06_div['status'] ) || $br06_div['status'] !== 'prepared', 'forced divergence does not return PreparedSale' );
br01_assert_eq( 1, $br06_div_runtime->create_calls, 'forced divergence created the original order once' );
br01_assert_eq( 1, $br06_div_runtime->pos_order_count(), 'forced divergence keeps exactly one Woo order' );
$br06_div_retry = $br06_div_stack['prep']->prepare( $br06_div_body, $br06_div_key );
br01_assert_eq( 'INTEGRATION_UNAVAILABLE', br06_error_code( $br06_div_retry ), 'forced divergence retry still fails closed' );
br01_assert_eq( 1, $br06_div_runtime->create_calls, 'forced divergence retry does not create a second order' );
br01_assert_eq( 1, $br06_div_runtime->pos_order_count(), 'forced divergence retry order count remains one' );
$br06_div_resolved = $br06_div_stack['prep']->resolve( $br06_div_body['transactionId'] );
br01_assert( $br06_div_resolved['status'] === 'preparing' || $br06_div_resolved['status'] === 'requires_attention', 'forced divergence remains resolvable without PreparedSale' );

/* ---------------------------------------------------------------------------
 * Post-create identity: idempotent bind, conflicts, quote-store expiry,
 * and the legacy create-entered claim with no woo_order_id.
 * ------------------------------------------------------------------------ */

$br06_bind_claims = new Cetech_Pos_Bridge_Claim_Store();
$br06_bind_key    = br06_next_uuid();
$br06_bind_tx     = br06_next_uuid();
$br06_bind_hash   = str_repeat( 'ab', 32 );
br01_assert_eq(
	Cetech_Pos_Bridge_Claim_Store::INSERT_CREATED,
	$br06_bind_claims->insert_preparing(
		array(
			'operation_type'  => Cetech_Pos_Bridge_Constants::OPERATION_PREPARE,
			'idempotency_key' => $br06_bind_key,
			'transaction_id'  => $br06_bind_tx,
			'request_hash'    => $br06_bind_hash,
			'quote_id'        => 'quote-bind',
		)
	),
	'identity bind fixture creates one claim'
);
br01_assert_eq(
	Cetech_Pos_Bridge_Claim_Store::BIND_NEWLY_BOUND,
	$br06_bind_claims->bind_created_order_identity( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, $br06_bind_key, $br06_bind_tx, $br06_bind_hash, '4401', 'sale-4401' ),
	'same identity bind is newly bound'
);
br01_assert_eq(
	Cetech_Pos_Bridge_Claim_Store::BIND_ALREADY_BOUND,
	$br06_bind_claims->bind_created_order_identity( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, $br06_bind_key, $br06_bind_tx, $br06_bind_hash, '4401', 'sale-4401' ),
	'repeated identity bind is idempotent'
);
br01_assert_eq( '4401', (string) $br06_bind_claims->get_by_idempotency( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, $br06_bind_key )['woo_order_id'], 'idempotent bind keeps the original Woo order id' );
br01_assert_eq(
	Cetech_Pos_Bridge_Claim_Store::BIND_CONFLICTING_ORDER_ID,
	$br06_bind_claims->bind_created_order_identity( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, $br06_bind_key, $br06_bind_tx, $br06_bind_hash, '4402', 'sale-4401' ),
	'a second Woo order id conflicts'
);
br01_assert_eq( '4401', (string) $br06_bind_claims->get_by_idempotency( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, $br06_bind_key )['woo_order_id'], 'conflicting order id does not overwrite' );
br01_assert_eq(
	Cetech_Pos_Bridge_Claim_Store::BIND_CONFLICTING_SALE_ID,
	$br06_bind_claims->bind_created_order_identity( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, $br06_bind_key, $br06_bind_tx, $br06_bind_hash, '4401', 'sale-other' ),
	'a rotated sale id conflicts'
);
br01_assert_eq( 'sale-4401', (string) $br06_bind_claims->get_by_idempotency( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, $br06_bind_key )['sale_id'], 'conflicting sale id does not overwrite' );
br01_assert_eq(
	Cetech_Pos_Bridge_Claim_Store::BIND_REQUEST_HASH_MISMATCH,
	$br06_bind_claims->bind_created_order_identity( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, $br06_bind_key, $br06_bind_tx, str_repeat( 'cd', 32 ), '4401', 'sale-4401' ),
	'a different request hash is not bound'
);
br01_assert_eq(
	Cetech_Pos_Bridge_Claim_Store::BIND_TRANSACTION_MISMATCH,
	$br06_bind_claims->bind_created_order_identity( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, $br06_bind_key, br06_next_uuid(), $br06_bind_hash, '4401', 'sale-4401' ),
	'a different transaction is not bound'
);
br01_assert_eq(
	Cetech_Pos_Bridge_Claim_Store::BIND_NOT_FOUND,
	$br06_bind_claims->bind_created_order_identity( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, br06_next_uuid(), $br06_bind_tx, $br06_bind_hash, '4401', 'sale-4401' ),
	'a missing claim is not created by identity binding'
);

if ( ! defined( 'ARRAY_A' ) ) {
	define( 'ARRAY_A', 'ARRAY_A' );
}

/**
 * Scripted $wpdb for bind_wpdb() only. get_row() returns the queued claim
 * snapshots. query() returns the scripted write result and does not mutate.
 */
class Br128_Scripted_Wpdb {
	public $query_result = false;
	public $rows         = array();
	public $query_calls  = 0;

	public function insert() {
		return 1;
	}

	public function prepare( $sql ) {
		unset( $sql );
		return 'scripted';
	}

	public function get_row( $sql, $output = null ) {
		unset( $sql, $output );
		if ( count( $this->rows ) === 0 ) {
			return null;
		}
		return array_shift( $this->rows );
	}

	public function query( $sql ) {
		unset( $sql );
		++$this->query_calls;
		return $this->query_result;
	}
}

/**
 * In-memory claim table used only to drive one prepare through bind_wpdb().
 * The identity UPDATE is forced to fail and does not write woo_order_id.
 */
class Br128_Claim_Table_Wpdb {
	public $rows           = array();
	public $query_result   = false;
	public $identity_writes = 0;

	public function insert( $table, $data ) {
		unset( $table );
		foreach ( $this->rows as $row ) {
			if (
				isset( $row['operation_type'], $row['idempotency_key'], $data['operation_type'], $data['idempotency_key'] )
				&& (string) $row['operation_type'] === (string) $data['operation_type']
				&& (string) $row['idempotency_key'] === (string) $data['idempotency_key']
			) {
				return false;
			}
		}
		$this->rows[] = array_merge(
			array(
				'woo_order_id'       => null,
				'sale_id'            => null,
				'outcome_json'       => null,
				'error_code'         => null,
				'error_message'      => null,
				'error_details_json' => null,
			),
			$data
		);
		return 1;
	}

	public function update( $table, $data, $where ) {
		unset( $table );
		foreach ( $this->rows as $index => $row ) {
			$matched = true;
			foreach ( $where as $column => $value ) {
				if ( ! isset( $row[ $column ] ) || (string) $row[ $column ] !== (string) $value ) {
					$matched = false;
					break;
				}
			}
			if ( $matched ) {
				$this->rows[ $index ] = array_merge( $row, $data );
				return 1;
			}
		}
		return 0;
	}

	public function prepare( $sql ) {
		unset( $sql );
		return 'claim-table';
	}

	public function get_row( $sql, $output = null ) {
		unset( $sql, $output );
		return isset( $this->rows[0] ) ? $this->rows[0] : null;
	}

	public function query( $sql ) {
		unset( $sql );
		++$this->identity_writes;
		return $this->query_result;
	}

	public function get_var( $sql ) {
		unset( $sql );
		return '1';
	}
}

function br128_with_wpdb( $wpdb, $callback ) {
	$previous = array_key_exists( 'wpdb', $GLOBALS ) ? $GLOBALS['wpdb'] : null;
	$had      = array_key_exists( 'wpdb', $GLOBALS );
	$GLOBALS['wpdb'] = $wpdb;
	try {
		return $callback();
	} finally {
		if ( $had ) {
			$GLOBALS['wpdb'] = $previous;
		} else {
			unset( $GLOBALS['wpdb'] );
		}
	}
}

function br128_wpdb_claim( $key, $tx, $hash, $order_id = null, $sale_id = null ) {
	return array(
		'site_scope'         => '1',
		'operation_type'     => Cetech_Pos_Bridge_Constants::OPERATION_PREPARE,
		'idempotency_key'    => $key,
		'transaction_id'     => $tx,
		'request_hash'       => $hash,
		'quote_id'           => 'quote-wpdb-bind',
		'internal_status'    => Cetech_Pos_Bridge_Claim_Store::STATUS_PREPARING,
		'woo_order_id'       => $order_id,
		'sale_id'            => $sale_id,
		'woo_create_entered' => 1,
		'outcome_json'       => null,
		'error_code'         => null,
		'error_message'      => null,
		'error_details_json' => null,
	);
}

function br128_wpdb_bind( $query_result, array $before, $after, $key, $tx, $hash, $order_id, $sale_id ) {
	$wpdb                = new Br128_Scripted_Wpdb();
	$wpdb->query_result  = $query_result;
	$wpdb->rows          = array( $before );
	if ( is_array( $after ) ) {
		$wpdb->rows[] = $after;
	}
	$result = br128_with_wpdb(
		$wpdb,
		function () use ( $key, $tx, $hash, $order_id, $sale_id ) {
			$store = new Cetech_Pos_Bridge_Claim_Store();
			return $store->bind_created_order_identity(
				Cetech_Pos_Bridge_Constants::OPERATION_PREPARE,
				$key,
				$tx,
				$hash,
				$order_id,
				$sale_id
			);
		}
	);
	return array( $result, $wpdb );
}

$br128_wp_key  = br06_next_uuid();
$br128_wp_tx   = br06_next_uuid();
$br128_wp_hash = str_repeat( 'ef', 32 );
$br128_unbound = br128_wpdb_claim( $br128_wp_key, $br128_wp_tx, $br128_wp_hash );
$br128_same    = br128_wpdb_claim( $br128_wp_key, $br128_wp_tx, $br128_wp_hash, '4401', 'sale-4401' );
$br128_other_order = br128_wpdb_claim( $br128_wp_key, $br128_wp_tx, $br128_wp_hash, '9999', 'sale-4401' );
$br128_other_sale  = br128_wpdb_claim( $br128_wp_key, $br128_wp_tx, $br128_wp_hash, '4401', 'sale-other' );

list( $br128_false_result, $br128_false_db ) = br128_wpdb_bind( false, $br128_unbound, $br128_unbound, $br128_wp_key, $br128_wp_tx, $br128_wp_hash, '4401', 'sale-4401' );
br01_assert_eq( Cetech_Pos_Bridge_Claim_Store::BIND_PERSISTENCE_FAILED, $br128_false_result, 'wpdb query false while unbound is persistence_failed' );
br01_assert_eq( 1, $br128_false_db->query_calls, 'wpdb query false still attempted the identity update' );

list( $br128_zero_same, $br128_zero_same_db ) = br128_wpdb_bind( 0, $br128_unbound, $br128_same, $br128_wp_key, $br128_wp_tx, $br128_wp_hash, '4401', 'sale-4401' );
br01_assert_eq( Cetech_Pos_Bridge_Claim_Store::BIND_ALREADY_BOUND, $br128_zero_same, 'wpdb query zero with the same reread identity is already_bound' );
br01_assert_eq( 1, $br128_zero_same_db->query_calls, 'wpdb query zero still ran the identity update' );

list( $br128_zero_open, $br128_zero_open_db ) = br128_wpdb_bind( 0, $br128_unbound, $br128_unbound, $br128_wp_key, $br128_wp_tx, $br128_wp_hash, '4401', 'sale-4401' );
unset( $br128_zero_open_db );
br01_assert_eq( Cetech_Pos_Bridge_Claim_Store::BIND_PERSISTENCE_FAILED, $br128_zero_open, 'wpdb query zero while still unbound is persistence_failed' );

list( $br128_one_same, $br128_one_same_db ) = br128_wpdb_bind( 1, $br128_unbound, $br128_same, $br128_wp_key, $br128_wp_tx, $br128_wp_hash, '4401', 'sale-4401' );
unset( $br128_one_same_db );
br01_assert_eq( Cetech_Pos_Bridge_Claim_Store::BIND_NEWLY_BOUND, $br128_one_same, 'wpdb query one with the same reread identity is newly_bound' );

foreach ( array( 1, 0 ) as $br128_conflict_rows ) {
	list( $br128_order_conflict, $br128_order_conflict_db ) = br128_wpdb_bind( $br128_conflict_rows, $br128_unbound, $br128_other_order, $br128_wp_key, $br128_wp_tx, $br128_wp_hash, '4401', 'sale-4401' );
	unset( $br128_order_conflict_db );
	br01_assert_eq( Cetech_Pos_Bridge_Claim_Store::BIND_CONFLICTING_ORDER_ID, $br128_order_conflict, 'wpdb reread with a different order id conflicts for query ' . $br128_conflict_rows );
	list( $br128_sale_conflict, $br128_sale_conflict_db ) = br128_wpdb_bind( $br128_conflict_rows, $br128_unbound, $br128_other_sale, $br128_wp_key, $br128_wp_tx, $br128_wp_hash, '4401', 'sale-4401' );
	unset( $br128_sale_conflict_db );
	br01_assert_eq( Cetech_Pos_Bridge_Claim_Store::BIND_CONFLICTING_SALE_ID, $br128_sale_conflict, 'wpdb reread with a different sale id conflicts for query ' . $br128_conflict_rows );
}

$br128_wrong_tx = br128_wpdb_claim( $br128_wp_key, br06_next_uuid(), $br128_wp_hash );
list( $br128_tx_result, $br128_tx_db ) = br128_wpdb_bind( 1, $br128_wrong_tx, $br128_same, $br128_wp_key, $br128_wp_tx, $br128_wp_hash, '4401', 'sale-4401' );
br01_assert_eq( Cetech_Pos_Bridge_Claim_Store::BIND_TRANSACTION_MISMATCH, $br128_tx_result, 'wpdb transaction mismatch is returned before the update' );
br01_assert_eq( 0, $br128_tx_db->query_calls, 'wpdb transaction mismatch does not write' );

$br128_wrong_hash = br128_wpdb_claim( $br128_wp_key, $br128_wp_tx, str_repeat( 'ab', 32 ) );
list( $br128_hash_result, $br128_hash_db ) = br128_wpdb_bind( 1, $br128_wrong_hash, $br128_same, $br128_wp_key, $br128_wp_tx, $br128_wp_hash, '4401', 'sale-4401' );
br01_assert_eq( Cetech_Pos_Bridge_Claim_Store::BIND_REQUEST_HASH_MISMATCH, $br128_hash_result, 'wpdb request-hash mismatch is returned before the update' );
br01_assert_eq( 0, $br128_hash_db->query_calls, 'wpdb request-hash mismatch does not write' );

$br128_table = new Br128_Claim_Table_Wpdb();
$br128_table->query_result = false;
br128_with_wpdb(
	$br128_table,
	function () use ( $br128_table ) {
		$runtime = br06_runtime();
		$store   = new Cetech_Pos_Bridge_Quote_Store();
		$quotes  = new Cetech_Pos_Bridge_Quote_Engine( $runtime, $store );
		$claims  = new Cetech_Pos_Bridge_Claim_Store();
		$prep    = new Cetech_Pos_Bridge_Prepare_Engine( $runtime, $quotes, $store, $claims );
		$quote   = $quotes->quote( br06_quote_request() );
		$body    = br06_prepare_body( $quote );
		$key     = br06_next_uuid();
		$first   = $prep->prepare( $body, $key );
		br01_assert_eq( 'REQUIRES_ATTENTION', br06_error_code( $first ), 'persistence failure returns requires_attention' );
		br01_assert(
			is_object( $first ) && strpos( $first->get_error_message(), 'could not be confirmed in the prepare claim' ) !== false,
			'persistence failure explains the claim identity was not confirmed'
		);
		br01_assert_eq( 1, $runtime->create_calls, 'persistence failure creates exactly one Woo order' );
		br01_assert_eq( 1, $runtime->pos_order_count(), 'persistence failure leaves one Woo order' );
		br01_assert_eq( 0, count( $runtime->orders[0]['items'] ), 'persistence failure does not continue quote-line work' );
		br01_assert( ! br06_order_reserved( $runtime ), 'persistence failure does not reserve stock' );
		br01_assert_eq( 0, $runtime->woo_mutation_counts()['item_adds'], 'persistence failure adds no order items' );
		br01_assert_eq( 0, $runtime->woo_mutation_counts()['stock_reservations'], 'persistence failure writes no stock reservation' );
		br01_assert_eq( $body['transactionId'], $runtime->orders[0]['transaction_id'], 'persistence failure keeps the transaction on the order' );
		br01_assert( is_array( $runtime->orders[0]['frozen_prepare'] ), 'persistence failure leaves frozen order evidence' );
		$claim = $claims->get_by_idempotency( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, $key );
		br01_assert_eq( Cetech_Pos_Bridge_Claim_Store::STATUS_REQUIRES_ATTENTION, $claim['internal_status'], 'persistence failure classifies the claim as attention' );
		br01_assert_eq( '', (string) $claim['woo_order_id'], 'persistence failure does not treat the claim as bound' );
		br01_assert_eq( $key, $claim['idempotency_key'], 'persistence failure keeps the idempotency key' );
		br01_assert_eq( $body['transactionId'], $claim['transaction_id'], 'persistence failure keeps the claim transaction' );
		$retry = $prep->prepare( $body, $key );
		br01_assert_eq( 'REQUIRES_ATTENTION', br06_error_code( $retry ), 'persistence failure retry stays requires_attention' );
		br01_assert_eq( 1, $runtime->create_calls, 'persistence failure retry does not create a second order' );
		br01_assert_eq( 1, $runtime->pos_order_count(), 'persistence failure retry order count stays one' );
		br01_assert_eq( 1, $br128_table->identity_writes, 'persistence failure retry does not attempt another identity write' );
	}
);

$br06_leg_runtime = br06_runtime();
$br06_leg_stack   = br06_stack( $br06_leg_runtime );
$br06_leg_quote   = $br06_leg_stack['quotes']->quote( br06_quote_request() );
$br06_leg_body    = br06_prepare_body( $br06_leg_quote );
$br06_leg_key     = br06_next_uuid();
$br06_leg_hash    = Cetech_Pos_Bridge_Request_Hash::hash( $br06_leg_body );
$br06_leg_stack['claims']->insert_preparing(
	array(
		'operation_type'     => Cetech_Pos_Bridge_Constants::OPERATION_PREPARE,
		'idempotency_key'    => $br06_leg_key,
		'transaction_id'     => $br06_leg_body['transactionId'],
		'request_hash'       => $br06_leg_hash,
		'quote_id'           => $br06_leg_quote['id'],
		'woo_create_entered' => 1,
	)
);
$br06_leg_runtime->inject_pos_order( $br06_leg_body['transactionId'], $br06_leg_hash, false, null );
$br06_leg_stack['store']->forget( $br06_leg_quote['id'] );
$br06_leg_before = $br06_leg_runtime->woo_mutation_counts();
$br06_leg_resolved = $br06_leg_stack['prep']->resolve( $br06_leg_body['transactionId'] );
br01_assert_eq( 'requires_attention', $br06_leg_resolved['status'], 'legacy create-entered claim is not not_found' );
br01_assert( isset( $br06_leg_resolved['saleId'] ) && $br06_leg_resolved['saleId'] !== '', 'legacy resolve includes the existing sale id' );
br01_assert( isset( $br06_leg_resolved['orderReference'] ) && $br06_leg_resolved['orderReference'] !== '', 'legacy resolve includes the existing order reference' );
br01_assert( strpos( $br06_leg_resolved['message'], 'cannot yet be safely opened for payment' ) !== false, 'legacy resolve explains the order cannot yet be opened for payment' );
br01_assert_eq( $br06_leg_before, $br06_leg_runtime->woo_mutation_counts(), 'legacy GET resolve writes no Woo mutations' );
br01_assert_eq( 0, $br06_leg_runtime->create_calls, 'legacy resolve does not create a replacement order' );
br01_assert_eq( 1, $br06_leg_runtime->pos_order_count(), 'legacy resolve leaves the original order' );
br01_assert_eq( '', (string) $br06_leg_stack['claims']->get_by_idempotency( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, $br06_leg_key )['woo_order_id'], 'legacy GET does not invent a claim order id' );
$br06_leg_retry = $br06_leg_stack['prep']->prepare( $br06_leg_body, $br06_leg_key );
br01_assert_eq( 'REQUIRES_ATTENTION', br06_error_code( $br06_leg_retry ), 'legacy retry does not invent a prepared sale' );
br01_assert_eq( 0, $br06_leg_runtime->create_calls, 'legacy retry does not call order creation' );
br01_assert_eq( 1, $br06_leg_runtime->pos_order_count(), 'legacy retry does not create a second order' );

$br06_exp_runtime = br06_runtime();
$br06_exp_stack   = br06_stack( $br06_exp_runtime );
$br06_exp_quote   = $br06_exp_stack['quotes']->quote( br06_quote_request() );
$br06_exp_body    = br06_prepare_body( $br06_exp_quote );
$br06_exp_key     = br06_next_uuid();
$br06_exp_stack['prep']->after_order_create = br06_thrower( 'crash after reservation before quote expiry recovery' );
br06_prepare_crashed( $br06_exp_stack['prep'], $br06_exp_body, $br06_exp_key, 'crash after reservation before quote expiry recovery' );
$br06_exp_sale = 'sale-' . $br06_exp_runtime->orders[0]['id'];
$br06_exp_stack['store']->forget( $br06_exp_quote['id'] );
$br06_exp_runtime->catalog['walkin']['101']['1']['unitPrice'] = '99.00';
$br06_exp_runtime->catalog['walkin']['101']['1']['subtotal']  = '99.00';
$br06_exp_before = $br06_exp_runtime->woo_mutation_counts();
$br06_exp_resolved = $br06_exp_stack['prep']->resolve( $br06_exp_body['transactionId'] );
br01_assert_eq( 'prepared', $br06_exp_resolved['status'], 'expired quote store still resolves a complete frozen order' );
br01_assert_eq( $br06_exp_sale, $br06_exp_resolved['saleId'], 'expired quote store resolve keeps the original sale id' );
br01_assert_eq( (string) $br06_exp_runtime->orders[0]['id'], $br06_exp_resolved['orderReference'], 'expired quote store resolve keeps the original order' );
br01_assert_eq( $br06_exp_before, $br06_exp_runtime->woo_mutation_counts(), 'complete frozen GET resolve writes no Woo mutations' );
br01_assert_eq( 1, $br06_exp_runtime->create_calls, 'expired quote store resolve does not create another order' );
$br06_exp_retry = $br06_exp_stack['prep']->prepare( $br06_exp_body, $br06_exp_key );
br01_assert( is_array( $br06_exp_retry ), 'expired quote store retry returns PreparedSale from frozen evidence' );
br01_assert_eq( 'prepared', $br06_exp_retry['status'], 'expired quote store retry is prepared' );
br01_assert_eq( (int) $br06_exp_quote['total']['minor'], (int) $br06_exp_retry['total']['minor'], 'expired quote store retry does not use the mutated catalog price' );
br01_assert_eq( $br06_exp_sale, $br06_exp_retry['saleId'], 'expired quote store retry does not rotate the sale id' );
br01_assert_eq( $br06_exp_body['transactionId'], $br06_exp_retry['transactionId'], 'expired quote store retry keeps the transaction id' );
br01_assert_eq( 1, $br06_exp_runtime->create_calls, 'expired quote store retry does not create a second order' );
br01_assert_eq( 1, $br06_exp_runtime->pos_order_count(), 'expired quote store retry order count stays one' );

$br06_norm_runtime = br06_runtime();
$br06_norm_stack   = br06_stack( $br06_norm_runtime );
$br06_norm_quote   = $br06_norm_stack['quotes']->quote( br06_quote_request() );
$br06_norm_body    = br06_prepare_body( $br06_norm_quote );
$br06_norm_key     = br06_next_uuid();
$br06_norm         = $br06_norm_stack['prep']->prepare( $br06_norm_body, $br06_norm_key );
br01_assert( is_array( $br06_norm ), 'normal prepare returns PreparedSale' );
br01_assert_eq( 'prepared', $br06_norm['status'], 'normal prepare status is prepared' );
$br06_norm_claim = $br06_norm_stack['claims']->get_by_idempotency( Cetech_Pos_Bridge_Constants::OPERATION_PREPARE, $br06_norm_key );
br01_assert_eq( Cetech_Pos_Bridge_Claim_Store::STATUS_PREPARED, $br06_norm_claim['internal_status'], 'normal prepare claim is prepared' );
br01_assert_eq( (string) $br06_norm_runtime->orders[0]['id'], (string) $br06_norm_claim['woo_order_id'], 'normal prepare claim stores the one Woo order id' );
br01_assert_eq( $br06_norm['saleId'], (string) $br06_norm_claim['sale_id'], 'normal prepare claim stores the one sale id' );
br01_assert_eq( $br06_norm_body['transactionId'], $br06_norm['transactionId'], 'normal prepare keeps the transaction id' );
br01_assert_eq( 1, $br06_norm_runtime->create_calls, 'normal prepare creates one Woo order' );
br01_assert_eq( 1, $br06_norm_runtime->pos_order_count(), 'normal prepare leaves one Woo order' );

br01_assert_eq( 0, $br06_ok_runtime->side_effect_counts()['payments'], 'suite still has no payment side effect on the happy-path runtime' );
br01_assert( strpos( $woo_src, 'WoodMart' ) === false || strpos( $prep_src, 'b2bking_get' ) === false, 'prepare path does not copy B2BKing getters' );
br01_assert( strpos( $prep_src, 'woodmart_get_discount' ) === false, 'prepare path does not copy WoodMart formulas' );

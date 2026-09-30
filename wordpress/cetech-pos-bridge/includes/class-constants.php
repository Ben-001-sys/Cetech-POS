<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Cetech_Pos_Bridge_Constants {
	const NAMESPACE           = 'cetech-pos/v1';
	const HEALTH_ROUTE        = '/health';
	const QUOTE_ROUTE         = '/quotes';
	const PREPARE_ROUTE       = '/sales/prepare';
	const FINALIZE_ROUTE      = '/sales/finalize';
	const CANCEL_ROUTE        = '/sales/cancel';
	const RESOLVE_ROUTE       = '/sales/(?P<transactionId>[0-9a-fA-F-]+)';
	const COMMERCIAL_REFUND_ROUTE         = '/returns/commercial-refund';
	const COMMERCIAL_REFUND_RESOLVE_ROUTE = '/returns/commercial-refund/(?P<commercialRefundId>[0-9a-fA-F-]+)';
	const STOCK_DISPOSITION_ROUTE         = '/returns/stock-disposition';
	const STOCK_DISPOSITION_RESOLVE_ROUTE = '/returns/stock-disposition/(?P<stockDispositionId>[0-9a-fA-F-]+)';
	const CATALOG_ROUTE                   = '/catalog';
	const CUSTOMERS_ROUTE                 = '/customers';
	const OPERATION_PREPARE   = 'prepare';
	const OPERATION_FINALIZE  = 'finalize';
	const OPERATION_CANCEL    = 'cancel';
	const OPERATION_COMMERCIAL_REFUND = 'commercial_refund';
	const OPERATION_STOCK_DISPOSITION = 'stock_disposition';
	const CAPABILITY          = 'cetech_pos_bridge_access';
	const ORDER_META_TX       = '_cetech_pos_transaction_id';
	const ORDER_META_HASH     = '_cetech_pos_request_hash';
	const ORDER_META_SALE     = '_cetech_pos_sale_id';
	const ORDER_META_RECOVERY = '_cetech_pos_woo_recovery_token';
	const ORDER_META_QUOTE    = '_cetech_pos_quote_id';
	const ORDER_META_QUOTE_FP = '_cetech_pos_quote_fingerprint';
	const ORDER_META_FROZEN_PREPARE = '_cetech_pos_frozen_prepare';
	const FROZEN_PREPARE_VERSION = 1;
	const ORDER_META_PAYMENT  = '_cetech_pos_payment_id';
	const ORDER_META_EVIDENCE = '_cetech_pos_evidence_id';
	const ORDER_META_TENDER   = '_cetech_pos_tender';
	const ORDER_META_VERIFY_SRC = '_cetech_pos_verification_source';
	const ORDER_META_VERIFIED_AT = '_cetech_pos_verified_at';
	const ORDER_ITEM_META_LINE = '_cetech_pos_quote_line_id';
	const ORDER_META_COMMERCIAL_REFUND = '_cetech_pos_commercial_refund_id';
	const ORDER_META_COMMERCIAL_REFUND_TX = '_cetech_pos_commercial_refund_tx';
	const ORDER_META_COMMERCIAL_REFUND_HASH = '_cetech_pos_commercial_refund_hash';
	const DB_VERSION          = '5';
	const DB_VERSION_OPTION   = 'cetech_pos_bridge_db_version';
	const CONTRACT            = '1.0.0';
	const UUID_PATTERN        = '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/';
	const ID_PATTERN          = '/^[A-Za-z0-9][A-Za-z0-9._:-]*$/';
	const QUANTITY_PATTERN    = '/^(0\.[0-9]{0,5}[1-9]|[1-9][0-9]{0,8}(\.[0-9]{0,5}[1-9])?)$/';
	const TIMESTAMP_PATTERN   = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/';
	const SETTLEMENT_CURRENCY = 'GHS';
	const PRICE_DECIMALS      = 2;
	const QUOTE_TTL_SECONDS   = 900;

	/**
	 * Official WooCommerce plugin basename.
	 */
	const WOO_PLUGIN_BASENAME = 'woocommerce/woocommerce.php';

	/**
	 * Public theme identifiers used by WordPress theme APIs (stylesheet or parent template).
	 */
	const WOODMART_THEME_SLUG = 'woodmart';

	/**
	 * Conservative public plugin basenames. The authenticated CP-04 audit recorded
	 * B2BKing Core/Pro by name/version, not a committed basename. These are official
	 * WordPress.org / vendor file names, not pricing APIs.
	 */
	const B2BKING_PLUGIN_BASENAMES = array(
		'b2bking/b2bking.php',
		'b2bking-wholesale-for-woocommerce/b2bking.php',
		'b2bking-wholesale-for-woocommerce/b2bking-wholesale-for-woocommerce.php',
	);
}

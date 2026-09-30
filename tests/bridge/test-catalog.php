<?php

$catalog_correlation = '550e8400-e29b-41d4-a716-446655440000';

final class Cetech_Pos_Bridge_Test_Catalog_Product {
	public $id;
	public $parent_id         = 0;
	public $type              = 'simple';
	public $name              = 'Item';
	public $sku               = '';
	public $status            = 'publish';
	public $purchasable       = true;
	public $stock_status      = 'instock';
	public $modified          = '2026-01-15T12:00:00Z';
	public $attribute_summary = '';
	/** @var array<string,string> */
	public $attributes = array();
	public $price               = '';
	public $price_context       = null;
	/** @var array<int,int> */
	public $children = array();

	public static $variation_price_calls  = 0;
	public static $variation_prices_calls = 0;

	public function get_id() {
		return $this->id;
	}

	public function get_parent_id() {
		return $this->parent_id;
	}

	public function get_type() {
		return $this->type;
	}

	public function get_name() {
		return $this->name;
	}

	public function get_sku() {
		return $this->sku;
	}

	public function get_status() {
		return $this->status;
	}

	public function is_purchasable() {
		return (bool) $this->purchasable;
	}

	public function get_stock_status() {
		return $this->stock_status;
	}

	public function get_date_modified() {
		return $this->modified;
	}

	public function get_attribute_summary() {
		return $this->attribute_summary;
	}

	public function get_attributes() {
		return $this->attributes;
	}

	public function get_price( $context = 'view' ) {
		$this->price_context = $context;
		return $this->price;
	}

	public function get_visible_children() {
		return $this->children;
	}

	public function get_children() {
		return $this->children;
	}

	public function get_variation_price( $min_or_max = 'min', $for_display = false ) {
		unset( $min_or_max, $for_display );
		self::$variation_price_calls++;
		br01_assert( false, 'advisory catalog must not call get_variation_price' );
		return '';
	}

	public function get_variation_prices( $for_display = false ) {
		unset( $for_display );
		self::$variation_prices_calls++;
		br01_assert( false, 'advisory catalog must not call get_variation_prices' );
		return array();
	}
}

function stg05_product( $id, $overrides = array() ) {
	$product     = new Cetech_Pos_Bridge_Test_Catalog_Product();
	$product->id = $id;
	foreach ( $overrides as $key => $value ) {
		$product->$key = $value;
	}
	if ( ! isset( $GLOBALS['cetech_pos_test_products'] ) || ! is_array( $GLOBALS['cetech_pos_test_products'] ) ) {
		$GLOBALS['cetech_pos_test_products'] = array();
	}
	$GLOBALS['cetech_pos_test_products'][ (int) $id ] = $product;
	return $product;
}

if ( ! function_exists( 'wc_get_product' ) ) {
	/**
	 * @param mixed $id
	 * @return object|false
	 */
	function wc_get_product( $id ) {
		$key = (int) $id;
		if ( isset( $GLOBALS['cetech_pos_test_products'][ $key ] ) ) {
			return $GLOBALS['cetech_pos_test_products'][ $key ];
		}
		return false;
	}
}

function stg05_loader( $products ) {
	return static function ( $cursor, $limit, $modified_after ) use ( $products ) {
		$matched = array();
		foreach ( $products as $product ) {
			$id = (string) $product->get_id();
			if ( is_string( $cursor ) && $cursor !== '' && (int) $id <= (int) $cursor ) {
				continue;
			}
			if ( is_string( $modified_after ) && $modified_after !== '' && (string) $product->get_date_modified() < $modified_after ) {
				continue;
			}
			$matched[] = $product;
		}
		$has_more = count( $matched ) > $limit;
		$page     = array_slice( $matched, 0, $limit );
		$last     = end( $page );
		$next     = null;
		if ( $has_more && is_object( $last ) && method_exists( $last, 'get_id' ) ) {
			$next = (string) $last->get_id();
		}
		return array(
			'products'   => $page,
			'hasMore'    => $has_more,
			'nextCursor' => $next,
		);
	};
}

function stg05_engine( $products ) {
	return new Cetech_Pos_Bridge_Catalog_Engine( stg05_loader( $products ) );
}

function stg05_dispatch( $engine, $headers, $params = array(), $env = null ) {
	$env          = $env instanceof Cetech_Pos_Bridge_Test_Environment ? $env : br01_authorized_env();
	$auth         = new Cetech_Pos_Bridge_Auth( $env );
	$correlation  = new Cetech_Pos_Bridge_Correlation();
	$controller   = new Cetech_Pos_Bridge_Catalog_Controller( $auth, $correlation, $engine );
	$request      = new Cetech_Pos_Bridge_Test_Request( $headers, '/cetech-pos/v1/catalog', array(), $params );
	$permission   = $controller->permission_callback( $request );
	if ( $permission !== true ) {
		$plugin = new Cetech_Pos_Bridge_Plugin( $env );
		return $plugin->normalize_error_response( $permission, null, $request );
	}
	return $controller->handle( $request );
}

$simple = stg05_product(
	101,
	array(
		'name'         => 'Simple Cable',
		'sku'          => '00123',
		'stock_status' => 'instock',
	)
);
$variable = stg05_product(
	200,
	array(
		'type'         => 'variable',
		'name'         => 'Shirt',
		'sku'          => 'SHIRT',
		'purchasable'  => false,
		'stock_status' => 'instock',
	)
);
$variation = stg05_product(
	201,
	array(
		'type'              => 'variation',
		'parent_id'         => 200,
		'name'              => 'Shirt - Blue',
		'sku'               => '00456',
		'attribute_summary' => 'Color: Blue',
		'stock_status'      => 'outofstock',
		'purchasable'       => true,
		'price'             => '12.50',
	)
);
$simple_priced = stg05_product(
	102,
	array(
		'name'         => 'Priced Switch',
		'sku'          => 'PRC-1',
		'stock_status' => 'instock',
		'price'        => '155.00',
	)
);
$simple_invalid = stg05_product(
	103,
	array(
		'name'  => 'Invalid Price',
		'sku'   => 'BAD-1',
		'price' => '12.345',
	)
);
$variable_range_a = stg05_product(
	214,
	array(
		'type'       => 'variation',
		'parent_id'  => 210,
		'name'       => 'Range Shirt - Small',
		'sku'        => 'RANGE-S',
		'price'      => '10.00',
		'purchasable'=> true,
	)
);
$variable_range_b = stg05_product(
	215,
	array(
		'type'       => 'variation',
		'parent_id'  => 210,
		'name'       => 'Range Shirt - Large',
		'sku'        => 'RANGE-L',
		'price'      => '20.00',
		'purchasable'=> true,
	)
);
$variable_range = stg05_product(
	210,
	array(
		'type'         => 'variable',
		'name'         => 'Range Shirt',
		'sku'          => 'RANGE',
		'purchasable'  => false,
		'stock_status' => 'instock',
		'price'        => '10.00',
		'children'     => array( 214, 215 ),
	)
);
$variable_uniform_a = stg05_product(
	212,
	array(
		'type'       => 'variation',
		'parent_id'  => 211,
		'name'       => 'Uniform Shirt - Red',
		'sku'        => 'UNIF-R',
		'price'      => '12.50',
		'purchasable'=> true,
	)
);
$variable_uniform_b = stg05_product(
	213,
	array(
		'type'       => 'variation',
		'parent_id'  => 211,
		'name'       => 'Uniform Shirt - Blue',
		'sku'        => 'UNIF-B',
		'price'      => '12.50',
		'purchasable'=> true,
	)
);
$variable_uniform = stg05_product(
	211,
	array(
		'type'         => 'variable',
		'name'         => 'Uniform Shirt',
		'sku'          => 'UNIF',
		'purchasable'  => false,
		'stock_status' => 'instock',
		'price'        => '99.00',
		'children'     => array( 212, 213 ),
	)
);
$variable_unparseable_child = stg05_product(
	216,
	array(
		'type'       => 'variation',
		'parent_id'  => 220,
		'name'       => 'Broken Shirt - Red',
		'sku'        => 'BRK-R',
		'price'      => '12.345',
		'purchasable'=> true,
	)
);
$variable_unparseable = stg05_product(
	220,
	array(
		'type'         => 'variable',
		'name'         => 'Broken Shirt',
		'sku'          => 'BRK',
		'purchasable'  => false,
		'stock_status' => 'instock',
		'children'     => array( 216 ),
	)
);
$tombstone = stg05_product(
	300,
	array(
		'name'    => 'Retired Item',
		'sku'     => 'OLD-1',
		'status'  => 'trash',
	)
);
$grouped = stg05_product(
	400,
	array(
		'type' => 'grouped',
		'name' => 'Bundle',
		'sku'  => 'BNDL',
	)
);

$mapped_simple = Cetech_Pos_Bridge_Catalog_Engine::map_product( $simple );
br01_assert_eq( 'woocommerce', $mapped_simple['sourceSystem'], 'producer sourceSystem is Woo' );
br01_assert_eq( '101', $mapped_simple['sourceItemId'], 'simple sourceItemId is a string' );
br01_assert( is_string( $mapped_simple['sourceItemId'] ), 'sourceItemId type string' );
br01_assert_eq( 'simple', $mapped_simple['kind'], 'simple kind' );
br01_assert_eq( 'Simple Cable', $mapped_simple['name'], 'simple name' );
br01_assert_eq( '00123', $mapped_simple['sku'], 'leading-zero SKU preserved as string' );
br01_assert( is_string( $mapped_simple['sku'] ), 'sku remains a string' );
br01_assert_eq( array( '00123' ), $mapped_simple['barcodes'], 'training barcode source is SKU string' );
br01_assert_eq( 'in_stock', $mapped_simple['stockStatus'], 'instock maps to in_stock' );
br01_assert_eq( true, $mapped_simple['purchasable'], 'simple purchasable' );
br01_assert( ! isset( $mapped_simple['sourceParentId'] ), 'simple has no parent' );
br01_assert( ! isset( $mapped_simple['displayPrice'] ), 'missing Woo price remains omitted rather than fabricated' );
br01_assert_eq( 'edit', $simple->price_context, 'catalog reads get_price edit context, not view/B2B filters' );
br01_assert( ! isset( $mapped_simple['unitPrice'] ), 'producer omits unitPrice' );
br01_assert( ! isset( $mapped_simple['price'] ), 'producer omits generic price key' );
br01_assert( ! isset( $mapped_simple['b2bPrice'] ), 'producer omits b2bPrice' );
br01_assert( ! isset( $mapped_simple['woodmartPrice'] ), 'producer omits woodmartPrice' );
br01_assert( ! isset( $mapped_simple['customerPrice'] ), 'producer omits customerPrice' );
br01_assert( ! isset( $mapped_simple['effectivePrice'] ), 'producer omits effectivePrice' );
br01_assert( ! isset( $mapped_simple['regularPrice'] ), 'producer omits regularPrice' );
br01_assert( ! isset( $mapped_simple['salePrice'] ), 'producer omits salePrice' );

$mapped_priced = Cetech_Pos_Bridge_Catalog_Engine::map_product( $simple_priced );
br01_assert_eq( array( 'minor' => 15500, 'currency' => 'GHS' ), $mapped_priced['displayPrice'], 'simple Woo display/base price is advisory Money in GHS minor units' );
br01_assert_eq( 'edit', $simple_priced->price_context, 'priced simple uses get_price edit context' );
br01_assert( ! isset( $mapped_priced['unitPrice'] ), 'priced simple omits unitPrice' );
br01_assert( ! isset( $mapped_priced['b2bPrice'] ), 'priced simple omits b2bPrice' );
br01_assert( ! isset( $mapped_priced['woodmartPrice'] ), 'priced simple omits woodmartPrice' );

$mapped_invalid = Cetech_Pos_Bridge_Catalog_Engine::map_product( $simple_invalid );
br01_assert( ! isset( $mapped_invalid['displayPrice'] ), 'unparseable Woo price is omitted, not fabricated' );
$sku_json = json_encode( $mapped_simple );
br01_assert( strpos( $sku_json, '"00123"' ) !== false, 'JSON keeps leading-zero SKU quoted' );
br01_assert( strpos( $sku_json, ':123' ) === false && strpos( $sku_json, ':00123' ) === false, 'JSON does not emit SKU as a number' );

$mapped_variable = Cetech_Pos_Bridge_Catalog_Engine::map_product( $variable );
br01_assert_eq( 'variable', $mapped_variable['kind'], 'variable parent kind' );
br01_assert_eq( false, $mapped_variable['purchasable'], 'variable parent is not sold directly' );
br01_assert( ! isset( $mapped_variable['sourceParentId'] ), 'variable parent has no sourceParentId' );
br01_assert( ! isset( $mapped_variable['displayPrice'] ), 'variable parent without priced children omits displayPrice' );
br01_assert( $variable->price_context === null, 'variable parent does not use get_price as parent authority' );

$mapped_range = Cetech_Pos_Bridge_Catalog_Engine::map_product( $variable_range );
br01_assert( ! isset( $mapped_range['displayPrice'] ), 'variable parent omits advisory displayPrice without scanning children' );
br01_assert( $variable_range_a->price_context === null, 'variable parent mapping does not load range child A price' );
br01_assert( $variable_range_b->price_context === null, 'variable parent mapping does not load range child B price' );
br01_assert( $variable_range->price_context === null, 'range variable parent does not use get_price as parent authority' );

$mapped_uniform = Cetech_Pos_Bridge_Catalog_Engine::map_product( $variable_uniform );
br01_assert( ! isset( $mapped_uniform['displayPrice'] ), 'uniform variable parent omits advisory displayPrice without scanning children' );
br01_assert( $variable_uniform_a->price_context === null, 'variable parent mapping does not load uniform child A price' );
br01_assert( $variable_uniform_b->price_context === null, 'variable parent mapping does not load uniform child B price' );
br01_assert( $variable_uniform->price_context === null, 'uniform variable parent does not use get_price as parent authority' );

$mapped_unparseable = Cetech_Pos_Bridge_Catalog_Engine::map_product( $variable_unparseable );
br01_assert( ! isset( $mapped_unparseable['displayPrice'] ), 'variable parent omits displayPrice even when a child price is unparseable' );
br01_assert( $variable_unparseable_child->price_context === null, 'variable parent mapping does not load unparseable child price' );

br01_assert_eq( 0, Cetech_Pos_Bridge_Test_Catalog_Product::$variation_price_calls, 'advisory catalog never calls get_variation_price' );
br01_assert_eq( 0, Cetech_Pos_Bridge_Test_Catalog_Product::$variation_prices_calls, 'advisory catalog never calls get_variation_prices' );

$mapped_variation = Cetech_Pos_Bridge_Catalog_Engine::map_product( $variation );
br01_assert_eq( 'variation', $mapped_variation['kind'], 'variation kind' );
br01_assert_eq( '200', $mapped_variation['sourceParentId'], 'variation parent identity is Woo parent string' );
br01_assert_eq( '00456', $mapped_variation['sku'], 'variation leading-zero SKU preserved' );
br01_assert_eq( 'Color: Blue', $mapped_variation['variationLabel'], 'variation label from attribute summary' );
br01_assert_eq( 'out_of_stock', $mapped_variation['stockStatus'], 'outofstock maps' );
br01_assert_eq( array( 'minor' => 1250, 'currency' => 'GHS' ), $mapped_variation['displayPrice'], 'sellable variation exposes its own advisory displayPrice' );
br01_assert_eq( 'edit', $variation->price_context, 'variation uses get_price edit context' );

$mapped_tombstone = Cetech_Pos_Bridge_Catalog_Engine::map_product( $tombstone );
br01_assert_eq( true, $mapped_tombstone['deleted'], 'trash is a tombstone' );
br01_assert_eq( null, Cetech_Pos_Bridge_Catalog_Engine::map_product( $grouped ), 'grouped products are not catalog sellables' );

$engine = stg05_engine(
	array( $simple, $simple_priced, $simple_invalid, $variable, $variation, $variable_range, $variable_range_a, $variable_range_b, $variable_uniform, $variable_uniform_a, $variable_uniform_b, $variable_unparseable, $variable_unparseable_child, $tombstone, $grouped )
);
$page   = $engine->page( null, 2, null );
br01_assert_eq( 2, count( $page['items'] ), 'page respects limit' );
br01_assert_eq( '101', $page['items'][0]['sourceItemId'], 'first page starts at lowest id' );
br01_assert_eq( '102', $page['nextCursor'], 'nextCursor is last consumed source id' );
$page2 = $engine->page( '200', 20, null );
br01_assert_eq( '201', $page2['items'][0]['sourceItemId'], 'cursor is exclusive' );
br01_assert_eq( null, $page2['nextCursor'], 'final page has no nextCursor' );

$unsupported_a = stg05_product( 301, array( 'type' => 'grouped', 'name' => 'Bundle A' ) );
$unsupported_b = stg05_product( 302, array( 'type' => 'grouped', 'name' => 'Bundle B' ) );
$supported     = stg05_product( 303, array( 'name' => 'Simple After Unsupported', 'sku' => 'AFTER' ) );
$empty_page_engine = stg05_engine( array( $unsupported_a, $unsupported_b, $supported ) );
$empty_mapped = $empty_page_engine->page( null, 2, null );
br01_assert_eq( 0, count( $empty_mapped['items'] ), 'unsupported source page may emit zero mapped items' );
br01_assert_eq( '302', $empty_mapped['nextCursor'], 'source cursor still advances after unmappable rows' );
$page_after_empty = $empty_page_engine->page( $empty_mapped['nextCursor'], 2, null );
br01_assert_eq( 1, count( $page_after_empty['items'] ), 'consumer fetches the next source page' );
br01_assert_eq( '303', $page_after_empty['items'][0]['sourceItemId'], 'supported simple after unsupported page is included' );
br01_assert_eq( null, $page_after_empty['nextCursor'], 'final source page after empty mapped page completes' );

$missing_product_engine = new Cetech_Pos_Bridge_Catalog_Engine(
	static function () {
		return array(
			'products'   => array(),
			'hasMore'    => true,
			'nextCursor' => '103',
		);
	}
);
$missing_page = $missing_product_engine->page( null, 3, null );
br01_assert_eq( 0, count( $missing_page['items'] ), 'wc_get_product null page emits no items' );
br01_assert_eq( '103', $missing_page['nextCursor'], 'cursor still advances when source IDs were consumed but products were discarded' );

$unauth = stg05_dispatch( $engine, array( 'X-Correlation-ID' => $catalog_correlation ), array(), new Cetech_Pos_Bridge_Test_Environment() );
$unauth_payload = br01_payload( $unauth );
br01_assert_eq( 401, br01_status( $unauth ), 'catalog unauthenticated HTTP 401' );
br01_assert_eq( 'AUTH_REQUIRED', $unauth_payload['error']['code'], 'catalog AUTH_REQUIRED' );

$success = stg05_dispatch(
	$engine,
	array( 'X-Correlation-ID' => $catalog_correlation ),
	array( 'limit' => '25' )
);
$success_payload = br01_payload( $success );
br01_assert_eq( 200, br01_status( $success ), 'authorized catalog HTTP 200' );
br01_assert_eq( true, $success_payload['ok'], 'authorized catalog ok' );
br01_assert( isset( $success_payload['data']['items'] ), 'catalog data.items present' );
br01_assert( isset( $success_payload['data']['nextCursor'] ) || array_key_exists( 'nextCursor', $success_payload['data'] ), 'catalog data.nextCursor present' );
br01_assert_eq( '00123', $success_payload['data']['items'][0]['sku'], 'HTTP payload preserves leading-zero SKU' );
$http_by_id = array();
foreach ( $success_payload['data']['items'] as $row ) {
	br01_assert( ! isset( $row['posItemId'] ), 'producer does not assign POS ids' );
	br01_assert( ! isset( $row['unitPrice'] ), 'HTTP catalog omits unitPrice' );
	br01_assert( ! isset( $row['price'] ), 'HTTP catalog omits generic price key' );
	br01_assert( ! isset( $row['b2bPrice'] ), 'HTTP catalog omits b2bPrice' );
	br01_assert( ! isset( $row['woodmartPrice'] ), 'HTTP catalog omits woodmartPrice' );
	br01_assert( ! isset( $row['customerPrice'] ), 'HTTP catalog omits customerPrice' );
	br01_assert( ! isset( $row['effectivePrice'] ), 'HTTP catalog omits effectivePrice' );
	$http_by_id[ $row['sourceItemId'] ] = $row;
}
br01_assert( ! isset( $http_by_id['101']['displayPrice'] ), 'HTTP unpriced simple omits displayPrice' );
br01_assert_eq( array( 'minor' => 15500, 'currency' => 'GHS' ), $http_by_id['102']['displayPrice'], 'HTTP priced simple emits advisory displayPrice' );
br01_assert( ! isset( $http_by_id['103']['displayPrice'] ), 'HTTP invalid price remains omitted' );
br01_assert_eq( array( 'minor' => 1250, 'currency' => 'GHS' ), $http_by_id['201']['displayPrice'], 'HTTP variation emits its advisory displayPrice' );
br01_assert( ! isset( $http_by_id['210']['displayPrice'] ), 'HTTP range variable omits parent displayPrice' );
br01_assert( ! isset( $http_by_id['211']['displayPrice'] ), 'HTTP uniform variable omits parent displayPrice to avoid child scans' );
br01_assert( ! isset( $http_by_id['220']['displayPrice'] ), 'HTTP unparseable-child variable omits parent displayPrice' );
br01_assert_eq( 0, Cetech_Pos_Bridge_Test_Catalog_Product::$variation_price_calls, 'HTTP catalog path never calls get_variation_price' );
br01_assert_eq( 0, Cetech_Pos_Bridge_Test_Catalog_Product::$variation_prices_calls, 'HTTP catalog path never calls get_variation_prices' );
$encoded = json_encode( $success_payload );
br01_assert( strpos( $encoded, 'cetech_pos_bridge_access' ) === false, 'catalog success does not leak capability name' );
br01_assert( stripos( $encoded, 'password' ) === false, 'catalog success has no password field' );
br01_assert( strpos( $encoded, 'ABSPATH' ) === false, 'catalog success has no filesystem constant' );

$bad_limit = stg05_dispatch(
	$engine,
	array( 'X-Correlation-ID' => $catalog_correlation ),
	array( 'limit' => '0' )
);
br01_assert_eq( 'VALIDATION_ERROR', br01_payload( $bad_limit )['error']['code'], 'limit 0 is validation' );

$bad_cursor = stg05_dispatch(
	$engine,
	array( 'X-Correlation-ID' => $catalog_correlation ),
	array( 'cursor' => 'abc' )
);
br01_assert_eq( 'VALIDATION_ERROR', br01_payload( $bad_cursor )['error']['code'], 'non-numeric cursor is validation' );

$bad_since = stg05_dispatch(
	$engine,
	array( 'X-Correlation-ID' => $catalog_correlation ),
	array( 'modifiedAfter' => 'yesterday' )
);
br01_assert_eq( 'VALIDATION_ERROR', br01_payload( $bad_since )['error']['code'], 'invalid modifiedAfter is validation' );

$unavailable_engine = new Cetech_Pos_Bridge_Catalog_Engine(
	static function () {
		return 'unavailable';
	}
);
$unavailable = stg05_dispatch( $unavailable_engine, array( 'X-Correlation-ID' => $catalog_correlation ) );
br01_assert_eq( 503, br01_status( $unavailable ), 'missing Woo listing is 503' );
br01_assert_eq( 'INTEGRATION_UNAVAILABLE', br01_payload( $unavailable )['error']['code'], 'missing Woo listing code' );

$missing = stg05_dispatch( $engine, array() );
br01_assert_eq( 'VALIDATION_ERROR', br01_payload( $missing )['error']['code'], 'catalog requires correlation' );

$plugin = new Cetech_Pos_Bridge_Plugin( br01_authorized_env() );
$plugin->register_routes();
$plugin_routes = $plugin->get_registered_routes();
br01_assert_eq( '/catalog', $plugin_routes[10]['route'], 'plugin exposes GET /catalog' );
br01_assert( $plugin->get_catalog_controller() instanceof Cetech_Pos_Bridge_Catalog_Controller, 'catalog controller is wired' );

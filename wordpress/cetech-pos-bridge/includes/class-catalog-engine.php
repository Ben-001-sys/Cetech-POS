<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Maps Woo products/variations onto provider-neutral catalog source rows.
 * May copy Woo's stored ordinary display/base price as advisory displayPrice.
 * Does not compute WoodMart/B2BKing/customer-specific prices. SKU and barcodes stay strings.
 */
final class Cetech_Pos_Bridge_Catalog_Engine {
	const DEFAULT_LIMIT = 50;
	const MAX_LIMIT     = 200;

	/** @var callable */
	private $loader;

	public function __construct( $loader ) {
		$this->loader = $loader;
	}

	public static function woo_loader() {
		return array( self::class, 'load_woo_products' );
	}

	/**
	 * @param string|null $cursor
	 * @param int         $limit
	 * @param string|null $modified_after
	 * @return array{items:array<int,array<string,mixed>>,nextCursor:?string}|string
	 */
	public function page( $cursor, $limit, $modified_after ) {
		$loaded = call_user_func( $this->loader, $cursor, $limit, $modified_after );
		if ( $loaded === 'unavailable' ) {
			return 'unavailable';
		}
		$products = isset( $loaded['products'] ) && is_array( $loaded['products'] ) ? $loaded['products'] : array();
		$has_more = ! empty( $loaded['hasMore'] );
		$items    = array();
		$loader_cursor = null;
		if ( isset( $loaded['nextCursor'] ) ) {
			$loader_cursor = self::as_id_string( $loaded['nextCursor'] );
		}
		$last_consumed = null;
		foreach ( $products as $product ) {
			$source_id = is_object( $product ) && method_exists( $product, 'get_id' ) ? self::as_id_string( $product->get_id() ) : null;
			if ( $source_id !== null ) {
				$last_consumed = $source_id;
			}
			$mapped = self::map_product( $product );
			if ( $mapped === null ) {
				continue;
			}
			$items[] = $mapped;
		}
		$next_cursor = null;
		if ( $has_more ) {
			$next_cursor = $loader_cursor !== null ? $loader_cursor : $last_consumed;
		}
		return array(
			'items'      => $items,
			'nextCursor' => $next_cursor,
		);
	}

	public static function normalize_limit( $value ) {
		if ( $value === null || $value === '' ) {
			return self::DEFAULT_LIMIT;
		}
		if ( is_string( $value ) && preg_match( '/^[0-9]+$/', $value ) ) {
			$value = (int) $value;
		}
		if ( ! is_int( $value ) || $value < 1 ) {
			return null;
		}
		return min( $value, self::MAX_LIMIT );
	}

	/**
	 * @param object $product
	 * @return array<string,mixed>|null
	 */
	public static function map_product( $product ) {
		if ( ! is_object( $product ) || ! method_exists( $product, 'get_id' ) ) {
			return null;
		}
		$id = self::as_id_string( $product->get_id() );
		if ( $id === null ) {
			return null;
		}
		$type = method_exists( $product, 'get_type' ) ? (string) $product->get_type() : '';
		$kind = self::kind_from_type( $type );
		if ( $kind === null ) {
			return null;
		}
		$name = method_exists( $product, 'get_name' ) ? trim( (string) $product->get_name() ) : '';
		if ( $name === '' ) {
			return null;
		}
		$sku      = method_exists( $product, 'get_sku' ) ? (string) $product->get_sku() : '';
		$status   = method_exists( $product, 'get_status' ) ? (string) $product->get_status() : 'publish';
		$deleted  = $status === 'trash';
		$parent   = method_exists( $product, 'get_parent_id' ) ? self::as_id_string( $product->get_parent_id() ) : null;
		if ( $kind !== 'variation' ) {
			$parent = null;
		}
		$barcodes = array();
		if ( $sku !== '' ) {
			$barcodes[] = $sku;
		}
		$row = array(
			'sourceSystem'    => 'woocommerce',
			'sourceItemId'    => $id,
			'sourceVersion'   => self::version_for( $product, $id ),
			'name'            => $name,
			'barcodes'        => $barcodes,
			'kind'            => $kind,
			'purchasable'     => method_exists( $product, 'is_purchasable' ) ? (bool) $product->is_purchasable() : false,
			'stockStatus'     => self::stock_status( $product ),
			'sourceUpdatedAt' => self::updated_at( $product ),
			'deleted'         => $deleted,
		);
		if ( $sku !== '' ) {
			$row['sku'] = $sku;
		}
		if ( $parent !== null ) {
			$row['sourceParentId'] = $parent;
		}
		$label = self::variation_label( $product, $kind );
		if ( $label !== null ) {
			$row['variationLabel'] = $label;
		}
		$display = self::advisory_display_price( $product, $kind );
		if ( $display !== null ) {
			$row['displayPrice'] = $display;
		}
		return $row;
	}

	/**
	 * Advisory/public/base current price from Woo's stored product value.
	 * Simple products and sellable variations use get_price('edit') so view filters
	 * (customer/B2B/qty hooks) are not applied.
	 * Variable parents never use get_variation_price / get_variation_prices.
	 * They emit a price only when every visible child variation's raw edit price
	 * converts to the same GHS minor amount.
	 *
	 * @param object $product
	 * @param string $kind
	 * @return array{minor:int,currency:string}|null
	 */
	private static function advisory_display_price( $product, $kind ) {
		if ( $kind === 'variable' ) {
			// Variable parents are not directly purchasable. Loading every visible
			// child here turns catalog bootstrap into an N+1 scan. Child variations
			// carry their own advisory displayPrice, while quote-time pricing remains
			// authoritative for the selected sellable variation.
			return null;
		}
		if ( ! method_exists( $product, 'get_price' ) ) {
			return null;
		}
		$raw = self::normalize_woo_decimal( $product->get_price( 'edit' ) );
		if ( $raw === null ) {
			return null;
		}
		$minor = Cetech_Pos_Bridge_Money::from_decimal_string( $raw, Cetech_Pos_Bridge_Constants::SETTLEMENT_CURRENCY );
		if ( $minor === null ) {
			return null;
		}
		return Cetech_Pos_Bridge_Money::envelope( $minor );
	}

	/**
	 * @param object $product
	 * @return array{minor:int,currency:string}|null
	 */
	private static function variable_parent_advisory_display_price( $product ) {
		$ids = self::visible_variation_ids( $product );
		if ( $ids === null || count( $ids ) === 0 ) {
			return null;
		}
		$uniform = null;
		foreach ( $ids as $id ) {
			$variation = self::load_catalog_product( $id );
			if ( ! is_object( $variation ) || ! method_exists( $variation, 'get_price' ) ) {
				return null;
			}
			$raw = self::normalize_woo_decimal( $variation->get_price( 'edit' ) );
			if ( $raw === null ) {
				return null;
			}
			$minor = Cetech_Pos_Bridge_Money::from_decimal_string( $raw, Cetech_Pos_Bridge_Constants::SETTLEMENT_CURRENCY );
			if ( $minor === null ) {
				return null;
			}
			if ( $uniform === null ) {
				$uniform = $minor;
				continue;
			}
			if ( $uniform !== $minor ) {
				return null;
			}
		}
		if ( $uniform === null ) {
			return null;
		}
		return Cetech_Pos_Bridge_Money::envelope( $uniform );
	}

	/**
	 * Visible/sellable variation identity only. Does not read priced aggregates.
	 *
	 * @param object $product
	 * @return array<int,int>|null
	 */
	private static function visible_variation_ids( $product ) {
		$raw_ids = null;
		if ( method_exists( $product, 'get_visible_children' ) ) {
			$raw_ids = $product->get_visible_children();
		} elseif ( method_exists( $product, 'get_children' ) ) {
			$raw_ids = $product->get_children();
		}
		if ( ! is_array( $raw_ids ) || count( $raw_ids ) === 0 ) {
			return null;
		}
		$ids = array();
		foreach ( $raw_ids as $id ) {
			if ( is_int( $id ) && $id > 0 ) {
				$ids[] = $id;
				continue;
			}
			if ( is_string( $id ) && preg_match( '/^[1-9][0-9]*$/', $id ) ) {
				$ids[] = (int) $id;
				continue;
			}
			return null;
		}
		return $ids;
	}

	/**
	 * @param int $id
	 * @return object|null
	 */
	private static function load_catalog_product( $id ) {
		if ( ! function_exists( 'wc_get_product' ) ) {
			return null;
		}
		$loaded = wc_get_product( $id );
		return is_object( $loaded ) ? $loaded : null;
	}

	/**
	 * @param mixed $value
	 * @return string|null
	 */
	private static function normalize_woo_decimal( $value ) {
		if ( is_int( $value ) && $value >= 0 ) {
			return (string) $value;
		}
		if ( is_float( $value ) || is_string( $value ) ) {
			$trimmed = trim( (string) $value );
			return $trimmed === '' ? null : $trimmed;
		}
		return null;
	}

	public static function load_woo_products( $cursor, $limit, $modified_after ) {
		if ( ! function_exists( 'wc_get_product' ) ) {
			return 'unavailable';
		}
		$ids = self::query_catalog_post_ids( $cursor, $limit + 1, $modified_after );
		if ( $ids === 'unavailable' ) {
			return 'unavailable';
		}
		$has_more = count( $ids ) > $limit;
		if ( $has_more ) {
			array_pop( $ids );
		}
		$products       = array();
		$last_source_id = null;
		foreach ( $ids as $id ) {
			$source_id = self::as_id_string( $id );
			if ( $source_id !== null ) {
				$last_source_id = $source_id;
			}
			$product = wc_get_product( $id );
			if ( is_object( $product ) ) {
				$products[] = $product;
			}
		}
		return array(
			'products'   => $products,
			'hasMore'    => $has_more,
			'nextCursor' => $has_more ? $last_source_id : null,
		);
	}

	/**
	 * Product posts remain CPTs; HPOS covers orders, not this listing.
	 *
	 * @return array<int,int|string>|string
	 */
	private static function query_catalog_post_ids( $cursor, $limit, $modified_after ) {
		global $wpdb;
		if ( ! isset( $wpdb ) || ! is_object( $wpdb ) || ! method_exists( $wpdb, 'prepare' ) || ! method_exists( $wpdb, 'get_col' ) ) {
			return 'unavailable';
		}
		$posts = isset( $wpdb->posts ) ? (string) $wpdb->posts : 'wp_posts';
		$sql   = "SELECT ID FROM {$posts} WHERE post_type IN ('product','product_variation') AND post_status IN ('publish','private','pending','draft','trash')";
		$args  = array();
		if ( is_string( $cursor ) && preg_match( '/^[1-9][0-9]*$/', $cursor ) ) {
			$sql   .= ' AND ID > %d';
			$args[] = (int) $cursor;
		}
		if ( is_string( $modified_after ) && $modified_after !== '' ) {
			$ts = strtotime( $modified_after );
			if ( $ts !== false ) {
				$sql   .= ' AND post_modified_gmt >= %s';
				$args[] = gmdate( 'Y-m-d H:i:s', $ts );
			}
		}
		$sql   .= ' ORDER BY ID ASC LIMIT %d';
		$args[] = (int) $limit;
		$prepared = call_user_func_array( array( $wpdb, 'prepare' ), array_merge( array( $sql ), $args ) );
		if ( ! is_string( $prepared ) || $prepared === '' ) {
			return 'unavailable';
		}
		$ids = $wpdb->get_col( $prepared );
		return is_array( $ids ) ? $ids : array();
	}

	private static function kind_from_type( $type ) {
		if ( $type === 'simple' ) {
			return 'simple';
		}
		if ( $type === 'variable' ) {
			return 'variable';
		}
		if ( $type === 'variation' ) {
			return 'variation';
		}
		return null;
	}

	private static function stock_status( $product ) {
		$status = method_exists( $product, 'get_stock_status' ) ? (string) $product->get_stock_status() : '';
		if ( $status === 'instock' ) {
			return 'in_stock';
		}
		if ( $status === 'outofstock' ) {
			return 'out_of_stock';
		}
		if ( $status === 'onbackorder' ) {
			return 'backorder';
		}
		return 'unknown';
	}

	private static function variation_label( $product, $kind ) {
		if ( $kind !== 'variation' ) {
			return null;
		}
		if ( method_exists( $product, 'get_attribute_summary' ) ) {
			$summary = trim( (string) $product->get_attribute_summary() );
			if ( $summary !== '' ) {
				return $summary;
			}
		}
		if ( method_exists( $product, 'get_attributes' ) ) {
			$attributes = $product->get_attributes();
			if ( is_array( $attributes ) ) {
				$parts = array();
				foreach ( $attributes as $value ) {
					if ( is_string( $value ) && trim( $value ) !== '' ) {
						$parts[] = trim( $value );
					}
				}
				if ( $parts !== array() ) {
					return implode( ', ', $parts );
				}
			}
		}
		return null;
	}

	private static function updated_at( $product ) {
		if ( ! method_exists( $product, 'get_date_modified' ) ) {
			return gmdate( 'Y-m-d\TH:i:s\Z' );
		}
		$modified = $product->get_date_modified();
		if ( is_object( $modified ) && method_exists( $modified, 'date' ) ) {
			$formatted = $modified->date( 'Y-m-d\TH:i:s\Z' );
			if ( is_string( $formatted ) && $formatted !== '' ) {
				return $formatted;
			}
		}
		if ( is_string( $modified ) && $modified !== '' ) {
			$ts = strtotime( $modified . ' UTC' );
			if ( $ts !== false ) {
				return gmdate( 'Y-m-d\TH:i:s\Z', $ts );
			}
		}
		return gmdate( 'Y-m-d\TH:i:s\Z' );
	}

	private static function version_for( $product, $id ) {
		$updated = self::updated_at( $product );
		return $updated . ':' . $id;
	}

	private static function as_id_string( $value ) {
		if ( is_int( $value ) && $value > 0 ) {
			return (string) $value;
		}
		if ( is_string( $value ) && preg_match( '/^[1-9][0-9]*$/', $value ) ) {
			return $value;
		}
		return null;
	}
}

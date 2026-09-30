<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Short-lived immutable quote snapshots. Not a Woo order and not stock reservation.
 */
final class Cetech_Pos_Bridge_Quote_Store {
	/** @var array<string,array<string,mixed>> */
	private static $memory = array();

	public function put( array $quote ) {
		$id                   = (string) $quote['id'];
		self::$memory[ $id ]  = $quote;
		if ( function_exists( 'set_transient' ) ) {
			set_transient( $this->key( $id ), $quote, Cetech_Pos_Bridge_Constants::QUOTE_TTL_SECONDS );
		}
	}

	public function forget( $id ) {
		$id = (string) $id;
		unset( self::$memory[ $id ] );
		if ( function_exists( 'delete_transient' ) ) {
			delete_transient( $this->key( $id ) );
		}
	}

	public function get( $id ) {
		$id = (string) $id;
		if ( isset( self::$memory[ $id ] ) ) {
			return self::$memory[ $id ];
		}
		if ( function_exists( 'get_transient' ) ) {
			$stored = get_transient( $this->key( $id ) );
			if ( is_array( $stored ) ) {
				self::$memory[ $id ] = $stored;
				return $stored;
			}
		}
		return null;
	}

	private function key( $id ) {
		return 'cetech_pos_quote_' . $id;
	}
}

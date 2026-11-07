<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Access;

/**
 * Who may change scanned pages (edit, OCR, delete, consolidate, replace):
 * site administrators, and members of the "boek" directory group -- the
 * group that also gates "Zoeken in documenten" in avpvh-members.
 *
 * Without avpvh-members (no directory to ask) only administrators may.
 * Used both as the REST permission_callback of the scan routes and for the
 * lightbox's edit controls, so the two always agree.
 */
final class ScanEditPermission {
	const GROUP = 'boek';

	public static function check(): bool {
		if ( current_user_can( 'manage_options' ) ) {
			return true;
		}
		return in_array( self::GROUP, self::current_groups(), true );
	}

	/** @return array<string> the logged-in member's directory groups, lower-cased */
	private static function current_groups(): array {
		if (
			! is_user_logged_in()
			|| ! function_exists( 'avpvh_get_member_by_wp_user' )
			|| ! class_exists( \AVPVH_Directory::class )
		) {
			return [];
		}
		$member = avpvh_get_member_by_wp_user( get_current_user_id() );
		if ( ! is_object( $member ) || empty( $member->user_id ) ) {
			return [];
		}
		return array_map( 'strtolower', \AVPVH_Directory::cached_user_groups( (string) $member->user_id ) );
	}
}

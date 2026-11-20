<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\CLI;

use Avpvh\FindAndView\Index\EcliIndexer;
use Avpvh\FindAndView\Index\MeilisearchClient;
use Avpvh\FindAndView\Settings;

final class EcliIndexCommand {
	public static function register(): void {
		if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) return;
		\WP_CLI::add_command( 'fav index-ecli', [ self::class, 'run' ] );
	}

	public static function run( array $args, array $assoc ): void {
		$s      = Settings::get();
		$client = new MeilisearchClient( Settings::server_url(), Settings::admin_key() );
		$indexer = new EcliIndexer( $client, Settings::media_index(), Settings::ecli_index() );

		$count = $indexer->rebuild();
		\WP_CLI::success( sprintf( 'Indexed %d distinct ECLIs into %s.', $count, Settings::ecli_index() ) );
	}
}

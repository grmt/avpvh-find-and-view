<?php
/**
 * Plugin Name:  AVPVH Find and View
 * Description:  Find and view photos, archaeological finds, and scanned documents, powered by Meilisearch.
 * Version:      0.1.0
 * Author:       grmt
 * License:      MIT
 * Requires PHP: 8.2
 * Requires at least: 6.4
 *
 * @package avpvh-find-and-view
 */

declare( strict_types = 1 );

namespace Avpvh\FindAndView;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require_once __DIR__ . '/dist/vendor/autoload.php';
require_once __DIR__ . '/dist/class-main.php';

Main::init( __FILE__ );

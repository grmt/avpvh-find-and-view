<?php
/**
 * Plugin Name:  AV-PvH Find and View
 * Description:  Find and view photos, archaeological finds, and scanned documents, powered by Meilisearch.
 * Version:      0.1.80
 * Author:       grmt
 * Author URI:   https://github.com/grmt/avpvh-find-and-view
 * Update URI:   https://github.com/grmt/avpvh-find-and-view
 * Text Domain:  avpvh-find-and-view
 * Domain Path:  /languages
 * License:      MIT
 * Requires PHP: 8.4
 * Requires at least: 7.1
 *
 * @package avpvh-find-and-view
 */

declare( strict_types = 1 );

namespace Avpvh\FindAndView;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'AVPVH_FAV_VERSION', '0.1.80' );

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/src/php/class-main.php';

Main::init( __FILE__ );

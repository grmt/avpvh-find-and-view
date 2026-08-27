<?php
/**
 * Plugin Name:  AVPVH Find and View
 * Description:  Find and view photos, archaeological finds, and scanned documents, powered by Meilisearch.
 * Version:      0.1.48
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

define( 'AVPVH_FAV_VERSION', '0.1.48' );

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/src/php/class-main.php';

Main::init( __FILE__ );

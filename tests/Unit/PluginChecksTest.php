<?php declare( strict_types = 1 );

use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;

/**
 * Runs tests/plugin-checks.php under PHPUnit, so CI can measure its coverage.
 * The checks define WordPress stubs, so they get a process of their own.
 */
final class PluginChecksTest extends TestCase {
	#[RunInSeparateProcess]
	public function test_plugin_checks_pass(): void {
		require dirname( __DIR__ ) . '/plugin-checks.php';
		self::assertGreaterThan( 200, $GLOBALS['checks'] );
	}
}

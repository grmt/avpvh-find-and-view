<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Ocr;

/**
 * Calls the internal tesseract-ocr sidecar service — a tiny stdlib-only
 * Python HTTP wrapper around the tesseract CLI binary, running in its own
 * container (kept separate from the WordPress runtime on purpose, for
 * portability) — over the shared Docker network. No public exposure, no
 * nginx involved: a plain container-to-container call the same way
 * WordPress already talks to mysql/meilisearch by service name.
 *
 * Much lower baseline accuracy than Document AI, especially on handwritten
 * or informal pages (confirmed against real scans) — offered as a second,
 * free/local option for the editor to try, not a replacement.
 */
final class TesseractClient {
	private const URL = 'http://tesseract-ocr:8080/ocr';

	public static function ocr_image( string $image_bytes ): string|\WP_Error {
		$resp = wp_remote_post( self::URL, [
			'body'        => $image_bytes,
			'headers'     => [ 'Content-Type' => 'application/octet-stream' ],
			'redirection' => 0,
			'timeout'     => 60,
		] );
		if ( is_wp_error( $resp ) ) {
			error_log( '[avpvh-fav] Tesseract request error: ' . $resp->get_error_message() );
			return new \WP_Error( 'tesseract_error', 'Tesseract-service niet bereikbaar.', [ 'status' => 502 ] );
		}

		$code = wp_remote_retrieve_response_code( $resp );
		$body = json_decode( wp_remote_retrieve_body( $resp ), true );
		if ( $code !== 200 ) {
			$detail = is_array( $body ) ? (string) ( $body['error'] ?? '' ) : '';
			error_log( sprintf( '[avpvh-fav] Tesseract HTTP %d: %s', $code, $detail ) );
			return new \WP_Error( 'tesseract_error', 'Tesseract-verwerking mislukt.', [ 'status' => 502 ] );
		}
		return (string) ( is_array( $body ) ? ( $body['text'] ?? '' ) : '' );
	}
}

<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Ocr;

/**
 * Calls Google Cloud Document AI's REST API directly (no Google Cloud PHP
 * SDK dependency) using a service-account JSON key, authenticated via the
 * standard OAuth2 JWT-bearer flow signed with PHP's own openssl extension.
 * Use the same processor as the pipeline that produced the scans, so a page
 * re-OCR'd here matches the original output.
 *
 * Configuration: the project comes from the service-account key, the
 * processor ID from the settings page. AVPVH_FAV_DOCAI_PROJECT_ID,
 * AVPVH_FAV_DOCAI_PROCESSOR_ID and AVPVH_FAV_DOCAI_LOCATION (default "eu")
 * in wp-config.php override them.
 */
final class DocumentAiClient {
	private const LOCATION     = 'eu';
	private const SCOPE        = 'https://www.googleapis.com/auth/cloud-platform';
	private const TOKEN_URL    = 'https://oauth2.googleapis.com/token';
	private const KEY_FILE     = '/run/secrets/gcp_documentai_key';
	private const TRANSIENT    = 'avpvh_fav_docai_token';

	private static function project_id( string $from_key ): string {
		return defined( 'AVPVH_FAV_DOCAI_PROJECT_ID' ) ? (string) AVPVH_FAV_DOCAI_PROJECT_ID : $from_key;
	}

	private static function location(): string {
		return defined( 'AVPVH_FAV_DOCAI_LOCATION' ) ? (string) AVPVH_FAV_DOCAI_LOCATION : self::LOCATION;
	}

	private static function processor_id(): string {
		return defined( 'AVPVH_FAV_DOCAI_PROCESSOR_ID' ) ? (string) AVPVH_FAV_DOCAI_PROCESSOR_ID : (string) \Avpvh\FindAndView\Settings::get()['docai_processor_id'];
	}

	/**
	 * The processor endpoint, or an error when OCR is not configured. Every
	 * part is checked, since the access token is sent to this URL.
	 */
	private static function endpoint(): string|\WP_Error {
		$key = self::service_account_key();
		if ( is_wp_error( $key ) ) return $key;
		$project   = self::project_id( $key['project_id'] );
		$location  = self::location();
		$processor = self::processor_id();
		if ( preg_match( '/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/D', $project ) !== 1
			|| preg_match( '/^[a-z0-9-]{1,32}$/D', $location ) !== 1
			|| preg_match( '/^[a-f0-9]{8,64}$/D', $processor ) !== 1 ) {
			return new \WP_Error( 'docai_not_configured', 'Document AI is niet geconfigureerd.', [ 'status' => 503 ] );
		}
		return sprintf( 'https://%s-documentai.googleapis.com/v1/projects/%s/locations/%s/processors/%s:process', $location, $project, $location, $processor );
	}

	/**
	 * OCRs one page image and returns the extracted text.
	 */
	public static function ocr_image( string $image_bytes, string $mime_type ): string|\WP_Error {
		$doc = self::process_document( $image_bytes, $mime_type );
		if ( is_wp_error( $doc ) ) return $doc;
		return (string) ( $doc['text'] ?? '' );
	}

	/**
	 * OCRs an image and reconstructs the text by sorting individual
	 * detected lines top-to-bottom, left-to-right, rather than trusting
	 * Document AI's own text order — more reliable for a small cropped
	 * snippet (e.g. one column of a multi-column layout, a table cell)
	 * than the whole-page reading order.
	 */
	public static function ocr_image_sorted( string $image_bytes, string $mime_type ): string|\WP_Error {
		$doc = self::process_document( $image_bytes, $mime_type );
		if ( is_wp_error( $doc ) ) return $doc;

		$full_text = (string) ( $doc['text'] ?? '' );
		$lines = [];
		foreach ( (array) ( $doc['pages'] ?? [] ) as $page ) {
			foreach ( (array) ( $page['lines'] ?? [] ) as $line ) {
				$text = '';
				// startIndex/endIndex are UTF-8 byte offsets into $full_text,
				// so a byte-oriented substr() — not mb_substr() — is correct.
				foreach ( (array) ( $line['layout']['textAnchor']['textSegments'] ?? [] ) as $seg ) {
					$start = (int) ( $seg['startIndex'] ?? 0 );
					$end   = (int) ( $seg['endIndex'] ?? 0 );
					$text .= substr( $full_text, $start, $end - $start );
				}
				$text = trim( $text );
				if ( $text === '' ) continue;
				$vertices = $line['layout']['boundingPoly']['normalizedVertices'] ?? [];
				$lines[] = [ (float) ( $vertices[0]['y'] ?? 0 ), (float) ( $vertices[0]['x'] ?? 0 ), $text ];
			}
		}
		if ( ! $lines ) return trim( $full_text );

		usort( $lines, static fn( $a, $b ) => $a[0] <=> $b[0] ?: $a[1] <=> $b[1] );
		return implode( "\n", array_column( $lines, 2 ) );
	}

	/** Calls Document AI's process endpoint and returns the decoded `document` object. */
	private static function process_document( string $image_bytes, string $mime_type ): array|\WP_Error {
		$url = self::endpoint();
		if ( is_wp_error( $url ) ) return $url;
		$token = self::access_token();
		if ( is_wp_error( $token ) ) return $token;

		$resp = wp_remote_post( $url, [
			'headers'     => [
				'Authorization' => "Bearer {$token}",
				'Content-Type'  => 'application/json',
			],
			'body'        => wp_json_encode( [
				'rawDocument'    => [
					'content'  => base64_encode( $image_bytes ),
					'mimeType' => $mime_type,
				],
				'processOptions' => [
					'ocrConfig' => [ 'disableCharacterBoxesDetection' => true ],
				],
			] ),
			'redirection' => 0,
			'timeout'     => 60,
		] );
		if ( is_wp_error( $resp ) ) {
			error_log( '[avpvh-fav] Document AI request error: ' . $resp->get_error_message() );
			return new \WP_Error( 'docai_error', 'Document AI-service niet bereikbaar.', [ 'status' => 502 ] );
		}

		$code = wp_remote_retrieve_response_code( $resp );
		$body = json_decode( wp_remote_retrieve_body( $resp ), true );
		if ( $code !== 200 ) {
			$detail = is_array( $body ) ? (string) ( $body['error']['message'] ?? '' ) : '';
			error_log( sprintf( '[avpvh-fav] Document AI HTTP %d: %s', $code, $detail ) );
			return new \WP_Error( 'docai_error', 'Document AI-verwerking mislukt.', [ 'status' => 502 ] );
		}

		return (array) ( $body['document'] ?? [] );
	}

	/**
	 * Returns a cached access token (valid ~1h, refreshed with a minute of
	 * headroom) or mints a new one via the JWT-bearer service-account flow.
	 */
	private static function access_token(): string|\WP_Error {
		$cached = get_transient( self::TRANSIENT );
		if ( is_string( $cached ) && $cached !== '' ) return $cached;

		$key = self::service_account_key();
		if ( is_wp_error( $key ) ) return $key;

		$now = time();
		$header = self::base64url( wp_json_encode( [ 'alg' => 'RS256', 'typ' => 'JWT' ] ) );
		$claims = self::base64url( wp_json_encode( [
			'iss'   => $key['client_email'],
			'scope' => self::SCOPE,
			'aud'   => self::TOKEN_URL,
			'iat'   => $now,
			'exp'   => $now + 3600,
		] ) );
		$unsigned = "{$header}.{$claims}";

		$signature = '';
		$ok = openssl_sign( $unsigned, $signature, $key['private_key'], OPENSSL_ALGO_SHA256 );
		if ( ! $ok ) return new \WP_Error( 'docai_sign_failed', 'Kon JWT niet ondertekenen', [ 'status' => 500 ] );

		$jwt = "{$unsigned}." . self::base64url( $signature );

		$resp = wp_remote_post( self::TOKEN_URL, [
			'body'        => [
				'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
				'assertion'  => $jwt,
			],
			'redirection' => 0,
			'timeout'     => 15,
		] );
		if ( is_wp_error( $resp ) ) {
			error_log( '[avpvh-fav] Document AI token error: ' . $resp->get_error_message() );
			return new \WP_Error( 'docai_auth_failed', 'Document AI-authenticatie mislukt.', [ 'status' => 502 ] );
		}

		$body = json_decode( wp_remote_retrieve_body( $resp ), true );
		$token = is_array( $body ) ? ( $body['access_token'] ?? null ) : null;
		if ( ! is_string( $token ) || $token === '' ) {
			$detail = is_array( $body ) ? (string) ( $body['error_description'] ?? $body['error'] ?? '' ) : '';
			error_log( '[avpvh-fav] Document AI token response failed: ' . $detail );
			return new \WP_Error( 'docai_auth_failed', 'Document AI-authenticatie mislukt.', [ 'status' => 502 ] );
		}

		$ttl = max( 60, (int) ( $body['expires_in'] ?? 3600 ) - 60 );
		set_transient( self::TRANSIENT, $token, $ttl );

		return $token;
	}

	/**
	 * @return array{client_email: string, private_key: string, project_id: string}|\WP_Error
	 */
	private static function service_account_key(): array|\WP_Error {
		if ( ! is_readable( self::KEY_FILE ) ) {
			return new \WP_Error( 'no_key', 'Geen GCP service-account sleutel geconfigureerd', [ 'status' => 400 ] );
		}
		$raw = json_decode( (string) file_get_contents( self::KEY_FILE ), true );
		if ( ! isset( $raw['client_email'], $raw['private_key'] ) ) {
			return new \WP_Error( 'bad_key', 'Ongeldige service-account sleutel', [ 'status' => 500 ] );
		}
		return [ 'client_email' => (string) $raw['client_email'], 'private_key' => (string) $raw['private_key'], 'project_id' => (string) ( $raw['project_id'] ?? '' ) ];
	}

	private static function base64url( string $data ): string {
		return rtrim( strtr( base64_encode( $data ), '+/', '-_' ), '=' );
	}
}

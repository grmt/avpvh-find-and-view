=== AVPVH Find and View ===
Contributors: grmt
Tags: search, meilisearch, scans, pdf, archive
Requires at least: 7.1
Tested up to: 7.1
Requires PHP: 8.4
Stable tag: 0.1.71
License: MIT
License URI: https://opensource.org/licenses/MIT

Find and view photos, archaeological finds, and scanned documents, powered by Meilisearch.

== Description ==

Indexes page scans, chat transcripts, posts and pages, PDFs attached to them and
XLSX spreadsheets in Meilisearch, and shows the results with a filter tree and a
lightbox that renders the PDF or scan side by side with its text.

Editors can correct a scan's text in the lightbox and re-run OCR on a page or a
cropped region (Document AI, Tesseract or a local Docker engine).

== Installation ==

1. Copy the plugin to `wp-content/plugins/avpvh-find-and-view/`, including `vendor/`.
2. Activate it and fill in the Meilisearch URL and keys under Settings → Find and View.
3. Index the content with `wp fav index`.

== Changelog ==

= 0.1.67 =
* Fix image panning when zoomed in via mouse drag, wheel scroll and gestures.

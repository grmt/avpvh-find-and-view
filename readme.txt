=== AV-PvH Find and View ===
Contributors: grmt
Tags: search, meilisearch, scans, pdf, archive
Requires at least: 7.1
Tested up to: 7.1
Requires PHP: 8.4
Stable tag: 0.1.83
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
4. Optional, for Document AI OCR: mount a Google service-account key as the
   Docker secret `gcp_documentai_key` and enter the processor ID in the
   settings. `AVPVH_FAV_DOCAI_PROJECT_ID`, `AVPVH_FAV_DOCAI_PROCESSOR_ID` and
   `AVPVH_FAV_DOCAI_LOCATION` in `wp-config.php` override them.

To deploy with `deploy.sh`, copy `deploy.local.env.example` to
`deploy.local.env` and fill in the server login, path and sites.

== Changelog ==

= 0.1.67 =
* Fix image panning when zoomed in via mouse drag, wheel scroll and gestures.

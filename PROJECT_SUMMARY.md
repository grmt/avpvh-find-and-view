# AVPVH Find and View

WordPress plugin for searching and browsing photos, archaeological finds, and scanned documents using Meilisearch.

## What It Does

- Provides the `[avpvh_find_and_view]` shortcode for embedding a search and browse interface on the site.
- Searches across two main sources:
  - Media items such as photos, scanned pages, and XLSX worksheets
  - WordPress posts and pages indexed into Meilisearch
- Lets users:
  - Search with a keyword box
  - Filter by source type
  - Refine by collection
  - Toggle substring-style matching
  - Browse media collections in a folder-like layout
  - Open images and text in a lightbox-style viewer

## Admin Features

The plugin adds a WordPress settings page with tools for managing the index and local scan tree.

- Configure Meilisearch URL and keys
- Choose which post types are indexed
- Configure storage backends
- View index stats from Meilisearch
- Apply index settings such as typo tolerance and separator tokens
- Search and edit indexed documents
- Reindex local scans from uploaded files
- Reindex WordPress content
- Manage scan folders through a tree UI:
  - Move folders
  - Create subfolders
  - Rename folders
  - Normalize numbering
  - Remap collections in the search index

## Main Data Flow

- WordPress content changes are observed and queued for indexing.
- Content and media are written into Meilisearch indexes.
- XLSX files placed in the scans tree are split by worksheet and groups of 100 rows, then indexed as searchable Markdown tables.
- The frontend queries Meilisearch directly with a public read-only key.
- Admin actions use the Meilisearch admin key or the master key from `/run/secrets/meilisearch_master_key` when available.

## Code Structure

- `avpvh-find-and-view.php` bootstraps the plugin.
- `src/php/class-main.php` registers observers, shortcode, admin page, tree controller, and CLI commands.
- `src/php/Shortcode/FindAndViewShortcode.php` renders the frontend shell and enqueues assets.
- `src/ts/search.ts` drives the frontend search experience.
- `src/ts/browse.ts` handles the folder-style media browser.
- `src/ts/lightbox.ts` handles image and text viewing.
- `src/php/Admin/SettingsPage.php` renders the admin settings page and queues tree assets.
- `src/php/Admin/TreeController.php` exposes REST endpoints for tree and index actions.

## Build Outputs

- Frontend CSS and JS are emitted into `dist/css/` and `dist/js/`.
- The project uses Vite for browser bundles and TypeScript for source checking.

## Notes

- [`AGENTS.md`](AGENTS.md) is the agent handoff file for repo conventions and workflow.
- `TODO.md` still lists future storage backends:
  - `S3Provider`
  - `FileShareProvider`
- Team workflow preference: `memory/feedback_feature_branches.md`.
- The project currently includes local, Google Drive, and S3-related storage abstractions in the PHP source tree.

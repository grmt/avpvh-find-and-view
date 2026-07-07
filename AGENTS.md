# AGENTS.md

Shared working notes for agents in this repository.

## Project

- WordPress plugin: `AVPVH Find and View`
- Purpose: search and browse photos, archaeological finds, and scanned documents with Meilisearch
- Bootstrap file: [`avpvh-find-and-view.php`](avpvh-find-and-view.php)

## Key Areas

- Frontend shortcode and asset loading: [`src/php/Shortcode/FindAndViewShortcode.php`](src/php/Shortcode/FindAndViewShortcode.php)
- Search UI: [`src/ts/search.ts`](src/ts/search.ts)
- Browse UI: [`src/ts/browse.ts`](src/ts/browse.ts)
- Lightbox: [`src/ts/lightbox.ts`](src/ts/lightbox.ts)
- Settings page: [`src/php/Admin/SettingsPage.php`](src/php/Admin/SettingsPage.php)
- Tree REST controller: [`src/php/Admin/TreeController.php`](src/php/Admin/TreeController.php)
- Plugin bootstrap: [`src/php/class-main.php`](src/php/class-main.php)

## Current Behavior

- Frontend search uses Meilisearch directly with a public read-only key.
- Admin tools can inspect indexes, apply index settings, reindex content, and manage scan folders.
- The tree UI is bundled separately through Vite.
- Local scan files are expected under the WordPress uploads `scans/` directory.

## Build And Checks

- TypeScript check: `npm run lint:ts:typecheck`
- JS build: `npm run build:js`
- PHP syntax check: `php -l <file>`

## Working Rules

- Preserve existing user changes unless the task explicitly asks otherwise.
- Use `apply_patch` for file edits.
- Prefer `rg` for searches and `rg --files` for file listings.
- Keep changes ASCII unless the file already uses other characters.
- If touching frontend code, ensure both desktop and mobile behavior remain usable.
- Always work on a feature branch before committing changes.
- Use `./deploy.sh` for releases instead of manual build + deploy steps.

## External Notes

- Team workflow preference: `memory/feedback_feature_branches.md`.

## Handoff Notes

- [`PROJECT_SUMMARY.md`](PROJECT_SUMMARY.md) contains a higher-level overview of the project.
- `TODO.md` still lists storage backend work that has not been implemented yet.

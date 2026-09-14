#!/usr/bin/env bash
set -euo pipefail

PHP_FILE="avpvh-find-and-view.php"
PKG_FILE="package.json"

# Deploy all regular sites by default, or only the explicitly named sites.
# Example: ./deploy.sh staging
if (( $# )); then
	sites=( "$@" )
else
	sites=( site1 site2 site3 )
fi

for site in "${sites[@]}"; do
	case "$site" in
		site1|site2|site3|staging) ;;
		*)
			echo "Unknown deploy target: ${site}" >&2
			exit 2
			;;
	esac
done

# 1. Read and bump micro version
current=$(grep -m1 '^ \* Version:' "$PHP_FILE" | sed 's/.*Version:[[:space:]]*//')
major=$(echo "$current" | cut -d. -f1)
minor=$(echo "$current" | cut -d. -f2)
micro=$(echo "$current" | cut -d. -f3)
micro=$(( ${micro:-0} + 1 ))
new_version="${major}.${minor}.${micro}"

echo "Bumping version: ${current} -> ${new_version}"

# 2. Update PHP plugin header
sed -i "s/^\( \* Version:\s*\).*$/\1${new_version}/" "$PHP_FILE"

# 3. Update AVPVH_FAV_VERSION constant
sed -i "s/define( 'AVPVH_FAV_VERSION', '[^']*' )/define( 'AVPVH_FAV_VERSION', '${new_version}' )/" "$PHP_FILE"

# 4. Update package.json
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('${PKG_FILE}', 'utf8'));
pkg.version = '${new_version}';
fs.writeFileSync('${PKG_FILE}', JSON.stringify(pkg, null, 2) + '\n');
"

# 5. Build
npx vite build --config config/vite/search.config.ts
npx vite build --config config/vite/ecli.config.ts
npx vite build --config config/vite/tree.config.ts

# 6. Build a production-only vendor/ (no phpunit/phpstan/etc — the server
# has no composer binary to install these itself, and dev tooling has no
# business shipping to production anyway), then restore the full dev
# vendor/ afterwards so this doesn't disturb the local dev environment.
composer install --no-dev --optimize-autoloader
trap 'composer install' EXIT

# 7. Deploy via rsync — dist/ goes into dist/ on server, php into src/php/,
# vendor/ mirrored with --delete so a dependency dropped from composer.json
# actually disappears server-side too, not just stops being referenced.
for site in "${sites[@]}"; do
	dest="user@server.example:/srv/wordpress/wp-content-${site}/plugins/avpvh-find-and-view/"

	rsync -av --omit-dir-times avpvh-find-and-view.php "$dest"
	rsync -av --omit-dir-times dist/ "${dest}dist/"
	rsync -av --omit-dir-times src/php/ "${dest}src/php/"
	rsync -av --delete --omit-dir-times vendor/ "${dest}vendor/"
done

echo "Done -- ${new_version} deployed to ${sites[*]}."

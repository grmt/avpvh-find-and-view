#!/usr/bin/env bash
set -euo pipefail

PHP_FILE="avpvh-find-and-view.php"
PKG_FILE="package.json"

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

# 6. Deploy via rsync — dist/ goes into dist/ on server, php into src/php/
for site in site1 site2 site3; do
	dest="user@server.example:/srv/wordpress/wp-content-${site}/plugins/avpvh-find-and-view/"

	rsync -av --omit-dir-times avpvh-find-and-view.php "$dest"
	rsync -av --omit-dir-times dist/ "${dest}dist/"
	rsync -av --omit-dir-times src/php/ "${dest}src/php/"
done

echo "Done -- ${new_version} deployed."

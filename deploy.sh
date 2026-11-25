#!/usr/bin/env bash
set -euo pipefail

# Deploy settings come from the environment or from deploy.local.env next to
# this script (ignored by Git; see deploy.local.env.example):
#   AVPVH_DEPLOY_HOST   ssh login, <user>@<server>
#   AVPVH_DEPLOY_PATH   plugin folder on the server; {site} is replaced by
#                       the site name
#   AVPVH_DEPLOY_SITES  sites deployed when none are named
#   AVPVH_DEPLOY_EXTRA  other sites that may be named explicitly
deploy_env="$(dirname "$0")/deploy.local.env"
deploy_setting() {
	local name="$1" value="${!1:-}"
	if [ -z "$value" ] && [ -f "$deploy_env" ]; then
		value=$(sed -n "s/^${name}=//p" "$deploy_env" | head -1)
		value="${value%\"}"; value="${value#\"}"
	fi
	printf '%s' "$value"
}
DEPLOY_HOST=$(deploy_setting AVPVH_DEPLOY_HOST)
DEPLOY_PATH=$(deploy_setting AVPVH_DEPLOY_PATH)
read -r -a default_sites <<< "$(deploy_setting AVPVH_DEPLOY_SITES)"
read -r -a extra_sites <<< "$(deploy_setting AVPVH_DEPLOY_EXTRA)"
if [ -z "$DEPLOY_HOST" ] || [ -z "$DEPLOY_PATH" ] || (( ${#default_sites[@]} == 0 )); then
	echo "Set AVPVH_DEPLOY_HOST, AVPVH_DEPLOY_PATH and AVPVH_DEPLOY_SITES (see deploy.local.env.example)." >&2
	exit 1
fi

PHP_FILE="avpvh-find-and-view.php"
PKG_FILE="package.json"

# Deploy the default sites, or only the sites named on the command line.
# Example: ./deploy.sh mysite
if (( $# )); then
	sites=( "$@" )
else
	sites=( "${default_sites[@]}" )
fi

for site in "${sites[@]}"; do
	if [[ ! "$site" =~ ^[a-z0-9_-]+$ ]] || [[ " ${default_sites[*]} ${extra_sites[*]} " != *" $site "* ]]; then
		echo "Unknown deploy target: ${site}" >&2
		exit 2
	fi
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

# 3b. Update the readme's Stable tag
sed -i "s/^Stable tag: .*$/Stable tag: ${new_version}/" readme.txt

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

# 7. Deploy via rsync. dist/, src/php/, languages/ and vendor/ are mirrored
# with --delete, so a file removed or renamed here also disappears from the
# server instead of lingering there.
# Group-writable on purpose: php-fpm shares the deploy group, so WordPress
# can update or replace the plugin like any other (see the shared CLAUDE.md).
rsync_opts=(-rltv --omit-dir-times --no-owner --no-group --no-perms --chmod=D775,F664)
for site in "${sites[@]}"; do
	dest="${DEPLOY_HOST}:${DEPLOY_PATH//\{site\}/$site}"
	dest="${dest%/}/"

	rsync "${rsync_opts[@]}" avpvh-find-and-view.php readme.txt "$dest"
	rsync "${rsync_opts[@]}" --delete dist/ "${dest}dist/"
	rsync "${rsync_opts[@]}" --delete src/php/ "${dest}src/php/"
	rsync "${rsync_opts[@]}" --delete languages/ "${dest}languages/"
	rsync "${rsync_opts[@]}" --delete vendor/ "${dest}vendor/"
done

echo "Done -- ${new_version} deployed to ${sites[*]}."

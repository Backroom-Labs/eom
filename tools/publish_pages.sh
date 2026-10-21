#!/usr/bin/env bash
# Lays out one release in a checkout of the Pages repo (run by .github/workflows/release.yml).
#
#     tools/publish_pages.sh <site dir> <version> <dist dir> <app dir>
#
# <dist dir> holds firmware-<env>.bin for each board and the manifest.json that make_manifest.py
# wrote for them, with URLs already pointing at the Pages copy. <app dir> is the built eomui/public.
# Everything goes under <site dir>/eom/, which Pages serves at https://backroom-labs.github.io/eom/:
#
#     eom/                               the app, replaced by every release
#     eom/firmware/<version>/*.bin       every release's images, never pruned
#     eom/firmware/manifest.json         newest stable release (only stable versions rewrite it)
#     eom/firmware/manifest-beta.json    newest release of either kind
#
# See docs/adr/0011-releases-served-from-public-pages-site.md.

set -euo pipefail

if [ $# -ne 4 ]; then
  sed -n '4p' "$0" >&2
  exit 2
fi
site=$1 version=$2 dist=$3 app=$4
root="$site/eom"

for f in "$dist/manifest.json" "$app/index.html"; do
  if [ ! -f "$f" ]; then
    echo "publish_pages: missing $f" >&2
    exit 1
  fi
done
shopt -s nullglob
bins=("$dist"/firmware-*.bin)
if [ ${#bins[@]} -eq 0 ]; then
  echo "publish_pages: no firmware-*.bin in $dist" >&2
  exit 1
fi

mkdir -p "$root/firmware/$version"

# The app replaces the last one, leaving firmware/ alone.
rsync -a --checksum --delete --exclude /firmware/ "$app/" "$root/"

# A re-run of the same tag replaces that version's images rather than mixing old and new ones.
rm -f "$root/firmware/$version"/firmware-*.bin
cp "${bins[@]}" "$root/firmware/$version/"

cp "$dist/manifest.json" "$root/firmware/manifest-beta.json"
case "$version" in
  *-*) echo "publish_pages: $version is a prerelease; manifest.json left as it was" ;;
  *) cp "$dist/manifest.json" "$root/firmware/manifest.json" ;;
esac

# Serve files as they are, without Jekyll.
touch "$site/.nojekyll"

echo "publish_pages: laid out $version (${#bins[@]} images) in $root"

#!/usr/bin/env bash
set -euo pipefail

PAGES_REPO="/Users/bryanoltman/Documents/bryanoltman.github.io"
DEST="$PAGES_REPO/Evolve"

# Build
echo "==> Building..."
npm run build

# Copy to GitHub Pages repo
echo "==> Copying to $DEST..."
rm -rf "$DEST"
mkdir -p "$DEST/evolve" "$DEST/wiki" "$DEST/lib" "$DEST/font" "$DEST/strings"
cp index.html save.html wiki.html evolved.ico evolved-light.ico LICENSE "$DEST/"
cp -r evolve/* "$DEST/evolve/"
cp -r wiki/* "$DEST/wiki/"
cp -r lib/* "$DEST/lib/"
cp -r font/* "$DEST/font/"
cp -r strings/* "$DEST/strings/"

# Commit and push
echo "==> Deploying..."
cd "$PAGES_REPO"
git add Evolve/
git commit -m "Update Evolve ($(date '+%Y-%m-%d %H:%M'))"
git push

echo "==> Done. Live at https://bryanoltman.com/Evolve/"

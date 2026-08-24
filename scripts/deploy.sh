#!/usr/bin/env bash
# Build and copy the static bundle into the Jekyll site at translunar.io/tools/adev/.
set -euo pipefail
cd "$(dirname "$0")/.."
SITE="${SITE:-$HOME/Projects/translunar.github.io}"
DEST="$SITE/tools/adev"
npm test
npm run build
mkdir -p "$DEST"
rsync -a --delete dist/ "$DEST/"
echo "Copied to $DEST. Commit and push in $SITE to publish."

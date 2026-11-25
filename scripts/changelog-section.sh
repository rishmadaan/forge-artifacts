#!/usr/bin/env bash
# Prints one release's notes from CHANGELOG.md: the lines under its
# "## [X.Y.Z]" heading, up to the next "## [" heading or the link references
# at the bottom, without the heading and without leading or trailing blank
# lines. Fails when the section is missing or holds nothing.
#   scripts/changelog-section.sh <X.Y.Z> [CHANGELOG.md]
# Used by scripts/release.sh and by the release workflow, so the notes a
# release gets are the ones checked before it was tagged.
set -euo pipefail

version="${1:-}"
file="${2:-$(cd "$(dirname "$0")/.." && pwd)/CHANGELOG.md}"
if [ -z "$version" ]; then
  echo "usage: scripts/changelog-section.sh <X.Y.Z> [CHANGELOG.md]" >&2
  exit 1
fi
if [ ! -f "$file" ]; then
  echo "error: $file does not exist" >&2
  exit 1
fi

body="$(awk -v v="$version" '
  index($0, "## [" v "]") == 1 { on = 1; next }
  on && (/^## \[/ || /^\[[^]]+\]: /) { exit }
  on { print }
' "$file" | sed '/[^[:space:]]/,$!d')"

if [ -z "$(printf '%s' "$body" | tr -d '[:space:]')" ]; then
  echo "error: $file has no notes under a '## [$version]' heading" >&2
  exit 1
fi
printf '%s\n' "$body"

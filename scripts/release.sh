#!/usr/bin/env bash
# Releases Forge X.Y.Z: checks this checkout first, then builds the release in
# a temporary copy of it: sets VERSION in bin/forge, and the same version in
# gemini-extension.json (one "Release X.Y.Z" commit, only when it differs),
# runs the tests there, tags vX.Y.Z and pushes main and the tag together to
# origin. Only then is this checkout brought up to the
# release (fast-forward only). The tag starts the release workflow, which
# tests again and makes the GitHub Release from the CHANGELOG section.
#   scripts/release.sh <X.Y.Z>
# Write the CHANGELOG section first: "## [X.Y.Z] - YYYY-MM-DD" with its notes.
# X.Y.Z has no leading zeros and is higher than VERSION and every release tag
# on origin; only the first release may tag VERSION as it is.
# Every refusal changes nothing: the copy is removed, this checkout is never
# touched before the push, and nothing is tagged or pushed.
set -euo pipefail

version="${1:-}"
cd "$(dirname "$0")/.."
checkout="$(pwd -P)"
step() { echo "release: $*"; }
refuse() { echo "refusing: $*; nothing was changed" >&2; exit 1; }

[ $# -eq 1 ] || refuse "usage: scripts/release.sh <X.Y.Z>"
echo "$version" | grep -qE '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' || refuse "the version must be X.Y.Z (three numbers, no leading zeros), not '$version'"
tag="v$version"

step "checking the working tree"
# Untracked files too, asked for whatever git's settings say: a new file the
# tests use but nobody added would be missing from the tag. Ignored files are
# left out.
status="$(git status --porcelain --untracked-files=all)"
if [ -n "$status" ]; then
  printf '%s\n' "$status" >&2
  refuse "the files above have uncommitted changes or are not tracked (??); commit, undo or remove them first"
fi
branch="$(git symbolic-ref --short -q HEAD || true)"
[ "$branch" = "main" ] || refuse "releases are made from main, and this is '${branch:-a detached HEAD}'"

step "checking that $tag is new"
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then refuse "the tag $tag already exists here"; fi
set +e
origin_refs="$(git ls-remote --tags --refs origin 2>/dev/null)"
remote=$?
set -e
[ "$remote" -eq 0 ] || refuse "could not read origin's tags (git ls-remote exit $remote), so it is not known whether $tag exists there"
if printf '%s\n' "$origin_refs" | awk -v t="refs/tags/$tag" '$2 == t { f = 1 } END { exit !f }'; then refuse "the tag $tag already exists on origin"; fi

line='^const VERSION = "[0-9]+\.[0-9]+\.[0-9]+";$'
[ "$(grep -cE "$line" bin/forge)" = 1 ] || refuse "bin/forge does not have exactly one VERSION line"
current="$(grep -E "$line" bin/forge | cut -d'"' -f2)"
# gemini-extension.json must carry a version (Gemini CLI refuses one without);
# it always says bin/forge's VERSION, and the Release commit sets both.
gline='^  "version": "[0-9]+\.[0-9]+\.[0-9]+",?$'
[ "$(grep -cE "$gline" gemini-extension.json 2>/dev/null)" = 1 ] || refuse "gemini-extension.json does not have exactly one top-level version line"
gcurrent="$(grep -E "$gline" gemini-extension.json | cut -d'"' -f4)"
[ "$gcurrent" = "$current" ] || refuse "gemini-extension.json says version $gcurrent and bin/forge says $current; make them the same first"

# Is X.Y.Z $1 newer than $2? Compared as numbers, part by part.
newer() {
  local IFS=. a b i
  read -r -a a <<<"$1"
  read -r -a b <<<"$2"
  for i in 0 1 2; do
    if [ "$((10#${a[$i]}))" -ne "$((10#${b[$i]}))" ]; then [ "$((10#${a[$i]}))" -gt "$((10#${b[$i]}))" ]; return; fi
  done
  return 1
}
step "checking that $version is newer than every release"
origin_versions="$(printf '%s\n' "$origin_refs" | sed -nE 's#^[0-9a-f]+[[:space:]]+refs/tags/v([0-9]+\.[0-9]+\.[0-9]+)$#\1#p')"
local_versions="$(git tag --list | sed -nE 's#^v([0-9]+\.[0-9]+\.[0-9]+)$#\1#p')"
if [ "$version" = "$current" ]; then
  # Only the first release tags bin/forge's VERSION as it is: no release tag yet, here or on origin.
  any="$(printf '%s\n%s\n' "$origin_versions" "$local_versions" | sed -n '/./{p;q;}')"
  [ -z "$any" ] || refuse "$version is already bin/forge's VERSION, and v$any is a release tag already, so this is not the first release: release a version higher than $current"
else
  newer "$version" "$current" || refuse "$version is not newer than bin/forge's VERSION ($current)"
  for v in $origin_versions; do
    newer "$version" "$v" || refuse "$version is not newer than the release v$v on origin"
  done
fi

step "checking CHANGELOG.md"
grep -qE "^## \[${version//./\\.}\] - [0-9]{4}-[0-9]{2}-[0-9]{2}$" CHANGELOG.md || refuse "CHANGELOG.md has no '## [$version] - YYYY-MM-DD' heading; write the release's notes first"
scripts/changelog-section.sh "$version" >/dev/null || refuse "CHANGELOG.md's $version section has no notes"

# The release is made and tested in a temporary copy, so nothing the tests do
# can reach this checkout, and nothing here changes until the push succeeds.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
copy="$work/forge"
step "making a temporary copy to release from"
{ git clone --no-local --quiet "$checkout" "$copy" && git -C "$copy" checkout -q -B main "$(git rev-parse HEAD)"; } || refuse "could not make the temporary copy (above)"
# The Release commit gets the identity this checkout would use.
for k in user.name user.email; do
  v="$(git config "$k" || true)"
  [ -z "$v" ] || git -C "$copy" config "$k" "$v"
done
# git resolves a relative path to origin from this checkout, not from the copy.
push_url="$(git remote get-url --push origin)"
case "$push_url" in /* | *:*) ;; *) push_url="$checkout/$push_url" ;; esac

if [ "$current" != "$version" ]; then
  step "setting VERSION in bin/forge and gemini-extension.json: $current -> $version"
  sed -E "s/$line/const VERSION = \"$version\";/" "$copy/bin/forge" > "$work/forge.new"
  cat "$work/forge.new" > "$copy/bin/forge"
  sed -E "s/^(  \"version\": \")[0-9.]+(\",?)$/\\1$version\\2/" "$copy/gemini-extension.json" > "$work/gemini.new"
  cat "$work/gemini.new" > "$copy/gemini-extension.json"
  if [ "$(node "$copy/bin/forge" --version)" != "Forge $version" ] || [ "$(grep -E "$gline" "$copy/gemini-extension.json" | cut -d'"' -f4)" != "$version" ] ||
    [ "$(git -C "$copy" diff --numstat -- bin/forge gemini-extension.json)" != "$(printf '1\t1\tbin/forge\n1\t1\tgemini-extension.json')" ]; then
    refuse "setting VERSION did not change exactly that one line in each file"
  fi
  git -C "$copy" add -- bin/forge gemini-extension.json
  tree="$(git -C "$copy" write-tree)"
  git -C "$copy" commit -q -m "Release $version" -- bin/forge gemini-extension.json
  [ "$(git -C "$copy" rev-parse 'HEAD^{tree}')" = "$tree" ] || refuse "the Release $version commit is not the tree that was checked (a commit hook changed it?)"
  step "committed: Release $version"
else
  step "bin/forge already says $version: tagging HEAD"
fi
release="$(git -C "$copy" rev-parse HEAD)"

# The tests run on exactly the commit to be tagged, and must leave it so.
step "running the tests at $version (node test/run.js)"
(cd "$copy" && node test/run.js) || refuse "the tests failed at $version"
[ "$(git -C "$copy" rev-parse HEAD)" = "$release" ] || refuse "the tests moved the copy's HEAD, so what passed is not the commit to be tagged"
after="$(git -C "$copy" status --porcelain --untracked-files=all)"
if [ -n "$after" ]; then
  printf '%s\n' "$after" >&2
  refuse "the tests changed the copy they ran in (above), so what passed is not the commit to be tagged"
fi

git -C "$copy" tag -a "$tag" -m "Forge $version" "$release"
step "tagged $tag ($(git -C "$copy" rev-parse --short "$release")) in a temporary copy"
git -C "$copy" push --atomic --quiet "$push_url" "$release:refs/heads/main" "refs/tags/$tag" ||
  refuse "origin did not take the push (above); main and $tag go together or not at all, so neither was pushed"
step "pushed main and $tag; the release workflow makes the GitHub Release"

# Only now does this checkout move: fast-forward only, never over a change or
# an ignored file.
here="$(printf '%q' "$checkout")"
up="git -C $here fetch -q origin main refs/tags/$tag:refs/tags/$tag && git -C $here merge -q --ff-only --no-overwrite-ignore --no-autostash $release"
if ! git fetch -q origin main "refs/tags/$tag:refs/tags/$tag" || ! git merge -q --ff-only --no-overwrite-ignore --no-autostash "$release"; then
  echo "NOT FINISHED: $tag is released (main and the tag are on origin), but this checkout was not brought up to it (git said why, above); bring it up with: $up" >&2
  exit 1
fi
step "this checkout is now at the release ($(git rev-parse --short HEAD))"

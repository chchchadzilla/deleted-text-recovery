#!/usr/bin/env bash
# Publishes the web app: builds it, then replaces the gh-pages branch with apps/web/dist.
# GitHub Pages serves that branch at https://chchchadzilla.github.io/deleted-text-recovery/
#
# This is how the site is published, because GitHub Actions is not available on the
# maintainer's account. (.github/workflows/pages.yml does the same thing where Actions works.)
#
#   bash scripts/deploy-web.sh
#
# Needs Node and git (on Windows: run it from Git Bash). It refuses to run with uncommitted
# changes, so the live site always matches a commit.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "There are uncommitted changes. Commit or stash them first." >&2
  exit 1
fi

npm run check
node scripts/audit.mjs

remote=$(git remote get-url origin)
sha=$(git rev-parse --short HEAD)
name=$(git config user.name)
email=$(git config user.email)

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp -R apps/web/dist/. "$tmp/"

cd "$tmp"
git init -q -b gh-pages
git config user.name "$name"
git config user.email "$email"
git config core.autocrlf false
git add -A
if [ -n "${DTR_COMMIT_TRAILER:-}" ]; then
  git commit -q -m "Deploy web app from $sha" -m "$DTR_COMMIT_TRAILER"
else
  git commit -q -m "Deploy web app from $sha"
fi
git push -q -f "$remote" gh-pages

echo "Published $sha. It can take a minute to appear at https://chchchadzilla.github.io/deleted-text-recovery/"

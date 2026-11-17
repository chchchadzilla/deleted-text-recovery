#!/usr/bin/env bash
# Builds the release downloads on a developer machine, exactly as .github/workflows/release.yml
# does in CI. Use it only when the workflow cannot run. Needs Node, npx and GNU tar
# (on Windows: run it from Git Bash).
#
#   bash scripts/release-local.sh        -> .tmp/release/out/*
set -euo pipefail
cd "$(dirname "$0")/.."

BUN="npx --yes bun@1.4.4"
app=apps/desktop/dist/deleted-text-recovery.cjs
out=.tmp/release/out
stage=.tmp/release/stage
rm -rf .tmp/release
mkdir -p "$out" "$stage"

npm run check
node scripts/audit.mjs

# The first use of a Bun version through npx only sets it up, and can exit non-zero.
$BUN --version >/dev/null 2>&1 || true
echo "bun $($BUN --version)"

$BUN build "$app" --compile --target=bun-windows-x64 --outfile "$out/DeletedTextRecovery-Windows.exe"

build() {
  # $1 = bun target, $2 = name used in the download
  mkdir -p "$stage/$2"
  $BUN build "$app" --compile --target="bun-$1" --outfile "$stage/$2/deleted-text-recovery"
  # --mode forces the executable bit even when the archive is made on Windows
  tar --mode=755 -C "$stage/$2" -czf "$out/DeletedTextRecovery-$2.tar.gz" deleted-text-recovery
}
build linux-x64 Linux-x64
build linux-arm64 Linux-arm64
build darwin-arm64 macOS-AppleSilicon
build darwin-x64 macOS-Intel

cp "$app" "$out/deleted-text-recovery.cjs"
cp apps/web/dist/index.html "$out/DeletedTextRecovery-WebApp.html"
(cd "$out" && sha256sum DeletedTextRecovery-* deleted-text-recovery.cjs > SHA256SUMS.txt)
ls -la "$out"

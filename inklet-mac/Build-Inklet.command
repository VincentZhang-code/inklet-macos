#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
case "$(uname -m)" in
  arm64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) printf 'Unsupported Mac architecture.\n'; exit 1 ;;
esac
VERSION="$(/usr/bin/plutil -extract devDependencies.electron raw -o - package.json)"
APP_VERSION="$(/usr/bin/plutil -extract version raw -o - package.json)"
ARCHIVE="$ROOT/runtime/electron-v${VERSION}-darwin-${ARCH}.zip"
if [[ ! -f "$ARCHIVE" ]]; then
  printf 'Official offline runtime is missing. See README.md.\n'
  exit 1
fi
RUNTIME="$ROOT/build/runtime-${ARCH}"
mkdir -p "$RUNTIME"
/usr/bin/ditto -x -k "$ARCHIVE" "$RUNTIME"
NODE="$RUNTIME/Electron.app/Contents/MacOS/Electron"
export ELECTRON_RUN_AS_NODE=1
export ELECTRON_OVERRIDE_DIST_PATH="$RUNTIME"
"$NODE" "$ROOT/tools/package.mjs" "--arch=$ARCH"
SUFFIX=-unsigned
if [[ -n "${INKLET_NOTARY_PROFILE:-}" ]]; then SUFFIX= ; fi
"$NODE" "$ROOT/tools/verify-package.mjs" "$ROOT/release/Inklet-${APP_VERSION}-mac-${ARCH}${SUFFIX}.zip"
/usr/bin/open "$ROOT/release"
printf 'Build completed. Native testing and Developer ID notarization remain separate release gates.\n'
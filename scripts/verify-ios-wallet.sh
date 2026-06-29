#!/usr/bin/env bash
# B1 — iOS wallet verification checklist (Phase 10).
# Run on macOS with Xcode installed. Exits non-zero on any hard failure.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOS_DIR="$ROOT/GoemanWallet"
SCHEME="GoemanWallet"
DERIVED="$ROOT/.build/ios-verify"

echo "== Goeman iOS wallet verification (B1) =="

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "SKIP: macOS + Xcode required for compile verification."
  exit 0
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "FAIL: xcodebuild not found — install Xcode."
  exit 1
fi

if [[ ! -d "$IOS_DIR/GoemanWallet.xcodeproj" && ! -d "$IOS_DIR/GoemanWallet.xcworkspace" ]]; then
  echo "WARN: No Xcode project yet — open Package.swift in Xcode and create the app target per GoemanWallet/README.md"
  echo "      Verifying Swift package resolves instead..."
  if command -v swift >/dev/null 2>&1; then
    (cd "$IOS_DIR" && swift package resolve)
    echo "PASS: Swift package resolved."
  else
    echo "FAIL: swift CLI not available."
    exit 1
  fi
  exit 0
fi

PROJECT_FLAG=()
if [[ -d "$IOS_DIR/GoemanWallet.xcworkspace" ]]; then
  PROJECT_FLAG=(-workspace "$IOS_DIR/GoemanWallet.xcworkspace")
else
  PROJECT_FLAG=(-project "$IOS_DIR/GoemanWallet.xcodeproj")
fi

mkdir -p "$DERIVED"

echo "-- xcodebuild (generic iOS Simulator) --"
xcodebuild "${PROJECT_FLAG[@]}" \
  -scheme "$SCHEME" \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO \
  build

echo ""
echo "Manual smoke (device / simulator):"
echo "  [ ] Secure Enclave / Face ID gate on send"
echo "  [ ] Hedera build → sign → submit (signatureHex)"
echo "  [ ] OID4VP consent deep link → VP sign → scoped token"
echo "  [ ] Receive QR shows Hedera account + EVM alias"
echo ""
echo "PASS: iOS compile verification complete."

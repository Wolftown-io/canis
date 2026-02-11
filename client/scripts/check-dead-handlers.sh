#!/usr/bin/env bash
# check-dead-handlers.sh
#
# Detects common dead handler anti-patterns in .tsx and .ts component files.
# Run: bun run lint:handlers
# Exit code: 1 if issues found, 0 if clean.

set -euo pipefail

SRCDIR="$(cd "$(dirname "$0")/../src" && pwd)"
EXIT_CODE=0

# Colors (disabled if not a terminal)
if [ -t 1 ]; then
  RED='\033[0;31m'
  YEL='\033[0;33m'
  GRN='\033[0;32m'
  RST='\033[0m'
else
  RED='' YEL='' GRN='' RST=''
fi

echo "Checking for dead UI handlers..."
echo ""

# 1. console.log stubs inside component files
#    Exclude: test files, stores, webrtc (operational logging), sound (operational),
#    tauri.ts (API/auth infra), and tagged logs like console.log("[Tag]")
STUBS=$(grep -rn 'console\.log' "$SRCDIR" \
  --include='*.tsx' --include='*.ts' \
  --exclude-dir='__tests__' \
  --exclude-dir='stores' \
  --exclude-dir='webrtc' \
  --exclude-dir='sound' \
  --exclude='tauri.ts' \
  --exclude='*.test.*' \
  --exclude='*.spec.*' \
  | grep -v '// eslint-disable' \
  | grep -v 'console\.error' \
  | grep -v 'console\.warn' \
  | grep -v 'console\.debug' \
  | grep -v 'console\.log(\s*[`"'"'"']\s*\[' \
  || true)

if [ -n "$STUBS" ]; then
  echo -e "${YEL}[WARN] console.log() found in component/lib files (possible stub handlers):${RST}"
  echo "$STUBS" | while IFS= read -r line; do
    echo -e "  ${RED}$line${RST}"
  done
  echo ""
  EXIT_CODE=1
fi

# 2. TODO/FIXME near action handlers
TODOS=$(grep -rn 'TODO\|FIXME' "$SRCDIR" \
  --include='*.tsx' --include='*.ts' \
  --exclude-dir='__tests__' \
  --exclude='*.test.*' \
  --exclude='*.spec.*' \
  | grep -iE 'action|onClick|onSubmit|handler|implement' \
  || true)

if [ -n "$TODOS" ]; then
  echo -e "${YEL}[WARN] TODO/FIXME comments near handlers (unfinished work):${RST}"
  echo "$TODOS" | while IFS= read -r line; do
    echo -e "  ${RED}$line${RST}"
  done
  echo ""
  EXIT_CODE=1
fi

# 3. Empty arrow functions in event handler props
EMPTY=$(grep -rn -E '(onClick|onSubmit|onChange|onInput|action)\s*=\s*\{?\s*\(\)\s*=>\s*\{\s*\}\s*\}?' "$SRCDIR" \
  --include='*.tsx' \
  --exclude-dir='__tests__' \
  --exclude='*.test.*' \
  || true)

if [ -n "$EMPTY" ]; then
  echo -e "${YEL}[WARN] Empty event handlers found:${RST}"
  echo "$EMPTY" | while IFS= read -r line; do
    echo -e "  ${RED}$line${RST}"
  done
  echo ""
  EXIT_CODE=1
fi

if [ "$EXIT_CODE" -eq 0 ]; then
  echo -e "${GRN}No dead handler patterns found.${RST}"
else
  echo -e "${RED}Found dead handler patterns. Fix the issues above.${RST}"
fi

exit $EXIT_CODE

#!/bin/zsh

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Khong tim thay Node.js 18+. Cai Node.js roi chay lai file nay."
  read "?Nhan Enter de dong..."
  exit 1
fi

node "$SCRIPT_DIR/gui.js" "$@"

#!/bin/zsh

# One-click macOS setup: this project has no npm dependencies.
set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
MIN_NODE_MAJOR=18

pause() {
  echo
  read "?Nhấn Enter để đóng / Press Enter to close..."
}

fail() {
  echo
  echo "Lỗi / Error: $1"
  pause
  exit 1
}

clear
echo "============================================================"
echo "  9router Codex Importer — Thiết lập / Setup"
echo "============================================================"
echo

if ! command -v node >/dev/null 2>&1; then
  fail "Không tìm thấy Node.js. Hãy cài Node.js $MIN_NODE_MAJOR+ từ https://nodejs.org rồi chạy lại. / Node.js $MIN_NODE_MAJOR+ is required; install it from https://nodejs.org and run this again."
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
if [[ ! "$NODE_MAJOR" =~ ^[0-9]+$ ]] || (( NODE_MAJOR < MIN_NODE_MAJOR )); then
  fail "Node.js $(node --version 2>/dev/null || echo 'unknown') không được hỗ trợ. Cần Node.js $MIN_NODE_MAJOR+ / Node.js $MIN_NODE_MAJOR+ is required."
fi

cd "$SCRIPT_DIR" || fail "Không thể mở thư mục dự án / Cannot open the project folder."
mkdir -p "$SCRIPT_DIR/tokens" || fail "Không thể tạo thư mục tokens / Cannot create the tokens folder."

for file in importer-core.js import.js gui.js; do
  node --check "$SCRIPT_DIR/$file" >/dev/null 2>&1 || fail "Kiểm tra mã thất bại: $file / Code check failed: $file"
done

echo "✓ Node.js $(node --version)"
echo "✓ Không cần npm install / No npm install is required"
echo "✓ Đã sẵn sàng: $SCRIPT_DIR/tokens"
echo
echo "Đang tự mở giao diện... / Opening the interface automatically..."
exec /bin/zsh "$SCRIPT_DIR/run.command"

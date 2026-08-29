#!/bin/zsh

# Starts the local GUI. gui.js opens the default browser on 127.0.0.1.
set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
MIN_NODE_MAJOR=18

pause() {
  echo
  read "?Nhấn Enter để đóng / Press Enter to close..."
}

if ! command -v node >/dev/null 2>&1; then
  echo "Không tìm thấy Node.js $MIN_NODE_MAJOR+. Hãy chạy setup.command trước. / Node.js $MIN_NODE_MAJOR+ was not found. Run setup.command first."
  pause
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
if [[ ! "$NODE_MAJOR" =~ ^[0-9]+$ ]] || (( NODE_MAJOR < MIN_NODE_MAJOR )); then
  echo "Cần Node.js $MIN_NODE_MAJOR+; phiên bản hiện tại là $(node --version 2>/dev/null || echo 'unknown'). / Node.js $MIN_NODE_MAJOR+ is required."
  pause
  exit 1
fi

cd "$SCRIPT_DIR" || exit 1
echo "Đang mở giao diện cục bộ... / Opening the local interface..."
echo "Đóng cửa sổ này hoặc nhấn Ctrl+C để dừng máy chủ / Close this window or press Ctrl+C to stop the server."
echo
node "$SCRIPT_DIR/gui.js" "$@"
EXIT_CODE=$?

if (( EXIT_CODE != 0 )); then
  echo
  echo "GUI đã dừng với mã $EXIT_CODE / The GUI stopped with exit code $EXIT_CODE."
  pause
fi
exit "$EXIT_CODE"

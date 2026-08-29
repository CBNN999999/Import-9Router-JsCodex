@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1

set "SCRIPT_DIR=%~dp0"
set "MIN_NODE_MAJOR=18"

title 9router Codex Importer - Local GUI
call :check_node
if errorlevel 1 goto :failed

cd /d "%SCRIPT_DIR%" || (
  echo Không thể mở thư mục dự án / Cannot open the project folder.
  goto :failed
)

echo Đang mở giao diện cục bộ... / Opening the local interface...
echo Đóng cửa sổ này hoặc nhấn Ctrl+C để dừng máy chủ / Close this window or press Ctrl+C to stop the server.
echo.
node "%SCRIPT_DIR%gui.js" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo GUI đã dừng với mã %EXIT_CODE% / The GUI stopped with exit code %EXIT_CODE%.
  pause
)
exit /b %EXIT_CODE%

:check_node
where node >nul 2>&1
if errorlevel 1 (
  echo Không tìm thấy Node.js %MIN_NODE_MAJOR%+. Hãy chạy setup.cmd trước.
  echo Node.js %MIN_NODE_MAJOR%+ was not found. Run setup.cmd first.
  exit /b 1
)

set "NODE_MAJOR="
for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node" 2^>nul') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR (
  echo Không thể đọc phiên bản Node.js / Cannot read the Node.js version.
  exit /b 1
)
if %NODE_MAJOR% LSS %MIN_NODE_MAJOR% (
  echo Cần Node.js %MIN_NODE_MAJOR%+ / Node.js %MIN_NODE_MAJOR%+ is required.
  exit /b 1
)
exit /b 0

:failed
echo.
pause
exit /b 1

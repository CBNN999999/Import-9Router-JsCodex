@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1

set "SCRIPT_DIR=%~dp0"
set "MIN_NODE_MAJOR=18"

title 9router Codex Importer - Setup
echo ============================================================
echo   9router Codex Importer - Thiết lập / Setup
echo ============================================================
echo.

call :check_node
if errorlevel 1 goto :failed

cd /d "%SCRIPT_DIR%" || (
  echo Không thể mở thư mục dự án / Cannot open the project folder.
  goto :failed
)

if not exist "%SCRIPT_DIR%tokens\" mkdir "%SCRIPT_DIR%tokens" 2>nul
if not exist "%SCRIPT_DIR%tokens\" (
  echo Không thể tạo thư mục tokens / Cannot create the tokens folder.
  goto :failed
)

for %%F in (importer-core.js import.js gui.js) do (
  node --check "%SCRIPT_DIR%%%F" >nul 2>&1
  if errorlevel 1 (
    echo Kiểm tra mã thất bại: %%F / Code check failed: %%F
    goto :failed
  )
)

for /f "delims=" %%V in ('node --version') do set "NODE_VERSION=%%V"
echo [OK] Node.js %NODE_VERSION%
echo [OK] Không cần npm install / No npm install is required
echo [OK] Sẵn sàng: %SCRIPT_DIR%tokens
echo.
echo Đang tự mở giao diện... / Opening the interface automatically...
call "%SCRIPT_DIR%run.cmd"
exit /b %ERRORLEVEL%

:check_node
where node >nul 2>&1
if errorlevel 1 (
  echo Không tìm thấy Node.js. Cài Node.js %MIN_NODE_MAJOR%+ từ https://nodejs.org rồi chạy lại.
  echo Node.js %MIN_NODE_MAJOR%+ is required. Install it from https://nodejs.org and run this again.
  exit /b 1
)

set "NODE_MAJOR="
for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node" 2^>nul') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR (
  echo Không thể đọc phiên bản Node.js / Cannot read the Node.js version.
  exit /b 1
)
if %NODE_MAJOR% LSS %MIN_NODE_MAJOR% (
  echo Node.js %MIN_NODE_MAJOR%+ là bắt buộc / Node.js %MIN_NODE_MAJOR%+ is required.
  exit /b 1
)
exit /b 0

:failed
echo.
pause
exit /b 1

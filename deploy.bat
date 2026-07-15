@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"

set "PAGES_URL=https://wu8858009.github.io/equippro/"

echo ============================================
echo   EquipPro 自動發布工具
echo ============================================
echo.

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo [錯誤] 這個資料夾不是 Git 倉庫。
    pause
    exit /b 1
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
    echo [錯誤] 尚未設定遠端倉庫 origin，請先執行 git remote add origin ...
    pause
    exit /b 1
)

for /f "usebackq delims=" %%i in (`git rev-parse --abbrev-ref HEAD`) do set "BRANCH=%%i"

echo 正在檢查變更...
git add -A

git diff --cached --quiet
if not errorlevel 1 (
    echo 沒有偵測到新的檔案變更，將直接嘗試推送。
    goto :dopush
)

set "MSG=%~1"
if "%MSG%"=="" (
    set /p MSG=請輸入本次更新說明（直接按 Enter 使用預設訊息）:
)
if "%MSG%"=="" (
    for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm'"`) do set "NOWSTAMP=%%i"
    set "MSG=更新內容 !NOWSTAMP!"
)

echo.
echo 正在建立 commit：!MSG!
git commit -m "!MSG!"
if errorlevel 1 (
    echo [錯誤] Commit 失敗，請檢查上方訊息。
    pause
    exit /b 1
)

:dopush
echo.
echo 正在推送到 GitHub（分支：!BRANCH!）...
git push origin !BRANCH!
if errorlevel 1 (
    echo.
    echo [錯誤] 推送失敗。可能原因：
    echo   - 遠端有你本機沒有的變更，請先執行 git pull
    echo   - 網路連線或 GitHub 登入權限問題
    pause
    exit /b 1
)

echo.
echo ============================================
echo   發布成功！
echo   GitHub Pages 通常需要 1-2 分鐘更新
echo   網址：!PAGES_URL!
echo ============================================
echo.

choice /M "要現在開啟瀏覽器查看網站嗎"
if not errorlevel 2 start "" "!PAGES_URL!"

echo.
pause

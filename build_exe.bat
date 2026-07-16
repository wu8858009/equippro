@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   EquipPro 桌面版打包工具
echo ============================================
echo.

where python >nul 2>&1
if errorlevel 1 (
    echo [錯誤] 找不到 Python，請先安裝並將其加入 PATH。
    pause
    exit /b 1
)

echo 正在確認相依套件（pywebview、pyinstaller）...
python -m pip install --quiet --upgrade pywebview pyinstaller
if errorlevel 1 (
    echo [錯誤] 套件安裝失敗，請檢查上方訊息。
    pause
    exit /b 1
)

echo.
echo 正在打包成 EXE（可能需要一兩分鐘）...
python -m PyInstaller --noconfirm --name EquipPro --onefile --windowed ^
    --add-data "index.html;." ^
    --add-data "css;css" ^
    --add-data "js;js" ^
    desktop_app.py

if errorlevel 1 (
    echo.
    echo [錯誤] 打包失敗，請檢查上方訊息。
    pause
    exit /b 1
)

echo.
echo ============================================
echo   打包完成！
echo   執行檔位置：dist\EquipPro.exe
echo ============================================
echo.
pause

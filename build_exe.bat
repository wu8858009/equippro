@echo off
chcp 65001 >nul
cd /d "%~dp0"
python -m PyInstaller --noconfirm 設備管家.spec
echo.
echo 完成：dist\設備管家.exe
pause

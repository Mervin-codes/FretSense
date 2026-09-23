@echo off
setlocal
cd /d "%~dp0"
title FretSense - Build Windows EXE

if not exist ".venv\Scripts\python.exe" (
  echo Run INSTALL_WINDOWS.bat first.
  pause
  exit /b 1
)

call .venv\Scripts\python.exe -m pip install -r requirements-build.txt
if errorlevel 1 goto :failed

if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
if exist FretSense.spec del /q FretSense.spec

.venv\Scripts\python.exe -m PyInstaller --noconfirm --clean --windowed ^
  --name FretSense ^
  --icon assets\FretSense.ico ^
  --add-data "app;app" ^
  --add-data "assets;assets" ^
  fretsense_windows.py
if errorlevel 1 goto :failed

echo.
echo Build complete:
echo   %CD%\dist\FretSense\FretSense.exe
echo.
echo Zip the entire dist\FretSense folder when sharing it.
pause
exit /b 0

:failed
echo.
echo Build failed. Review the error above.
pause
exit /b 1

@echo off
setlocal
cd /d "%~dp0"
title FretSense - Windows Setup

echo ================================================
echo        FretSense 5.2.3 - Windows Setup
echo ================================================
echo.

where py >nul 2>nul
if %errorlevel%==0 (
  set "PY=py -3"
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo Python 3.10+ was not found.
    echo Install Python from https://www.python.org/downloads/windows/
    echo IMPORTANT: tick "Add Python to PATH" during setup.
    pause
    exit /b 1
  )
  set "PY=python"
)

if not exist ".venv\Scripts\python.exe" (
  echo [1/3] Creating local Python environment...
  %PY% -m venv .venv
  if errorlevel 1 goto :failed
) else (
  echo [1/3] Existing environment found.
)

echo [2/3] Installing Windows app dependencies...
call .venv\Scripts\python.exe -m pip install --upgrade pip
if errorlevel 1 goto :failed
call .venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 goto :failed

echo [3/3] Setup complete.
echo.
echo Launching FretSense...
call RUN_FRETSENSE.bat
exit /b 0

:failed
echo.
echo Setup failed. Check your internet connection and the error above.
pause
exit /b 1

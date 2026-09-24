@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo FretSense is not installed yet.
  echo Run INSTALL_WINDOWS.bat first.
  pause
  exit /b 1
)
start "" .venv\Scripts\pythonw.exe fretsense_windows.py

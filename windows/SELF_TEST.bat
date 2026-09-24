@echo off
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  .venv\Scripts\python.exe SELF_TEST.py
) else (
  py -3 SELF_TEST.py 2>nul || python SELF_TEST.py
)
pause

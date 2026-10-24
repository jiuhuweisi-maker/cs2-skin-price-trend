@echo off
setlocal
cd /d "%~dp0"
if not exist ".tmp" mkdir ".tmp"
set "TEMP=%CD%\.tmp"
set "TMP=%TEMP%"
if exist ".venv\Scripts\python.exe" goto check_venv
set "PYTHON_EXE=python"
python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1
if not errorlevel 1 goto create
set "PYTHON_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if exist "%PYTHON_EXE%" goto create
echo [Skin Reveal] Python 3.11+ was not found. Please install Python, then retry.
pause
exit /b 1
:check_venv
".venv\Scripts\python.exe" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1
if errorlevel 1 goto old_venv
goto run
:old_venv
echo [Skin Reveal] Existing .venv uses Python below 3.11. Remove .venv and retry with Python 3.11+.
pause
exit /b 1
:create
"%PYTHON_EXE%" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1
if errorlevel 1 goto old_python
"%PYTHON_EXE%" -m venv .venv
if errorlevel 1 goto fail
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto fail
:run
".venv\Scripts\python.exe" app.py
if errorlevel 1 goto fail
exit /b 0
:fail
echo [Skin Reveal] Startup failed. See the error above.
pause
exit /b 1
:old_python
echo [Skin Reveal] Python 3.11+ was not found. Please install Python, then retry.
pause
exit /b 1

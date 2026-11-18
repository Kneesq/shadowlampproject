@echo off
title Shadow Lamp Generator
cd /d "%~dp0"

set PY_EXE="C:\Users\ASUSTek\AppData\Local\Programs\Python\Python311\python.exe"

if exist %PY_EXE% goto :run_server

where python >nul 2>&1
if %errorlevel% equ 0 (
    set PY_EXE=python
    goto :run_server
)

echo Python was not found. Opening standalone HTML version...
start "" "%~dp0shadow_lamp.html"
goto :end

:run_server
echo ========================================================
echo  Starting Shadow Lamp Generator Server...
echo  Opening http://127.0.0.1:5000 in your browser...
echo ========================================================
start "" http://127.0.0.1:5000
%PY_EXE% server.py

:end
pause

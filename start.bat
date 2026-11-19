@echo off
setlocal
title Shadow Lamp Generator
cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -c "import flask, trimesh, skimage, scipy, fast_simplification" >nul 2>&1
    if not errorlevel 1 (
        ".venv\Scripts\python.exe" server.py --open
        goto :end
    )
)
for %%P in ("%LocalAppData%\Programs\Python\Python311\python.exe" python) do (
    "%%~P" -c "import flask, trimesh, skimage, scipy, fast_simplification" >nul 2>&1
    if not errorlevel 1 (
        "%%~P" server.py --open
        goto :end
    )
)
py -3 -c "import flask, trimesh, skimage, scipy, fast_simplification" >nul 2>&1
if not errorlevel 1 (
    py -3 server.py --open
    goto :end
)
echo Opening the standalone generator. The full server requires the packages in requirements.txt.
start "" "%~dp0shadow_lamp_fixed.html"
exit /b

:end
if errorlevel 1 pause

@echo off
setlocal
title Shadow Lamp Generator
cd /d "%~dp0"

set "PY_PYTHON=3"
for %%P in (".venv\Scripts\python.exe" "%LocalAppData%\Programs\Python\Python311\python.exe" python py) do (
    "%%~P" -c "from importlib.util import find_spec; import sys; sys.exit(not all(find_spec(n) for n in 'flask numpy PIL scipy skimage trimesh fast_simplification'.split()))" >nul 2>&1
    if not errorlevel 1 (
        "%%~P" server.py --open
        goto :end
    )
)
echo Opening the standalone generator. The full server requires the packages in requirements.txt.
start "" "%~dp0shadow_lamp_fixed.html"
exit /b

:end
if errorlevel 1 pause

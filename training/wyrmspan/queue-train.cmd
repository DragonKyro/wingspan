@echo off
rem Queue a Wyrmspan training run: wait until no other Python job is using the
rem GPU (polls nvidia-smi every 2 minutes), then run train.py with the `train`
rem conda env. Usage (from anywhere):
rem
rem   training\wyrmspan\queue-train.cmd [run-name] [extra train.py args...]
rem
rem Logs: training\runs\wyrmspan\<run>\queue.log (waiting / start / exit) and
rem train.log (the trainer's output). To stop a started run, create an empty
rem training\runs\wyrmspan\<run>\STOP file (it saves, then exits); to cancel
rem while it is still waiting, close this window.
setlocal
set "ENV=C:\ProgramData\anaconda3\envs\train"
set "PATH=%ENV%;%ENV%\Library\bin;%ENV%\Scripts;%PATH%"
set "PYTHONUNBUFFERED=1"
cd /d "%~dp0..\.."
set "RUN=%~1"
if "%RUN%"=="" set "RUN=main"
set "DIR=training\runs\wyrmspan\%RUN%"
if not exist "%DIR%" mkdir "%DIR%"
title wyrmspan training (%RUN%) - waiting for the GPU
echo %date% %time% queued run %RUN% >> "%DIR%\queue.log"

:wait
nvidia-smi --query-compute-apps=process_name --format=csv,noheader | findstr /i "python.exe" >nul
if not errorlevel 1 (
  timeout /t 120 /nobreak >nul
  goto wait
)

title wyrmspan training (%RUN%)
echo %date% %time% GPU free - starting train.py --run %RUN% %2 %3 %4 %5 %6 %7 %8 %9 >> "%DIR%\queue.log"
python training\wyrmspan\train.py --run %RUN% %2 %3 %4 %5 %6 %7 %8 %9 >> "%DIR%\train.log" 2>&1
echo %date% %time% train.py exited with code %errorlevel% >> "%DIR%\queue.log"

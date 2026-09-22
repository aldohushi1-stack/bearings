@echo off
rem Startup-tax measurement — double-click. Reads your real Claude Code transcripts, writes a report into docs\private\.
rem Usage: measure.cmd [YYYY-MM-DD]   (only sessions started on/after that date; default: all)
setlocal
cd /d "%~dp0.."
if not exist docs\private mkdir docs\private
set SINCE=%1
if "%SINCE%"=="" (
  set OUT=docs\private\startup-tax-all.md
  node scripts\startup-tax.mjs "%USERPROFILE%\.claude\projects" --per-session --title "Startup tax - all sessions" > "%OUT%"
) else (
  set OUT=docs\private\startup-tax-since-%SINCE%.md
  node scripts\startup-tax.mjs "%USERPROFILE%\.claude\projects" --since %SINCE% --per-session --title "Startup tax - since %SINCE%" > "%OUT%"
)
if errorlevel 1 (
  echo Something went wrong - is Node installed and are there transcripts under %USERPROFILE%\.claude\projects ?
) else (
  echo Written: %OUT%
  echo.
  type "%OUT%" | findstr /C:"did nothing but orient" /C:"sessions across" /C:"Carrying"
)
echo.
pause

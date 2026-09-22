@echo off
rem Bearings - first npm publish (0.2.0). Double-click. Uses "call npm" so the window survives each step.
setlocal
cd /d "%~dp0"
echo == 1/5  who am I on npm?
call npm whoami >nul 2>&1
if errorlevel 1 (
  echo Not logged in - a browser window will open for npm login ^(account aldoh, security key^).
  call npm login
  if errorlevel 1 (echo npm login failed. & pause & exit /b 1)
)
call npm whoami
echo.
echo == 2/5  tests
call npm test
if errorlevel 1 (echo Tests failed - not publishing. & pause & exit /b 1)
echo.
echo == 3/5  what will be published
call npm pack --dry-run
echo.
echo == 4/5  publish
call npm publish --access public
if errorlevel 1 (
  echo.
  echo Publish failed. If it says the version already exists, bump package.json + .claude-plugin\*.json and push first.
  echo If it says E403/needs OTP, run:  npm publish --access public --otp=XXXXXX
  pause
  exit /b 1
)
echo.
echo == 5/5  verify from the registry ^(may take a minute to propagate^)
timeout /t 20 /nobreak >nul
call npx -y get-bearings@0.2.0 --version
echo.
echo Done. Next: npmjs.com ^> get-bearings ^> Settings ^> Publishing access ^> Trusted publisher ^(GitHub, aldohushi1-stack/bearings, publish.yml^).
pause

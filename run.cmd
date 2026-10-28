@echo off
node --experimental-ffi --disable-warning=ExperimentalWarning "%~dp0src\main.ts" %*
exit /b %ERRORLEVEL%

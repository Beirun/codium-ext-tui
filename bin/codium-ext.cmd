@echo off
node --experimental-ffi --disable-warning=ExperimentalWarning "%~dp0..\src\main.ts" %*

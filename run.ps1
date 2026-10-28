$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
& node --experimental-ffi --disable-warning=ExperimentalWarning (Join-Path $root "src/main.ts") @args
exit $LASTEXITCODE

#!/bin/sh
dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node --experimental-ffi --disable-warning=ExperimentalWarning "$dir/src/main.ts" "$@"

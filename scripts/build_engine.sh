#!/data/data/com.termux/files/usr/bin/bash

cd "$(dirname "$0")/../engine" || exit 1

mkdir -p build
cd build || exit 1

cmake .. 2>/dev/null || true
cmake --build .

# copy outputs so Flask can serve them
cp -r ../assets ../../app/static/engine/ 2>/dev/null || true
cp -r ../shaders ../../app/static/engine/ 2>/dev/null || true


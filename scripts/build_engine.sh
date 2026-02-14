#!/data/data/com.termux/files/usr/bin/bash

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/engine"
BUILD="$ENGINE/build"

mkdir -p "$BUILD"
cd "$BUILD" || exit 1

echo "Running CMake configure..."

# Force CMake to use host compiler, avoid termux-x11 toolchain
cmake .. -DCMAKE_SYSTEM_NAME=Linux -DCMAKE_C_COMPILER=cc -DCMAKE_CXX_COMPILER=c++ || exit 1

echo "Building engine..."
cmake --build .

echo "Done."

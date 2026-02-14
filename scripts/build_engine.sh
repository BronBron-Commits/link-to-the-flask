#!/data/data/com.termux/files/usr/bin/bash

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/engine"
BUILD="$ENGINE/build"

mkdir -p "$BUILD"
cd "$BUILD" || exit 1

echo "Running CMake configure..."
cmake ..

echo "Building engine..."
cmake --build .

echo "Done."

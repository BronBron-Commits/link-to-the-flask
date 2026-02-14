cmake_minimum_required(VERSION 3.10)
project(GameEngine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)

# Include engine headers
include_directories(include include/renderer include/controls)

# Collect all .cpp files
file(GLOB_RECURSE SRC CONFIGURE_DEPENDS src/*.cpp)

if(NOT SRC)
    message(FATAL_ERROR "No source files found in src/")
endif()

# Create executable
add_executable(engine ${SRC})

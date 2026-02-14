cmake_minimum_required(VERSION 3.10)
project(GameEngine)

set(CMAKE_CXX_STANDARD 17)

file(GLOB_RECURSE SRC CONFIGURE_DEPENDS
    src/*.cpp
)

if(NOT SRC)
    message(FATAL_ERROR "No source files found in src/")
endif()

add_executable(engine ${SRC})

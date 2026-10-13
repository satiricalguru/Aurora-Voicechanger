cmake_minimum_required(VERSION 3.20)
project(aurora_core VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_VISIBILITY_PRESET hidden)
set(CMAKE_VISIBILITY_INLINES_HIDDEN ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()
if(NOT CMAKE_OSX_ARCHITECTURES)
  set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64")
endif()
set(CMAKE_OSX_DEPLOYMENT_TARGET 12.0)

add_compile_options(-Wall -Wextra -Wno-unused-parameter -fno-math-errno)

set(SOURCES src/engine.cpp src/graph.cpp)
set(FRAMEWORKS "-framework CoreAudio" "-framework CoreFoundation" "-framework Accelerate")

add_library(aurora_core SHARED ${SOURCES})
target_include_directories(aurora_core PUBLIC include)
target_link_libraries(aurora_core PRIVATE ${FRAMEWORKS})

# Offline tests and DSP benchmarks (no audio devices needed).
add_executable(aurora_bench tests/bench.cpp)
target_include_directories(aurora_bench PRIVATE include src)
target_link_libraries(aurora_bench PRIVATE aurora_core ${FRAMEWORKS})

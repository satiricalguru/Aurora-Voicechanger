cmake_minimum_required(VERSION 3.20)
project(aurora_core VERSION 0.1.0 LANGUAGES C CXX)

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

# Neural voices: ONNX Runtime headers at build time; the library is dlopen'ed
# at run time, so the engine still works where it is missing.
find_path(ORT_INCLUDE onnxruntime_c_api.h
  PATHS /opt/homebrew/opt/onnxruntime/include/onnxruntime /usr/local/opt/onnxruntime/include/onnxruntime
        ${CMAKE_SOURCE_DIR}/third_party/onnxruntime/include)
if(ORT_INCLUDE)
  message(STATUS "Neural voices enabled (ONNX Runtime headers: ${ORT_INCLUDE})")
  list(APPEND SOURCES src/neural/ort_model.cpp)
  add_compile_definitions(AURORA_NEURAL=1)
  include_directories(${ORT_INCLUDE})
else()
  message(STATUS "ONNX Runtime headers not found: neural voices disabled")
endif()
set(FRAMEWORKS "-framework CoreAudio" "-framework CoreFoundation" "-framework Accelerate")

# RNNoise 0.2 (BSD-3-Clause) for background-noise removal; see third_party/rnnoise.
file(GLOB RNNOISE_SOURCES third_party/rnnoise/src/*.c)
add_library(rnnoise STATIC ${RNNOISE_SOURCES})
target_include_directories(rnnoise PUBLIC third_party/rnnoise/include PRIVATE third_party/rnnoise/src)
target_compile_options(rnnoise PRIVATE -O3 -w)
set_target_properties(rnnoise PROPERTIES POSITION_INDEPENDENT_CODE ON C_VISIBILITY_PRESET hidden)

add_library(aurora_core SHARED ${SOURCES})
target_include_directories(aurora_core PUBLIC include)
target_link_libraries(aurora_core PRIVATE rnnoise ${FRAMEWORKS})

# Offline tests and DSP benchmarks (no audio devices needed).
add_executable(aurora_bench tests/bench.cpp)
target_include_directories(aurora_bench PRIVATE include src)
target_link_libraries(aurora_bench PRIVATE aurora_core rnnoise ${FRAMEWORKS})

# Device test: soundboard preview on the monitor output (needs BlackHole).
add_executable(aurora_monitor_probe tests/monitor_probe.cpp)
target_include_directories(aurora_monitor_probe PRIVATE include)
target_link_libraries(aurora_monitor_probe PRIVATE aurora_core ${FRAMEWORKS})

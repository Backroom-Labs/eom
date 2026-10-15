FILE(GLOB_RECURSE app_sources ${CMAKE_SOURCE_DIR}/src/*.*)
idf_component_register(
        SRCS ${app_sources}
        INCLUDE_DIRS "include"
        PRIV_REQUIRES "nvs_flash" "spiffs" "esp_driver_dac" "esp_adc" "led_strip" 
        # "hx711" "esp_idf_lib_helpers"
)


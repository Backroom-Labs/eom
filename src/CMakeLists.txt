FILE(GLOB_RECURSE app_sources ${CMAKE_SOURCE_DIR}/src/*.*)
idf_component_register(
        SRCS ${app_sources}
        INCLUDE_DIRS "include"
        EMBED_TXTFILES "${CMAKE_SOURCE_DIR}/data/config.json" "${CMAKE_SOURCE_DIR}/keys/ota_signing_pub.pem"
        PRIV_REQUIRES "nvs_flash" "spiffs" "esp_driver_dac" "esp_adc" "led_strip" "app_update" "esp_app_format" "mbedtls"
        # "hx711" "esp_idf_lib_helpers"
)


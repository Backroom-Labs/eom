#include "esp_app_desc.h"

// The version is set by PROJECT_VER in the top-level CMakeLists.txt and stored in the app
// descriptor, where OTA updates read it too.
extern const esp_app_desc_t esp_app_desc;

const char* EOM_VERSION = esp_app_desc.version;

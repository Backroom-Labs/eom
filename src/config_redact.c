#include "config_redact.h"

#include "cJSON.h"

static const char* const SECRET_KEYS[] = { "wifi_key", "ap_password" };

char* config_redact_json(const char* json) {
    cJSON* root = cJSON_Parse(json);
    if (root == NULL) return NULL;

    for (size_t i = 0; i < sizeof(SECRET_KEYS) / sizeof(SECRET_KEYS[0]); i++) {
        cJSON* item = cJSON_GetObjectItemCaseSensitive(root, SECRET_KEYS[i]);
        if (cJSON_IsString(item) && item->valuestring[0] != '\0') {
            cJSON_SetValuestring(item, "***");
        }
    }

    char* out = cJSON_Print(root);
    cJSON_Delete(root);
    return out;
}

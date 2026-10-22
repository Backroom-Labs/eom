#ifndef __config_redact_h
#define __config_redact_h

// A copy safe to log: a non-empty wifi_key or ap_password becomes "***", so it shows which are set.
// Free it with cJSON_free(). NULL if the input isn't valid JSON: log nothing, it may hold a password.
char* config_redact_json(const char* json);

#endif

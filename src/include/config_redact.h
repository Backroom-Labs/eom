#ifndef __config_redact_h
#define __config_redact_h

/**
 * @brief Copy of a config JSON document that is safe to write to the log.
 *
 * Non-empty `wifi_key` and `ap_password` values become "***"; empty ones stay empty, so the log
 * still shows whether a password is set. Everything else is kept. The input isn't changed.
 *
 * @return A new string to release with cJSON_free(), or NULL if the input isn't valid JSON (log
 *         nothing from it then: it may hold a password).
 */
char* config_redact_json(const char* json);

#endif

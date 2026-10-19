#include "api/broadcast.h"
#include "cJSON.h"
#include "config_defs.h"
#include "status_snapshot.h"
#include "system/websocket_handler.h"

void api_broadcast_config(void) {
    cJSON* payload = cJSON_CreateObject();
    cJSON* root = cJSON_AddObjectToObject(payload, "configList");

    config_to_json(root, &Config);

    websocket_broadcast(payload, WS_BROADCAST_SYSTEM);
    cJSON_Delete(payload);
}

void api_broadcast_readings(void) {
    cJSON* payload = cJSON_CreateObject();
    cJSON* root = cJSON_AddObjectToObject(payload, "readings");

    status_snapshot_t snapshot;
    status_snapshot_get(&snapshot);
    status_snapshot_to_json(&snapshot, root);

    websocket_broadcast(payload, WS_BROADCAST_READINGS);
    cJSON_Delete(payload);
}

void api_broadcast_network_status(void) {
    cJSON* payload = cJSON_CreateObject();
    cJSON* root = cJSON_AddObjectToObject(payload, "wifiStatus");

    // TODO: Actually get this from active connection
    cJSON_AddStringToObject(root, "ssid", Config.wifi_ssid);
    cJSON_AddStringToObject(root, "ip", "");
    cJSON_AddNumberToObject(root, "rssi", -1);

    websocket_broadcast(payload, WS_BROADCAST_SYSTEM);
    cJSON_Delete(payload);
}

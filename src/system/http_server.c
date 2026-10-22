#include "system/http_server.h"
#include "api/index.h"
#include "config.h"
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_https_server.h"
#include "esp_log.h"
#include "esp_system.h"
#include "system/websocket_handler.h"
#include "system/ws_ota.h"
#include "util/fs.h"
#include "esp_wifi.h"
#include <stdlib.h>

#define DEFAULT_CACERT_PATH "/spiffs/server.crt"
#define DEFAULT_PRVTKEY_PATH "/spiffs/server.key"

static const char* TAG = "http_server";
static httpd_handle_t _server = NULL;

// The UI is hosted externally (PWA / native app); the device only serves the WebSocket API.
static const httpd_uri_t routes[] = {
    {
        .uri = "/",
        .method = HTTP_GET,
        .handler = &websocket_handler,
        .user_ctx = NULL,
        .is_websocket = true,
        .handle_ws_control_frames = true,
    },
};

static void init_routes(httpd_handle_t server) {
    for (size_t i = 0; i < sizeof(routes) / sizeof(routes[0]); i++) {
        httpd_uri_t route = routes[i];
        ESP_LOGI(TAG, "* Route: %s", route.uri);
        httpd_register_uri_handler(server, &route);
    }
}

// Loads the TLS certificate and key from SPIFFS. Returns false (and frees anything loaded) if
// either is missing, so the caller can fall back to a plain ws:// server.
static bool load_ssl_credentials(httpd_ssl_config_t* ssl_config) {
    const char* cert_path =
        Config.ssl_servercert_path ? Config.ssl_servercert_path : DEFAULT_CACERT_PATH;
    const char* key_path = Config.ssl_prvtkey_path ? Config.ssl_prvtkey_path : DEFAULT_PRVTKEY_PATH;

    char* cert = NULL;
    char* key = NULL;
    size_t cert_len = fs_read_file(cert_path, &cert);
    size_t key_len = fs_read_file(key_path, &key);

    if (cert_len == 0 || key_len == 0) {
        free(cert);
        free(key);
        return false;
    }

    ssl_config->servercert = (const uint8_t*)cert;
    ssl_config->servercert_len = cert_len;
    ssl_config->prvtkey_pem = (const uint8_t*)key;
    ssl_config->prvtkey_len = key_len;
    return true;
}

static httpd_handle_t start_webserver(void) {
    esp_err_t err = ESP_OK;
    httpd_handle_t server = NULL;
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();

    if (Config.websocket_port > 0) {
        config.server_port = Config.websocket_port;
    }

    config.lru_purge_enable = true;

    // Open/Close callbacks
    config.open_fn = websocket_open_fd;
    config.close_fn = websocket_close_fd;

    httpd_ssl_config_t ssl_config = HTTPD_SSL_CONFIG_DEFAULT();
    bool use_ssl = Config.use_ssl && load_ssl_credentials(&ssl_config);

    if (Config.use_ssl && !use_ssl) {
        ESP_LOGW(
            TAG,
            "use_ssl is set but no certificate/key found on SPIFFS; falling back to plain ws://"
        );
    }

    if (use_ssl) {
        // The secure server listens on ssl_config.port_secure (443), not websocket_port.
        ESP_LOGI(
            TAG,
            "Starting SSL server on port: %d (%d bytes free)",
            ssl_config.port_secure,
            esp_get_free_heap_size()
        );
        ssl_config.httpd = config;
        err = httpd_ssl_start(&server, &ssl_config);
        // httpd_ssl_start copies the credentials, so the buffers can be released.
        free((void*)ssl_config.servercert);
        free((void*)ssl_config.prvtkey_pem);
    } else {
        ESP_LOGI(TAG, "Starting server on port: %d", config.server_port);
        err = httpd_start(&server, &config);
    }

    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Error starting server: %s", esp_err_to_name(err));
        return NULL;
    }

    ESP_LOGI(TAG, "Server started, registering routes.");
    init_routes(server);

    return server;
}

static void stop_webserver(httpd_handle_t server) {
    httpd_stop(server);
}

static void
connect_handler(void* arg, esp_event_base_t event_base, int32_t event_id, void* event_data) {
    httpd_handle_t* server = (httpd_handle_t*)arg;
    if (*server == NULL) {
        ESP_LOGI(TAG, "Starting webserver...");
        *server = start_webserver();
    }
}

static void
disconnect_handler(void* arg, esp_event_base_t event_base, int32_t event_id, void* event_data) {
    httpd_handle_t* server = (httpd_handle_t*)arg;
    if (*server) {
        ESP_LOGI(TAG, "Stopping webserver...");
        stop_webserver(*server);
        *server = NULL;
    }
}

esp_err_t http_server_init(void) {
    esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &connect_handler, &_server);
    esp_event_handler_register(WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED, &disconnect_handler, &_server);

    api_register_all();
    ws_ota_register();
    return ESP_OK;
}

esp_err_t http_server_connect(void) {
    _server = start_webserver();
    if (_server == NULL) {
        return ESP_FAIL;
    }
    return ESP_OK;
}

void http_server_disconnect(void) {
    stop_webserver(_server);
    _server = NULL;
}
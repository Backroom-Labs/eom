#include "system/ota.h"
#include "esp_app_desc.h"
#include "esp_app_format.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "freertos/FreeRTOS.h"
#include "mbedtls/pk.h"
#include "mbedtls/sha256.h"
#include "orgasm_control.h"
#include "sdkconfig.h"
#include <stdio.h>
#include <string.h>

#ifndef EOM_BOARD
#define EOM_BOARD "unknown"
#endif

static const char* TAG = "ota";

// Signature trailer appended to firmware.bin by tools/sign_firmware.py:
// magic | signature length (uint16 LE) | DER ECDSA P-256 signature of the image's SHA-256 | padding
#define OTA_SIG_MAGIC "EOMSIG1"
#define OTA_SIG_MAGIC_LEN 8 // including the terminating NUL
#define OTA_SIG_TRAILER_LEN 128

// keys/ota_signing_pub.pem, from tools/gen_signing_keys.py
extern const uint8_t ota_signing_pub_pem_start[] asm("_binary_ota_signing_pub_pem_start");
extern const uint8_t ota_signing_pub_pem_end[] asm("_binary_ota_signing_pub_pem_end");

// Referenced in check_header(), which also keeps the linker from discarding it.
const __attribute__((section(".rodata_custom_desc"))) eom_app_desc_t eom_app_desc = {
    .magic = EOM_APP_DESC_MAGIC,
    .board = EOM_BOARD,
};
_Static_assert(sizeof(EOM_BOARD) <= sizeof(eom_app_desc.board), "EOM_BOARD name is too long");

// Everything up to the end of eom_app_desc, which is all check_header() needs.
#define HEADER_LEN                                                                                 \
    (sizeof(esp_image_header_t) + sizeof(esp_image_segment_header_t) + sizeof(esp_app_desc_t) +   \
     sizeof(eom_app_desc_t))

static portMUX_TYPE s_lock = portMUX_INITIALIZER_UNLOCKED;
static ota_state_t s_state = OTA_STATE_IDLE;

static struct {
    const esp_partition_t* partition;
    esp_ota_handle_t handle;
    mbedtls_sha256_context sha; // of the image, excluding the signature trailer
    uint8_t trailer[OTA_SIG_TRAILER_LEN];
    bool allow_downgrade;
    size_t image_size;
    size_t bytes_written;
    uint8_t header[HEADER_LEN];
    bool header_checked;
} s_ota;

const char* ota_get_board(void) {
    return eom_app_desc.board;
}

bool ota_firmware_confirmed(void) {
    esp_ota_img_states_t state;
    return esp_ota_get_state_partition(esp_ota_get_running_partition(), &state) != ESP_OK ||
           state != ESP_OTA_IMG_PENDING_VERIFY;
}

size_t ota_max_image_size(void) {
    const esp_partition_t* next = esp_ota_get_next_update_partition(NULL);
    return next != NULL ? next->size : 0;
}

ota_status_t ota_get_status(void) {
    taskENTER_CRITICAL(&s_lock);
    ota_status_t status = {
        .state = s_state,
        .bytes_written = s_ota.bytes_written,
        .image_size = s_ota.image_size,
    };
    taskEXIT_CRITICAL(&s_lock);
    return status;
}

static void set_state(ota_state_t state) {
    taskENTER_CRITICAL(&s_lock);
    s_state = state;
    taskEXIT_CRITICAL(&s_lock);
}

// Returns <0, 0, >0 like strcmp. Versions that aren't major.minor.patch compare as equal.
static int compare_versions(const char* a, const char* b) {
    unsigned a1, a2, a3, b1, b2, b3;
    if (sscanf(a, "%u.%u.%u", &a1, &a2, &a3) != 3 || sscanf(b, "%u.%u.%u", &b1, &b2, &b3) != 3) {
        return 0;
    }
    if (a1 != b1) return a1 < b1 ? -1 : 1;
    if (a2 != b2) return a2 < b2 ? -1 : 1;
    if (a3 != b3) return a3 < b3 ? -1 : 1;
    return 0;
}

// Rejects images for another chip, another project, another board, or (unless allowed) an older
// version. The signature can only be checked at the end, by verify_signature().
static esp_err_t check_header(void) {
    const esp_image_header_t* image = (const esp_image_header_t*)s_ota.header;
    const esp_app_desc_t* app =
        (const esp_app_desc_t*)(s_ota.header + sizeof(esp_image_header_t) +
                                sizeof(esp_image_segment_header_t));
    const eom_app_desc_t* eom = (const eom_app_desc_t*)(app + 1);
    const esp_app_desc_t* running = esp_app_get_description();

    if (image->magic != ESP_IMAGE_HEADER_MAGIC || app->magic_word != ESP_APP_DESC_MAGIC_WORD) {
        ESP_LOGE(TAG, "Not an ESP-IDF app image");
        return ESP_ERR_OTA_VALIDATE_FAILED;
    }
    if (image->chip_id != CONFIG_IDF_FIRMWARE_CHIP_ID) {
        ESP_LOGE(TAG, "Image is for chip id %d, this is %d", image->chip_id, CONFIG_IDF_FIRMWARE_CHIP_ID);
        return ESP_ERR_OTA_VALIDATE_FAILED;
    }
    if (strncmp(app->project_name, running->project_name, sizeof(app->project_name)) != 0) {
        ESP_LOGE(TAG, "Image is for project '%.32s'", app->project_name);
        return ESP_ERR_OTA_VALIDATE_FAILED;
    }
    if (eom->magic != EOM_APP_DESC_MAGIC ||
        strncmp(eom->board, eom_app_desc.board, sizeof(eom->board)) != 0) {
        ESP_LOGE(
            TAG,
            "Image is for board '%.32s', this is '%s'",
            eom->magic == EOM_APP_DESC_MAGIC ? eom->board : "unknown",
            eom_app_desc.board
        );
        return ESP_ERR_OTA_VALIDATE_FAILED;
    }
    if (!s_ota.allow_downgrade && compare_versions(app->version, running->version) < 0) {
        ESP_LOGE(TAG, "Refusing downgrade from %s to %.32s", running->version, app->version);
        return ESP_ERR_INVALID_VERSION;
    }

    ESP_LOGI(TAG, "Installing version %.32s (running %s)", app->version, running->version);
    return ESP_OK;
}

static void cleanup(void) {
    mbedtls_sha256_free(&s_ota.sha);
    s_ota.handle = 0;
    set_state(OTA_STATE_IDLE);
}

void ota_abort(void) {
    if (ota_get_status().state != OTA_STATE_RECEIVING) {
        return;
    }
    ESP_LOGW(TAG, "Update aborted after %zu of %zu bytes", s_ota.bytes_written, s_ota.image_size);
    esp_ota_abort(s_ota.handle);
    cleanup();
}

// Checks the trailer's signature over the image hash with the public key built into this firmware.
static esp_err_t verify_signature(const uint8_t hash[32]) {
    const uint8_t* trailer = s_ota.trailer;
    if (memcmp(trailer, OTA_SIG_MAGIC, OTA_SIG_MAGIC_LEN) != 0) {
        ESP_LOGE(TAG, "Image isn't signed");
        return ESP_ERR_OTA_VALIDATE_FAILED;
    }
    size_t sig_len = trailer[OTA_SIG_MAGIC_LEN] | (trailer[OTA_SIG_MAGIC_LEN + 1] << 8);
    const uint8_t* sig = trailer + OTA_SIG_MAGIC_LEN + 2;
    if (sig_len == 0 || sig_len > OTA_SIG_TRAILER_LEN - OTA_SIG_MAGIC_LEN - 2) {
        ESP_LOGE(TAG, "Malformed signature");
        return ESP_ERR_OTA_VALIDATE_FAILED;
    }

    mbedtls_pk_context key;
    mbedtls_pk_init(&key);
    // EMBED_TXTFILES NUL-terminates the PEM, and the parser wants that NUL counted in the length.
    int ret = mbedtls_pk_parse_public_key(
        &key, ota_signing_pub_pem_start, ota_signing_pub_pem_end - ota_signing_pub_pem_start
    );
    if (ret == 0) {
        ret = mbedtls_pk_verify(&key, MBEDTLS_MD_SHA256, hash, 32, sig, sig_len);
    }
    mbedtls_pk_free(&key);

    if (ret != 0) {
        ESP_LOGE(TAG, "Signature verification failed (-0x%04x)", -ret);
        return ESP_ERR_OTA_VALIDATE_FAILED;
    }
    return ESP_OK;
}

esp_err_t ota_begin(size_t image_size, bool allow_downgrade) {
    taskENTER_CRITICAL(&s_lock);
    bool busy = s_state != OTA_STATE_IDLE;
    if (!busy) s_state = OTA_STATE_RECEIVING;
    taskEXIT_CRITICAL(&s_lock);

    if (busy) {
        ESP_LOGE(TAG, "An update is already in progress");
        return ESP_ERR_INVALID_STATE;
    }

    // Updating before this image has passed its boot health check would lose the rollback target.
    esp_ota_img_states_t running_state;
    if (esp_ota_get_state_partition(esp_ota_get_running_partition(), &running_state) == ESP_OK &&
        running_state == ESP_OTA_IMG_PENDING_VERIFY) {
        ESP_LOGE(TAG, "Current firmware hasn't been confirmed yet, try again shortly");
        set_state(OTA_STATE_IDLE);
        return ESP_ERR_INVALID_STATE;
    }

    const esp_partition_t* partition = esp_ota_get_next_update_partition(NULL);
    if (partition == NULL) {
        ESP_LOGE(TAG, "No OTA partition available");
        set_state(OTA_STATE_IDLE);
        return ESP_ERR_NOT_FOUND;
    }
    if (image_size < HEADER_LEN + OTA_SIG_TRAILER_LEN || image_size > partition->size) {
        ESP_LOGE(TAG, "Image size %zu doesn't fit partition (%" PRIu32 " bytes)", image_size, partition->size);
        set_state(OTA_STATE_IDLE);
        return ESP_ERR_INVALID_SIZE;
    }

    // Never leave the motor running while the device is busy updating and then restarting.
    orgasm_control_set_output_mode(OC_MANUAL);
    orgasm_control_set_pleasure(0);

    memset(&s_ota, 0, sizeof(s_ota));
    s_ota.partition = partition;
    s_ota.image_size = image_size;
    s_ota.allow_downgrade = allow_downgrade;

    ESP_LOGI(
        TAG,
        "Erasing %s at 0x%08" PRIx32 " for a %zu byte image",
        partition->label,
        partition->address,
        image_size
    );
    esp_err_t err = esp_ota_begin(partition, image_size, &s_ota.handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_begin failed: %s", esp_err_to_name(err));
        set_state(OTA_STATE_IDLE);
        return err;
    }

    mbedtls_sha256_init(&s_ota.sha);
    mbedtls_sha256_starts(&s_ota.sha, 0);
    return ESP_OK;
}

esp_err_t ota_write(const void* data, size_t len) {
    if (ota_get_status().state != OTA_STATE_RECEIVING) {
        return ESP_ERR_INVALID_STATE;
    }
    if (len > s_ota.image_size - s_ota.bytes_written) {
        ESP_LOGE(TAG, "Received more data than the announced %zu bytes", s_ota.image_size);
        ota_abort();
        return ESP_ERR_INVALID_SIZE;
    }

    if (!s_ota.header_checked) {
        size_t n = HEADER_LEN - s_ota.bytes_written;
        if (n > len) n = len;
        memcpy(s_ota.header + s_ota.bytes_written, data, n);

        if (s_ota.bytes_written + n == HEADER_LEN) {
            esp_err_t err = check_header();
            if (err != ESP_OK) {
                ota_abort();
                return err;
            }
            s_ota.header_checked = true;
        }
    }

    esp_err_t err = esp_ota_write(s_ota.handle, data, len);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_write failed: %s", esp_err_to_name(err));
        ota_abort();
        return err;
    }

    // Hash the image, and set aside the trailer (which is written too; the bootloader ignores it).
    size_t image_len = s_ota.image_size - OTA_SIG_TRAILER_LEN;
    size_t hash_len = 0;
    if (s_ota.bytes_written < image_len) {
        hash_len = image_len - s_ota.bytes_written;
        if (hash_len > len) hash_len = len;
        mbedtls_sha256_update(&s_ota.sha, data, hash_len);
    }
    if (hash_len < len) {
        size_t offset = s_ota.bytes_written + hash_len - image_len;
        memcpy(s_ota.trailer + offset, (const uint8_t*)data + hash_len, len - hash_len);
    }

    taskENTER_CRITICAL(&s_lock);
    s_ota.bytes_written += len;
    taskEXIT_CRITICAL(&s_lock);
    return ESP_OK;
}

esp_err_t ota_end(void) {
    if (ota_get_status().state != OTA_STATE_RECEIVING) {
        return ESP_ERR_INVALID_STATE;
    }
    if (s_ota.bytes_written != s_ota.image_size) {
        ESP_LOGE(TAG, "Image incomplete: %zu of %zu bytes", s_ota.bytes_written, s_ota.image_size);
        ota_abort();
        return ESP_ERR_INVALID_SIZE;
    }

    uint8_t hash[32];
    mbedtls_sha256_finish(&s_ota.sha, hash);
    esp_err_t err = verify_signature(hash);
    if (err != ESP_OK) {
        ota_abort();
        return err;
    }

    // Validates the app image format and checksums. The handle is released even if this fails.
    err = esp_ota_end(s_ota.handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Image verification failed: %s", esp_err_to_name(err));
        cleanup();
        return err;
    }

    err = esp_ota_set_boot_partition(s_ota.partition);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_ota_set_boot_partition failed: %s", esp_err_to_name(err));
        cleanup();
        return err;
    }

    mbedtls_sha256_free(&s_ota.sha);
    set_state(OTA_STATE_READY_TO_REBOOT);
    ESP_LOGI(TAG, "Update installed to %s, restart to run it", s_ota.partition->label);
    return ESP_OK;
}

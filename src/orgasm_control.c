#include "orgasm_control.h"
#include "config.h"
#include "eom-hal-esp32.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "heart_rate.h"
#include "safety.h"
#include "status_snapshot.h"
#include "system/websocket_handler.h"
#include "util/running_average.h"
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

static const char* TAG = "orgasm_control";

// Read only here, mostly to fill the status snapshot.
static uint16_t orgasm_control_get_arousal(void);
static uint16_t orgasm_control_get_last_pressure(void);
static uint16_t orgasm_control_get_average_pressure(void);
static uint16_t orgasm_control_get_arousal_threshold(void);
static uint8_t orgasm_control_get_orgasm_count(void);
static uint8_t orgasm_control_get_arousal_sensitivity(void);
static uint8_t orgasm_control_get_cooldown(void);
static uint16_t orgasm_control_get_permit_orgasm_remaining_seconds(void);
static oc_bool_t orgasm_control_is_menu_locked(void);
static oc_after_orgasm_phase_t orgasm_control_get_after_orgasm_phase(void);
static uint8_t orgasm_control_get_session_orgasms(void);
static uint16_t orgasm_control_get_rest_remaining_seconds(void);
static uint16_t orgasm_control_get_baseline(void);
static uint32_t orgasm_control_get_raw_pressure(uint16_t* out, uint8_t n);
static bool orgasm_control_is_hr_waiting(void);
static bool orgasm_control_is_hr_edge_zone(void);
static void publish_status_snapshot(void);

static const char* orgasm_output_mode_str[] = {
    "MANUAL",
    "ENDLESS",
    "ORGASM",
};

static struct {
    unsigned long last_update_ms;
    running_average_t* average;
    uint16_t last_value;
    uint16_t pressure_value;
    uint16_t peak_start;
    uint16_t arousal;
    uint8_t update_flag;
    unsigned long cooldown;
    float memory; // slowly fading copy of recent arousal peaks (Config.arousal_memory_s)
} arousal_state;

// The last RAW_PRESSURE_LEN raw pressure readings, one per update, for detailed recording in the
// app. raw_seq counts every reading since boot; the newest is raw_buf[(raw_seq - 1) % LEN].
#define RAW_PRESSURE_LEN 32
static uint16_t raw_buf[RAW_PRESSURE_LEN];
static uint32_t raw_seq = 0;
static portMUX_TYPE raw_lock = portMUX_INITIALIZER_UNLOCKED;

static struct {
    orgasm_output_mode_t output_mode;
    vibration_mode_t vibration_mode;
    unsigned long motor_stop_time;
    unsigned long motor_start_time;
    unsigned long edge_time_out; // 10000?
    unsigned long random_additional_delay;
    int twitch_count;
    uint8_t control_motor;
    uint8_t prev_control_motor;
    float pleasure;
} output_state;

static struct {
    // File Writer
    unsigned long recording_start_ms;
    FILE* logfile;
} logger_state;

static struct {
    //  Post Orgasm Clench variables
    long clench_pressure_threshold; //  4096?
    int clench_duration;

    // Autoedging Time and Post-Orgasm varables
    unsigned long auto_edging_start_millis;
    unsigned long post_orgasm_start_millis;
    unsigned long post_orgasm_duration_millis;
    unsigned long clench_start_millis;
    long clench_duration_millis;
    oc_bool_t menu_is_locked;
    oc_bool_t detected_orgasm;
    int post_orgasm_duration_seconds;

    // After-orgasm modes (Config.after_orgasm)
    uint8_t session_orgasms;
    unsigned long rest_start_millis; // Milking rest between rounds, 0 when not resting
    oc_bool_t ruined;
} post_orgasm_state;

// Resting pressure, followed slowly so drift can be told apart from clenches.
static struct {
    float baseline; // < 0 until the first reading
    unsigned long elevated_since_ms; // when pressure rose above the resting band, 0 if not above
} baseline_state = { .baseline = -1 };

// Heart-rate features (Config.hr_*). Each falls back to pressure-only behaviour while
// heart_rate_get() is 0.
#define HR_ORGASM_DROP_WINDOW_MS (30 * 1000)
static struct {
    uint8_t peak_since_edge; // highest heart rate since the last edge, for hr_recovery_bpm
    bool waiting;            // cooldown held until the heart rate recovers
    uint8_t orgasm_peak;     // Orgasm mode, once permitted: recent peak, for hr_orgasm_drop_bpm
    unsigned long orgasm_peak_ms;
} hr_state = { 0 };

volatile static struct {
    uint8_t orgasm_count;
    //event_handler_node_t* _h_orgasm;
} orgasm_state = { 0 };

// Orgasm mode rounds (Config.orgasm_chance). A round ends when its edging time or denial target is
// reached, with one roll: won, an orgasm is permitted; lost, it's a denial and a new round starts.
static struct {
    unsigned long start_millis;
    uint8_t denials;        // denials this round, for Config.max_denied
    bool won;
    uint8_t chance_denials; // lost rolls since Orgasm mode started
} round_state;

// static void _evt_orgasm_start(
//     const char* evt, EVENT_HANDLER_ARG_TYPE eap, int eai, EVENT_HANDLER_ARG_TYPE hap
// ) {
//     if ( orgasm_control_is_permit_orgasm_reached() ) {
//         post_orgasm_state.detected_orgasm = ocTRUE;
//     }
//     //orgasm_state.orgasm_count += 1;
// }

// Sets variable to value, flagging an update if it changed. value is evaluated once: it is often a
// call with side effects, such as a vibration mode's increment().
#define update_check(variable, value)                                                              \
    {                                                                                              \
        __typeof__(variable) update_check_value = (value);                                         \
        if (variable != update_check_value) {                                                      \
            ESP_LOGD(TAG, "updated: %s = %s", #variable, #value);                                  \
            variable = update_check_value;                                                         \
            arousal_state.update_flag = ocTRUE;                                                    \
        }                                                                                          \
    }
static uint8_t orgasm_control_get_orgasm_count(void) {
    return orgasm_state.orgasm_count;
}
static uint8_t orgasm_control_get_arousal_sensitivity(void) {
    return Config.sensor_sensitivity;
}


/**
 * @brief Simplified method to set pleasure, which also handles broadcasting the event.
 * @param pleasure pleasure value
 * @param use_motor Whether to actually control the motor hardware (defaults to true)
 */
void orgasm_control_set_pleasure_ex(uint8_t pleasure, bool use_motor) {
    if (pleasure > Config.max_pleasure) pleasure = Config.max_pleasure;
    if (pleasure > Config.max_motor_output) pleasure = Config.max_motor_output;
    if (pleasure > 0) {
        safety_clear();
        post_orgasm_state.ruined = ocFALSE;
    }

    if (use_motor) {
        #if MOTOR1_ENABLED
        eom_hal_set_motor1_speed((uint8_t) pleasure);
        #endif
        #if MOTOR2_ENABLED
        eom_hal_set_motor2_speed((uint8_t) pleasure);
        #endif
    }

    // Only track externally-set pleasure in manual mode; in automatic modes the
    // vibration controller owns output_state.pleasure.
    if (output_state.output_mode == OC_MANUAL) {
        output_state.pleasure = pleasure;
    }
}

/**
 * @brief Convenience wrapper that calls orgasm_control_set_pleasure_ex with control_motor=true
 * @param pleasure pleasure value
 */
void orgasm_control_set_pleasure(uint8_t pleasure) {
    orgasm_control_set_pleasure_ex(pleasure, true);
}

void orgasm_control_set_motor2(uint8_t speed) {
    if (speed > Config.max_pleasure) speed = Config.max_pleasure;
    if (speed > Config.max_motor_output) speed = Config.max_motor_output;
    #if MOTOR2_ENABLED
    eom_hal_set_motor2_speed(speed);
    #endif
}

void orgasm_control_init(void) {
    eom_hal_init_pressure_sensor();
    ESP_LOGI(TAG, "Pressure sensor initialized.");
    output_state.output_mode = OC_MANUAL;
    output_state.vibration_mode = Config.vibration_mode;
    output_state.edge_time_out = 10000;
    post_orgasm_state.clench_pressure_threshold = 4096;    
    arousal_state.cooldown = 0; 

    running_average_init(&arousal_state.average, Config.pressure_smoothing);
    ESP_LOGI(TAG, "Running average initialized with window size %d.", Config.pressure_smoothing);
    orgasm_state.orgasm_count = 0;  
    // if (orgasm_state._h_orgasm == NULL) {
    //     orgasm_state._h_orgasm =
    //         event_manager_register_handler(EVT_ORGASM_START, &_evt_orgasm_start, NULL);
    // }
}

static const vibration_mode_controller_t* get_vibration_mode_controller() {
    switch (Config.vibration_mode) {
    case Enhancement: return &EnhancementController;

    default:
    case Depletion: return &DepletionController;

    case Pattern: return &PatternController;

    case RampStop: return &RampStopController;
    }
}

/**
 * Follow the resting pressure. Falls are followed quickly, small changes slowly (drift). Pressure
 * above the resting band is a clench or a peak and barely moves the baseline, unless it stays up
 * longer than any clench (max_clench_duration_ms): then it's drift too.
 */
static void orgasm_control_update_baseline(long p) {
    unsigned long now = esp_timer_get_time() / 1000UL;
    float hz = Config.update_frequency_hz > 0 ? Config.update_frequency_hz : 50;
    float b = baseline_state.baseline;
    if (b < 0) {
        baseline_state.baseline = p;
        return;
    }

    float tau_s;
    if (p < b) {
        tau_s = 2;
        baseline_state.elevated_since_ms = 0;
    } else if (p <= b + Config.clench_pressure_sensitivity / 2) {
        tau_s = 20;
        baseline_state.elevated_since_ms = 0;
    } else {
        if (baseline_state.elevated_since_ms == 0) baseline_state.elevated_since_ms = now;
        tau_s = now - baseline_state.elevated_since_ms > (unsigned long)Config.max_clench_duration_ms ? 5 : 300;
    }
    b += (p - b) / (tau_s * hz);
    baseline_state.baseline = b < 0 ? 0 : b;
}

/**
 * The edge threshold, lowered by hr_edge_sensitivity percent while the heart rate is at or above
 * hr_edge_bpm, so edges are caught earlier close to the limit.
 */
static int orgasm_control_edge_threshold(void) {
    uint8_t hr = heart_rate_get();
    if (Config.hr_edge_bpm > 0 && hr >= Config.hr_edge_bpm && Config.hr_edge_sensitivity < 100) {
        return Config.sensitivity_threshold * (100 - Config.hr_edge_sensitivity) / 100;
    }
    return Config.sensitivity_threshold;
}

static bool orgasm_control_is_hr_edge_zone(void) {
    return orgasm_control_edge_threshold() < Config.sensitivity_threshold;
}

static bool orgasm_control_is_hr_waiting(void) {
    return hr_state.waiting;
}

/**
 * Once edge_delay has passed, keep the cooldown going until the heart rate has dropped
 * hr_recovery_bpm below its peak since the edge, for at most hr_recovery_max_s after the edge.
 * Returns the ms of cooldown to keep, 0 when it's over.
 */
static unsigned long orgasm_control_hr_recovery_hold(unsigned long since_stop_ms) {
    uint8_t hr = heart_rate_get();
    unsigned long max_ms = Config.hr_recovery_max_s * 1000UL;
    if (Config.hr_recovery_bpm == 0 || hr == 0 || output_state.motor_stop_time == 0 || since_stop_ms >= max_ms) {
        return 0;
    }
    if (hr > hr_state.peak_since_edge) hr_state.peak_since_edge = hr;
    if (hr + Config.hr_recovery_bpm <= hr_state.peak_since_edge) return 0;
    return max_ms - since_stop_ms;
}

/**
 * Orgasm mode, once permitted: an orgasm without a detected clench shows as the heart rate
 * falling hr_orgasm_drop_bpm within HR_ORGASM_DROP_WINDOW_MS of its peak, while still stimulated.
 */
static void orgasm_control_hr_orgasm_detect(void) {
    uint8_t hr = heart_rate_get();
    unsigned long now = esp_timer_get_time() / 1000UL;
    if (Config.hr_orgasm_drop_bpm == 0 || hr == 0) {
        hr_state.orgasm_peak = 0;
        return;
    }
    if (hr >= hr_state.orgasm_peak || now - hr_state.orgasm_peak_ms > HR_ORGASM_DROP_WINDOW_MS) {
        hr_state.orgasm_peak = hr;
        hr_state.orgasm_peak_ms = now;
        return;
    }
    bool high_enough = Config.hr_orgasm_min_bpm == 0 || hr_state.orgasm_peak >= Config.hr_orgasm_min_bpm;
    if (high_enough && hr + Config.hr_orgasm_drop_bpm <= hr_state.orgasm_peak && output_state.pleasure > 0) {
        ESP_LOGI(TAG, "Orgasm detected from heart rate: %d -> %d bpm", hr_state.orgasm_peak, hr);
        post_orgasm_state.detected_orgasm = ocTRUE;
        hr_state.orgasm_peak = 0;
    }
}

/**
 * Main orgasm detection / edging algorithm happens here.
 * This happens with a default update frequency of 50Hz.
 */
static void orgasm_control_update_arousal() {
    float hz = Config.update_frequency_hz > 0 ? Config.update_frequency_hz : 50;

    // Decay stale arousal: halve every arousal_fade_ms. Truncating, like the old fixed `* 0.99`,
    // so the default (1400 ms at 50 Hz) behaves the same and it always reaches 0.
    float fade_ms = Config.arousal_fade_ms > 0 ? Config.arousal_fade_ms : 1400;
    float keep = powf(0.5f, 1000.0f / hz / fade_ms);
    update_check(arousal_state.arousal, (uint16_t)(arousal_state.arousal * keep));

    // Arousal memory: follow peaks at once, fade with a half-life of arousal_memory_s, and keep
    // arousal at least at that level, capped below the edge threshold so it can't edge by itself.
    if (Config.arousal_memory_s > 0) {
        if (arousal_state.arousal > arousal_state.memory) {
            arousal_state.memory = arousal_state.arousal;
        } else {
            arousal_state.memory *= powf(0.5f, 1.0f / hz / Config.arousal_memory_s);
        }
        float cap = Config.mid_threshold < Config.sensitivity_threshold ? Config.mid_threshold
                                                                         : Config.sensitivity_threshold * 0.9f;
        uint16_t floor = (uint16_t)fminf(arousal_state.memory, cap);
        if (arousal_state.arousal < floor) update_check(arousal_state.arousal, floor);
    } else {
        arousal_state.memory = 0;
    }

    // Acquire new pressure and take average:
    arousal_state.pressure_value = eom_hal_get_pressure_reading();
    portENTER_CRITICAL(&raw_lock);
    raw_buf[raw_seq % RAW_PRESSURE_LEN] = arousal_state.pressure_value;
    raw_seq++;
    portEXIT_CRITICAL(&raw_lock);
    running_average_set_window(arousal_state.average, Config.pressure_smoothing);
    running_average_add_value(arousal_state.average, arousal_state.pressure_value);
    long p_avg = running_average_get_average(arousal_state.average);
    long p_check = Config.use_average_values ? p_avg : arousal_state.pressure_value;

    // Increment arousal
    if (p_check < arousal_state.last_value) {                      // falling edge of peak
        if (arousal_state.last_value > arousal_state.peak_start) { // first tick past peak?
            if (arousal_state.last_value - arousal_state.peak_start >= Config.sensitivity_threshold / 10) { // big peak

                update_check(
                    arousal_state.arousal,
                    arousal_state.arousal + (arousal_state.last_value - arousal_state.peak_start)
                );

                arousal_state.peak_start = p_check;
            }
        }

        if (p_check < arousal_state.peak_start) {
            // run this value down to a new minimum after a peak detected.
            arousal_state.peak_start = p_check;
        }
    }

    arousal_state.last_value = p_check;

    orgasm_control_update_baseline(p_check);

    long clench_duration;
    clench_duration = orgasm_control_clench_detect(p_check);
    if (Config.clench_detector_in_edging) {
        if (clench_duration > Config.clench_time_threshold_ms &&
                clench_duration < Config.max_clench_duration_ms) {
            arousal_state.arousal += 5;  //why 5?
            arousal_state.update_flag = ocTRUE;
        }
    }

    // Update accessories:
    if (arousal_state.update_flag) {
        //event_manager_dispatch(EVT_AROUSAL_CHANGE, NULL, arousal_state.arousal);
        //bluetooth_driver_broadcast_arousal(arousal_state.arousal);
        //websocket_driver_broadcast_arousal(arousal_state.arousal);

        // Update LED for Arousal Color
        // if (output_state.output_mode == OC_AUTOMATIC) {
        //     float arousal_perc = orgasm_control_get_arousal_percent() * 255.0f;
        //     if (arousal_perc > 255.0f) arousal_perc = 255.0f;
        //     eom_hal_set_encoder_rgb(arousal_perc, 255 - arousal_perc, 0);
        // }
    }
}

// LED while no automatic mode is running: flashing blue until the UI connects (BLE or
// WebSocket), then solid green. The automatic modes set their own colors.
static void orgasm_control_update_idle_led() {
    if (LED_TYPE != LED_TYPE_WS2812) return;

    if (safety_get_stop_reason() == SAFETY_SENSOR_FAULT) {
        // Fast red flash until a mode is started again.
        eom_hal_set_led_flash_interval(150);
        eom_hal_set_led_flashing(1);
        eom_hal_set_rgb_color(&rgb_red);
    } else if (isConnected || websocket_client_count() > 0) {
        eom_hal_set_led_flashing(0);
        eom_hal_set_rgb_color(&rgb_green);
    } else {
        eom_hal_set_led_flash_interval(500);
        eom_hal_set_led_flashing(1);
        eom_hal_set_rgb_color(&rgb_blue);
    }
}

static void orgasm_control_deny(const vibration_mode_controller_t* controller) {
    output_state.pleasure = controller->stop();
    output_state.motor_stop_time = (esp_timer_get_time() / 1000UL);
    output_state.motor_start_time = 0;
    arousal_state.update_flag = ocTRUE;
    arousal_state.cooldown = (Config.edge_delay * 1000) + output_state.random_additional_delay;  //calculate cooldown
    // Saturating, so many rounds can't wrap the count back to 0.
    if (orgasm_state.orgasm_count < UINT8_MAX) orgasm_state.orgasm_count += 1;
    if (round_state.denials < UINT8_MAX) round_state.denials += 1;
    hr_state.peak_since_edge = heart_rate_get();
    ESP_LOGI(TAG, "Orgasm Denied! Total: %d", orgasm_state.orgasm_count);
    if (Config.max_additional_delay  != 0) {
        output_state.random_additional_delay = random() % (Config.max_additional_delay * 1000);
    }
}

static void orgasm_control_start_round(void) {
    round_state.start_millis = (esp_timer_get_time() / 1000UL);
    round_state.denials = 0;
    round_state.won = false;
}

static bool orgasm_control_is_round_target_reached(void) {
    return (esp_timer_get_time() / 1000UL) >
               round_state.start_millis + (Config.auto_edging_duration_minutes * 60 * 1000) ||
           (Config.max_denied > 0 && Config.max_denied < 100 && round_state.denials > Config.max_denied);
}

// Rolls once per round, when its target is reached. A lost roll counts as the next round's first
// denial, so that round permits after max_denied more.
static void orgasm_control_update_round(void) {
    if (output_state.output_mode != OC_ORGASM || round_state.won || !orgasm_control_is_round_target_reached()) {
        return;
    }
    arousal_state.update_flag = ocTRUE;
    if (esp_random() % 100 < Config.orgasm_chance) {
        round_state.won = true;
        return;
    }
    ESP_LOGI(TAG, "Denied by chance (%d%%)", Config.orgasm_chance);
    if (round_state.chance_denials < UINT8_MAX) round_state.chance_denials++;
    orgasm_control_start_round();
    orgasm_control_deny(get_vibration_mode_controller());
}

static void orgasm_control_update_pleasure() {
    if (!output_state.control_motor) {
        orgasm_control_update_idle_led();
        return;
    }

    // After an orgasm, orgasm_control_update_edging_time() owns the output.
    if (orgasm_control_is_post_orgasm_reached() || post_orgasm_state.rest_start_millis > 0) {
        return;
    }

    const vibration_mode_controller_t* controller = get_vibration_mode_controller();
    controller->tick(output_state.pleasure, arousal_state.arousal);

    // Calculate timeout delay
    long on_time = (esp_timer_get_time() / 1000UL) - output_state.motor_start_time;

    //check if its been long enough since motor stopped
    unsigned long since_stop = (esp_timer_get_time() / 1000UL) - output_state.motor_stop_time;
    if (since_stop > (Config.edge_delay * 1000) + output_state.random_additional_delay) {
        // Then wait for the heart rate to settle, if hr_recovery_bpm is on.
        arousal_state.cooldown = orgasm_control_hr_recovery_hold(since_stop);
        update_check(hr_state.waiting, arousal_state.cooldown > 0);
    } else {
        arousal_state.cooldown = (Config.edge_delay * 1000) + output_state.random_additional_delay - 
                                   ((esp_timer_get_time() / 1000UL) - output_state.motor_stop_time);
    }

    if (arousal_state.cooldown > 0) {
        // It hasn't been long enough since the pleasure stopped
        orgasm_control_twitch_detect();  //if still aroused restart the cooldown timeout counter until arousal is below threshold

    } else if (arousal_state.arousal > orgasm_control_edge_threshold() &&
               output_state.pleasure > 0 && on_time > (Config.minimum_on_time * 1000)) {
        // EDGE DETECTED
        // We're not already in timeout, but arousal is high enough to stop the pleasure
        if (!orgasm_control_is_permit_orgasm_reached()) {
            orgasm_control_deny(controller);
        } else {
            ESP_LOGI(TAG,"EDGE DETECTED BUT ORGASM PERMITTED");
        }

        //event_manager_dispatch(EVT_ORGASM_DENIAL, NULL, 0);
        eom_hal_set_rgb_color(&rgb_red); // Red over threshold
        eom_hal_set_led_flashing(1);
        // If Max Additional Delay is not disabled, caculate a new delay for the next time pleasure is stopped

    } else if (output_state.pleasure == 0 && output_state.motor_start_time == 0) {
        // the timeout is over and motor is stopped
        // its time to start again
        output_state.pleasure = controller->start();
        output_state.motor_start_time = (esp_timer_get_time() / 1000UL);
        output_state.random_additional_delay = 0;
        arousal_state.update_flag = ocTRUE;
        if (LED_TYPE == LED_TYPE_MONO ) {
            eom_hal_set_led_flash_interval(2000);
        } else {
            eom_hal_set_led_flashing(0);
        }
        if (isConnected) {
            eom_hal_set_rgb_color(&rgb_green); // Green when starting
        } else {
            eom_hal_set_rgb_color(&rgb_purple); // Purple when starting unconnected
        }
        ESP_LOGI(TAG, "Starting cycle: %d", orgasm_state.orgasm_count + 1);
    } else {
        // Normal pleasure mode...Increment or Change
        update_check(output_state.pleasure, controller->increment());
        eom_hal_set_led_flash_interval((uint16_t)fmaxf((float)MINIMUM_BLINK_L, 1000.0f - ((float)arousal_state.arousal / (float)Config.sensitivity_threshold) * 1000.0f));
        if (LED_TYPE != LED_TYPE_MONO ) {
            if (arousal_state.arousal < Config.mid_threshold) {
            RGBColor fadedColor;
                if (isConnected) {
                    fadedColor = calculate_fade_color(rgb_green, rgb_orange, (float)arousal_state.arousal / Config.mid_threshold);
                } else {
                    fadedColor = calculate_fade_color(rgb_purple, rgb_orange, (float)arousal_state.arousal / Config.mid_threshold);
                }
                eom_hal_set_rgb(fadedColor.r, fadedColor.g, fadedColor.b);
            } else {
                RGBColor fadedColor = calculate_fade_color(rgb_orange, rgb_red, (float)(arousal_state.arousal - Config.mid_threshold) / (Config.sensitivity_threshold - Config.mid_threshold));
                eom_hal_set_rgb(fadedColor.r, fadedColor.g, fadedColor.b);
            }
        }
    }

    // Control pleasure if we are not manually doing so.
    // if (output_state.control_motor) {
    //     uint8_t pleasure = orgasm_control_get_pleasure();
    //     orgasm_control_set_pleasure(pleasure);
    // }
}

// Ruin: stop everything as soon as the orgasm is detected.
static void orgasm_control_ruin() {
    ESP_LOGI(TAG, "Orgasm ruined");
    post_orgasm_state.menu_is_locked = ocFALSE;
    output_state.pleasure = 0;
    arousal_state.cooldown = 0;
    orgasm_control_set_output_mode(OC_MANUAL);
    orgasm_control_set_pleasure(0);
    post_orgasm_state.ruined = ocTRUE;
}

// Milking: start the next round of edging after a rest. Unlike orgasm_control_set_output_mode()
// this keeps the session's orgasm count and the menu lock.
static void orgasm_control_start_milking_round() {
    ESP_LOGI(TAG, "Milking: starting round %d", post_orgasm_state.session_orgasms + 1);
    post_orgasm_state.rest_start_millis = 0;
    post_orgasm_state.post_orgasm_start_millis = 0;
    post_orgasm_state.detected_orgasm = ocFALSE;
    post_orgasm_state.auto_edging_start_millis = (esp_timer_get_time() / 1000UL);
    orgasm_control_start_round();
    orgasm_state.orgasm_count = 0;
    output_state.pleasure = 0;
    output_state.motor_start_time = 0;
    output_state.motor_stop_time = 0;
    arousal_state.cooldown = 0;
    arousal_state.update_flag = ocTRUE;
}

static void orgasm_control_update_edging_time() { // Edging+Orgasm timer
    const vibration_mode_controller_t* controller = get_vibration_mode_controller();
    // Make sure menu_is_locked is turned off in Manual mode
    if (output_state.output_mode == OC_MANUAL) {
        post_orgasm_state.menu_is_locked = ocFALSE;
        post_orgasm_state.post_orgasm_duration_seconds = Config.post_orgasm_duration_seconds;
        return;
    }

    // keep edging start time to current time as long as system is not in Orgasm mode 2
    if (output_state.output_mode != OC_ORGASM) {
        post_orgasm_state.auto_edging_start_millis = (esp_timer_get_time() / 1000UL);
        post_orgasm_state.post_orgasm_start_millis = 0;
    }

    // Lock Menu if turned on. and in Edging_orgasm mode
    if (Config.edge_menu_lock && !post_orgasm_state.menu_is_locked) {
        // Lock only after 2 minutes
        if ((esp_timer_get_time() / 1000UL) >
            post_orgasm_state.auto_edging_start_millis + (2 * 60 * 1000)) {
            post_orgasm_state.menu_is_locked = ocTRUE;
            arousal_state.update_flag = ocTRUE;
        }
    }

    // Milking: resting between rounds. Stay off, then start the next round of edging.
    if (post_orgasm_state.rest_start_millis > 0) {
        output_state.pleasure = 0;
        if ((esp_timer_get_time() / 1000UL) >=
            post_orgasm_state.rest_start_millis + (Config.milking_rest_seconds * 1000UL)) {
            orgasm_control_start_milking_round();
        }
        return;
    }

    // Pre-Orgasm loop -- Orgasm is permited
    if (orgasm_control_is_permit_orgasm_reached() && !orgasm_control_is_post_orgasm_reached()) {
        if (output_state.control_motor) {
            //orgasm_control_pause_control(); // make sure orgasm is now possible
        }

        orgasm_control_hr_orgasm_detect();

        // now detect the orgasm to start post orgasm torture timer
        if (post_orgasm_state.detected_orgasm) {
            post_orgasm_state.detected_orgasm = ocFALSE;
            if (post_orgasm_state.session_orgasms < UINT8_MAX) post_orgasm_state.session_orgasms++;
            arousal_state.update_flag = ocTRUE;
            ESP_LOGI(TAG, "Orgasm detected: %d this session", post_orgasm_state.session_orgasms);

            if (Config.after_orgasm == AfterOrgasmRuin) {
                orgasm_control_ruin();
                return;
            }

            post_orgasm_state.post_orgasm_start_millis =
                (esp_timer_get_time() / 1000UL); // Start Post orgasm torture timer
            // Lock menu if turned on
            if (Config.post_orgasm_menu_lock && !post_orgasm_state.menu_is_locked) {
                post_orgasm_state.menu_is_locked = ocTRUE;
                arousal_state.update_flag = ocTRUE;
            }

           // eom_hal_set_encoder_rgb(255, 0, 0);
        } else {
          //  eom_hal_set_encoder_rgb(0, 255, 0);
        }

        // raise pleasure to max. protect not to go higher than max
        if (output_state.pleasure < Config.max_pleasure) {
            update_check(output_state.pleasure, controller->increment());
            //output_state.pleasure += 5;  //why 5?
        } else {
            update_check(output_state.pleasure, Config.max_pleasure);
        }
    }

    // Post Orgasm loop
    if (orgasm_control_is_post_orgasm_reached()) {
        post_orgasm_state.post_orgasm_duration_millis =
            (post_orgasm_state.post_orgasm_duration_seconds * 1000);

        // Detect if within post orgasm session
        if ((esp_timer_get_time() / 1000UL) < (post_orgasm_state.post_orgasm_start_millis +
                                               post_orgasm_state.post_orgasm_duration_millis)) {
            output_state.pleasure = Config.max_pleasure;
        } else {                                // Post_orgasm timer reached
            if (output_state.pleasure > 0) { // Ramp down pleasure to 0
                output_state.pleasure = output_state.pleasure - 1;  // why 1?
            } else if (Config.after_orgasm == AfterOrgasmMilking &&
                       (Config.milking_max_orgasms <= 0 ||
                        post_orgasm_state.session_orgasms < Config.milking_max_orgasms)) {
                // Milking: rest, then go again.
                ESP_LOGI(TAG, "Milking: resting for %ds", Config.milking_rest_seconds);
                post_orgasm_state.detected_orgasm = ocFALSE;
                post_orgasm_state.post_orgasm_start_millis = 0;
                unsigned long now = esp_timer_get_time() / 1000UL;
                post_orgasm_state.rest_start_millis = now > 0 ? now : 1;
                output_state.pleasure = 0;
                arousal_state.cooldown = 0;
                arousal_state.update_flag = ocTRUE;
            } else {
                post_orgasm_state.menu_is_locked = ocFALSE;
                post_orgasm_state.detected_orgasm = ocFALSE;
                output_state.pleasure = 0;
                arousal_state.cooldown = 0;
                orgasm_control_set_pleasure(output_state.pleasure);
                orgasm_control_set_output_mode(OC_MANUAL);
            }
        }
    }
    // Control output while motor control is paused
    if (output_state.control_motor == OC_MANUAL) {
        uint8_t pleasure = orgasm_control_get_pleasure();
        orgasm_control_set_pleasure(pleasure);
    }
}

/**
 *  Detect muscle clenching.  
 *  Used to ajust arousal if turned on
 *  Used to detect the start of a Orgasm
 *  @param p_check
 *  @return clench duration in ms
 */
long orgasm_control_clench_detect(long p_check){
    static bool orgasm_detect = false;
    // raise clench threshold to pressure - 1/2 sensitivity
    long current_time = (esp_timer_get_time() / 1000UL);
    if (Config.auto_baseline) {
        // Never below resting pressure + 1/2 sensitivity, so drift doesn't count as a clench.
        long floor = (long)baseline_state.baseline + Config.clench_pressure_sensitivity / 2;
        if (post_orgasm_state.clench_pressure_threshold < floor) {
            post_orgasm_state.clench_pressure_threshold = floor;
        }
    }
    if (p_check >=
        (post_orgasm_state.clench_pressure_threshold + Config.clench_pressure_sensitivity)) {
        post_orgasm_state.clench_pressure_threshold =
            (p_check - (Config.clench_pressure_sensitivity / 2));
    }

    // Start counting clench time if pressure over threshold
    if (p_check >= post_orgasm_state.clench_pressure_threshold) {
        post_orgasm_state.clench_duration_millis =
            current_time - post_orgasm_state.clench_start_millis;

        // Orgasm detected
        if (post_orgasm_state.clench_duration_millis >= Config.clench_time_to_orgasm_ms &&
            !orgasm_detect) {
            orgasm_detect = true;
            if ( orgasm_control_is_permit_orgasm_reached() ) {
                uint8_t hr = heart_rate_get();
                if (Config.hr_orgasm_min_bpm > 0 && hr > 0 && hr < Config.hr_orgasm_min_bpm) {
                    ESP_LOGI(TAG, "Clench ignored: heart rate %d below %d", hr, Config.hr_orgasm_min_bpm);
                } else {
                    post_orgasm_state.detected_orgasm = ocTRUE;
                }
            }
            //event_manager_dispatch(EVT_ORGASM_START, NULL, 0);    
        }
        return post_orgasm_state.clench_duration_millis;

    } else {
        orgasm_detect = false;
        post_orgasm_state.clench_start_millis = current_time;
        post_orgasm_state.clench_duration_millis -= 150; // ms
        if (post_orgasm_state.clench_duration_millis <= 0) {
            post_orgasm_state.clench_duration_millis = 0;
            // clench pressure threshold value decays over time to a min of pressure + 1/2
            // sensitivity
            if ((p_check + (Config.clench_pressure_sensitivity / 2)) <
                post_orgasm_state.clench_pressure_threshold) {
                post_orgasm_state.clench_pressure_threshold *= 0.99;
            }
        }
        return 0;
    } // END of clench detector
}

void orgasm_control_twitch_detect() {
    if (arousal_state.arousal > orgasm_control_edge_threshold()) {
        output_state.motor_stop_time = (esp_timer_get_time() / 1000UL);
        arousal_state.cooldown = (Config.edge_delay * 1000) + output_state.random_additional_delay;
        eom_hal_set_led_flash_interval(MINIMUM_BLINK_L);
        eom_hal_set_led_flashing(1);
        eom_hal_set_rgb_color(&rgb_red); // Red over threshold

    } else {
        //fade out flash
        //if (LED_TYPE == LED_TYPE_MONO ) {
            uint16_t interval = 1000 - ((float)arousal_state.cooldown / (float)((Config.edge_delay * 1000) + output_state.random_additional_delay)) * 1000;
            eom_hal_set_led_flash_interval(interval);
        //}
        RGBColor fadedColor = calculate_fade_color(rgb_off,rgb_red, ((float)arousal_state.cooldown / (float)((Config.edge_delay * 1000) + output_state.random_additional_delay)));
        eom_hal_set_rgb(fadedColor.r, fadedColor.g, fadedColor.b);
        //eom_hal_set_led_flashing(0);
    }
}

orgasm_output_mode_t orgasm_control_get_output_mode(void) {
    return output_state.output_mode;
}

static uint8_t orgasm_control_get_cooldown(void) {  //convert to seconds for display
    return (uint8_t)(arousal_state.cooldown / 1000UL);
}

const char* orgasm_control_get_output_mode_str(void) {
    if (output_state.output_mode < _OC_MODE_MAX) {
        return orgasm_output_mode_str[output_state.output_mode];
    } else {
        return "";
    }
}

orgasm_output_mode_t orgasm_control_str_to_output_mode(const char* str) {
    for (int i = 0; i < _OC_MODE_MAX; i++) {
        if (!strcasecmp(str, orgasm_output_mode_str[i])) {
            return (orgasm_output_mode_t)i;
        }
    }

    return -1;
}

oc_bool_t orgasm_control_is_recording() {
    return (oc_bool_t) !!logger_state.logfile;
}

// Called every tick; updates at Config.update_frequency_hz.
static void orgasm_control_update(void) {
    if (Config.update_frequency_hz == 0) return;

    unsigned long millis = esp_timer_get_time() / 1000UL;
    unsigned long update_frequency_ms = 1000UL / Config.update_frequency_hz;

    if (millis - arousal_state.last_update_ms > update_frequency_ms) {
        orgasm_control_update_round();
        orgasm_control_update_arousal();
        orgasm_control_update_edging_time();
        orgasm_control_update_pleasure();
        safety_tick(arousal_state.pressure_value);
        arousal_state.last_update_ms = millis;

        if (Config.classic_serial || logger_state.logfile) {

            // Data for logfile or classic log.
            char data_csv[255];
            snprintf(
                data_csv,
                255,
                "%d,%d,%d,%d,%ld,%ld,%d",
                orgasm_control_get_average_pressure(),
                orgasm_control_get_arousal(),
                orgasm_control_get_pleasure(),
                Config.sensitivity_threshold,
                post_orgasm_state.clench_pressure_threshold,
                post_orgasm_state.clench_duration_millis,
                orgasm_state.orgasm_count
            );

            // Write out to logfile, which includes millis:
            if (logger_state.logfile != NULL) {
                fprintf(
                    logger_state.logfile,
                    "%ld,%s\n",
                    arousal_state.last_update_ms - logger_state.recording_start_ms,
                    data_csv
                );
            }

            // Write to console for classic log mode:
            if (Config.classic_serial) {
                printf("%s\n", data_csv);
            }
        }
    }
}

void orgasm_control_tick() {
    orgasm_control_update();
    publish_status_snapshot();
}

oc_bool_t orgasm_control_updated() {
    return arousal_state.update_flag;
}

void orgasm_control_clear_update_flag(void) {
    arousal_state.update_flag = ocFALSE;
}

/**
 * @return normalized pleasure byte
 */
uint8_t orgasm_control_get_pleasure() {
    uint8_t limit = Config.max_pleasure < Config.max_motor_output ? Config.max_pleasure : Config.max_motor_output;
    if (output_state.pleasure > limit)
        return limit;
    else
        return (uint8_t)floor(output_state.pleasure);
}

uint8_t orgasm_control_get_pleasure_percent() {
    return (uint8_t)(orgasm_control_get_pleasure() * 100.0f / Config.max_pleasure);
}

static uint16_t orgasm_control_get_arousal() {
    return arousal_state.arousal;
}

float orgasm_control_get_arousal_percent() {
    if (Config.sensitivity_threshold == 0) return 1.0;
    return (float)arousal_state.arousal / Config.sensitivity_threshold;
}

void orgasm_control_increment_arousal_threshold(int threshold) {
    orgasm_control_set_arousal_threshold(Config.sensitivity_threshold + threshold);
}

void orgasm_control_set_arousal_threshold(int threshold) {
    // Sensitivity threshold of 0 prevents horrible issues from happening.
    // It also prevents confusing the customers, which is a big win I'd say.
    Config.sensitivity_threshold = threshold >= 10 ? threshold : 10;
    config_enqueue_save(300);
}

static uint16_t orgasm_control_get_arousal_threshold(void) {
    return Config.sensitivity_threshold;
}

static uint32_t orgasm_control_get_raw_pressure(uint16_t* out, uint8_t n) {
    if (n > RAW_PRESSURE_LEN) n = RAW_PRESSURE_LEN;
    portENTER_CRITICAL(&raw_lock);
    uint32_t seq = raw_seq;
    for (uint8_t i = 0; i < n; i++) {
        // Oldest first; before n readings exist, the missing ones read as 0.
        out[i] = seq + i >= n ? raw_buf[(seq + i - n) % RAW_PRESSURE_LEN] : 0;
    }
    portEXIT_CRITICAL(&raw_lock);
    return seq;
}

static uint16_t orgasm_control_get_last_pressure() {
    return arousal_state.pressure_value;
}

static uint16_t orgasm_control_get_average_pressure() {
    return running_average_get_average(arousal_state.average);
}

void orgasm_control_control_motor(orgasm_output_mode_t control) {
    orgasm_control_set_output_mode(control);
}

void orgasm_control_trigger_arousal() {
    arousal_state.arousal = Config.sensitivity_threshold + 1;
    output_state.pleasure = 0;
    output_state.motor_stop_time = (esp_timer_get_time() / 1000UL);
    hr_state.peak_since_edge = heart_rate_get();
    output_state.motor_start_time = 0;
    arousal_state.update_flag = ocTRUE;
}

void orgasm_control_set_output_mode(orgasm_output_mode_t mode) {
    orgasm_output_mode_t old = output_state.output_mode;
    output_state.output_mode = mode;
    output_state.control_motor = mode != OC_MANUAL;
    if (mode != OC_MANUAL) safety_clear();
    if (old == OC_MANUAL && mode != OC_MANUAL) {
        // Starting a session: begin the vibration mode afresh at initial_pleasure, rather than
        // carrying on from the manual setting or where the last session's ramp left off.
        output_state.pleasure = 0;
        output_state.motor_start_time = 0;
    }
    output_state.motor_stop_time = 0;
    post_orgasm_state.auto_edging_start_millis = (esp_timer_get_time() / 1000UL);
    post_orgasm_state.post_orgasm_start_millis = 0;
    post_orgasm_state.rest_start_millis = 0;
    hr_state.waiting = false;
    hr_state.orgasm_peak = 0;
    arousal_state.memory = 0;
    if (mode != OC_MANUAL) {
        // A new session: forget the last one's orgasms and clench baseline.
        post_orgasm_state.session_orgasms = 0;
        post_orgasm_state.ruined = ocFALSE;
        post_orgasm_state.detected_orgasm = ocFALSE;
        post_orgasm_state.clench_pressure_threshold = 4096;
    }
    orgasm_control_start_round();
    if (mode == OC_ORGASM) {
        orgasm_state.orgasm_count = 0;
        round_state.chance_denials = 0;
    }

    // if (old == OC_MANUAL) {
    //     const vibration_mode_controller_t* controller = get_vibration_mode_controller();
    //     //output_state.pleasure = controller->start(); //lets let the pleasure stay at its former value
    // } else if (mode == OC_MANUAL) {
    //     const vibration_mode_controller_t* controller = get_vibration_mode_controller();
    //     //output_state.pleasure = controller->stop();  //lets let the pleasure stay at its former value
    // }
    //event_manager_dispatch(EVT_MODE_SET, NULL, mode);
}

void orgasm_control_pause_control() {
    output_state.prev_control_motor = output_state.control_motor;
    orgasm_control_set_output_mode(OC_MANUAL);
    orgasm_control_set_pleasure(Config.max_pleasure);  //review this..would be nice to keep depletion mode working
}

void orgasm_control_resume_control() {
    output_state.control_motor = output_state.prev_control_motor;
}

void orgasm_control_permit_orgasm(int seconds) {
    post_orgasm_state.detected_orgasm = ocFALSE;
    orgasm_control_set_output_mode(OC_ORGASM);
    post_orgasm_state.auto_edging_start_millis =
        (esp_timer_get_time() / 1000UL) - (Config.auto_edging_duration_minutes * 60 * 1000);
    post_orgasm_state.post_orgasm_duration_seconds = seconds;
    round_state.won = true;  // permitted straight away, without a roll
}

oc_bool_t orgasm_control_is_permit_orgasm_reached() {
    return orgasm_control_get_output_mode() == OC_ORGASM && round_state.won ? ocTRUE : ocFALSE;
}

static uint16_t orgasm_control_get_permit_orgasm_remaining_seconds() {
    if (output_state.output_mode != OC_ORGASM || orgasm_control_is_permit_orgasm_reached()) {
        return 0;
    } else {
        long remaining_ms = (round_state.start_millis +
                             (Config.auto_edging_duration_minutes * 60 * 1000)) -
                            (esp_timer_get_time() / 1000UL);
        return (uint16_t)(remaining_ms / 1000UL);
    }
}

oc_bool_t orgasm_control_is_post_orgasm_reached() {
    // Detect if after orgasm
    if (post_orgasm_state.post_orgasm_start_millis > 0) {
        return ocTRUE;
    } else {
        return ocFALSE;
    }
}

static oc_after_orgasm_phase_t orgasm_control_get_after_orgasm_phase(void) {
    if (post_orgasm_state.ruined) return OC_PHASE_RUINED;
    if (post_orgasm_state.rest_start_millis > 0) return OC_PHASE_RESTING;
    if (output_state.output_mode == OC_ORGASM && orgasm_control_is_post_orgasm_reached()) {
        return OC_PHASE_POST_ORGASM;
    }
    return OC_PHASE_NONE;
}

static uint16_t orgasm_control_get_baseline(void) {
    return baseline_state.baseline < 0 ? 0 : (uint16_t)baseline_state.baseline;
}

static uint8_t orgasm_control_get_session_orgasms(void) {
    return post_orgasm_state.session_orgasms;
}

static uint16_t orgasm_control_get_rest_remaining_seconds(void) {
    if (post_orgasm_state.rest_start_millis == 0) return 0;
    unsigned long end = post_orgasm_state.rest_start_millis + (Config.milking_rest_seconds * 1000UL);
    unsigned long now = esp_timer_get_time() / 1000UL;
    return now >= end ? 0 : (uint16_t)((end - now + 999) / 1000);
}

static oc_bool_t orgasm_control_is_menu_locked() {
    return post_orgasm_state.menu_is_locked;
};

void orgasm_control_lock_menu(oc_bool_t value) {
    post_orgasm_state.menu_is_locked = value;
}

void orgasm_control_reset_denied(void) {
    orgasm_state.orgasm_count = 0;
    round_state.denials = 0;
}

// Everything the app is told about, gathered in one tick (status_snapshot.h).
static void publish_status_snapshot(void) {
    RGBColor led = eom_hal_get_rgb_color();
    status_snapshot_t s = {
        .millis = esp_timer_get_time() / 1000,
        .pressure = orgasm_control_get_last_pressure(),
        .pressure_avg = orgasm_control_get_average_pressure(),
        .arousal = orgasm_control_get_arousal(),
        .threshold = orgasm_control_get_arousal_threshold(),
        .sensitivity = orgasm_control_get_arousal_sensitivity(),
        .motor = orgasm_control_get_pleasure(),
        .cooldown = orgasm_control_get_cooldown(),
        .denied = orgasm_control_get_orgasm_count(),
        .chance_denials = round_state.chance_denials,
        .mode = (uint8_t)orgasm_control_get_output_mode(),
        .mode_name = orgasm_control_get_output_mode_str(),
        .vibration_mode = (uint8_t)Config.vibration_mode,
        .permit_s = orgasm_control_get_permit_orgasm_remaining_seconds(),
        .menu_locked = orgasm_control_is_menu_locked(),
        .safety = (uint8_t)safety_get_stop_reason(),
        .phase = (uint8_t)orgasm_control_get_after_orgasm_phase(),
        .session_orgasms = orgasm_control_get_session_orgasms(),
        .rest_s = orgasm_control_get_rest_remaining_seconds(),
        .baseline = orgasm_control_get_baseline(),
        .hr = heart_rate_get(),
        .hr_waiting = orgasm_control_is_hr_waiting(),
        .hr_zone = orgasm_control_is_hr_edge_zone(),
        .led_r = led.r,
        .led_g = led.g,
        .led_b = led.b,
    };
    s.raw_seq = orgasm_control_get_raw_pressure(s.raw, STATUS_SNAPSHOT_RAW_LEN);
    status_snapshot_publish(&s);
}

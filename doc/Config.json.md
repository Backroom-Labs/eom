## Configuration

Please see `data/config.json` file.
If a configuration is changed using the UI it will be saved on the device itself.  There is not currently a way to get the device's config.json back to a computer, but the WebSocket `configList` command returns every setting (see [WebSocket.md](WebSocket.md)), and the Bluetooth config characteristic does the same.

[/data/config.json](/data/config.json) is compiled into the firmware, so to push config changes to the device edit the file and run ```PlatformIO -> Project Tasks -> <your board> -> General -> Upload``` (no filesystem upload needed).  On boot the device compares the built-in file with the one it last applied:
- If the file changed, every key in it overrides the value saved on the device.  Keys you leave out of the file keep their saved values.
- If the file is unchanged, settings changed from the UI are kept, even across firmware updates.
- If the file is not valid JSON it is ignored and ```Built-in config.json is not valid JSON``` is logged to the monitor.

```Upload Filesystem Image``` also writes ```data/config.json``` to the device, replacing any settings saved from the UI, and ```Erase Flash``` wipes them entirely.  See [Updating the device](../README.md#updating-the-device) in the README for when each kind of update is needed.

## Settings

Every key the firmware loads and saves (`src/config.c`).  **Default** is the firmware's value for a key missing from the file.  The shipped `data/config.json` sets some of them differently (see [below](#shipped-dataconfigjson)), and on a new device those values win.

Types: *Text (n)* holds up to n characters.  *Number (0-255)* and *Number (0-65535)* are stored in 8 and 16 bits: a larger value wraps around, it is not rejected.  *Number* is a signed 32-bit integer.  A boolean sent as text (over Bluetooth, or as a string in `configSet`) is false for `false`, `no`, `off` or `0` and true for anything else.  Settings in the Wi-Fi and Bluetooth table take effect on the next restart.

### Wi-Fi and Bluetooth

|Key|Type|Default|Meaning|
|---|----|---|---|
|`wifi_ssid`|Text (64)|""|Your Wi-Fi network name (join mode).|
|`wifi_key`|Text (64)|""|Your Wi-Fi password.|
|`wifi_on`|Boolean|true|Turn on Wi-Fi and the WebSocket server.  Read at boot.|
|`wifi_ap_mode`|Boolean|true|Make the EOM its own Wi-Fi network (`ap_ssid`) instead of joining `wifi_ssid`.  If joining fails, the EOM starts its own network anyway.|
|`ap_ssid`|Text (64)|"EOM"|Name of the EOM's own network.|
|`ap_password`|Text (64)|""|Password for the EOM's own network; empty for an open network.|
|`ap_channel`|Number (0-255)|1|Wi-Fi channel of the EOM's own network (1-13).|
|`ap_max_connections`|Number (0-255)|4|Devices that can join the EOM's own network at once (1-4).|
|`bt_display_name`|Text (63)|"EOM_BT"|Bluetooth name.  Also the mDNS instance name.  The EOM emulates a MonsterPub device for Xtoys; see the README.|
|`bt_on`|Boolean|true|Turn on Bluetooth.|
|`force_bt_coex`|Boolean|true|Allow Bluetooth and Wi-Fi at the same time.  When it's off and both are on, Bluetooth is turned off.|
|`websocket_port`|Number|80|Port of the plain `ws://` server.|
|`use_ssl`|Boolean|true|Serve `wss://` on port 443 instead.  Needed for the hosted (https) app and Xtoys over Wi-Fi.  Uses `/spiffs/server.crt` and `/spiffs/server.key`, generated per machine by `tools/gen_cert.py`; falls back to plain `ws://` on `websocket_port` if they are missing.  Accept the self-signed certificate once by visiting `https://<device-ip>/`.|
|`ssl_servercert_path`|Text|not set|Certificate file to use instead of `/spiffs/server.crt`.  Left out of the saved file while it isn't set.|
|`ssl_prvtkey_path`|Text|not set|Private key file to use instead of `/spiffs/server.key`.  Left out of the saved file while it isn't set.|
|`hostname`|Text (63)|"eom"|mDNS hostname (`<hostname>.local`).|
|`classic_serial`|Boolean|false|Write a continuous stream of arousal data to the serial port, for older software.|

### Session

|Key|Type|Default|Meaning|
|---|----|---|---|
|`auto_edging_duration_minutes`|Number|30|Orgasm mode: minutes of edging before an orgasm is permitted.|
|`max_denied`|Number (0-255)|20|Orgasm mode: an orgasm is permitted once there have been more denials than this in a round, if that comes before the edging time.  0, or 100 and over, turns it off.|
|`orgasm_chance`|Number (0-255)|100|Orgasm mode: percent chance an orgasm is permitted once the edging time or `max_denied` is reached.  A lost roll is a denial and another full round starts.|
|`after_orgasm`|Number|1|What happens once an orgasm is detected in Orgasm mode: 0 Ruin, 1 Post-orgasm, 2 Milking.|
|`post_orgasm_duration_seconds`|Number|10|Post-orgasm and Milking: seconds of full intensity after an orgasm before ramping down.|
|`milking_rest_seconds`|Number|60|Milking: seconds to rest between an orgasm and the next round of edging.|
|`milking_max_orgasms`|Number|3|Milking: stop after this many orgasms; the last one ends like Post-orgasm.  0 for no limit.|
|`edge_menu_lock`|Boolean|false|Turn on the settings lock 2 minutes into an Orgasm mode session.|
|`post_orgasm_menu_lock`|Boolean|false|Turn on the settings lock when an orgasm is detected.|
|`vibration_mode`|Number|2|Algorithm: 1 Ramp-Stop, 2 Depletion, 3 Enhancement.  (4 Pattern is unfinished and does nothing; any other value acts as Depletion.)|

### Stimulation

|Key|Type|Default|Meaning|
|---|----|---|---|
|`max_pleasure`|Number (0-255)|255|Highest motor speed in Endless and Orgasm mode.|
|`initial_pleasure`|Number (0-255)|10|Motor speed Endless and Orgasm mode start from.|
|`motor_ramp_time_s`|Number (0-255)|120|Seconds to ramp from `initial_pleasure` to `max_pleasure`.|
|`edge_delay`|Number (0-255)|10|Minimum seconds after an edge before stimulation resumes.|
|`max_additional_delay`|Number (0-255)|10|Up to this many seconds, picked at random each time, are added to `edge_delay`.  0 to turn off.|
|`minimum_on_time`|Number (0-255)|1|Seconds after stimulation starts before edges are detected again.|

### Detection

|Key|Type|Default|Meaning|
|---|----|---|---|
|`sensitivity_threshold`|Number (0-65535)|1024|Edge threshold: arousal above this is an edge (0-4095 scale).  Lower stops sooner.|
|`mid_threshold`|Number (0-65535)|512|Warning threshold: the start of the yellow zone, approaching an edge.  Also caps arousal memory.|
|`sensor_sensitivity`|Number (0-255)|50|Sensor gain, 0-100.  On analog sensors it picks the ADC range (75 and up most sensitive); on I2C/SPI sensors it scales the reading.|
|`pressure_smoothing`|Number (0-255)|10|Number of readings averaged into the smoothed pressure.  Higher lags more.|
|`use_average_values`|Boolean|true|Calculate arousal from the smoothed pressure instead of single readings.|
|`update_frequency_hz`|Number (0-255)|50|Pressure readings and control updates per second.|
|`auto_baseline`|Boolean|true|Follow the resting pressure so slow drift (warming air, a shifted plug) isn't taken for a clench.|
|`arousal_fade_ms`|Number|1400|Milliseconds for arousal to fall by half once contractions stop.|
|`arousal_memory_s`|Number|0|Half-life in seconds of a fading copy of recent arousal peaks that arousal won't drop below, capped at `mid_threshold`.  0 for off.|

### Clench

|Key|Type|Default|Meaning|
|---|----|---|---|
|`clench_detector_in_edging`|Boolean|true|Let clenches raise arousal while edging.|
|`clench_pressure_sensitivity`|Number|300|Pressure above the resting level that counts as a clench.  Lower is more sensitive.|
|`clench_time_threshold_ms`|Number|900|Milliseconds a clench must last before it counts.|
|`clench_time_to_orgasm_ms`|Number|1500|Milliseconds of clench, once an orgasm is permitted, that count as an orgasm.  (Replaced `clench_threshold_2_orgasm`; old files are converted.)|
|`max_clench_duration_ms`|Number|3000|Longest a clench can keep raising arousal.  Pressure that stays up longer is treated as drift.|

### Safety

|Key|Type|Default|Meaning|
|---|----|---|---|
|`sensor_fault_stop`|Boolean|true|Stop an Endless or Orgasm session when the pressure sensor stops giving a usable signal.|
|`disconnect_stop_s`|Number (0-255)|10|Stop when no app (Bluetooth or WebSocket) has been connected for this many seconds.  0 to turn off.|
|`max_session_minutes`|Number (0-65535)|0|Stop any session, Manual included, after this many minutes.  0 to turn off.|
|`max_motor_output`|Number (0-255)|255|Hard cap on motor output in every mode, including direct motor control.|
|`hr_max_bpm`|Number (0-255)|0|Stop any session when the heart rate stays above this for 10 seconds.  0 to turn off.|

### Heart rate

All of these need a heart rate from the app (an O2Ring) and are ignored while none is coming in.

|Key|Type|Default|Meaning|
|---|----|---|---|
|`hr_recovery_bpm`|Number (0-255)|0|After an edge, keep cooling down until the heart rate has dropped this far below its peak (and `edge_delay` has passed).  0 to turn off.|
|`hr_recovery_max_s`|Number (0-255)|90|Longest to wait for the heart rate after an edge, in seconds.|
|`hr_edge_bpm`|Number (0-255)|0|At or above this heart rate, lower the edge threshold by `hr_edge_sensitivity` percent.  0 to turn off.|
|`hr_edge_sensitivity`|Number (0-255)|20|Percent the edge threshold drops in the heart-rate edge zone.|
|`hr_orgasm_min_bpm`|Number (0-255)|0|Orgasm mode: a clench only counts as an orgasm with the heart rate at least this high.  0 to turn off.|
|`hr_orgasm_drop_bpm`|Number (0-255)|0|Orgasm mode, once permitted: also count an orgasm when the heart rate falls this far within 30 seconds of its peak, without a clench.  Experimental.  0 to turn off.|

### Unused

The firmware loads and saves these, but nothing uses them.

|Key|Type|Default|Meaning|
|---|----|---|---|
|`chart_window_s`|Number (0-255)|5|Seconds of chart history, from the old UI.|
|`store_command_history`|Boolean|true|Serial console setting; the console is gone.|
|`console_basic_mode`|Boolean|false|Serial console setting; the console is gone.|

## Shipped `data/config.json`

The `data/config.json` in this repository sets these differently from the firmware defaults:

|Key|In `data/config.json`|Firmware default|
|---|---|---|
|`wifi_ssid`, `wifi_key`|"your_wifi", "your_password"|""|
|`wifi_on`|false|true|
|`wifi_ap_mode`|false|true|
|`max_denied`|5|20|
|`update_frequency_hz`|30|50|

It also has `use_post_orgasm`, which the firmware no longer reads (see `after_orgasm`).  Keys that aren't settings are ignored.

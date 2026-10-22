# WebSocket Communication

The Endless Orgasm Machine serves as a WebSocket host for streaming data over wireless networks. The EOM app can use
it instead of Bluetooth, and Xtoys and older NoGasm / Edge-o-Matic software use it, but you are free to develop your
own interface.

Connect to `wss://<device-ip>/` (port 443) when `use_ssl` is on and the certificate is on the device, otherwise to
`ws://<device-ip>:<websocket_port>/` (port 80 by default). See [Config.json.md](Config.json.md).

The WebSocket interface uses JSON serialization for both sending and receiving packets. The structure of a payload sent
TO the EOM is a key-value object with each key corresponding to a command, and a value corresponding to the
arguments to that command. Responses streamed from the device should be handled similarly.

**An example request sent to the WebSocket channel:**

```json
{
    "configSet": {
        "max_pleasure": 255
    },
    "configList": {
        "nonce": 1234
    }
}
```

**The associated response:**

```json
{
    "configList": {
        "nonce": 1234,
        "_filename": "/spiffs/config.json",
        "max_pleasure": 255,
        …
    }
}
```

Multiple commands can be sent in either direction, but only one of each command type can be specified. It is recommended
that you send only one command per request. To track responses to commands, you can use the "nonce" parameter: when a
command's value is an object with a numeric `nonce`, the reply to that command carries the same `nonce`. A command that
succeeds and has nothing to say gets no reply (unless it was given a nonce).

**Errors** come back under the command's name:

|Reply|Meaning|
|---|---|
|`{"<command>": {"errno": 1}}`|Bad argument (wrong type, out of range, an unknown setting)|
|`{"<command>": {"errno": 2, "error": "SETTINGS LOCKED"}}`|Refused because the settings lock is on (3.8.0)|
|`{"<command>": {"errno": -1}}`|Failed, for example the command queue was full|
|`{"<command>": {"error": "NOT IMPLEMENTED"}}`|Not a command this firmware knows|
|`{"error": "<text>"}`|The message wasn't valid JSON; the text is where parsing stopped|

While the settings lock is on, `configSet`, `setMode` to Endless or Orgasm, and `resetDenied` are refused. Stopping is
always accepted: `setMode` to Manual and `setMotor`, as are `triggerArousal`, `heartRate` and `simPressure`.


## Server Commands

These commands are recognized by the WebSocket server running on the Endless Orgasm Machine:


### `streamReadings`
Subscribes this connection to the messages the EOM sends on its own: `readings` (about 15 times a second), and
`configList` and `wifiStatus` (see [Server Responses](#server-responses)). Without it you only get replies.

**Example:**
```json
"streamReadings": null
```


### `configSet`
Sets one or more configuration values, see [Config.json.md](Config.json.md) for the keys. Values can be numbers,
booleans or strings. The changes apply at once and are saved, and every streaming client is sent the new `configList`.
Every valid entry is applied even if another one is bad; a bad or unknown key makes the reply `errno` 1. Don't put a
`nonce` here: it isn't a setting, so it counts as a bad key.

**Arguments:**

|Argument|Type|Description|
|---|---|---|
|*|\<any>|Config keys / values|

**Example:**
```json
"configSet": {
    "max_pleasure": 255
}
```


### `configList`
Requests all config values to be sent. The reply is [`configList`](#configlist-1).

**Example:**
```json
"configList": null
```


### `setMode`
Sets the current run mode. Setting the mode it's already in starts it again.

**Arguments:**

|Argument|Type|Description|
|---|---|---|
|mode|String|`manual`, `endless` or `orgasm` (any case)|

**Example:**
```json
"setMode": "endless"
```


### `setMotor`
Sets vibration speed. Will enter manual mode; if it wasn't in Manual already, the reply is `{"setMotor": {"mode": "MANUAL"}}`.
The speed is still capped by `max_pleasure` and `max_motor_output`.

**Arguments:**

|Argument|Type|Description|
|---|---|---|
|speed|Number|0-255 motor speed|

**Example:**
```json
"setMotor": 128
```


### `resetDenied`
Sets the denied count to 0.

**Example:**
```json
"resetDenied": null
```


### `triggerArousal`
Forces an edge: arousal jumps above the edge threshold and stimulation stops for a cooldown, as if one had been detected.

**Example:**
```json
"triggerArousal": null
```


### `heartRate`
A heart rate in bpm from a sensor the app is connected to (3.5.0). 0, or anything outside 1-255, means no reading.
See the heart rate settings in [Config.json.md](Config.json.md#heart-rate).

**Example:**
```json
"heartRate": 72
```


### `simPressure`
Firmware with the pressure simulator only: every build except stable releases (3.8.0; before that, builds with
`-DEOM_PRESSURE_SIM`, from 3.3.0). Other firmware ignores it. Replaces the sensor reading with this value (0-4095); -1
goes back to the real sensor, which is also where the EOM starts. [`info`](#info-1) says whether the firmware has it.

**Example:**
```json
"simPressure": 1500
```


### `info`
Asks what the EOM is. The reply is [`info`](#info-1).

**Example:**
```json
"info": null
```


### `restart`
Restarts the EOM at once. There is no reply.

**Example:**
```json
"restart": null
```


### `configLoad`, `configSave`, `time`
Accepted for compatibility, but they do nothing. Settings are saved automatically after `configSet`.


### `otaInfo`
Asks what the EOM runs, before a firmware update (3.8.0). The reply is `otaInfo` below.

**Example:**
```json
"otaInfo": null
```


### `otaBegin`
Starts a firmware update (3.8.0). The EOM erases the inactive app partition, then sends an `ota` `ready` event. Send
the signed `firmware.bin` in **binary frames**, each a 4-byte little-endian offset followed by up to 4096 image bytes,
keeping no more than 16384 bytes beyond the last `progress` value in flight. Only one update runs at a time, over
Wi-Fi or Bluetooth; a second is refused with a `result` of 259 (0x103). Closing the connection cancels the update.

**Arguments:**

|Argument|Type|Description|
|---|---|---|
|size|Numeric|Image size in bytes|
|allowDowngrade|Boolean|Install an older version (optional, default false)|

**Example:**
```json
"otaBegin": { "size": 1273328, "allowDowngrade": false }
```


### `otaAbort`
Cancels the update this client started.

**Example:**
```json
"otaAbort": null
```


### No longer supported
`serialCmd`, `getWiFiStatus` and `getSDStatus` from the Edge-o-Matic are not implemented; they get
`{"error": "NOT IMPLEMENTED"}`. `wifiStatus` is sent every 10 seconds to streaming clients instead.


## Server Responses
Your application should be prepared to handle these messages streamed from the server.


### `readings`
The current readings and device status, sent about 15 times a second to clients that sent `streamReadings`. Pressure,
arousal and thresholds are on the 12-bit (0-4095) scale. The Bluetooth status characteristic carries the same values;
see [WebSocket and Bluetooth API](../README.md#websocket-and-bluetooth-api) in the README for its layout.

**Parameters:**

|Parameter|Type|Since|Description|
|---|---|---|---|
|pressure|Numeric||Last pressure reading|
|pavg|Numeric||Smoothed pressure (`pressure_smoothing`)|
|arousal|Numeric||Current arousal|
|motor|Numeric||Current vibrator speed (0-255), after the `max_pleasure` and `max_motor_output` caps|
|threshold|Numeric||Edge threshold (`sensitivity_threshold`; the heart-rate edge zone doesn't change it here)|
|sensitivity|Numeric||Sensor gain (`sensor_sensitivity`)|
|cooldown|Numeric||Seconds left of the cooldown after an edge|
|denied|Numeric||Denials this Endless or Orgasm mode run (at most 255)|
|permit|Numeric||Orgasm mode: seconds until an orgasm is permitted; 0 once permitted or in another mode|
|runMode|String||`MANUAL`, `ENDLESS` or `ORGASM`|
|millis|Numeric||Milliseconds since boot|
|lock|Boolean|3.0.0|The settings lock is on (`edge_menu_lock` or `post_orgasm_menu_lock`); see Errors above|
|safety|Numeric|3.2.0|Why a safety check stopped the session: 0 not stopped, 1 sensor fault, 2 disconnected, 3 session time limit, 4 heart rate limit|
|orgasms|Numeric|3.3.0|Orgasms detected this session|
|phase|Numeric|3.3.0|After an orgasm: 0 none, 1 post-orgasm, 2 resting (Milking), 3 ruined|
|rest|Numeric|3.3.0|Seconds left resting between orgasms (Milking)|
|baseline|Numeric|3.4.0|Tracked resting pressure, same scale as `pressure`|
|hr|Numeric|3.5.0|Heart rate the EOM is using, in bpm (0 = none)|
|hrWait|Boolean|3.5.0|The cooldown is waiting for the heart rate to settle (`hr_recovery_bpm`)|
|hrZone|Boolean|3.5.0|The heart rate is in the edge zone (`hr_edge_bpm`)|
|rawSeq|Numeric|3.6.0|Pressure readings taken since boot; the newest value in `raw` is reading number `rawSeq - 1`|
|raw|Array|3.6.0|The last 8 raw pressure readings, oldest first, taken at `update_frequency_hz` (0 before there were enough)|
|chanceDenials|Numeric|3.8.0|Orgasm chance rolls lost since Orgasm mode started (at most 255); each is also counted in `denied`|

**Example:**
```json
"readings": {
    "arousal": 310,
    "cooldown": 0,
    "denied": 2,
    "millis": 198452,
    "motor": 180,
    "pavg": 1028,
    "permit": 1520,
    "pressure": 1029,
    "runMode": "ORGASM",
    "sensitivity": 50,
    "threshold": 1024,
    "lock": false,
    "safety": 0,
    "phase": 0,
    "orgasms": 0,
    "rest": 0,
    "baseline": 1010,
    "hr": 0,
    "hrWait": false,
    "hrZone": false,
    "chanceDenials": 0,
    "rawSeq": 9912,
    "raw": [1027, 1029, 1030, 1028, 1031, 1029, 1028, 1029]
}
```


### `configList`
A listing of the current configuration: every key in [Config.json.md](Config.json.md). The reply to `configList` also
has `_filename`, the settings file on the device, and the `nonce` if one was sent. The same listing, without those two,
is sent to every streaming client after a setting change is saved.

**Parameters:**

|Parameter|Type|Description|
|---|---|---|
|_filename|String|Settings file on the device (reply only)|
|*|\<any>|Current serialized configuration|

**Example:**
```json
"configList": {
    "_filename": "/spiffs/config.json",
    "max_pleasure": 255,
    "wifi_on": true,
    …
}
```


### `wifiStatus`
Sent every 10 seconds to streaming clients.

**Parameters:**

|Parameter|Type|Description|
|---|---|---|
|ssid|String|The `wifi_ssid` setting|
|ip|String|Always empty for now|
|rssi|Numeric|Always -1 for now|

**Example:**
```json
"wifiStatus": {
    "ssid": "FBI Spy-Fi",
    "ip": "",
    "rssi": -1
}
```


### `info`
Reply to `info`.

|Parameter|Type|Description|
|---|---|---|
|device|String|Always `Endless Orgasm Machine`|
|serial|String|Always empty for now|
|fwVersion|String|Installed firmware version|
|pressureSim|Boolean|`true` if the firmware has the pressure simulator ([`simPressure`](#simpressure)); absent in stable releases (3.8.0)|

**Example:**
```json
"info": { "device": "Endless Orgasm Machine", "serial": "", "fwVersion": "3.8.0" }
```


### `otaInfo`
Reply to `otaInfo`.

|Parameter|Type|Description|
|---|---|---|
|version|String|Installed firmware version|
|board|String|Board the firmware was built for (the PlatformIO environment)|
|maxSize|Numeric|Largest image the EOM can take|
|confirmed|Boolean|False while new firmware is still on probation (about 30 s after an update), when updates are refused|

**Example:**
```json
"otaInfo": { "version": "3.8.0", "board": "m5stack_atom_echo", "maxSize": 1966080, "confirmed": true }
```

### `ota`
Firmware update events, sent to the client that sent `otaBegin`. They match the Bluetooth update protocol
(`src/include/system/ble_ota.h`).

|Event|Value|Meaning|
|---|---|---|
|`ready`|0|Partition erased; send the image from offset 0|
|`progress`|Bytes written|Written to flash so far|
|`resend`|Offset|Resume sending from this offset (after a gap, or a stall)|
|`result`|0|`error` 0: installed, the EOM restarts in a second. Otherwise the update failed and is over: 259 (0x103) busy or still on probation, 260 (0x104) wrong size, 263 (0x107) timed out, 266 (0x10a) older than installed, 5379 (0x1503) not signed with this EOM's key|

**Example:**
```json
"ota": { "event": "progress", "error": 0, "value": 16384 }
```

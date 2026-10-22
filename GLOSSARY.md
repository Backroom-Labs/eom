# EOM

The Endless Orgasm Machine: a device that reads arousal from a pressure sensor and controls a vibrator to edge and deny, driven from the EOM app over Wi-Fi or Bluetooth.

## Language

### Modes

**Mode**:
What the EOM is doing with stimulation: Manual, Endless or Orgasm.
_Avoid_: output mode, run mode

**Manual**:
The mode where the user sets pleasure directly and the EOM does not react to arousal. Manual at zero pleasure is shown as "Stopped".
_Avoid_: off, idle

**Endless**:
The mode where the EOM raises pleasure and denies at every edge, with no orgasm allowed.
_Avoid_: automatic (that word covers Orgasm mode too)

**Orgasm mode**:
The mode that edges and denies like Endless until the edging time or the denial count is reached, then permits an orgasm.
_Avoid_: release mode

**Automatic mode**:
Either Endless or Orgasm mode: any mode where the EOM drives stimulation itself.

### Edging

**Arousal**:
The EOM's estimate of how close the user is to orgasm, read from pressure changes.

**Pleasure**:
How strongly the EOM is stimulating at the moment, from zero to the maximum.
_Avoid_: intensity, motor speed, output

**Edge**:
Getting close to an orgasm: arousal reaching the edge threshold while being stimulated.

**Edge threshold**:
The arousal level that counts as an edge.
_Avoid_: sensitivity threshold

**Warning threshold**:
A lower arousal level that shows the user is approaching an edge.
_Avoid_: mid threshold

**Denial**:
An edge where the EOM turns stimulation off so the user doesn't reach orgasm.
_Avoid_: orgasm count (the firmware's old name for the denial counter)

**Cooldown**:
The pause after a denial before stimulation starts again.
_Avoid_: edge delay

**Orgasm**:
The user reaching climax. The EOM only detects one in Orgasm mode, once an orgasm is permitted.

**Clench**:
A sustained squeeze on the pressure sensor. A clench held long enough after an orgasm is permitted counts as an orgasm.

**Resting pressure**:
The pressure the sensor reads when the user is relaxed. It drifts during a session and the EOM follows it.
_Avoid_: baseline, ambient

**Arousal fade**:
How quickly arousal falls once pressure activity stops.

**Arousal memory**:
A floor that holds arousal up after a burst of activity, so quiet spells between contractions don't read as no arousal.

### After an orgasm

**After-orgasm mode**:
What happens once an orgasm is detected: Ruin, Post-orgasm or Milking.

**Ruin**:
Stimulation stops the moment an orgasm is detected.

**Post-orgasm**:
Stimulation continues at full strength for a set time after the orgasm, then ramps down.

**Milking**:
Post-orgasm followed by a rest and another round of edging, repeated up to a set number of orgasms.

**Rest**:
The pause at zero pleasure between Milking rounds.

### Heart rate

**Edge zone**:
A heart rate above which the edge threshold is lowered, so edges are caught earlier.

**Heart rate settle**:
Extending the cooldown until the user's heart rate has dropped by a set amount since the edge.
_Avoid_: recovery

### Safety and control

**Safety stop**:
The EOM stopping all stimulation by itself because of a sensor fault, a lost connection, a time limit or a heart-rate limit.

**Settings lock**:
A state where settings and mode changes are refused, either during Orgasm mode or after an orgasm. The firmware refuses them, whichever client sends them. Stopping always works, and switching to Manual ends the lock.
_Avoid_: menu lock

**Control command**:
An instruction from the app or a remote to change what the EOM is doing: set the mode, set the motor, trigger arousal, reset the denied count, report a heart rate, or change a setting.
_Avoid_: command (on its own, it also covers system requests such as restart or info), message, request

**Status snapshot**:
The EOM's state at one moment (arousal, pressure, motor, mode, phase, counters and recent raw pressure) as reported to the app.
_Avoid_: readings (the name of the Wi-Fi message that carries it), status packet

### Sessions

**Session**:
One stretch of use recorded by the app, from when a mode starts or pleasure rises above zero until shortly after it stops.

**Detailed recording**:
An optional session recording of every pressure reading, rather than the usual few samples a second.

### Toys

**Toy**:
A third-party device the EOM app drives to follow the EOM, connected through Buttplug or directly (such as an OSSM), separate from the vibrator the EOM drives itself.
_Avoid_: device (the EOM itself is the device)

**Toy control**:
One output on a toy, such as a vibrator or rotator, driven by hand or by following pleasure, arousal, pressure or denials.
_Avoid_: feature, actuator

**Toy level**:
One of the fixed strengths a toy control can produce; a Lovense vibrator has 20.
_Avoid_: step, speed

**Toy strip**:
The row of toy pills in the main screen header, shown while any toy is connected, that gives each toy's name, its strength and what its toy controls follow, with a stop button for each toy.
_Avoid_: toy bar, toy panel

### Firmware updates

**Release**:
A tagged, signed build of the firmware for every supported board, published together under one version.
_Avoid_: build (your own builds aren't releases), drop

**Release channel**:
Which releases an EOM is offered: an EOM on a stable release is offered only stable releases, and one on a beta is offered the newest release of either kind.
_Avoid_: track, update stream

# Control commands are applied by the tick, through a queue

Control commands arrive on the WebSocket and Bluetooth tasks, but edging state must only be changed by the task that runs `orgasm_control_tick()`. Parsers therefore validate a command, answer the sender straight away, and queue it. The tick drains the queue at its start. This replaced direct calls from each transport. Those calls changed edging state from several tasks without locks, and each transport had drifted into its own rules; for example, BLE motor writes skipped `max_pleasure`.

## Consequences

- A command takes effect up to one tick (20 ms at 50 Hz) after it arrives.
- Setting changes are the exception: they are applied immediately in the caller's task, because their values can be long strings and settings were already written that way.
- When the queue is full, new commands are dropped and reported to the sender as failed.

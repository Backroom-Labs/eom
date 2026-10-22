# Smart home integration (MQTT, Home Assistant)

The EOM doesn't publish its state to, or take commands from, MQTT, Home Assistant or other smart home hubs.

## Why this is out of scope

A smart home hub is shared and long-lived. What the EOM would send it (mode, arousal, edges, denials, orgasms, when a session starts and ends) is intimate, and once it's there it isn't private any more:

- other people in the household can usually see the hub's dashboards and logs
- the hub keeps history by default, and backups and cloud add-ons copy it elsewhere
- automations and other integrations can pass it on without the user noticing

Commands coming in from the hub would also let any automation or household member start or change a session.

The EOM's data stays between the device and the EOM app, which only the user runs. Session history lives in the app (ADR 0002).

## Prior requests

- #10: "MQTT / Home Assistant integration": publish state to and accept commands from MQTT / Home Assistant

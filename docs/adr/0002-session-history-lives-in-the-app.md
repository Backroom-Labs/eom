# Session history is recorded by the app, not the device

Sessions are recorded by the app into its browser's IndexedDB, not stored on the device. Logging to SPIFFS was rejected: it would wear the flash and doesn't fit well on the 4 MB Atom Echo. The cost is that a session is only recorded while the app is open and connected, and history lives in one browser rather than travelling with the device.

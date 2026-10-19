# Heart rate comes from an external ring through the app

The EOM gets heart rate from a ring (e.g. an O2Ring) that the app connects to and forwards about once a second. No heart-rate or SpO2 sensor (such as a MAX30102) is added to the device. Every heart-rate feature is a setting that is off by default and falls back to pressure-only detection when no heart rate has arrived for 5 s, so the EOM works the same without a ring.

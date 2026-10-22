# Sounds from the device

The EOM doesn't play sounds itself: no speaker, buzzer or I2S audio in the firmware, on the Atom Echo or any other board.

## Why this is out of scope

The EOM is used in private, often with other people nearby, so it has to be discreet. A device that beeps at every edge or denial gives away what's going on to anyone in earshot, and a sound you can't silence quickly is worse than none. Feedback stays where the user controls who sees it:

- the EOM app, on the user's phone or computer
- the device's LED

If a session needs audio cues, they belong in the app, where the phone's own volume, silent mode and headphones already decide who hears them (the roadmap's "audio buzzer in the app for cooldown" idea is this kind).

## Prior requests

- #6: "Atom Echo speaker sounds (I2S)": sounds for edge, denial, orgasm permitted and connected

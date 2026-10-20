---
status: superseded by ADR-0009
---

# Stay on buttplug 0.13.2

The app keeps the `buttplug` npm package at 0.13.2, patched with patch-package. Version 5.x is a rewrite of the library, so upgrading means reworking the toy integration rather than a version bump. Leave it out of routine dependency updates.

Superseded: the app never imported the npm 0.13.2 copy. Since commit 836e749 it ran a vendored Buttplug v4 client and WASM server from `eomui/buttplug/`. See ADR 0009.

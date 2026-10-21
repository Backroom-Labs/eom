# Releases are served from a public Pages site, not from GitHub releases

The source repo is private, so its release downloads return 404 to anyone who isn't signed in, and GitHub release URLs don't send CORS headers even on a public repo. Each tagged release therefore also publishes the built app and the firmware (`firmware/manifest.json`, `firmware/manifest-beta.json`, `firmware/<version>/firmware-<env>.bin`) to a separate public repo's GitHub Pages site, which the app fetches for Check for updates. GitHub releases stay as the archive, but no device or app reads from them.

## Consequences

- The Pages URL is built into installed apps and into each manifest's download URLs, so moving the site later breaks updates for older apps. That's why the repo moves to its own account before the site goes up.
- The site is the `eom/` folder of the org's `backroom-labs.github.io` repo rather than a project repo, because a public repo named `eom` can't sit beside the private `EOM` (GitHub repo names ignore case). The URL is the same either way: `https://backroom-labs.github.io/eom/`.

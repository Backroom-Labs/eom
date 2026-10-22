# Releases are served from the repo's own Pages site, not from GitHub releases

GitHub release downloads don't send CORS headers, so the app can't fetch a manifest or firmware image from them. Each tagged release therefore also publishes the built app and the firmware (`firmware/manifest.json`, `firmware/manifest-beta.json`, `firmware/<version>/firmware-<env>.bin`) to this repo's GitHub Pages site, which the app fetches for Check for updates. GitHub releases stay as the archive, but no device or app reads from them.

The site is the repo's `gh-pages` branch rather than GitHub's deploy-from-Actions, because that replaces the whole site on every deploy and every old firmware version would have to be rebuilt each time. The release pushes to the branch with the workflow's own token, so no extra secret is needed.

## Consequences

- The Pages URL, `https://backroom-labs.github.io/eom/`, is built into installed apps and into each manifest's download URLs, so moving the site later breaks updates for older apps. The repo is named `eom` in lowercase because the repo name is the URL path.
- The repo has to stay public for Pages to serve it on a free plan.

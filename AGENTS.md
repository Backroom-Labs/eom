# AGENTS.md

## Agent skills

### Issue tracker

Issues live in GitHub Issues on backroom-labs/eom, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Project

- Hardware tests run on an M5Stack Atom Echo with no pressure sensor, using the pressure simulator build.
- Tests: `pio test -e native` (firmware); `npm run check` and `node --test test/*.test.ts` in `eomui` (app). CI runs all three.
- Firmware notes: `docs/agents/firmware-notes.md`. Read before changing the build, sdkconfig, OTA or the control loop, or when flashing or reading serial from the Echo.
- App notes: `docs/agents/app-notes.md`. Read before changing `eomui` settings, the heart-rate ring code, or the screenshots.

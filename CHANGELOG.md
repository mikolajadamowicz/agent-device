# Changelog

## Unreleased

- Add `crash [app]` and `client.apps.crash()` to crash a running Android app with `am crash`, so tests can check crash recovery and relaunch. It needs Android 8.0 (API 26) or newer and local adb, refuses an app with no running process, returns once the crashed process is gone, and never falls back to `force-stop` or `kill`. iOS and every other target refuse it with `UNSUPPORTED_OPERATION`.
- Carry provider keyboard facts through snapshots. Appium captures, including wait polls and fill pre-captures, add one sequential keyboard visibility probe with a 500 ms timeout. Probe results preserve tap-time docked-tree checks; unavailable probes leave visibility unknown.

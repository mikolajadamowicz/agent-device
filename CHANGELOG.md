# Changelog

## Unreleased

- Add `settings talkback on|off` for ADB-backed Android targets. It merges the installed TalkBack service into the secure `enabled_accessibility_services` list instead of overwriting it, lowers `accessibility_enabled` only once no service is left, and refuses a target without TalkBack with `talkback_not_installed` before changing anything.
- Carry provider keyboard facts through snapshots. Appium captures, including wait polls and fill pre-captures, add one sequential keyboard visibility probe with a 500 ms timeout. Probe results preserve tap-time docked-tree checks; unavailable probes leave visibility unknown.

# Changelog

## Unreleased

- Add the `is enabled` and `is disabled` predicates, for checks such as a submit button staying disabled until a form is valid. `is disabled` passes only when the snapshot reports the element as disabled; an element whose snapshot does not report the fact counts as enabled, the same rule as the `enabled=` selector key. In the selector-first form, a bare `enabled` after the selector is now read as the predicate; write `enabled=true` to keep it as a filter.
- Carry provider keyboard facts through snapshots. Appium captures, including wait polls and fill pre-captures, add one sequential keyboard visibility probe with a 500 ms timeout. Probe results preserve tap-time docked-tree checks; unavailable probes leave visibility unknown.

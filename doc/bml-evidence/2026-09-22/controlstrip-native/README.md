# Native control-strip replay

Captured after isolated server restart at `0512f0105`. Disposable helper cleanup
completed successfully. All six views assert HTTP200 and no JS/resource failures.
The first500 body characters match the prior native S2 capture after normalizing
disposable usernames; this is a bounded text comparison, not pixel equivalence.
See results.json and full-page screenshots. Runner/log are
`/tmp/bml-controlstrip-native.js` and `.log` in the foreman container.

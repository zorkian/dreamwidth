<!--
GB.md

 Shared scalar to page-local native output bridge.

 Authors:
      Dreamwidth contributors

 Copyright (c) 2026 by Dreamwidth Studios, LLC.

 This program is free software; you may redistribute it and/or modify it under
 the same terms as Perl itself. For a copy of the license, please reference
 'perldoc perlartistic' or 'perldoc perlgpl'.


-->

The trusted coordinator constructs `createNativeOutput(options)` and passes its frozen `sink` as the seventh Context constructor argument. It supplies `checkDepth: () => context.recoveryCheckpoint()` for that same Context, plus actual application stylesheet and hook operations. The sink declaration transfers print cadence to the page session; default sinks retain Context cadence. Function/loop checks remain unchanged. CSS-buffered writes do not count as native prints.

`startCss` and `endCss` operate the same page session as raw/safe prints. `finish()` returns a copied byte/UTF8-flag frame after cleaner eof. Frames cross the bridge without text decoding or re-encoding; NativeOutput performs shared Perl flag-aware accumulation.

Only a coordinator-classified S2 program exception may use `runtimeError(alreadyEncodedDiagnostic)`. It ends one capture for exact text/css, prints through the current raw channel, and omits cleaner eof, matching LJ/S2.pm333–354. Open HTML CSS captures remain buffered. Cleaner, hook, depth, output-bound and other infrastructure failures terminalize the session and cannot return partial output. `abort()` discards access to pending output. All completions prevent later writes.

Build content and S2 normally, then from src/s2/target/javascript run:

```sh
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
/opt/dw-node24/bin/node --test dist/tools/native-output.test.js
```

The tests use selected independent retained GO traces, fixed trusted raw-byte native compiler fixtures, and actual source-proven/recovered products with installed shared scalar and Context brands. Identity CSS/embed callbacks qualify bridge mechanics only. Installed hooks, child wiring, HTTP completion and final privacy rechecks remain the general coordinator's obligations. No stored generated Perl is executed by the oracle. No serving completeness claim follows from these component tests.

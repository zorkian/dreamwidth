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

Focused tests keep safe/raw output ordering, CSS capture, byte/UTF8 frames,
fixed trusted source execution and error terminality. The renderer and its
coordinator must also prove actual HTTP completion, public visibility and final
privacy rechecks. This component test alone is not a serving claim.

Context recursion/deadline stops have private runtime authority. The bridge
propagates them without poisoning the page; arbitrary lookalike errors and
cleaner, hook or page-bound failures remain terminal. That authority is not
exposed through `s2.runtime`. Nested application callbacks use the explicit
run boundary while the outer four-second deadline and page/worker limits remain
in force. The fixed native checkpoint-failure trace is a focused source
control, not a requirement for exhaustive internal checkpoint-byte parity.

Initialization uses `initialization: true` and the same frozen sink supplied to
Context from its construction. After prop_init/modules_init, the trusted
coordinator calls `beginRendering()` once. This replaces the current printer
pair without clearing saved CSS scratch; no temporary sink or second cleaner
is used. The type remains fixed in options. An initialization failure can use
the coordinator-classified diagnostic path without starting rendering or
ending an implicit text/css entry. Source-compiled programs exercise suppressed
initialization and rendering on one Context/sink. Stored generated Perl has no
renderer path.

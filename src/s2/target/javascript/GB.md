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

Context checkpoint recursion/deadline stops carry private WeakSet authority from the runtime scalar module. The bridge rethrows these without poisoning the page; arbitrary lookalike errors and cleaner/hook/page bounds remain terminal. The outermost function unwind cancels the program deadline before diagnostic output, matching native alarm lifetime while retaining the independent page/worker deadline. The brand is not exported through `s2.runtime`.

The fixed native checkpoint-failure trace proves exact bridge partial bytes and current-printer/no-eof completion. Actual recursive native, source-proven and recovered programs now agree at the same configured bound (277 bytes). The recovery frontend recognizes only NodeFunction.pm327's exact first generated entry-prologue AST, immediately followed by the generated Context argument declaration, and removes that statement because Context.invoke already owns the shared every-16th compiled-function entry check. Counter globals and standalone check_depth outside this proven form are rejected. No per-layer persistent counter remains. Mixed source/recovered dispatch counts once per entry.

Native NodeFunction.pm omits this prologue in standalone OO compiler output; persisted LJ deployment uses the non-OO registration envelope. Historical accepted closures without the prologue continue to enter through Context.invoke, with the same shared checkpoint ownership; no new trust classification is inferred from omission.

S2.pm447–471 resets entry cadence on each run_function, including host re-entry from plural (LJ/S2.pm2909) and date ordinal (4072). G2 must use an explicit run boundary for those reset points. Native nested run_function cancels the outer alarm; JS deliberately retains its outer four-second deadline on nested entry, avoiding unbounded execution after re-entry. This protective divergence does not widen worker/page limits. Symbolic-frame versus native call-site recursion granularity remains separate general-runtime follow-through; no general call-site rewrite is made here.

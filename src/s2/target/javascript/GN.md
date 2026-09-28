<!--
GN.md

Source-compiled S2 invocation locations and explicit run boundaries.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Source-only invocation and error boundaries

The current S2 source is checked and compiled by the installed JavaScript
backend. The resulting layer runs in the isolated renderer. Stored generated
Perl is not an input to this path.

The compiler records source-backed call locations for useful diagnostics.
`Context.runBoundary(callback, origin)` and `runNativeFunction(name, args,
origin)` mark application runs, including initialization, page printing and
reached plural/date callbacks. Ordinary function and method dispatch stays
inside the current run. The outer execution deadline and the worker's wall,
heap and output limits still apply across nested runs.

Private program-error and execution-stop identities distinguish a valid S2
diagnostic from an infrastructure failure. Unknown exceptions, including stack
exhaustion, remain terminal and cannot turn partial output into success.
Neither generated code nor author data may forge those identities or a Context.

Run the focused source compiler, invocation and page-output checks from
`src/s2/target/javascript` inside the devcontainer:

```sh
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
/opt/dw-node24/bin/node --test dist/tools/compile-active.test.js dist/tools/invocation.test.js dist/tools/native-output.test.js
```

Fixed trusted S2/native probes remain useful independent controls for source
language behavior and safe page output. Rendered page, links, forms, no-JS,
privacy and sanitizer checks are the acceptance boundary; physical-line and
checkpoint internals do not require an exhaustive native parity matrix.

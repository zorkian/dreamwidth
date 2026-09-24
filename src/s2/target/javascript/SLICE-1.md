<!--
SLICE-1.md

Offline S2 JavaScript fixture compiler and runtime guide.

Authors:
     Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# S2 JavaScript slice 1

This package checks a fixed set of trusted S2 fixtures against the retained Perl
backend. It compiles through the existing Perl tokenizer, parser, and checker,
then runs generated JavaScript with a synchronous TypeScript runtime in a fresh
Node process for each positive case. The Perl oracle runs in a separate process.
The generated JavaScript process never launches Perl.

From `$LJHOME` inside this worktree's devcontainer, run this one command:

```sh
cd src/s2/target/javascript && npm ci --no-audit --no-fund && npm run check
```

The command uses the local `package-lock.json`, checks TypeScript in strict mode,
builds disposable JavaScript, exercises failure paths, compiles the exact nine
mandatory cases, and compares positive output byte for byte. Each positive
artifact is compiled twice and must match byte for byte. The negative syntax
case must fail with a source and line diagnostic and is never executed. Missing
fixtures, skipped or duplicate cases, empty output, and mismatches fail the run.
Generated artifacts live in a temporary directory and are removed afterward.

## Artifact ABI version 1

The Perl fixture bridge emits a JSON artifact with `abi: 1` and ordered `layers`.
Each layer has a source path, a generated JavaScript variable name, and code.
Both the artifact loader and generated code check ABI version 1 before use.
The loader evaluates each trusted layer's code and takes its returned `Layer`;
it assigns the source path for diagnostics and links the ordered layers into one
`Context`. This direct code evaluation is limited to checked-in test fixtures.

Generated code calls `s2.makeLayer()` and registers layer information, classes,
properties, and functions on that layer. A generated function receives `ctx` as
its first argument. Methods also receive the S2 object, followed by S2 arguments.
`ctx.getFunction(signature)` resolves through the linked context at call time,
so a parent entry point sees a child's override. `ctx.getMethod(object,
signature, layer, line, isSuper)` walks the class ancestry, keeps a method frame
for `$super`, and reports the layer source and available S2 dereference line on
failure. `ctx.prop` contains property values after ordered layer overrides.
`ctx.print` writes synchronously. `ctx.builtin` contains only the typed fixture
string callbacks. `s2.builtin.construct_Color` supplies the one constructor
needed by the fixed array fixture.

The Perl bridge uses one checker for a two-layer compile, but compilation and
runtime linking are separate steps. The parent core is compiled before the child
layout; the runtime later links both compiled layers in that same order. The
Perl oracle evaluates the same ordered stack through `S2::make_context`.

## Supported behavior and boundaries

The fixed cases cover printing and interpolation, arithmetic with truncating
integer division, conditions and S2 truth values for integers, strings, arrays,
hashes, objects, and typed null objects, ranges and array iteration, array/hash
literals and property values, class methods and `$super`, linked function and
property overrides, and Unicode codepoint length and substring. The Unicode
fixture uses a supplementary character and the Perl oracle's string builtins.
Exact UTF-8 bytes are compared, including whitespace. Output is never sorted or
normalized.

This is a compatibility foundation for this subset. Hash iteration, broad
integer limits, all collection operations, complete string builtins, production
Color behavior, user layers, all stock styles, source maps, and a compiler
frontend rewrite remain deferred. Unsupported hash/string foreach compilation
fails explicitly. The legacy `runtime/s2runtime.js` is an older browser demo and
is not loaded by this Node fixture runner. This package is not a journal-serving
endpoint and does not load account, policy, database, or cache data.

Only the checked-in manifest in `tools/run.ts` is accepted by the comparison
command. Subprocesses receive a small environment containing only `PATH`,
`LANG`, and `HOME`; they do not inherit application credentials. Each compiler,
oracle, and Node execution process is limited to 10 seconds and 512 KiB on each
output stream (1 MiB combined). Timeout or overflow fails the test. These are
accidental-loop protections for trusted fixtures, not containment for hostile
tenant code. The loader uses direct JavaScript evaluation, not a security
sandbox.

To add a fixture builtin in a later scoped package, first declare it in the S2
fixture, then implement the matching synchronous callback in
`runtime/s2runtime.ts` and the matching Perl oracle callback in
`tools/fixture-pipeline.pl`. Verify the Perl callback against the retained S2
builtin semantics before comparing JavaScript. Extend the manifest only after
the package boundary is changed; slice 1 acceptance always runs exactly nine
cases.

<!--
README.md

Active generated-program recovery component and independent qualification.

Authors:
      Dreamwidth contributors

 Copyright (c) 2026 by Dreamwidth Studios, LLC.

 This program is free software; you may redistribute it and/or modify it under
 the same terms as Perl itself. For a copy of the license, please reference
 'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Active S2 recovery

The recovery frontend reads the authoritative decompressed generated Perl blob,
parses every token into a closed AST, and lowers registrations and functions to
JavaScript. It needs no current S2 source or checker. The generated JavaScript
contains the installed declarative executor plus JSON-serialized IR; stored
Perl substrings never become executable JavaScript. Database Perl is never
passed to eval, Perl -c, BEGIN processing or an op-tree extractor.

The deployed persistence path is `LJ::S2::layer_compile`, which omits a format
option and uses `S2::Compiler`'s default `perl` backend. The separately requested
`perloo` compiler format emits an OO standalone layer, not this deployed
persistence envelope. Its absence here does not restrict journal style names.
Historical persisted constants and two-element Color constructor tuples are
handled declaratively. Unknown historical deployed syntax remains unfinished
recovery work rather than a reason users must recompile their layers.

Lexical bindings, registration identities and callable forms are checked.
Strings and comments are inert. The exact embedded layer ID must match the
parent's authoritative input. Builtin references map to explicit runtime host
keys; the coordinator must validate `hostCalls` against its installed source
capability registry before using the artifact. Arbitrary computed callables,
module loading and non-S2 calls are rejected. Hash construction uses the agreed
`runtime.makeHash` operation, including duplicate-last-wins and prototype keys.
Context is usable only as a generated VTABLE/PROPS receiver or a passed
argument. The executor separately refuses Context hash access and mutation and
binds host calls to the executing branded Context, never a nominated lookalike.
Source authority and output safety remain the serving coordinator's duties.

Registration metadata, exact historical function aliases and call maps are
retained. Super calls use the already-resolved emitted dispatch class directly,
without looking up its parent again; missing aliases are not hidden by ancestor
fallback. Raw and safe statements invoke their defining function's distinct
output channels. Notags calls remain distinct. A caller's ownership does not
silently upgrade or alter those instructions.

The shared runtime supplies `registerClassMetadata`, `registerGlobalFunction`,
`runtime.makeHash`, `runtime.recoveryCheckpoint` and authoritative
`runtime.isContext(value)` branding. The checkpoint integrates
with the native timeout/depth policy; process/parser bounds are separately
supplied by the compilation coordinator. This component does not create an
unbounded production compilation service or widen renderer permissions.

## Focused checks

From `src/s2/target/javascript` inside the owning devcontainer:

```sh
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc
node --test dist/tools/recovery.test.js
```

All execution uses the installed shared runtime, private WeakSet Context brand,
PV/number operations and byte sink. There is no test-only runtime/brand adapter.
`native.pl` compiles raw bytes from only the maintained `program.s2` and
`override.s2` fixtures and executes that trusted compiler output as an independent
native oracle. It emits base64 program/output bytes and explicit UTF8 flags,
never decoded program text or a Unicode-normalized expected result. Stored
compdata and caller source never reach this oracle.

The fixed byte expectations include literal 猫é, byte size/foreach/comparison,
invalid-UTF8 scalar reversal and unchanged direct-print list-context reversal.
Wide numeric lexemes remain strings until the installed IV/UV/NV implementation
constructs them; 9007199254740993 and 94906267*94906267 are exact native controls.
The source-proven and recovered forms of the same actual programs run through
the same installed scalar/profile/Context/output ABI and match the independent
raw native outputs. Source B or missing source prevents source correspondence,
but recovery still executes the authoritative active A bytes. The coordinator
attaches the trusted offline-extracted `ArtifactCompiler.scalarProfile`, which
is available at setup without any current layer source; input blobs never
supply a profile or Context brand. Profile/dependency/cache identity remains
the trusted coordinator's responsibility.

Operand capture, list/collection construction, lvalues and foreach aliases use
the shared runtime cells. Numeric coercion, comparison, overflow and output do
not introduce a second codec or a JS Number safe-range refusal. Flat concat IR
preserves native delayed operand reads without nested JS expression/evaluator
stack growth. Evaluation context is restored by the shared try/finally helper;
assignment/arithmetic are scalar, calls/print arguments are list, expression
statements are void, and returns inherit the caller.

`stock-native.pl` compiles raw core2 plus all 58 current layout sources for
registration coverage, then executes native Venture nested-comment count/font
helpers and the same 2,000-term source workload used by the shared scalar tests.
Recovered helpers and long output match those independent expectations. Its
fixed trusted-source process has explicit memory/CPU/wall/output bounds and
fresh compiler processes for layout graphs. It never executes stored blobs.
Other tests retain historical records, exact aliases, safe/raw/notags, deletion,
prototype keys, hostile suffixes, quoted token names and authoritative active
digests, plus independent frontend/executor Context mutation/forgery controls.

Stock catalog parse/lower and registration-instantiation runs are useful syntax
coverage, not full page execution parity. Expanded native outputs, inventories,
logs and generated artifacts belong in ignored task output. Independent cache,
partial-write, mixed-generation, host integration and real page parity checks
remain required before claiming general replacement completion.

The executor's inherited semantic ports cite `src/s2/S2.pm` and Node* generated
operations and retain the applicable LiveJournal GPL notice. The independent
frontend, tests and fixtures carry the Dreamwidth Perl-license headers.

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
Source authority and output safety remain the serving coordinator's duties.

Registration metadata, exact historical function aliases and call maps are
retained. Super calls use the already-resolved emitted dispatch class directly,
without looking up its parent again; missing aliases are not hidden by ancestor
fallback. Raw and safe statements invoke their defining function's distinct
output channels. Notags calls remain distinct. A caller's ownership does not
silently upgrade or alter those instructions.

The shared runtime supplies `registerClassMetadata`, `registerGlobalFunction`,
`runtime.makeHash` and `runtime.recoveryCheckpoint`. The checkpoint integrates
with the native timeout/depth policy; process/parser bounds are separately
supplied by the compilation coordinator. This component does not create an
unbounded production compilation service or widen renderer permissions.

## Focused checks

From `src/s2/target/javascript` inside the owning devcontainer:

```sh
node node_modules/typescript/bin/tsc --strict --noUncheckedIndexedAccess --esModuleInterop --module Node16 --target ES2022 --rootDir . --outDir artifacts/recovery-test tools/recovery.test.ts
node --test artifacts/recovery-test/tools/recovery.test.js
```

The test adapter explicitly supplies the agreed metadata/checkpoint/hash ABI
against the preserved base runtime. It does not stand in for integrated G1
validation. `native.pl` compiles only the fixed maintained `program.s2` and
`override.s2` fixtures and executes that trusted compiler output as an independent
native oracle. It never executes stored compdata or accepts caller source.
The fixed output checks cover custom overrides, inherited super aliases,
properties, object fields, downcasts/null, loops/ranges, control flow,
reverse/pop/push, Unicode and hash foreach without assuming native key order.
Other tests cover historical records, safe/raw/notags, deletion, prototype keys,
complete hostile suffixes, quoted token names and authoritative active digests.

The native wide-integer controls are 9007199254740993 and the product
94906267*94906267 = 9007199515875289. Exact general integer ABI support is still
required: literals beyond the current safe representation return a named gap;
operations crossing it throw a named execution gap before rounded output.
This is an explicit unfinished implementation edge, not a permanent supported
integer subset. Cache and serving integration must expose this honestly and
complete the shared integer semantics.

Stock catalog parse/lower and registration-instantiation runs are useful syntax
coverage, not full page execution parity. Expanded native outputs, inventories,
logs and generated artifacts belong in ignored task output. Independent cache,
partial-write, mixed-generation, host integration and real page parity checks
remain required before claiming general replacement completion.

The executor's inherited semantic ports cite `src/s2/S2.pm` and Node* generated
operations and retain the applicable LiveJournal GPL notice. The independent
frontend, tests and fixtures carry the Dreamwidth Perl-license headers.

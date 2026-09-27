<!--
NATIVE-ENCODING.md

Installed native encoding profile and converter qualification.

Authors:
     Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Installed native encodings

`tools/native-encoding-profile.pl` extracts the installed `LJ::ConvUTF8` registry,
Map8 UCS2 mappings, multibyte Unicode::Map mappings and Japanese code-unit maps.
The profile is setup data, generated outside Git. No conversion invokes Perl,
loads a selected module, reads a mapping file or accesses a database at request
time. Setup has sticky DBI connect/connect_cached tripwires.

Run from `src/s2/target/javascript` inside the devcontainer:

```sh
perl tools/native-encoding-profile.pl > /tmp/native-encoding-profile.json
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc
node --test dist/tools/native-encoding.test.js
```

The test bounds profile extraction to 30 seconds and 16 MiB stdout; its native
conversion probes have a 10-second/1-MiB bound. These are test/setup bounds, not
new serving permissions. The caller supplies conversion input/output byte
limits, and existing job deadline/heap bounds still apply.

## Integration contract

`loadNativeEncodingProfile(raw, scalarProfile)` validates and copies the profile
into private storage and returns an opaque issued token. It does not certify
that arbitrary caller-supplied tables were produced by the installed extractor.
The coordinator must bind the exact profile bytes, trusted producer, converter
implementation and reviewed scalar-profile identity into its artifact identity.
`verifyNativeEncodingSources(profile, read)` independently rehashes each installed
file before use. A matching self-asserted manifest alone is not authority.

The source closure includes the producer, Perl executable, loaded module and XS
files, complete Map/Map8 directories (including aliases), and LJ/TextUtil.pm.
A setup snapshot must be regenerated and its identity updated after dependencies
change. It is not a portable charset catalog.

`convertNativeToUtf8(profile, name, input, {maxInputBytes,maxOutputBytes})` returns
`{kind:'converted',value:NativeString}` or
`{kind:'conversion-failure',reason:'missing-charset'|'unsupported-charset'}`.
Supported conversion errors, invalid profiles and resource failures throw;
they must not become the native missing-old-encoding fallback. The installed
branches qualified here return a value; none returns undef. Undefined input
reaching a converter becomes empty, while the caller must skip source undef
before selecting a converter.

`nativeUtf8Valid` and `nativeTextOut` reproduce the installed validity and reached
replacement behavior. Selection remains with the caller: ASCII bypass before
codes lookup, source codes/oldenc selection, and text_out only on the source
error path. The converter does not implement Entry/Talk selection or erase their
original witnesses.

## Native behavior and provenance

The qualified installation is Perl 5.34.0, Unicode::MapUTF8 1.14,
Unicode::Map 0.112, Unicode::Map8 0.13, Unicode::String 2.10, Jcode 2.07,
Encode 3.24 and Unicode::CheckUTF8 1.03. Its LJ wrapper exposes 567 names,
including aliases: 180 Map8, 44 Map, five String and ten Jcode converter records.
Tests independently call the actual native helper for all names on three fixed
inputs and compact distinct stateful, flagged, malformed and Unicode cases.

Map8 emits UCS2 before whole-buffer String conversion; unmapped bytes disappear.
Map uses longest mapping groups and its native unmatched-input stepping.
The installed malformed CNS mapping's loader returns false; native conversion
returns U+3000 rather than throwing. That returned state is recorded explicitly.
Jcode follows the installed Encode framing, partial EOF, fallback and JIS/h2z
roundtrip. Unicode::String preserves its logical-length/raw-byte distinction,
BOM/padding, UTF7 and surrogate behavior. UTF8 identity preserves the PV flag.
Validity accepts installed surrogate sequences and rejects selected ASCII
controls; text_out replaces NUL/high characters only when validity fails.

Algorithms are adapted from the installed modules and matching upstream source:
[Unicode::Map 0.112](https://cpan.metacpan.org/authors/id/M/MS/MSCHWARTZ/Unicode-Map-0.112.tar.gz),
[Unicode::String 2.10](https://cpan.metacpan.org/authors/id/G/GA/GAAS/Unicode-String-2.10.tar.gz),
[Encode 3.24](https://cpan.metacpan.org/authors/id/D/DA/DANKOGAI/Encode-3.24.tar.gz),
and [Unicode::CheckUTF8 1.03](https://cpan.metacpan.org/authors/id/B/BR/BRADFITZ/Unicode-CheckUTF8-1.03.tar.gz).
Map/Map8/String and Jcode/Encode retain their Perl terms and author attribution.
The converter retains the Unicode legality notice and inherited LiveJournal
GPL notice for text_out. Generated mappings stay outside Git; ordinary builds
never regenerate test expectations from the JavaScript implementation.

This component proves installed conversion behavior. Selected-data freshness,
worker isolation and final HTTP projection require the serving integration.

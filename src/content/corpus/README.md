<!--
README.md

Provenance and scope of the native Dreamwidth cleaner test inventory.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Native cleaner corpus

`native-inventory.json` indexes every TAP assertion in the fourteen unchanged
`t/cleaner*.t` files at base `c725406eeed4b239dbb68af0a50f505f4b83b8df`.
Each case has a stable source-file/TAP-number ID, source hash, source-line
locator, native context, predicate, TODO state and exact native TAP line.
`native-logs/` retains the complete output regenerated in this implementation
worktree's own devcontainer. The source files remain the authority for input,
options and expected predicates. Cases with generated descriptions point to
their named input definition; other dynamic cases list possible assertion
sites and retain the stable TAP ID. A later explicit `html_raw0` replay is a
**new** record, never a relabeling of a comment, Markdown, subject, email,
embed or streaming case.

The discovery count of 1,112 source-derived assertion instances was four
short: `cleaner-resource-loading.t` executes twelve assertions, not eight.
All fourteen suites passed in the owning container with **1,116** runtime
assertions. Five `not ok` results carry Perl TODO directives: one embed TODO
and four `clean_event` SVG/MathML gaps. They are retained security-gap evidence,
not desired sanitizer output.

The native suite helper `t/lib/ljtestlib.pl` replaces
`DW::Proxy::get_proxy_url` with `http://proxy.url` and stubs language helpers
where imported. That URL is a test fixture, not a production proxy decision.
Configured and absent proxy behavior needs a separate real-module test with a
synthetic key. Native TAP predicates are not an exact input/output oracle by
themselves; exact retained cleaner outputs and the per-case Perl/TypeScript
difference ledger belong to the later content replay harness.

Regenerate from the repository root inside the owning devcontainer:

```sh
mkdir -p /tmp/slice4-native-sol
for suite in t/cleaner*.t; do
    name=${suite##*/}
    perl "$suite" > "/tmp/slice4-native-sol/$name.log" 2>&1 || exit
done
cp /tmp/slice4-native-sol/*.log src/content/corpus/native-logs/
/opt/dw-node24/bin/node src/content/tools/build-native-inventory.mjs
```

Regeneration only uses this container's own test DB. Some original suites use
temporary test accounts and normal helper writes; run them in an isolated
development database. Source hashes and log hashes in the manifest catch
unexpected changes.

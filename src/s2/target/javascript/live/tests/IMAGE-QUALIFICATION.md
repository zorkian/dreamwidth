<!--
IMAGE-QUALIFICATION.md

Offline configured-image membership and synthetic-signature qualification.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Offline configured-image qualification

This test host is not a production image verifier. The ordinary live service
still requires `imageProxy: not-configured`. No production proxy exchange, parser,
secret, HTTP service or additional render child is introduced. See [COMPONENT.md](COMPONENT.md)
for the existing worker and stock-artifact build instructions.

After building and staging the actual content/worker package, run inside the own
devcontainer from the checkout root:

```sh
/opt/dw-node24/bin/node src/content/node_modules/typescript/bin/tsc -p src/s2/target/javascript/live/tests/image.tsconfig.json
S2_LIVE_TEST_ARTIFACT=/absolute/path/to/stock.json /opt/dw-node24/bin/node --test src/s2/target/javascript/dist/live/tests/image-qualification.test.js
perl -c src/s2/target/javascript/live/tests/image-plan.pl
```

The artifact requires its verified `.runtime` closure and `.sandbox` launcher.
Tests also run as an ordinary nonroot UID that owns the staged runtime. Native
Perl planning runs offline before the sandbox child starts. All keys are declared
synthetic test material in a fresh `/tmp/slice4-image-test-*` directory owned by
the test process; only that test-created directory is removed afterward. The
actual configured proxy salt is never read or modified by this helper.

## Independent authority

The Node host owns frozen original raw markup and context. Installed maintained
`HTML::Parser` token positions derive each image's exact raw attribute span from
unflagged UTF8 bytes. A separate retained `clean_event` call records actual
`https_url` eligibility and ordering. These views must agree bijectively before
the host accepts a plan. There is no regex HTML lexer and no worker-derived
membership authority. UTF8 byte offsets convert to UTF16 only through complete,
strictly decoded prefixes; non-BMP text and partial-prefix refusal are tested.

This offline plan intentionally has a finite grammar: matched ordinary
`div/p/span/a` flow, image `src` and quoted conventional descriptor-bearing HTTP
`srcset`, plus script/comment decoys. Duplicate attributes, incomplete/unquoted
values, parser recovery masquerading as comments, mismatched or implicitly
repaired nesting, ambiguous srcset, unsupported elements and eligibility/order
mismatches refuse the plan. This restriction qualifies the synthetic exchange;
it does not narrow the production cleaner's body grammar. Richer host-side
membership would need separately reviewed implementation before enabling a real
proxy path.

Only the actual cleaner in one sandboxed test child reads the staged DOM/CSS
libraries. The Node host loads builtins and pure production modules/type contracts,
never DOM/CSS libraries. The child uses the existing `ContentWire*` types for one
bounded optional request/resolution exchange. Its only extra read grant is its
exact compiled test-worker file; no host test source, key file or browser package
is granted. The original seccomp launcher, Node permission denials, 128MiB heap,
2MiB wire/output ceiling and whole-exchange 10-second deadline remain in force.

Before signing, the host requires the exact original body/context hash and the
complete independently derived request list: ordinals, attributes, decoded URLs,
raw spans, raw text and count. The maintained Perl proxy helper supplies public
expected signatures under the same declared synthetic salt. The Node host signs
independently using the retained MD5-prefix construction. No journal is supplied
to the native qualification, so its real source component is `-`; this test makes
no claim about production journal/account resolution. Known-host/site upgrades,
empty-domain non-upgrade, relative-origin adaptation and protocol-relative URLs
are checked separately. Inline HTTP CSS resources remain unproxied.

Forgery controls mutate URLs while preserving valid slices; replace image claims
with CSS, navigation, attribute, comment or eaten-script decoys; swap ordinals;
omit/duplicate candidates; alter spans and surrogate boundaries; or change the
original body/context with the old hash. Every forged claim must produce zero
host signing calls. A positive control must actually sign all independently
eligible candidates. These mutations occur at the host boundary independently
of child output, so a verifier that merely echoes the child cannot pass.

The child must fail to read the actual synthetic key file before it can process
the positive exchange. A separate negative-control launch grants only that file
and must exit with the dedicated denial-probe failure code, proving the probe
really exercised a readable existing file. No key value travels through child
arguments, environment or protocol. Public signed URLs are the only signing
results returned to the cleaner.

<!--
GENERAL-SUBJECT.md

Native subject cleaning and its neutral public-helper boundary.

Authors:
      Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
 the same terms as Perl itself. For a copy of the license, please reference
 'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Subject operations

`cleanGeneralSubject` implements the `clean_subject` and `clean_subject_all`
paths in `cgi-bin/LJ/CleanHTML.pm`. It consumes and returns a copied `PageChunk`
(byte payload plus Perl UTF8 flag). It is separate from entry-body cleaning and
from the page-local safe-print session. The `subject` mode retains the native
seven formatting tags; `all` uses the native textonly options, including their
special-tag/helper behavior. Neither mode uses a DOM text extraction shortcut.

The no-angle fast path preserves the input scalar flag and skips cleaner evals.
The existing private-viewer request-auth removal also applies on that path.
Parsed input uses maintained htmlparser2 token spans, the native literal set,
HTML::TokeParser text consumption, and the canonical HTML::Entities mapping.
ASCII-only flagged parser input yields byte tokens; non-ASCII flagged input
preserves native parser flags. Word/space membership comes from the required neutral `characterClass` callback.
The installed adapter binds the reviewed native profile helper to the owning Perl
version and each scalar UTF8 flag; JavaScript Unicode tables are not authority.
Native byte classes and flagged Unicode classes differ, including Latin names,
NBSP trimming and version-specific characters. The tests extract the installed
profile through the trusted producer and invoke its pure membership helper.

Attribute serialization follows native entity
and `no_utf8_flag` behavior, including duplicate names and bare attribute values.

A single result carries `exceptionEffect`: `none`, `cleared`, or
`set(message: PageChunk)`. Effects compose in reached token order. Successful
CLEAN handler evals clear the register, including denied-output handlers.
An inner stylesheet helper effect is overwritten by its enclosing successful
eval. Later user, localization, URL, or installed hook effects can replace it.
`clearsException` records whether a CLEAN eval was reached; the effect union is
the authority for the final register. Unknown helper/infrastructure exceptions
propagate unchanged instead of becoming native diagnostic strings.

# Installed helper boundary

The caller supplies synchronous named public operations, not a module resolver:

- `expandUser` receives the original optional name and optional site. Missing
  and empty differ. Name/user/comm presence precedence is retained. `no_link`
  comes from actually emitted open anchors, not generic parser nesting; `all`
  emits no anchors and therefore passes false.
- `templateError`, `videoError`, and `markupError` use only their fixed native
  localization keys and source-derived arguments.
- `validStylesheet` receives href/host/path even for denied subject link output.
  Its decision is undefined, numeric 0/1, or a native scalar `PageChunk`.
  Other numerics use their native PV, avoiding JavaScript Number formatting.
  Digits-only values equal to one retain href; other Perl-true values replace
  it. Empty and literal `0` are false.
- `rewriteBlockedHref` runs once per stored href before site expansion or
  canonical trimming. `expandSiteUrl` owns the native `lj:`/`site:` modes.
- `normalizeImageUrl` runs for the canonical src followed by HTTP srcset
  candidates, even though image tags are denied in these modes. The installed
  adapter supplies the source's empty journal and empty ditemid defaults and
  its declared URL policy. This operation itself has no fetch or signing API.
- Optional `embedTransform` represents installed hook presence. It receives
  copied native-shaped S/E/T tokens with decoded attributes, original order,
  raw spans, and literal-text flags; nocheck is zero and wmode is absent.
  Capture and residual eating follow native event order. Absence is an installed
  fact rather than an unsupported-format policy.

The inherited namespace-attribute branch uses the ordinary subject deny and
escaped-text path. Its native scripting-value consumption remains unchanged.
The tests retain independent native values for benign cases and name the
changed output explicitly. This and no-angle auth removal are deliberate
policy adaptations, not raw-byte parity claims for those branches.

# Validation

From the own devcontainer's `/workspaces/dreamwidth/src/content`:

```sh
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc -p tsconfig.json
/opt/dw-node24/bin/node --test tests/general-subject.test.mjs
/opt/dw-node24/bin/node --test tests/page-output.test.mjs
```

The subject test invokes actual retained CleanHTML with HTML::Parser 3.85 in a
bounded independent Perl process (256 MiB address space, 10 CPU seconds,
15 wall seconds, 1 MiB captured output). Fixed public-helper stubs expose
reached calls and native eval effects without database or network operations.
Both modes are compared for raw bytes, scalar flags, helper inputs/order and
the final exception register. Configured blocked links, stylesheet decisions,
denied images, and a declared synthetic embed hook are exercised separately
from the installation's hook absence.

Each operation uses the caller's input/output/time bounds. The production
coordinator must charge these operations and helpers to its existing total
job budget, resolve installed helpers, and bind the exact module closure and
implementation digests. The standalone tests do not establish a serving path.

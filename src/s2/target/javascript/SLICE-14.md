<!--
SLICE-14.md

Anonymous public comment rendering and read expansion.

Authors:
    Dreamwidth contributors

Copyright (c) 2026 by Dreamwidth Studios, LLC.

This program is free software; you may redistribute it and/or modify it under
the same terms as Perl itself. For a copy of the license, please reference
'perldoc perlartistic' or 'perldoc perlgpl'.
-->

# Slice 14: public comments

## Shared compiler compatibility

The shared Dreamwidth S2 compiler now checks declaration initializers in `for`
loops in their enclosing scope, using the existing assignment type rules. This
also rejects malformed initializers that were previously accepted, including
initializing an integer from a string or referring to an undeclared variable.
Production user-layer recompilation is affected; stored compiled layers remain
unchanged until recompiled. Valid stock core2 and layout native Perl output is
unchanged. The JavaScript core executable hash changes because lexical references
now carry the correct scope metadata; source hashes and artifact verification
rules remain unchanged.

## Anonymous expansion compatibility

On pages with a selected comment tree, anonymous `LJ_cmtinfo.canAdmin` is `0`
instead of native `null`. Both deny management authority. The retained
`getUnexpandedComments` loops over all keys and calls `hasOwnProperty` on their
values; native `null` otherwise breaks expand-all. No-comment pages retain the
native representation. Retained JavaScript and general JSON serialization are
unchanged. Only exact frozen stock expand-all AJAX handlers point at the TS
listener; their fallback links remain at the canonical retained application.

Nonzero effective comment counts require a fresh `site-config.pl` export containing
`maxComments` capability facts. Re-export the private configuration and restart
when upgrading. The existing capability snapshot and selected-data reread bind
these facts; this does not implement posting limits or request defenses.

## Selection and privacy

The private anonymous viewer admits canonical numeric Entry URLs with finite
`page`, `thread`, `destination_thread` and `expand_all=1` queries. Read expansion
returns a complete Entry page; retained JavaScript extracts `.dwexpcomment`.
Thread IDs follow native low-byte alias semantics. Generated IDs use the entry
anum. Missing threads fall back to the root page; explicitly selected screened
or deleted leaves remain blank structural stubs. Reply links go to the retained
application, and anonymous quick reply follows that link because no QR form is
present. No posting, editing, management or authentication endpoint is added.

Only owner/node-specific headers are loaded, at most 10,000 plus a refusal
sentinel. Root depth is zero; maximum structural edge-depth is 1,000, checked
iteratively before recursive model projection. Depth 1,001 and cycles refuse
without truncation. These are resource boundaries, not native account limits.
Stock visual nesting still flattens after its native threshold. Comment elapsed
seconds use the approved entry logtime, independently of its eventtime.
Hide/show captions use the retained plural helper and showable-child count.

Public A/F comments are selected using native root pagination, first-child and
subject-only rules. S/D headers retain only necessary structure. Suspended
authors still affect native count/topology but their text and profile never
reach the child. Unknown states refuse rather than being treated as hidden.
Entry privacy is checked before comment reads. Hidden invalid UTF8 is neither
loaded nor decoded. Author identities, public profile/picture dependencies,
selected header/text/properties and request context participate in the global
bracket and complete final reread. Persistent changes return fixed 409 before
HTML release; no distributed atomicity or arbitrary ABA guarantee is claimed.

`poster_ip`, manager-only and unknown properties never enter the model, worker
or cmtinfo. Parent dependency digests may cover their changes. Visible identity
or non-personal authors, unknown8bit, subject icons and edit-time metadata are
explicit encountered refusals in this bundle; hidden identity authors do not
trigger those paths. Public imported-source labels are separately escaped,
and admin-post presentation is supported. Existing registered/anonymous
pictures reuse the qualified picture domain.

Known all/reg/friends reply policies and screening enums govern posting.
`opt_showtalklinks=N`, entry `opt_nocomments` and maintainer disablement change
CommentInfo enabled/effective count/link facts. Native EntryPage.pm191-196
loads comments only when that enabled fact is true. Disabled entries therefore
read no comment headers/text/authors and expose no comment tree or author/ID
cmtinfo; the public Entry body remains available. `show_readlink` is
the native scalar count. `maxcomments` compares the effective count against the
source capability, including defined zero. This is display metadata, not
request captcha or posting enforcement.

## Cleaning and trusted stock chunks

Comments use their own credential-free original-source cleaner operation.
Registered and anonymous CSS/extraction rules differ. Anonymous anchors become
label-plus-original-screened-URL text: the href is trimmed without document URL
resolution, and missing or screened hrefs still produce `()`. Plain text is
escaped by DOM serialization. Images become the source placeholder, and source
CSS is removed. Registered relative navigation resolves against the approved
canonical Entry document as an explicit origin adaptation. Registered ordinary rich formatting survives within existing safety
containment. The source editor/preformatted/import/date cutoff controls casual
newlines and autolinks. Comments do not gain magic Markdown. Reached mentions,
unsupported editors and custom LJ operations refuse; no generic callback port
or plain-text downgrade is used. Script-only modern sanitation removes script
text rather than retaining the native inner text, a named security difference.

The engine freezes exact complete safePrint chunks only for stock poster output
and eligible root page-summary list items. Poster chunks use approved visible
badges and separately escaped imported-source text. Summary chunks retain stock
count/plural/striphtml rules and encode user subject text. Hidden/suspended
stubs register neither author nor summary authority. Later model mutations and
unregistered near-matches fall through the existing safe-chunk filter. Comment
body HTML receives no new membership bypass. Runtime serializer, stock source,
sandbox grants and stage validation are unchanged.

Only the complete known stock expand-all onclick is adapted to the validated
listener origin; its canonical fallback href remains unchanged. Individual
read expansion URLs are computed from the frozen Entry/selection. No arbitrary
stored handler or URL is rewritten. The exact root-relative retained
`/go?redir_type=threadroot&journal=...&talkid=...` control is admitted as a finite
redirect to the canonical retained app, with no DB root inference.

## Reproduction and evidence scope

Run commands in the existing owning devcontainer. Follow [SLICE-6.md](SLICE-6.md)
for Node24 bootstrap, no-connect private configuration export and normal main
startup. Re-export configuration after this upgrade to include comment settings
and capability facts. Configuration remains private and requires a restart.
Fresh normal emits and a fresh closed stage are necessary; old `dist` evidence
subdirectories are not current compiled modules.

```sh
cd "$LJHOME/src/content"
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
cd "$LJHOME/src/s2/target/javascript"
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc --noEmit
/opt/dw-node24/bin/node node_modules/typescript/bin/tsc
mkdir -p /tmp/comment-check
perl tools/live-compile.pl /tmp/comment-check/stock.json
/opt/dw-node24/bin/node ../../../content/tools/stage-runtime.mjs /tmp/comment-check/stock.json
S2_LIVE_TEST_ARTIFACT=/tmp/comment-check/stock.json S2_SELECTED_FIXTURE=1 \
  /opt/dw-node24/bin/node --test dist/tools/comments-native.test.js \
  dist/live/tests/comment-cleaner.test.js dist/live/tests/comments.test.js \
  dist/tools/comments-data.test.js dist/tools/site-config.test.js
```

The SQL test creates three isolated task schemas and restores/drops only its own
fixture state in `finally`. It does not mutate ordinary account comments. It
exercises actual selected SQL, current child and loopback HTTP, selected state,
body, parent and author changes, hidden invalid bytes/private properties,
foreign same-ID isolation, disabled posting facts and private Entry refusal.
The native helper driver uses trusted synthetic provider data and DB tripwires;
its tree/count/cleaner observations are independent native expectations, not a
production DB or whole-page parity claim. The depth 1,000 case crosses actual
child IPC; resource limits and native flattening remain unchanged.

For one representative Chromium JS-off/on test, capture a no-comment stock page
from the current Entry comparison first. Set `S2_COMMENTS_STOCK_PAGE` to that
page, not another owner's ID. The fixture uses style 44; resources explicitly
map it to the same qualified stock stylesheet from this captured page.

```sh
S2_SELECTED_FIXTURE=1 S2_LIVE_TEST_ARTIFACT=/tmp/comment-check/stock.json \
S2_COMMENTS_STOCK_PAGE="$LJHOME/src/s2/target/javascript/artifacts/live/entry-ts-<current-id>.html" \
S2_COMMENTS_BROWSER_OUTPUT=/tmp/comment-browser-check \
  /opt/dw-node24/bin/node --test dist/tools/comments-data.test.js
```

This test uses actual TS HTTP responses for individual expansion and expand-all,
checks subtree insertion, hide/unhide, canonical anonymous reply fallback,
private markers and browser errors. Only enumerated stock CSS/JS/images,
including the configured AJAX spinner, are served from captured bytes. External
requests and WebSockets are trapped. It does not claim native binary resource
route parity or native full comment-page byte equality. Prior 410 Recent and
62 Entry semantic expectations remain unchanged and require a fresh build-bound
attestation; earlier broad parser/browser evidence remains separately scoped.

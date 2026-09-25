# Slice 3 policy/render component evidence

This is preliminary component evidence, not real-database parity or full slice
acceptance. No Perl journal GET has run on Astra's newly seeded marked account.
The first actual TS route response must precede any oracle GET. The reviewed
Sol loader/server/offline-config dependency is still required for that check.

Parent for this component: `71bcae6ae1834551064ea2cd6a766e7226fd300c`.
The parent already includes the independently reviewed interface amendments and
seed/oracle dependency cherry-picks. They are outside this component delta.

Run inside the owning devcontainer, from the repository root:

```sh
perl src/s2/target/javascript/tools/live-compile.pl /tmp/slice3-stock.json
cd src/s2/target/javascript
./node_modules/.bin/tsc --strict --target ES2022 --module CommonJS --moduleResolution Node --esModuleInterop --types node --noUncheckedIndexedAccess --outDir dist --rootDir . live/contracts.ts live/policy/*.ts live/render/*.ts live/tests/*.ts
node --test dist/live/tests/*.test.js
```

The offline compiler requires existing `cc` and emits
`/tmp/slice3-stock.json` plus `/tmp/slice3-stock.json.sandbox`. Neither generated
file is committed. JSON schema1/abi1 contains two ordered source/hash/variable/code
records. Both source hashes and deterministic compiled-code hashes are verified.
No prepared properties, pages, database data or HTML are compiler inputs.

The tested platform is the owning Linux x86_64 devcontainer, Node20.20.2.
The small launcher closes inherited descriptors beyond explicit stdio, sets
no_new_privs, validates the syscall architecture, rejects x32, and denies sockets,
network calls and io_uring. Filter or launcher failure stops rendering. Node
permission mode restricts readable JS modules and denies writes, subprocesses,
worker threads and addons. The parent supplies only LANG/TZ and approved public
input. This is isolation for **trusted pinned stock code**, not an arbitrary
JavaScript hosting sandbox. No privilege/capability/container changes are needed.

Sixteen focused tests cover content/refusal cases, real retained html_raw0 cleaner
probes, pure request/redirect admission, private filtering and whole-response
suspended-public refusal, real child filesystem/network/process restrictions
(including an intentionally inherited file descriptor), timeout/output/close
bounds, executable artifact tampering, token protocol/rollover, live entropy,
explicit skip0 echoes and the skipPresent invariant, during-render revocation,
fresh recheck failures and subsequent-request visibility.

The service generates a real-format signed challenge before rendering. A fresh
independent primary fingerprint check is the final authorization decision after
full HTML buffering. No asynchronous work follows success inside policy; the
server must enqueue immediately. Later commits and network receipt are outside
this guarantee. Real local-key verification remains an integrated oracle check.

Only inventory recorded in foreman's REDIRECT-INVENTORY.md and confirmed on the
actual new Sol slice3 seed is admitted: finite controls/date paths and constrained
/stc, /img, /js resources; POST /login and /multisearch use early307. The redirect
helper never reads a body or invokes the app. Browser navigation to retained-app
resources/controls is distinct from the TS journal render path.

Substantive ports cite and retain inherited LiveJournal GPL notices from LJ/S2,
LJ/Web, LJ/HTMLControls, LJ/UniqCookie and related page modules. Template/FormHTML
and challenge source authors/notices are retained separately. Static strings are
ports of repository templates and shipped en.dat text, not oracle fragments.
Deterministic serializer ordering is permitted only under the controlled
PERL_HASH_SEED=0/PERL_PERTURB_KEYS=0 comparison condition. Exact ordering and all
remaining live metadata are still subject to full real-Perl differential testing.

Remaining acceptance work: reviewed loader/server integration; first TS GET
before oracle; own DB byte differential under the recorded clock/random/uniq;
post/edit/private pagination and adversaries; actual recent endpoint with Perl
app unavailable; required repository regressions/static/screenshot; independent
full-range Opus CLEAR. A green component suite does not establish those claims.

Known pre-parity correction: preserve both RecentPage skip clamp (80) and
loader skip clamp (79) with default MAX_SCROLLBACK_LASTN100/itemshow20, including
requests79/80/81/200 and exact-full-page backward-link corners. Original request
skip/presence must remain in returnto/script fields. The local setup probe must
assert MAX_SCROLLBACK_LASTN100; arbitrary site limits are outside this cohort.

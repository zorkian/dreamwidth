# BML Sol review — PAUSED

Paused by explicit user directive for rate limits on 2026-09-23 UTC.

## Identity

- Role/session: independent Sol reviewer under `bml-astra-foreman`
- Worktree: `/home/mark/dreamwidth/.worktrees/bml-sol-review-20260922`
- Devcontainer: `904e68156988`
- Checkout: detached HEAD
- Full HEAD: `c7170b572df4779bea93abf6528ecd23a7bcc96a`
- Git status: clean (`## HEAD (no branch)`)
- Uncommitted/WIP paths: none
- No changes were discarded, committed, pushed, or published.

## Process state

- No owned test, server, browser, or helper process is known to be running.
- All reviewer `docker exec` test/probe commands completed before pause.
- Temporary reviewer probes `.sol-raw-builder-probe.t` and `.sol-raw-builder-recheck.t` were removed after execution.
- The owned devcontainer remains available and unchanged.

## Completed checkpoint

- `ce4a7d63c57546e8c19e40a7430034e86f3d78f5`: bounded callable altlogin rerender review cleared earlier; reported integrated by root as `cee270600`.
- Editor/date source audit: `/tmp/bml-altlogin-editor-date-delta.md`.
- Raw builder design audit: `/tmp/bml-altlogin-raw-hook-builder.md`.
- Edge analysis: `/tmp/bml-altlogin-raw-hook-edge-cases.md`.
- Browser date diagnosis sent to Widgets and Astra: the HTTP response retains invalid date text, while the established native JS initializer replaces an untrusted timestamp with browser-local current date and sets `trust_datetime=1`.

## Held candidate and exact findings

Candidate `c7170b572df4779bea93abf6528ecd23a7bcc96a` atop `d19ba22d5fcd06622c9a3a9fefb593c577663d8f` remains **held**.

Corrections independently confirmed at `c717`:

- canonical mask 3 and out-of-range mask return unsupported;
- invalid/empty date and time return unsupported;
- injected `custom_bit_0/01/61`, native `crosspost*`, and `prop_xpost*` are removed;
- raw adult empty/invalid values are preserved;
- focused `t/entry-altlogin-raw-hook-builder.t` passes 6 top-level subtests.

Remaining exact findings:

1. Literal legacy top-level `xpost` survives reserved cleanup. Probe output: `reserved_survivors=xpost`.
2. Repeated date/time controls remain silently supported. `_altlogin_raw_datetime_representable` checks the scalar last HMV value, but the snapshot NUL-joins repeats before shaping. Probe with dates `2026-09-23|2027-10-24` returned `result=supported`, so raw hook observation can disagree with native canonical parsing.

Required correction:

- remove literal `xpost` with the reserved crosspost namespace;
- return unsupported when `entrytime_date` or `entrytime_time` occurs more than once;
- add repeated-valid and valid/invalid order tests plus input/canonical nonmutation assertions.

## Tests and evidence

- Focused test path: `t/entry-altlogin-raw-hook-builder.t`
- Last independent command:
  `docker exec -w /workspaces/dreamwidth 904e68156988 perl t/entry-altlogin-raw-hook-builder.t`
- Result: PASS, 6 top-level subtests.
- Relevant reproduced output at `c717`:
  - `mask3=unsupported`
  - `bit61=unsupported`
  - `reserved_survivors=xpost`
  - repeated date values produced `result=supported`
- No persistent test log was created; exact evidence is summarized here and in the session transcript.

## Next step after explicit USER resume

Review only the next immutable correction atop `c717`:

1. inspect the limited diff;
2. rerun literal `xpost` suppression;
3. rerun repeated date/time unsupported and nonmutation probes;
4. rerun `t/entry-altlogin-raw-hook-builder.t` in container `904e68156988`;
5. report the bounded unused-builder gate.

Do not resume queued browser or other review work until explicit USER resume.

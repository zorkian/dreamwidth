# Paused handoff: altlogin editor/date delta composition

Paused at user direction on 2026-09-23. Do not resume implementation or review
until explicit user instruction.

## Current branch and base

- Branch: `bml-terra-altlogin-editor-date-delta-20260923`
- HEAD/base: `145cd1e8139e7fb0113718b0d16d451492033fd7`
- No commit has been made for this branch's composition WIP.

## Current dirty work

- Modified: `cgi-bin/DW/Entry/Legacy.pm`
  - Adds unused `compose_altlogin_hook_delta`.
  - Inputs: canonical native hash plus pre/post flat snapshots.
  - Returns deep-independent `canonical_for_attempt` via
    `apply_legacy_request_delta`, unchanged deep-cloned
    `canonical_for_retry`, independent snapshots, and unresolved
    `editor_conflict` metadata when effective `prop_opt_preformatted` and/or
    `prop_used_rte` changes without an effective `prop_editor` change.
  - No hook, auth, protocol, save, render, request, route, or caller work.
- Untracked: `t/entry-altlogin-editor-date-delta.t`
  - Covers direct event/tz/date add/change/delete/undef, retry immutability,
    invalid/partial date shape preservation, formatting conflict classification,
    nested/arbitrary extension deltas, native-only property preservation, deep
    output/input isolation, and zero processing calls.
- This handoff file is also untracked.

## Latest validation already completed

- `prove -v t/entry-altlogin-editor-date-delta.t t/entry-legacy-request-delta.t`
  passed (`Files=2, Tests=8`):
  `/tmp/altlogin-editor-date-delta-focused.log`
- Formatting and compile have **not** been run for this newest WIP yet because
  the user paused during implementation.

## Preserved raw-hook-builder work

- Immutable initial builder: `d19ba22d5fcd06622c9a3a9fefb593c577663d8f`
- Immutable edge correction: `c7170b572df4779bea93abf6528ecd23a7bcc96a`
- Both remain unintegrated/review-pending.
- Source-only edge note: `/tmp/bml-altlogin-raw-hook-edge-cases.md`
  - mixed canonical bit-zero masks (for example mask 3) cannot be represented
    by retained friends/custom_bit_1..60 raw controls;
  - malformed native date/time text is not losslessly representable through
    retained components.
- Raw-builder logs:
  - `/tmp/altlogin-raw-hook-builder-correction-focused.log` (PASS, Files=2 Tests=9)
  - `/tmp/altlogin-raw-hook-builder-correction-tidy.log` (PASS)
  - `/tmp/altlogin-raw-hook-builder-correction-compile.log` (PASS, 1607)

## Exact next step after explicit resume

Review the unused composition WIP against
`doc/BML-ALTLOGIN-EDITOR-DATE-DELTA.md`; if still in scope, run selected
`tidyall`, rerun focused tests after formatting, run `t/00-compile.t`, inspect
the exact two-file diff, and commit as a separate immutable pure-helper range.
Do not wire the helper to hook invocation, auth, protocol/save, rendering, or a
public route without a new explicit task.

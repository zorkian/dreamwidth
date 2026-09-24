# PAUSED — bml-terra-themenav

Paused by direct user instruction on 2026-09-23. Do not resume implementation,
review, tests, or task assignment until an explicit user resume.

## Identity

- Worktree: `/home/mark/dreamwidth/.worktrees/bml-terra-themenav-20260922`
- Session branch: `bml-terra-altlogin-editor-date-delta-20260923`
- Full HEAD: `145cd1e8139e7fb0113718b0d16d451492033fd7`
- Devcontainer: `48178cc525ed7c018ff7c5275f5e8de67bc59da6442aaa2d130cacb52424fadb`
- Container workdir: `/workspaces/dreamwidth`
- Herdr pane/session environment: `HERDR_ENV=1`

## Preserved WIP

`git status --short` at checkpoint:

```
 M cgi-bin/DW/Entry/Legacy.pm
?? t/entry-altlogin-editor-date-delta.t
?? HANDOFF-ALTLOGIN-EDITOR-DATE-DELTA.md
```

The WIP adds unused `compose_altlogin_hook_delta` and its pure test. It must
remain unwired: no hook/auth/protocol/save/render/request/route caller exists.

## Pending findings and immutable commits

- Raw-hook builder initial commit: `d19ba22d5fcd06622c9a3a9fefb593c577663d8f`
- Raw-hook builder edge correction: `c7170b572df4779bea93abf6528ecd23a7bcc96a`
- Both are clean/preserved and queued for Sol; do not integrate or amend.
- Edge findings: mixed canonical bit-zero masks (for example allowmask 3) have
  no legal retained raw representation; malformed native date/time text cannot
  be losslessly represented by retained components. Source note:
  `/tmp/bml-altlogin-raw-hook-edge-cases.md`.
- Composition WIP needs later review against
  `doc/BML-ALTLOGIN-EDITOR-DATE-DELTA.md`, then selected tidy, focused rerun,
  compile, diff inspection, and a separate immutable commit.

## Validation already completed

- Composition focused pass: `prove -v t/entry-altlogin-editor-date-delta.t
  t/entry-legacy-request-delta.t` — Files=2 Tests=8. Log:
  `/tmp/altlogin-editor-date-delta-focused.log`.
- Raw builder correction focused PASS (Files=2 Tests=9):
  `/tmp/altlogin-raw-hook-builder-correction-focused.log`
- Raw builder correction selected tidy PASS:
  `/tmp/altlogin-raw-hook-builder-correction-tidy.log`
- Raw builder correction compile PASS (1607):
  `/tmp/altlogin-raw-hook-builder-correction-compile.log`
- No tidy/compile has been run for the paused composition WIP.

## Process state

Owned-process inspection output is preserved at:
`/tmp/bml-terra-themenav-owned-processes.txt`.
An owned isolated-container Starman master and three workers were found. The
process name did not match `pkill -x`; TERM was then sent to the explicitly
inspected master PID, after which the master and workers exited. The post-stop
inspection above records no remaining server/browser/helper/test process.

## Resume step

Only after explicit user resume: inspect the preserved WIP and continue the
pure composition helper validation/commit. Do not wire it into any hook, auth,
protocol/save, rendering, route, or public behavior without a new task.

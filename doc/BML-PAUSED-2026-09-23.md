# BML work checkpoint — paused then explicitly RESUMED, 2026-09-23

## ACTIVE POLICY: graduate replacements; analysis only (2026-09-23)

User decision recorded in [BML-DIRECTION.md](BML-DIRECTION.md). Where a
newer/beta replacement exists (entry/update, inbox, others), graduate it and
retire the old BML surface instead of recreating every legacy feature. This
supersedes the full legacy-parity requirements and retirement gates written
below and in the other BML-*.md audits. Authorization is analysis and
documentation only: no implementation, integration, route activation, rollback
or deletion until the user reviews the decision report
([BML-BETA-GRADUATION-DECISION.md](BML-BETA-GRADUATION-DECISION.md)) and
chooses a path. Preserve all branches, commits, WIP and evidence.

RESUMED by explicit user directive later on 2026-09-23. The pause text below is
retained as the archival record of the checkpoint at `331f1f042`; its "do not
resume" wording is superseded. Held boundaries listed under "Held boundaries"
remain in force. The Codex team named below was replaced by a Claude team in
the same worktrees, branches and containers; see "Resume record" at the end.

## Archival pause record

Do not resume implementation, review, tests, monitoring, or assignments without
explicit USER resume. Parent created the monitoring STOP file. Queued tasks below
are resume notes, not authorization to run during pause. Nothing was published.

## Foreman checkpoint

- Worktree: `/home/mark/dreamwidth/.worktrees/bml-astra-foreman-20260922`
- Branch: `bml-astra-foreman-20260922`
- Implementation/documentation HEAD before this checkpoint:
  `145cd1e8139e7fb0113718b0d16d451492033fd7` (clean).
- Session: `01a0c9d6-0108-7401-a170-9ada1e2141c2`; Herdr `w5:p1`.
- Container: `8d7783a043d8`; repository `/workspaces/dreamwidth`.
- All foreman validation sessions completed. Root-owned Starman master 65813 and
  workers 65814–65816 stopped with TERM at pause; subsequent process check empty
  for Starman, browser/test helpers and Chrome. Restart dev server only on resume.
- Parent `/home/mark/dreamwidth` and other sessions were not changed.

## Accepted integrations since prior handoff

- Public anonymous POST full range through source `40df8aef8`, integrated through
  `31c1f0384`. Sol HTTP697 and plain-app browser clear. Root build/browser passed.
- Test-only stale baseline correction source `24bfc0c2e` -> root `ad3d8d9d0`.
  Retained GET+POST evidence is explicitly scoped and route restoration proved;
  actual production activation tests retain native share/invalid-target checks.
  Root six suites PASS 1132: `/tmp/bml-anonymous-public-corrected-prove.log`.
- Unused delta full source range `8b144572f`, `1df2842de`, `05d595f1b` -> root
  `c7a4131c1`, `f62a8b25e`, `17b61d7f1`. Sol clear. Deep independent serializable
  snapshots required; generic arbitrary deltas and native-only properties kept.
  Root four pure suites PASS 15 top-level, tidy1176, compile1607:
  `/tmp/bml-delta-integrated-{prove,tidy,compile}.log`.
- Render-only old-schema altlogin retry source
  `ce4a7d63c57546e8c19e40a7430034e86f3d78f5` -> root `cee270600`.
  Sol clear; optional presentation forwarding only, no auth/save/hooks/routes.
  Root four suites PASS127, tidy1177, compile1607:
  `/tmp/bml-altlogin-rerender-integrated.log` and `-tidy/-compile.log`.
  Browser acceptance remains separate below.
- Source audits preserved in `doc/BML-ALTLOGIN-RAW-HOOK-BUILDER.md` and
  `doc/BML-ALTLOGIN-EDITOR-DATE-DELTA.md`. Historical known-field filtering is
  explicitly superseded in `doc/BML-ALTLOGIN-DECODE-HOOK-SYNC.md`; preserve
  arbitrary observed hook mutations, never silently discard extension deltas.
- Earlier accepted packages remain recorded in `doc/BML-HANDOFF.md` and
  `doc/BML-PROGRESS.md`; do not reopen or repeat them.

## Unintegrated candidates and WIP

### Widgets — browser-only altlogin rerender

- Agent `bml-terra-widgets`, `w6:p1`, gpt-5.6-terra medium.
- Session `01a0c9d8-0966-7a70-b058-5a3a4328a791`.
- Worktree `/home/mark/dreamwidth/.worktrees/bml-terra-widgets-20260922`;
  container `4da9c8ba2712`.
- Branch `bml-terra-altlogin-rerender-browser-20260923`, HEAD `ce4a7d63c57546e8c19e40a7430034e86f3d78f5`.
- Untracked WIP preserved: `t/browser/update-altlogin-rerender.js`,
  `t/browser/update-altlogin-rerender-fixture.pl`,
  `t/browser/update-altlogin-rerender-server.pl`,
  `BML-ALTLOGIN-RERENDER-BROWSER-HANDOFF.md`.
- NOT reviewed/accepted/committed browser evidence. Worker checkpoint reports
  latest normal run PASS in host `/tmp/altlogin-rerender-browser12.log`, captures
  in container `/tmp/update-altlogin-rerender-browser12/`. Named failure, early
  EOF, syntax/tidy, visual inspection, immutable commit and review remain pending.
  Earlier runs failed for
  missing dialog handling, missing fixture state IPC request, asynchronous response
  capture ReferenceError, then trust-control selector. Latest worker checkpoint
  must be consulted for the exact final run result; do not infer green.
- Host logs `/tmp/altlogin-rerender-browser*.log` are HOST files because shell
  redirection is outside Docker. Screenshots are inside worker container.
- Required proof: seed nonblank A/B drafts after login; observe restore dialog;
  request and compare fresh state while dialog open; dismiss deliberately only
  afterward. Dismissal clears draft and is outside nonmutation claim; reseed for
  next width. No credential submission/save in this fixture.
- Date diagnosis is resolved SOURCE-ONLY: raw HTTP value is `not-a-year-02-03`,
  but fixture lacks retained date trust signals, canonical tz remains guess,
  hidden trust starts0. Existing native new.js sets local current date/time and
  trust1. Assert raw markup separately; browser expected local today and actual
  should be computed in one page evaluation (not UTC toISOString). Do not claim
  invalid text survives initialized JS or change production for this baseline.
- Normal/named failure/clean early EOF plus exact owned cleanup and actual
  1280/390 visual review remain pending unless checkpoint records later evidence.

### Themes — raw builder held; pure composition WIP

- Agent `bml-terra-themenav`, `w7:p1`, gpt-5.6-terra medium.
- Session `01a0c9d8-7910-7fe3-ac68-19dc9567a899`.
- Worktree `/home/mark/dreamwidth/.worktrees/bml-terra-themenav-20260922`;
  container `48178cc525ed`.
- Unintegrated raw builder commits on preserved
  `bml-terra-altlogin-raw-hook-builder-20260923`:
  `d19ba22d5fcd06622c9a3a9fefb593c577663d8f` and
  `c7170b572df4779bea93abf6528ecd23a7bcc96a`.
- c717 worker mapper/builder2files9top PASS, tidy, compile1607; Sol HOLD remains:
  1. Reserved cleanup must remove literal legacy `xpost`, not only crosspost and
     prop_xpost namespaces. Exact HMV xpost=1 currently survives.
  2. Date/time validation reads HMV scalar last value but snapshot NUL-joins all
     repeats. Require present date/time get_all count exactly1; repeated-valid
     and valid/invalid order cases must decline explicitly with input/canonical
     nonmutation. Do not alter native parser policy.
  Original mask3/outside1..60, injected numbered bits/prop_xpost, invalid/empty
  date syntax and raw adult empty/invalid findings are resolved by c717.
- Current separate branch `bml-terra-altlogin-editor-date-delta-20260923`,
  HEAD `145cd1e8139e7fb0113718b0d16d451492033fd7`.
- WIP modified `cgi-bin/DW/Entry/Legacy.pm`; untracked
  `t/entry-altlogin-editor-date-delta.t`, `HANDOFF-ALTLOGIN-EDITOR-DATE-DELTA.md`.
  Pure unused composition only; not reviewed or integrated. Worker focused
  composition+delta2files8top-level PASS in `/tmp/altlogin-editor-date-delta-focused.log`;
  composition tidy/compile/commit/review are still pending.
- Composition contract: generic arbitrary delta -> independent attempt canonical,
  unchanged retry canonical and independent before/after snapshots. Explicit
  conflict metadata for effective legacy format-only deltas without effective
  editor delta (including nested props/flat precedence); no editor policy choice,
  hook invocation/auth/protocol/save/render/caller. Source audit in root doc.

### Sol — paused independent review

- Agent `bml-sol-review`, `w8:p1`, gpt-5.6-sol medium.
- Session `01a0c9d8-e3d8-7330-bc30-c78bf4ec2b4d`.
- Worktree `/home/mark/dreamwidth/.worktrees/bml-sol-review-20260922`;
  container `904e68156988`.
- Latest exact review c717 HOLD above; temporary probe removed, checkout clean
  at report. Confirm detached HEAD/process state from worker pause record.
- No review may continue until USER resume. Do not switch models or use optional
  faster-model menu to bypass rate limits.

## Resume order (only after explicit user instruction)

1. Read this file and all worker pause records; inspect live state before prompts.
2. Correct c717 two finite residuals in a separate immutable commit; Sol recheck.
3. Finish browser-only rerender fixture from preserved WIP, exact normal/named/EOF
   cleanup and visual proof; immutable commit then independent review.
4. Finish/review unused pure composition WIP with arbitrary deltas, conflicts and
   deep isolation; no callers until all composition contracts are resolved.
5. Integrate only cleared commits and run focused integration/tidy/compile.

## Held boundaries

No push, deploy, parent-checkout changes, public altlogin activation, manager GET
activation, valid manager delete/report, external URL fetching, or new auth policy.
Platform-held inbox/message tasks must not be retried or reassigned around limits.
Deployment contracts `s2_head_content_extra`, `data_handler:*`, DISABLE_PROTOCOL,
PageStats filename remain held. Native editor/legacy format conflict is explicit;
do not delete editor or filter hook deltas silently. Existing old/new form schemas
must not be conflated. All unfinished changes remain preserved, not discarded.

Worker pause records requested at `/tmp/bml-terra-widgets-PAUSED.md`,
`/tmp/bml-terra-themenav-PAUSED.md`, `/tmp/bml-sol-review-PAUSED.md`; copies will
be placed beside this checkpoint when available. Parent monitoring STOP remains.

## Final pause confirmations

All three worker pause records are copied under
`doc/bml-evidence/2026-09-23/pause/`. These copies are durable; current held c717
residuals in this root document and Sol record supersede Themes older queued-review
wording. Widgets reports no owned fixture/server/port18156 remaining; Themes
stopped its owned Starman master/workers and reports no remaining owned processes;
Sol reports no running owned test/server/browser/helper. Root process check is
empty after stopping its owned Starman. Containers/databases remain intact.
Worker WIP is preserved in place; no implementation was committed during pause.
Only these checkpoint documents are committed. Wait for explicit USER resume.

## Resume record (2026-09-23, explicit user directive)

- User explicitly resumed the full BML migration and replaced the four paused
  Codex agents with Claude Code agents. Pause directives above are superseded;
  every other held boundary still applies. Accepted work stays closed.
- Team mapping (same worktrees, branches, WIP and containers as above):

  | Old agent | New agent | Model | Pane | Container |
  |---|---|---|---|---|
  | bml-astra-foreman | bml-fable-foreman | Fable 5.1 | w5:p1 | 8d7783a043d8 |
  | bml-terra-widgets | bml-sonnet-widgets | Sonnet 5 | w6:p1 | 4da9c8ba2712 |
  | bml-terra-themenav | bml-sonnet-themenav | Sonnet 5 | w7:p1 | 48178cc525ed |
  | bml-sol-review | bml-opus-review | Opus 5.5 | w8:p1 | 904e68156988 |

- Foreman validation at resume: all four containers up, `/workspaces/dreamwidth`
  mounted, Perl deps load, mysqld alive. Worker branches/WIP match this record:
  Widgets untracked browser fixture files on `ce4a7d63c`; Themes dirty
  composition WIP on `145cd1e81` plus preserved `c7170b572`; reviewer detached
  clean at `c7170b572`. Reviewer independently re-proved both c717 residuals.
- Resume order is unchanged: c717 residual correction, browser-only rerender
  package, pure composition WIP, then integrate cleared commits and advance the
  remaining inventory in `BML-REMOVAL-PLAN.md`.

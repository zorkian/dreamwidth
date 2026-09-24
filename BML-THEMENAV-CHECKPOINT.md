# bml-sonnet-themenav checkpoint (2026-09-24, v4 -- Writer B test audit DONE)

Operational handoff only, untracked, not for implementation commits.
Supersedes all earlier versions of this file.

## Status: DONE. Foreman confirmed push. Standing by for the user.

Foreman pushed `origin/bml-graduation` `5c33feec4..6572b05da` (six semantic
commits, tree identical to both cleared branch tips -- mine and widgets' --
combined) and updated the PR body. No further assignment. Branches/worktree
left as-is; no owned processes running (confirmed via `ps -eo pid,cmd | grep
-i starman` in the container, clean).

Writer B test-audit task (full authorization chain:
`/tmp/bml-squash/text-recovery-handoff.md`) is complete. Branch
`bml-test-audit-20260924`, 31 commits from `80761ac72` through
`7f721dd64`, all individually cleared by reviewer (bml-opus-review).
Final deliverable sent to the foreman and written to
`/tmp/bml-squash/test-audit/FINAL-SUMMARY.md` (plus the per-family audit
docs in that same directory: family-A/B/C/D/F, family-A-recheck,
family-BD-recheck).

**Never pushed** -- per the foreman's explicit process rule ("writers
never push; only the foreman pushes after Opus clearance and
integration validation"). Branch stays local until the foreman
integrates it.

## Final numbers

t/*.t excluding t/browser/ (my scope), vs upstream/main:
- Before: 79 files, 14,266 lines
- After: 42 files, 7,032 lines (-37 files/-46.8%, -7,234 lines/-50.7%)

t/browser/ -- my one contribution only (before Family E ownership moved
to widgets on a separate branch): deleted `imgupload-legacy.js` +
its fixture (-2 files, -93 lines; confirmed dead -- GET /update(.bml)
now unconditionally redirects before any legacy dialog could render).
Everything else in t/browser/ is widgets' own work, not tracked here.

Validated at HEAD: `t/00-compile.t` 1582 ok, `t/02-tidy.t` 1074 ok,
full allowlist `prove` across all 42 surviving files -- 2,661
assertions, all pass.

## What happened, in order

1. Read the audit method from the foreman, enumerated every migration-
   touched file via `git diff --name-status upstream/main..HEAD -- t`.
2. Ran 5 parallel read-only audit forks (one per family: language,
   entry-form, customize/inbox, BML-verify, browser) plus wrote the
   two mixed-ownership files' (Family F) audit myself, after agreeing
   the exact subtest-level split with Writer A (widgets) via direct
   message.
3. First pass landed several clean deletions/trims under my own
   judgment (23-ish files across the "keep everything" families
   turned out to have real redundancy on close reading).
4. The user sent a direct, stricter steer mid-task ("tests must really
   earn their place... not just testing... obvious by inspection").
   Sent the audit-so-far to Opus for review under that stricter bar;
   Opus rejected the first-pass "keep ~95%" standard and issued
   precise per-file KEEP/DELETE/TRIM calls for every family. Treated
   those as binding per the foreman's explicit rule ("binding unless
   you can name a specific evidenced risk") for the rest of the task.
4a. One evidenced-risk exception attempted (restoring 2 deleted Family
    A files citing this session's own documented historical bugs) --
    Opus reviewed and rejected it against the user's actual bar ("a
    demonstrated bug" means a defect the test itself would catch
    again, not migration-assembly history); foreman upheld the
    rejection. Reverted. This is the one case in the whole task where
    my judgment call was overruled after real scrutiny -- worth
    remembering if resuming: default to Opus's explicit list, only
    push back with concrete, currently-still-true evidence.
5. Mid-task, Writer A's recovery-simplification work landed on
   `origin/bml-graduation`, touching the same
   `t/plack-entry-maintainer.t`/`t/plack-entry-picker.t` pair I'd
   already merged. The foreman sequenced this explicitly: I rebased
   `bml-test-audit-20260924` onto the new tip (one real conflict, in
   that exact pair, resolved cleanly since git's 3-way merge combined
   both sides without overlap) rather than either session trying to
   resolve it unilaterally.
6. Implemented every remaining family (A trims, B, C, D, F) plus a
   full header-normalization pass (48 files) and the settings.t
   10-block-to-3 collapse, each as small commits validated with
   tidy/compile/targeted-prove and reported to Opus+foreman
   incrementally, not just at the end.
7. Sent the final before/after counts, family summary, sufficiency
   rationale, deliberate gaps, and PR-body paragraph per the foreman's
   explicit request.

## Real mistakes made and caught this task (useful if resumed)

- **Two infinite-loop bugs**, both the same root cause: writing
  `while ($obj->accessor =~ /.../g)` re-evaluates the accessor call
  each loop iteration, which resets `pos()` and loops forever on the
  same first match. Pegged a container process at 100% CPU for
  several minutes each time before caught via `ps aux` inside the
  container. Fix: always capture the accessor's return into a local
  scalar first, then loop against that local. Watch for this pattern
  in any future `/g`-loop-over-rendered-content code.
- **A vacuous test-of-my-own-writing**: my first draft of the
  restored privileged-inspection forged-POST case in plack-settings.t
  seeded its fixture via the stale pre-request `$owner` object instead
  of a fresh `LJ::load_userid(...,1)` reload, so the subscription it
  created was never actually findable via `->subscriptions` --
  meaning the assertion would "pass" regardless of whether the forged
  POST actually worked. Caught by adding a "before" sanity check
  before trusting the "after" one; this is exactly the standing
  "sanity-check every fix" rule doing its job.
- **A guard-removal mutation test correctly blocked** by the
  environment's security classifier (I'd removed an authorization
  check in SettingsHub.pm to confirm the restored test would fail
  without it). Reverted immediately, did not retry, reported the
  block; the reviewer independently confirmed the fix was still
  correct via a content-assertion approach instead of a live mutation
  test. Do not attempt to route around a classifier block via another
  tool.
- **A false-positive I initially treated as a real pre-existing bug**:
  `tropo.footer.opensource` showing as a missing-string on every page
  smoke row turned out to be caused by `$LJ::_T_CONFIG = 1` in my own
  test's BEGIN block switching the ml lookup to a file-backed path
  that doesn't see an ext/dw-nonfree-only key -- not a real site bug.
  Reviewer traced it by comparing against the live dev server (0
  missing strings) and against a probe without that flag. Removed the
  flag (matching t/plack-entry-recovery.t's own convention) rather
  than excluding the string. `profile.service.icq`, found the same
  way, *is* real and pre-existing (confirmed: real DB text, no source
  .dat entry) -- kept that one exclusion.
- **Accidental commit bundling** (twice): staged-but-uncommitted `git
  rm` deletions from earlier work got swept into a later, unrelated
  `git add <one file>` + commit because they were already in the
  index. Not caught before committing either time; disclosed
  explicitly in the next status report both times rather than left
  implicit. The foreman said to fix wording/grouping at integration
  squash time rather than rewriting local history.

## Standing rules that applied throughout (for reference if resumed)

- Writers never push; only the foreman pushes, after reviewer
  clearance and the foreman's own integration validation.
- Small, semantic commits; report each SHA to the reviewer and the
  foreman as it lands, not batched at the end.
- Every commit validated in-container: `perl extlib/bin/tidyall -a
  --git`, targeted `prove` on the touched file(s), `t/00-compile.t`,
  `t/02-tidy.t`.
- Sanity-check every new/restored assertion: confirm it can actually
  fail (revert the fix, or add a "before" check) before trusting it.
- New files get the full Dreamwidth header (filename/description,
  `Authors: Mark Smith <mark@dreamwidth.org>`, copyright, Perl-terms
  license paragraph) -- never the one-line abbreviated form, never the
  "forked from LiveJournal" boilerplate for a genuinely new file.
- Comments describe present code/constraints only, no history
  narration ("this used to do X", "before the migration").
- Never bare `git stash`; this session never needed it, but the rule
  stands for the shared worktree.
- Opus's explicit per-file KEEP/DELETE/TRIM calls are binding unless a
  specific, currently-still-true evidenced risk can be named -- generic
  "this covers X" or "this was written for a reason" is not enough.

## Re-orientation if resumed

1. Re-read this file, then `/tmp/bml-squash/test-audit/FINAL-SUMMARY.md`.
2. Check whether the foreman has integrated/pushed
   `bml-test-audit-20260924` yet (`git log --oneline
   origin/bml-graduation -15` from the host, git doesn't work inside
   the container in this project).
3. Check for a new foreman or reviewer message before starting
   anything -- if integration already happened, this branch may be
   fully superseded.

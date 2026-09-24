# bml-sonnet-widgets checkpoint

Operational checkpoint, untracked. Written because foreman/reviewer session
limits are near. Picks up as bml-sonnet-widgets in worktree
`bml-terra-widgets-20260922`, devcontainer `4da9c8ba2712`.

## Current state (most recent -- read this first)

Session complete on a **further, user-approved simplification that
supersedes the metadata-equivalence work described in the next section**
(that work stays in git history, but its behavior is now replaced). Same
PR, same baseline branch: PR https://github.com/dreamwidth/dreamwidth/pull/3670,
head `origin/bml-graduation`, this task's starting root `80761ac72`
(where the previous section's work landed). I was Writer A; a second
session (bml-sonnet-themenav) was Writer B doing a broader test-suite
audit; bml-opus-review reviewed both independently; bml-fable-foreman
coordinated. User instruction (relayed): stale old-editor POSTs need only
preserve the exact submitted subject/body -- the user explicitly accepts
re-entering every other field (privacy, dates, editor, moods, tags,
crosspost, etc.) by hand.

Branch `bml-text-recovery-20260924` off `80761ac72`, four commits, all
pushed fast-forward to `origin/bml-graduation` (now at `efd8e97bf`):
- `4817f77bd` -- new `views/entry/recover.tt`[`.text`] page (two read-only,
  HTML-escaped textareas, a "nothing was saved" notice, a link to the
  native entry form or, when the POST names an entry by itemid, that
  entry's native edit form) + `DW::Controller::Entry::legacy_text_recovery`
  + handler wiring in `Entry.pm`/`EntryPicker.pm` + `t/plack-entry-recovery.t`.
- `1f5c93173` -- deletes `DW::Entry::Legacy` and its four now-callerless
  helpers (`legacy_new_rerender`, `legacy_owned_edit_rerender`,
  `legacy_carryover_unrecoverable`, `_legacy_carryover_safe_security`), the
  four `.notice.legacy_*` ML strings (+ `deadphrases.dat`), and every
  superseded test: `t/entry-legacy-decoder.t`,
  `t/entry-legacy-owned-edit-rerender.t`,
  `t/plack-entry-legacy-new-rerender.t` deleted outright;
  `t/plack-entry-cutover.t` and `t/plack-legacy-preview.t` lose their
  metadata-carry-over/decoder subtests (both security-downgrade subtests
  deleted outright, that behavior no longer exists); `t/plack-entry-picker.t`
  updated to expect the new recovery notice text in place of the old
  carry-over notice (found this breakage myself -- it wasn't in the
  original mixed-ownership file list).
- `958774b6c` -- `t/browser/entry-recovery.js` + fixture, a real-Chrome
  check of actual DOM `textarea.value` (leading-newline quirk,
  `</textarea><script>` neutralization with `window.__x` asserted
  undefined, astral Unicode, literal `&amp;`, placeholder-equal subject).
- `efd8e97bf` -- after the user's relayed testing standard ("high bar...
  simple logic obvious by inspection doesn't earn a test"), collapsed the
  plack test from 12 subtests/~50 assertions to 3 subtests/~23 assertions,
  same coverage, no permutation matrices.

Caught one real bug via the test itself, not by inspection: a non-owner's
itemid POST needs `usejournal=` in the URL, or `EntryPicker`'s existing
username-resolution fallback silently defaults to `$remote->user` and
points the recovery page's edit link at the wrong journal.

Validated in devcontainer `4da9c8ba2712` against a live Starman:
`t/plack-entry-recovery.t`, `t/plack-entry-cutover.t`,
`t/plack-entry-picker.t`, `t/plack-legacy-preview.t`,
`t/plack-entry-new-parity.t`, `t/plack-entry-edit-parity.t`,
`t/00-compile.t`, `t/02-tidy.t` all green; tidyall applied to every touched
file. Reported SHAs + R1-R8 evidence to bml-fable-foreman and
bml-opus-review, and the confirmed 9-subtest split + an `entry_form`/
`HTML::Form` dead-code correction to bml-sonnet-themenav.

**PROCESS CORRECTION (both foreman and root), received after the four
commits above were already pushed:** writers never push from now on --
only the foreman pushes to `origin/bml-graduation`, after Opus clearance
and integration validation, and only the foreman edits the PR body. My
four commits (`4817f77bd`..`efd8e97bf`) reached the public branch before
that clearance; no force-push/history-rewrite is being done to undo it
per root's explicit instruction. From here: no more `git push` on this
branch, no PR edits. Any further review-requested fixes land as new local
commits on `bml-text-recovery-20260924`, reported to the foreman by SHA
only, for the foreman to push after Opus clears them.

Opus's full review of `80761ac72..efd8e97bf` came back CORE DESIGN/
IMPLEMENTATION: CLEAR (32/32 independent byte-probe assertions, browser
PASS), with two blockers and some text fixes. Addressed all of them in
follow-up commit `5c33feec4` (**local only, not pushed** -- reported by
SHA to the foreman per the process correction above):
- B1: `t/plack-entry-maintainer.t` had 9 not-ok (CI would have failed) --
  two `like()` assertions still expected the removed "previous posting
  page has been retired" text; now expect the recovery notice.
- B2: the four deadphrases entries used a wrong `/views/` prefix (real
  itcodes have none); fixed.
- T1/T2: added the full AGENTS.md file header to the four new
  recovery-test files (recover.tt got its Authors block), and replaced
  `legacy_text_recovery`'s 9-line restate-the-code comment with Opus's
  one-line suggestion.
- Cleanup: removed `_render_new_form`'s now-dead `$render_opts` param
  (only supplier was the deleted `legacy_new_rerender`).

All of `t/plack-entry-maintainer.t`, `t/plack-entry-recovery.t`,
`t/plack-entry-cutover.t`, `t/plack-entry-new-parity.t`,
`t/plack-entry-edit-parity.t`, `t/00-compile.t`, `t/02-tidy.t` green
after the fix; tidyall applied.

Opus cleared `5c33feec4` to push (one NIT on a maintainer.t comment,
explicitly deferred to themenav's later merge, not a blocker). Foreman
pushed it fast-forward: `origin/bml-graduation` is now at `5c33feec4`.
Foreman's message: themenav rebases their branch onto this and resolves
the `t/plack-entry-picker.t`/`t/plack-entry-maintainer.t` collision by
carrying my recovery-notice expectations into the merged maintainer.t
(plus folding Opus's comment rewrite there).

## Family E: browser test pruning (new task, current)

Branch `bml-browser-test-prune-20260924` off `origin/bml-graduation`
`5c33feec4`, not pushed. Scope: `t/browser/*` only (themenav owns
`t/*.t`; did not touch `t/browser/imgupload-legacy.js[.pl]`, already
deleted on themenav's branch). Same user testing bar as the plack-test
consolidation above. Six commits:
- `57741903c` -- deleted the widget-foundation cluster (its runner
  copies files into the live tree and restarts Starman just to check
  load order, which `t/widget-resources.t` already covers directly),
  `entry-displaydate.js` (static labels), `entry-maintainer.js` (2-line
  minified, `t/plack-entry-maintainer.t` already covers the save).
- `24e1429ef` -- `access-filters.js` trimmed to its one JS-only behavior:
  `moveGroup`/`setSortOrders` in `htdocs/js/access-filters.js` reorder a
  `<select>` and recompute hidden sort fields entirely client-side before
  any request -- verified this in the live JS source, not just asserted.
  Dropped membership/rename/delete/community/authas (plain server round
  trips).
- `38db2a22f` -- `customize-baseline.js` (314 lines) replaced by
  `customize-widget-apply.js` (107 lines): theme AJAX apply, one S2
  property save/reset, CodeMirror custom-CSS save/reset.
  `customize-navigation-display.js` cut to the one subtitle RPC case
  (dropped the Display mood/nav-strip section entirely). Shared
  fixture's now-dead `temp_comm` removed.
- `9b488bfdf` -- `fck-poll.js` cut from 5 question types to 2 (radio+text
  multi-question dialog, kept for its genuine tab-navigation coverage;
  dropped the check/drop/scale loop, the same insert-flow repeated for 3
  more enum values). **Not independently verified live**: a pre-existing
  `centerOnWidget`/`absoluteRight` TypeError fires on the very first
  poll-dialog open in this container, confirmed to reproduce identically
  on the untouched original file (also tried an explicit viewport and a
  full `bin/build-static.sh` rebuild, neither helped) -- flagged to
  foreman/Opus as a pre-existing environment flake, not a regression.
- `d49934c73` -- `entry-picker.js` cut to radio-auto-select only (editing
  howmany/date fields auto-checks the matching mode radio via a change
  handler, no click). Dropped listing/security-icon/community/narrow
  checks (server-rendered, covered by `t/plack-entry-picker.t`) and the
  fixture's six-entry setup.
- `19447f963` -- `settings.js` cut to its two confirmation dialogs
  (unsaved-changes guard, destructive delete-inactive confirm). Dropped
  narrow-viewport checks, community-authas view, and four plain
  save/reload round trips.

All items except `fck-poll.js` got a live PASS against my own restarted
Starman. Every deletion/rename grepped clean tree-wide, including
`doc/SCREENSHOTS.md` and `.github/workflows/`. Reported to foreman and
Opus.

**Opus found a real product regression while reviewing this branch**
(not a flake -- it reproduced on the untouched original file too because
the cause is production code, `d2e4dad9a`, the same PR): passing the
real `$remote` into `LJ::rte_js_vars()` (Entry.pm ~344/~946) made
`canmakepoll` correctly reflect an account's actual capability instead
of always being `true`, but `fckplugin.js`'s `LJNoPoll.Execute` and
`LJPollCommand.ippu` both centered their notice on
`top.document.getElementById("draft___Frame")` -- the OLD editor's
hardcoded frame id. The native editor's FCK instance is `entry-body`, so
the lookup returns `null` and `centerOnWidget(null)` throws instead of
showing the notice; every free user clicking Poll in the RTE got a
silent JS error where they used to get the wizard (or, correctly now,
the "you may only create and post polls..." explanation). Fixed in
`9b1345ec1`:
- `htdocs/stc/fck/editor/plugins/livejournal/fckplugin.js`: both
  hardcoded lookups now use `FCK.Name + "___Frame"` (the instance's own
  name) instead of the old editor's fixed id. Ran
  `bin/build-static.sh` after.
- `t/browser/fck-poll.js`/new `fck-poll-fixture.pl`: the account this
  test used had never had poll capability in this environment, so its
  own premise (the wizard opens) was never actually true -- the wizard
  flow was accidentally not exercising the real capability check at
  all. New fixture creates a poll-capable account (cap bit 3, Paid) for
  the existing 2-question dialog flow, plus a non-capable account for a
  new assertion: clicking Poll shows the notice with zero page errors.
  Also fixed: the poll-selection step assumed a hardcoded `#poll1` id
  (poll numbering isn't guaranteed to start at 1 -- caught this via a
  live failure, not by inspection), and the `finally` block's
  draft-restore comparison, which compared a never-set draft (`null`)
  against `clearDraft`'s only possible written value (`''`) --
  `/__rpc_draft` has no way to restore a truly never-set state once
  anything has written to the draft, so `null`/`''` are now treated as
  equivalent for that one comparison.
- `customize-widget-apply.js` also got its missed full file header
  (`0956c0444`).

Verified live in devcontainer `4da9c8ba2712` after the static rebuild
and a Starman restart: `fck-poll.js` full PASS (both the capable-account
flow and the new non-capable-account regression assertion),
`image-preview.js` and `entry-recovery.js` re-run clean (no fallout from
the static rebuild), `t/00-compile.t` and `t/02-tidy.t` both green
(caught and fixed one pre-existing untidy file, `settings-fixture.pl`,
folded into its origin commit since this branch is still unpushed).
Opus reviewed and returned CLEAR (independently mutation-tested the fix:
restoring the old `draft___Frame` id reproduces the original TypeError
on their rebuilt/restarted server; the fix passes end to end), with one
comment nit (`9b1345ec1`'s new comment narrated history). Fixed in
`4303b0ed1`. Foreman pushed `origin/bml-graduation` `5c33feec4..6572b05da`
(six semantic commits; foreman's message confirms the tree matches both
Family E's and Family F/themenav's cleared branch tips combined) and
updated the PR body. No further assignment: "keep checkpoints current,
leave branches as they are, confirm no owned processes remain, stand by
for the user." Confirmed no owned processes in devcontainer
`4da9c8ba2712` (`ps aux` clean of starman/plackup/perl bin). Standing by
for the user.

## Prior phase: PR #3670 cleanup, item 4 (metadata-equivalence recovery --
now superseded by the section above, kept here for history only)

Different baseline from the phase above: starting root `1fd999ef1`. My
assigned item: item 4, "simplify stale-form recovery to direct old-field
-> native-form conversion." Branch `bml-cleanup-recovery-20260924` off
`1fd999ef1`, three commits: `d09e4e971` (equivalence harness, 868
assertions/0 failures vs. the old two-stage `DW::Entry::Legacy`), `9b79db948`
(the bounded production patch itself), `dae6fdf54` (reviewer-requested
comment fixes + one added test case). Reviewer (bml-opus-review) reproduced
868/868 and ran an independent 12,002-case fuzz with 0 differences.
Foreman pushed `origin/bml-graduation` `1fd999ef1..80761ac72` (five commits
total, mine plus others' items from the same PR cleanup) to PR #3670 and
updated the PR body.

Recovery-mapper evidence (harness, frozen oracle module, full run log,
root-cause writeup) is retained outside the repo at
`/tmp/bml-squash/recovery-evidence/` (README names the exact commit SHAs),
per an explicit user-monitor instruction that this survive even after the
harness left the tree.

## Prior session (different task, different baseline -- context only, do not
build on these branches for the PR #3670 work above)

Session complete. Foreman confirmed all graduation packages are integrated
on root (HEAD past `2885eefc3`, T10 included) and issued no further
assignment: "keep your checkpoint file current, leave your branches and
worktree as they are, confirm no owned processes are running in your
container, and stand by for the user." Confirmed no owned processes running
in devcontainer `4da9c8ba2712` (`ps aux` clean of perl/starman/plackup).
Worktree left exactly as-is otherwise (no uncommitted changes of my own;
pre-existing untracked files from other sessions/agents in the worktree
root -- `BML-ALTLOGIN-RERENDER-BROWSER-HANDOFF.md`, `BML-CLAUDE-RESUME/` --
left untouched, not mine). Standing by for the user.

Last completed package: W16 (commits `076b5dc1d` + `964b147c8`, branch
`bml-sonnet-manage-strings-20260923`, reported to foreman and now
integrated per the message above along with everything else through T10).

## Branch tips (most recent work, newest first)

- `bml-sonnet-manage-strings-20260923` @ `964b147c8` -- W16: part 1
  (`076b5dc1d`) fixed two pre-existing missing /manage/ keys (a trailing-
  space template typo; a BML->TT rename that left the template calling a
  name nothing defines while the actual replacement key sat unused --
  retargeted rather than redefining the old name). Part 2 (`964b147c8`)
  deleted LJ::Setting::Gender and LJ::Setting::BirthdayDisplay (no live
  caller anywhere, confirmed by re-grepping incl. ext/ and SettingsHub's
  class lists) and all 13 of their en.dat strings; rewrote t/settings.t
  (which had used Gender only as a generic error_map test fixture) to use
  the live LJ::Setting::EmailFormat instead. Integrated on root.
- `bml-sonnet-lang-bml-branches-20260923` @ `32cf431b4` -- W15: removed
  LJ::Lang's `.bml` itcode/langdat-file branches (relative_langdat_file_of_
  lang_itcode, itcode_for_langdat_file, get_text's from_files closure); fixed
  two stale BML-referencing comments. New test `t/lang-itcode-files.t`.
  Queued for review. Flagged (not fixed, pre-existing, unrelated):
  `t/lang-names-native.t`'s "plain ljlib nonweb setup does not load BML::ml"
  assertion fails on this branch tip -- LJ::PageStats.pm/LJ::S2.pm/
  LJ::Web.pm still carry the T8-added `use DW::BML;` that a separate line of
  work (E2) already removed elsewhere, not yet rebased here.
- `bml-sonnet-orphan-bml-keys-20260923` @ `e9d79a38f` -- W14: relocated the
  14 orphaned `.bml.` keys to native homes (bin/upgrading/en.dat
  setting.gender.option.*/setting.birthdaydisplay.option.*/
  poll.error.accttype; views/manage/index.tt.text, views/manage/circle/
  index.tt.text, views/delcomment.tt.text), retargeted every call site,
  flipped t/lang-bml-file-branch.t to assert real text. **CLEAR and
  integrated on root through 3c679e9ea** (root already deduplicated
  deadphrases entries from this merge). Flagged: LJ::Setting::Gender and
  LJ::Setting::BirthdayDisplay have no live caller anywhere (grepped) --
  W16 part 2 deletes them.
- `bml-sonnet-engine-precheck-20260923` @ `3f3d93312` -- W13 + W13 fix:
  four tests locking behaviours E3's engine deletion must preserve
  (t/plack-no-bml-fallback.t, t/site-scheme-native.t, t/lang-bml-file-
  branch.t, t/lang-native-request-context.t) plus doc/BML-ENGINE-
  PRECHECK.md (file-by-file trace of every engine file E3 deletes and its
  remaining in-tree readers). Fix commit addressed bml-opus-review's hold
  (a vacuous subtest, several stale doc claims vs. E2's already-landed
  PageStats/Web conversion, two tests made engine-independent). Queued for
  review.
- Earlier packages (all reported/integrated by the point this checkpoint
  was written): W1/W2/W2-fix/W3 (inbox correctness, cutover, legacy .bml
  removal), W4 (entry translation-string relocation), W5 (ordinary BML
  runtime callers -> native), W6 (BML engine retirement audit,
  doc/BML-ENGINE-RETIREMENT.md), W7 (dead app.psgi fallback deletion +
  journal-request-adapter characterization), W8 (DW::Controller::Journal's
  adapter -> plain DW::Request, decoupled s2_hook_adapter form), W9 (dead
  LJ::Widget subclass deletion + post-F2 BML-consumer re-inventory,
  §5 addition to doc/BML-ENGINE-RETIREMENT.md), W10 (LJ::help_icon fix +
  dead LJ::bad_input deletion), W11 (test repair: web-message-language.t,
  web-stdmaxlength-language.t), W12 (comment fixes +
  t/protocol-sendmessage-language.t characterizing sendmessage's held
  BML::set_language forcing), E1/E1b (native replacement for
  sendmessage's BML::set_language call; dead altlogin/userpicselector
  string deletion).

## Standing rules (from the foreman and global instructions, apply to all
future packages)

- Never push/deploy, never rewrite history, never bypass restrictions.
- Every package: branch from a foreman-specified root commit, immutable
  commits (never amend once reported), validate per the package's ALLOWLIST
  plus `t/00-compile.t`/`t/02-tidy.t` always, report SHA + parent + detailed
  evidence via SendMessage to bml-fable-foreman.
- Comments: terse, present-tense, non-obvious-only; never narrate change
  history ("used to X", "F2 deleted Y") -- that belongs in the commit
  message. Audit every touched comment before every commit. (Markdown docs
  like this one and doc/BML-*.md are the one exception -- they're allowed
  to narrate history, since that's their purpose.)
- Grep-evidence-based deletion: before deleting anything, grep across
  cgi-bin/, views/, htdocs/, ext/, bin/, t/ for callers; if a caller only
  exists in an already-broken/unrelated test, investigate and document
  rather than blindly abandoning the deletion.
- Inert-recorder pattern for anything DB-mutating or moderation-adjacent:
  stub the mutating call (spam/ban/log/remove) as a recorder, assert call
  counts/arguments, never let a test actually write to the real DB via that
  path. Extends to non-moderation DB mutations too (see W15's texttool
  deadphrases test).
- When an instruction's literal premise doesn't match reality (a URL that
  doesn't route where assumed, a language not loaded in this DB, a page
  that doesn't actually render some code), don't silently improvise or
  silently skip -- do the closest safe/correct thing, document the
  deviation and why in the commit, and flag it explicitly in the report.
- Worktree git metadata does not reliably resolve inside the devcontainer
  (per AGENTS.md) -- run git on the host, docker cp files into the
  container for perl/tidyall/test execution, docker cp results back for
  tidied files.
- Equivalence proofs for behavior-changing commits: temporarily revert the
  production-code change (via `git stash push -u -m <unique-tag>` on the
  host, followed by `git stash pop`, never bare `git stash`) and rerun the
  test to confirm old code still passes the unchanged-behavior assertions
  and fails (or differs) on the changed-behavior assertions. Established in
  E1, reused in W15.
- Mutation testing for new characterization tests: before considering a
  test done, deliberately break the thing it's supposed to catch (comment
  out a line, change a value) and confirm the test actually fails; fixed a
  vacuous test this way in the W13 review round.

## Environment

- Worktree: `/home/mark/dreamwidth/.worktrees/bml-terra-widgets-20260922`
- Devcontainer: `4da9c8ba2712`
  (`docker exec -w /workspaces/dreamwidth 4da9c8ba2712 bash -lc '...'`)
- `LJHOME=/workspaces/dreamwidth`,
  `PERL5LIB=/opt/dreamwidth-extlib/lib/perl5:/workspaces/dreamwidth/cgi-bin`
- This test DB only has "en" and "en_DW" loaded via `texttool.pl load` (no
  "ru" or other real translated language) -- `en_DW` is the go-to stand-in
  for "a non-en language code" in tests that need one.

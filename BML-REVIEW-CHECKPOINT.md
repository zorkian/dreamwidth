# BML review checkpoint (bml-opus-review) — 2026-09-23

Operational, untracked. Written at the foreman's request because the session limit is close.

## Identity and state

- Role: independent reviewer (Opus) under bml-fable-foreman.
- Worktree: `/home/mark/dreamwidth/.worktrees/bml-sol-review-20260922`.
- HEAD: detached at root `a0f2d7a8480198c4c99839511d720f9521aba043` (final; graduation complete). No local edits apart from this file; every probe and mutation was restored or deleted.
- Container: `904e68156988`.
- Dev server (starman on :8080 in that container): running `15ab9c051` code (restarted for the final E3 browser run).
- No owned test, browser or fixture processes are running.

## Verdicts

### E3 (engine deletion) `319a03ca4` + static fix `fa75b9d82` + robots fix `15ab9c051` — FINAL CLEAR (sent). Dev starman now runs 15ab code.

- The E3-specific commits are verified: nothing reads a deleted hook or file; the adapter loads; every selectable scheme renders; routing, carry-over, inbox and entry pages are unchanged; the dropped subtests were false or vacuous; the docs state the deploy gates; 36/36 allowlist passed at `319a03ca4`.
- The static-file regression at `319a03ca4` (robots.txt, favicon.ico, apple-touch-icon.png, protocol.dat, rte/*, 500-error.html returning 404) is fixed by `fa75b9d82`.
- NEW blocker in `fa75b9d82`: the path-only Static rule serves the SITE `htdocs/robots.txt` on JOURNAL hosts before routing, bypassing `DW/Controller/Journal.pm` robots_txt (:166-167, :265-269). Proven: a blocked journal (`opt_blockrobots=1`) loses `Disallow: /`. Fix: skip robots.txt when `$env->{'dw.journal_user'}` is set, or serve it natively for the site host only; add a test for blocked, ordinary and www.
- Verified OK in `fa75b9d82`: rte/ traversal returns 403, and journal-host favicon is 200 image/vnd.microsoft.icon.
- STILL TO DO on the corrected commit: fa75's allowlist (t/plack-root-static.t, t/plack-no-bml-fallback.t, t/plack-bml.t, t/plack-subdomain.t, t/plack-journal-feeds.t, t/routing-*.t, t/00-compile.t, t/02-tidy.t) and entry-preview.js on a restarted server.
- Integration notes: keep ROOT's `t/bml-shims-loaded.t` (15714a059, stronger); drop `aeb94fb1b` (the W13-fix tests pass on E3 code).

### W15 `32cf431b4` (LJ::Lang .bml branches) — CLEAR (sent); the foreman confirmed t/lang-names-native.t passes on root 3c679e9ea (post-E2), so the failure is lineage-only

- The diff removes exactly the three `.bml` branches (relative_langdat_file_of_lang_itcode, itcode_for_langdat_file, get_text from_files) plus comments. No `.bml`-scoped key is requested in code after W14.
- Allowlist at `32cf431b4`: all PASS (lang-itcode-files 1..5, ml, native-*-language, lang-bml-file-branch 1..7, plack-entry-strings 1..30, langdatfile 1..9, 00-compile 1..1595, 02-tidy 1..1115) EXCEPT `t/lang-names-native.t` test 1 ('plain ljlib nonweb setup does not load BML::ml'). That is consistent with the lineage explanation: the base predates E2, so ljlib still loads DW::BML via T8's `use`. The foreman is to verify it on root.
- Done: the deadphrases parsing replica matches texttool.pl sub deadphrases (comment strip, blank skip, trim, split; the domain check is approximated by defined $it; wildcard entries skipped). Revert check: the parent Lang.pm fails only the new .bml->base .dat mapping subtest (4); the other 4 subtests are equivalent.

## Earlier verdicts in this session

W16 `964b147c8` CLEAR and T9 `e8d1c180b` CLEAR (both sent). T10 `9455f59ce` + `2519397d0` FINAL CLEAR (sent). No further graduation candidates; standing by. All sent to the foreman; root integrity checks passed through `a0f2d7a84` (final). W14 `e9d79a38f` CLEAR. W13 range incl. `3f3d93312` CLEAR. E2, E1b, E1 (+ comment fix), W12, T8 (+ fix), W11, W10, W9 (code + doc), T7, T6, W8, T5, T4, W7-A/B, F2, W3, W2, W1, T2+T3, T1, W4 are all CLEAR after their fixes.

## Standing rules (from the user)

- Run ONLY the tests on each candidate's allowlist, plus the candidate's own new tests. Before running any other suite, grep it for set_rel (other than 'A'/'P' fixtures), sysban, mark_entry_as_spam, mark_as_spam, log_event ban_set, suspend, expunge, delete_user, statusvis (except temp-community 'O'->'V'), spamreports and userlog; stub those paths inert or ask. No console/sysban/moderation globs.
- Moderation and report paths stay inert: stub them as recorders and assert call counts. Never "clean up" past local mutations with further admin actions.
- No push, publish, remote merge or deploy. Local review only; report exact SHAs, and keep source clearance separate from HTTP/browser/public acceptance.
- Comments describe present code, not history (AGENTS.md).

## NEW TASK (2026-09-24): PR #3670 cleanup review

- Baseline: `origin/bml-graduation` = `1fd999ef1bf977baf4a723f025ed708d10cf7791` (8-commit squash). The old 600+ commit branches are stale; do not compare against them.
- Handoff: /tmp/bml-squash/team-cleanup-handoff.md.
- Worktree detached at 1fd999ef1; container 904e68156988 (HTML::Form OK). Restart starman before any browser run.
- Expected candidates:
  - themenav `bml-cleanup-entry-options-20260924`: 4 commits (render options, crosspost_callback, ImageDialog upload-return, moderated-post scaffolding).
  - widgets `bml-cleanup-recovery-20260924`: 2 commits (an equivalence harness against the CURRENT DW::Entry::Legacy as oracle, then a bounded production patch).
- Final step: combined-diff review of /home/mark/dreamwidth/.worktrees/bml-graduation-squashed-20260924 before the foreman pushes.
- Scrutiny: privacy (custom bits through 60, community custom -> private notice, friends -> access), exact subject/body bytes and subject hint, dates/trust, editor selection, never-save, and that the harness oracle is the current code.

### PR #3670 cleanup verdicts (2026-09-24, all sent to the foreman)

- Worktree is now detached at `8c67b4620` (clean). The dev starman runs `d51b5181c` code (restarted for the image-preview.js run).
- (0) `399dc9c41` CLEAR. The new parity cases fail on the parent and pass on the candidate. The `$ml_scope` warning goes from 1 to 0. Regex strip and as_text give identical results on 6 synthetic cases.
- (1) `60d305d8e` CLEAR: no producer of the removed render options anywhere. (2) `56e3cebe7` CLEAR: 2 closure mutations are each caught by crosspost.t. The foreman integrated both as bec8a7701 and d3d17290c.
- (3) `d51b5181c` CLEAR (source + local browser). No upload_count/onUpload producer; the dialog has no upload form; image-preview.js PASS on the restarted server.
- (R)a `d09e4e971` CLEAR as evidence. The frozen oracle is cmp-equal to root, and 868/0 was reproduced. Gap: the RTE empty-body-clear branch was untested (the boundary case takes the non-fast path).
- (R)b `9b79db948`: logic CLEAR. Production is token-identical to the harness mapper. Independent fuzz (scratchpad zz-opus-fuzz.t + zz-opus-oracle.txt): 12002 cases, 0 differences, and it catches every production mutant. REQUIRED comment-only fixup in Legacy.pm: the legacy_post_hash comment, the crosspost "generic prop copy" comment, and the wordy prepare_entry_form comment. Optional: an RTE-clear assertion.
- (4) `8c67b4620` CLEAR: 26 assertions, names identical after normalizing; fire stub kept.
- NEXT: the combined-diff review of /home/mark/dreamwidth/.worktrees/bml-graduation-squashed-20260924 when the foreman asks. Re-run the fuzz against the integrated Legacy.pm there.

### Combined review 1fd999ef1..3d147371d (integration worktree bml-graduation-squashed-20260924) — sent
- My worktree is detached at 3d147371d (clean). dae6fdf54 (widgets comment fixes + RTE-clear test) was reviewed as part of this.
- Code, tree and tests CLEAR. merge-tree(8c67b4620, dae6fdf54) = 3d147371d^{tree} c05a1cd33. Every intermediate tree matches its candidate. Fuzz: 12002 cases, 0 failures. All 18 allowlist files pass.
- HELD on text only:
  - 3d147371d message misattributes the community custom->private fallback and empty-usejournal handling to the decoder;
  - bec8a7701 message says "warned on every request";
  - comment trims: Legacy.pm "subject, with…" and "props copied…"; the decoder-test "Unlike <p>…" comment; the new-parity "(an absolute ml key)…" comment.
- Re-verify after the fixups: a text-only diff plus 02-tidy, and patch-id/tree checks against 3d147371d apart from the comment lines.

### Final reword 1fd999ef1..80761ac72 — GO sent
- backup (3d147371d)..80761ac72: comment-only (+3/-8, 0 non-comment lines). Two messages fixed, as requested. decoder, new-parity and 02-tidy pass at 80761ac72.
- My worktree is detached at 80761ac72 (clean). The foreman pushes; public/HTTP acceptance after deploy is separate.

### PUSHED by the foreman: origin/bml-graduation 1fd999ef1..80761ac72 (PR #3670, body updated). No further assignment; standing by for the user.
- Final state: worktree detached at 80761ac72, clean except for this file. No owned test/browser/puppeteer processes running. Dev starman (4 procs) still serves d51b5181c code in 904e68156988, left running as-is.
- Branches and worktrees left untouched, as instructed. Earlier evidence artifacts in the container's /tmp/opus-* (graduation-era probe dirs) are kept; this session's logs were removed.

## NEW TASK (2026-09-24, user-approved): text-only recovery + test audit
- Handoff: /tmp/bml-squash/text-recovery-handoff.md. Baseline origin/bml-graduation 80761ac72 (13 commits, CI green); my worktree is detached there.
- Writer A (widgets, bml-text-recovery-20260924): minimal recovery page echoing ONLY the exact subject/body in escaped textareas, plus a notice and links; deletes DW::Entry::Legacy and the recovery helpers; keeps GET redirects and the picker. Review the DESIGN NOTE first, then the implementation.
- Writer B (themenav, bml-test-audit-20260924): prune migration tests; audit in /tmp/bml-squash/test-audit/. Review for MEANINGFUL GAPS (authz, CSRF, privacy, no-auto-save, drafts, live dialog flows, success paths) and stale CI references.
- Checks for A: exact raw bytes (markup, Unicode, CRLF, '</textarea>', placeholder subject, empty vs missing); textarea leading-newline rule; HTML escaping; no writes; no stored-entry exposure; no credentials/metadata carried; redirects intact; no deletion of live paths (native preview, picker).
- Final step: combined-diff review of the integration worktree before the foreman pushes.
- A's DESIGN NOTE (views/entry/recover.tt; legacy_text_recovery($post) called from /update POST and /editjournal?itemid POST): APPROVED in principle, with requirements R1-R8 sent to widgets and the foreman:
  - R1 no form-auth check;
  - R2 edit link built only from canonical_username plus the validated itemid;
  - R3 no form/names/hidden inputs;
  - R4 marker non-exposure and non-carriage tests, draft unchanged, log2 unchanged, both .bml aliases, logged in and out;
  - R5 CRLF becomes LF in the DOM (document it);
  - R6 browser checks of .value;
  - R7 missing-vs-empty note optional;
  - R8 deletion greps and the deadphrases convention.
- Verified: the old forms post urlencoded (no enctype); the body field is 'event'; TT has no custom html filter.
- TEST AUDIT (user's stricter bar: tests must earn their place): B's first pass kept ~95%, and I rejected that as a standard. I sent per-file calls to themenav and the foreman; full text in scratchpad testbar.txt.
  - Headline: delete ~23 family-A per-caller/BML-premise files and replace them with one BML-token lint plus one page smoke table.
  - Big trims: manager-moderation, spellcheck, customize-mutations, inbox-cutover, settings, cutover and legacy-preview.
  - Browser: delete the widget-foundation cluster, entry-displaydate.js, entry-maintainer.js and possibly access-filters.js; trim the customize/settings/picker browser tests.
  - Correct baseline is upstream/main: t/ is 117 files, +16614. The auth-2fa files are upstream, not in the PR. CI globs t/plack-*.t, so no list edits are needed.
- B's commits so far (b5afd057a, b7073d2b8, ea60b1019, 0ef6cd244, c4254db13, f39d37d10) are not yet reviewed per SHA; they're awaiting B's tighter pass.
- B accepted my calls as the spec and is working through families A to F with a SHA per commit; F waits for A's recovery test.
- Lint scope sent: 'BML::' and '$BML::' only (0 hits at 80761ac72). A generic '<?' pattern would hit two PRE-EXISTING upstream bugs: views/shop/confirm.tt:15-19 (garbled Perl/BML block) and support/append_request.tt.text .bounced.success (raw <?h1/<?p). I suggested a separate follow-up PR for those.
- USER STANDARD (verbatim, via the foreman): "I hold a high bar for tests. They must be really earning their place. Not just testing. Simple logic that is obvious by inspection." My per-file calls stand as the themenav plan. Hold every SHA to this bar and re-derive the kept list per file. The two pre-existing template leftovers are OUT of #3670's scope; the foreman will raise them with the user. Next up: A's recovery candidate. (Saved to memory as tests-must-earn-their-place.)
- df7ef3e62 (family A: 23 deletions + no-bml-references.t lint): deletions CLEAR (set equals my list, tidy -22, lint mutation-proven). Lint HELD for R1 full DW header, R2 garbled comment, R3 scan ext/dw-nonfree not ext/. The commit message overclaims; fix at squash.
- 56e31f120: lint R1-R3 CLEAR (Authors line must be 'Mark Smith <mark@dreamwidth.org>'). The bundled restoration of protocol-sendmessage-language.t and birthday-setting-language.t is REJECTED: mirror/literal checks; sendmessage's test locks in a context-clobber side effect; its 'catch' was an integration accident. Asked for a revert and for unbundled deviations.
- Writer A range 80761ac72..efd8e97bf, PUSHED before review (flagged to the foreman). Core CLEAR: my probe 32/32; browser PASS; no chomp; greps clean.
  - B1: CI break, maintainer.t has 9 not-ok on the removed notice text.
  - B2: deadphrases '/views/' prefix is ineffective (itcodes have no /views).
  - T1: full headers needed on the new files.
  - T2: trim the legacy_text_recovery comment.
  - Cleanup: dead render_opts param.
  - Integration conflict: picker.t vs B's merge into maintainer.t.
  - My dev starman now runs efd8e97bf; worktree detached at efd8e97bf.
- B family A follow-ups (64d468776, fdf64c19b, 4ee29c5d7, 7b8ed61fd): CLEAR (native-lang scope restore mutation-proven 3/3) except: DELETE admin-faq-modtime.t (BML premise plus stub fixtures); comment-request-metadata.t has the LiveJournal boilerplate on a new file, so it needs the DW header. Asked for one final header-normalization commit for all kept new tests.
- B 1b60e1857 (displaydate/rendering-parity folded in, then deleted) and c7bbe7232 (admin-faq deleted, comment header fixed): CLEAR; edit-parity 39, new-parity 47, compile and tidy green.
- A follow-up 5c33feec4 (B1/B2/T1/T2 + render_opts): CLEAR to push. Maintainer 166/0; no test expects the removed notices. Nit: maintainer.t:~468 'no longer reaches' comment, to fold into B's merge.
- The foreman pushed 5c33feec4 to origin/bml-graduation. Themenav is rebasing bml-test-audit onto it (picker.t conflict resolved into maintainer.t, plus the :468 comment). My next candidates come from themenav's rebased branch.
- B 54f9a2e83 (entry family trims/deletes): CLEAR; dropping the rte_js_vars subtest is agreed; crosspost payload mutation still 2/2. After the rebase, check patch-ids for the cleared commits and review the maintainer/picker merge and family F fresh.
- Rebase (5aed5e9f6..c797b44cc): 14/15 patch-id SAME; 5aed5e9f6 merge CLEAR. Early commits CLEAR, except cbd4b45bf, which must RESTORE the 'privileged inspection POST cannot mutate owner subscription' forged-POST case (?user= path; server-side authz, not a CSRF duplicate).
- B 722642813 (family F) and 0f5f6711d (restored inspection case; branch HEAD): CLEAR with fixes (a) drop cutover's -e file-existence checks; (b) add an error.invalidauth content assertion to isolate the inspection guard.
  - B reported the security classifier BLOCKED its attempt to remove the SettingsHub auth guard (a mutation) and invited me to run it. I DECLINED, per the no-laundering rule, and am surfacing it to the user and foreman.
  - B wrongly claimed families C and D needed no changes; C, D and E are still pending under my calls, and I sent the full remaining list.
- B 4a5fea8df (fixes a/b) and 362f2278a (27-file header pass, comment-only): CLEAR. Six kept files still need headers (lang-native-request-context, native-lang-request-context, plack-access-filters, plack-root-static, widget-request, widget-resources); plack-root-static's description narrates history. The browser family moved to a peer's branch; my family E calls apply there. B is now on C/D.
- B 731f483b4 (family C, 5 files): CLEAR; kept protections verified by name; spam stubs cover the sysban case; all rc=0. customize-navigation is pending.
- Browser prune (widgets, bml-browser-test-prune-20260924, 5c33feec4..19447f963): CLEAR; 5/6 browser tests PASS on my server; customize-widget-apply.js needs the full header.
- fck-poll.js fails on the untouched original too. REAL REGRESSION in PR #3670: d2e4dad9a passes $remote to rte_js_vars, so free users get canmakepoll=false and LJNoPoll. fckplugin.js:363 (and :346) use getElementById("draft___Frame"), the OLD editor id; the native frame is entry-body___Frame. The result is a TypeError and no notice. Proposed a 2-line fix, a poll-capable fixture, and one notice assertion. Sent to the foreman and widgets.
- My dev starman now serves 19447f963.
- B fa2d6e40f (customize-navigation, plus 3 unmentioned D deletions) and 915f8cd9e (image-dialog, no-bml-fallback merge, widget-request): CLEAR; fa2d6e40f's message must be fixed at integration. Remaining D: page smoke, settings category trim, headers.
- B e676c1657 (page smoke) and 794896d3c (settings to 3 blocks, 47 assertions; inspection case kept): CLEAR. Fix: drop _T_CONFIG from the smoke and remove the tropo exclusion (a harness artifact; the live server is clean). icq is real, pre-existing upstream (#3577 file-backed lookup; DB-only key), so it's a follow-up item. Trim the smoke header.
- B 2112948a0 (headers) and ce8978ff7 (smoke fix): CLEAR; 0 kept files lack headers. Themenav branch complete from my side. Open: widgets browser prune (header, fck-poll fixture), fckplugin.js poll regression fix, message fixups, final combined review.
- Widgets browser prune plus poll fix (b6b978ae4, 0956c0444, 9b1345ec1): CLEAR; the poll fix is mutation-proven (draft___Frame restored -> TypeError); fck-poll, image-preview and entry-recovery PASS; temp-user fixtures. Nit: the fck-poll.js comment narrates history. My dev starman serves 9b1345ec1 (rebuilt). Next: the final combined review when the foreman integrates.
- FINAL: GO sent for 5c33feec4..6572b05da (tree == bd41d171f), on 46/46 of my run (all plack except sysban, plus PR non-plack tests), the foreman's 85-file pass and my earlier browser passes. The remaining files are still running; report any late failure.

### DONE (2026-09-24): the foreman pushed origin/bml-graduation 5c33feec4..6572b05da (6 commits; tree == bd41d171f) and updated the PR body.
- My CI-equivalent run completed with 60/60 rc=0 (40 plack tests excluding the untouched plack-sysban, 11 PR non-plack tests, 7 routing tests, 00-compile 1582, 02-tidy 1072). Browser passes were already recorded above.
- Net against upstream: tests went from 117 files/+16614 lines to 74 files/+8700; browser from 38/+3346 to 31/+2623; non-test additions from +4192 to +3755.
- Open follow-ups (outside #3670), raised by the foreman with the user:
  - views/shop/confirm.tt:15-19 garbled Perl/BML block;
  - support/append_request.tt.text .bounced.success has raw <?h1/<?p;
  - profile.service.icq has DB text but no source .dat (so the #3577 file-backed lookup reports it missing).
- Final state: worktree detached at bd41d171f (clean except this file). Starman STOPPED in 904e68156988; no owned processes. Container /tmp opus logs removed (older graduation-era probe dirs kept). Branches and worktrees untouched. Standing by.

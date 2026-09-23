# Rollback inventory: root commits 595a54928..a9a077a3d classified

Companion to [BML-BETA-GRADUATION-DECISION.md](BML-BETA-GRADUATION-DECISION.md).
Read-only classification of the 533 commits on `bml-astra-foreman-20260922`
above the overnight base `595a54928`, produced 2026-09-23 for the graduate-
replacements decision. Nothing here has been reverted. Bucket letters are used
by the decision report.

| Bucket | Meaning | Commits |
|---|---|---|
| A | Shared / keep regardless of the entry decision | 203 |
| B | Legacy entry port, code and tests: candidate drop | 161 |
| C | Mixed: shared and legacy in one commit | 26 |
| D | Legacy-port docs and evidence only | 143 |

## A. Shared / keep (203)

- `57533bb5c..2bb4530c7` (the first 167 commits, all shared): customize and
  theme navigation (2e042ecd5, 487d3e1d2, bcdced59f); settings hub
  (d792dc5c4..e4679e8c8, 035e27196); FCK poll (80c1c7c27, adb8502ff,
  6300adc42); LJ::Lang request-local state (ea1cf1913..f51de6ca4, b29e99f50);
  native language callers (2f9b0f43f, ba3604b24, 538d5d8dc, f4b760a3e,
  5249750db, 363cda887, 0512f0105, 23023f579, ea61aa63d, d50c11eea, 4f7832ea4);
  request notes and adapters (2e57379dc, 0bceb2942, 04f0fe2b2, a23efe915,
  0838d1028, fcba06e32); form-auth isolation (42840ba7b); inbox (3dd1c4464,
  e772d7919); entry picker (bd4b87237..95fcdf04c, 81ed8db2e, e83cddf0e, the
  last adds the `/editjournal` registration); native maintainer editor
  (2a33bfeb7, 8986e7de8, 156f37328); native form rendering (0aad3e37f);
  native drafts, display date and editor modes (f86d593dd, 8823c34c1,
  e9281a322); FCK image dialog (6dca2d923); native parity tests (f07bac73b,
  558ba0609, 42b80ed08); progress and handoff docs for the above.
- Native entry work interleaved with the port: owned-entry delete (440faea99,
  16b865dfa); preview and spellcheck contracts (cef5a20fe, f7fa3eaac,
  a426524be, 675d43958); preview popups (5f6a1b12d, 898aca48a); docs
  (bcb503adf, 0d27752ca, be2839b6b, c7eddb1fa, 2b164e4ee, b28269995,
  6ccda23b1, 67f594da1, 64280969e, 17ab58cd5, 93c44c63c); native draft
  clear/restore race fix 11fd6c97d (`htdocs/js/pages/entry/drafts.js`);
  image-insert baselines (bcd40791e, 61682d4d3); native spellcheck
  (5ab380e6c, 19a32d950, 450aa5ab1); protocol request notes (c2cc22f9c, the
  only change to `cgi-bin/LJ/Protocol.pm` in the range; 62193904a); native
  image insertion (59ebe781c, 188a479ea); web message language (599f70c29,
  5b8aa3ccd); checkpoints (104228f4a, 331f1f042, 5ab6dc9cd, a9a077a3d).

## B. Legacy entry port, code and tests (161, in order)

1. Legacy form contract tests: b1f8b13cc, 53357f450, 4d72caddd.
2. `DW::Entry::Legacy` helpers: 7d3a8eb70 (normalizer), 8a55d0170 (success-hook
   characterization; also edits the C test `t/plack-entry-moderated-post.t`),
   374e45d80 (formdata), de05d97bb (edit-action classifier), 182cad0d7
   (submission preparation), b762072f0 (hook-timing test).
3. Owned edit and update adapters: 83765695c (first Entry.pm change),
   13cba88f7, c116f5b44 (legacy_update_handler), 5af39e827, 88e2c2cc8
   (legacy_owned_edit_post), 874a7d167, dc7d43ada, 9e65b9d50, 93fab0e2d,
   75e674910, bdfe83dcd, ad7debbef (community update).
4. `/update` POST activation: 8ba94e59d (adds the `register_string('/update')`
   block).
5. Owned edit browser tests: 42ab08b25, 6a26ab7a8, 30b7d90f4.
6. Update transforms: da02bde4c, 06f98f1a0, 7ab09a676, a150cc766, 6d43ae49f,
   1dfd1b0c3, aa309c906, 776789fba.
7. Owned edit POST dispatch: 5ea5858fc (first itemid dispatch in
   EntryPicker.pm), 31d322889, dad4bc220, 06735ba3a.
8. Transform activation: d419097ae.
9. GET renderers: 98f202d14, bc52393ca, b8dbb3758 (legacy_update_get_render);
   dedfa7bc0, c7ad9abb9, 7e3f9dc51 (owned edit GET); 8ba47739b, 24995c4e5,
   d77e85b20 (legacy_update_get_handler); fa4e13737
   (`t/lib/LJ/Test/LegacyOwnedEditRoute.pm`, legacy-only); 6e1a52ac1,
   009a844b8; 5c91b54a2 (owned edit GET dispatch); 8c9813584 (also edits the
   C test `t/plack-editor-spellcheck-baseline.t`); 11c75c53e; 003e8c593,
   ddb2d38b4, d7c4b9058, 81fc421f4, 36465e9e4, d00ab5dbb (community edit GET);
   53f82843f, 7963b513d, 9177ba357 (`/update` GET activation); 1aca57868
   (terminal responses, adds `views/entry/update-terminal.tt`); 17e74d7e2,
   98c4e1107; af0643fbe (same-poster community GET dispatch); 0c5b6f927;
   f468b49ac (last change to `t/plack-entry-picker.t`); ea8ad7aca; 2f36ed6fc,
   653c12cba, f47aab510, eb47aca13 (terminal activation).
10. Manager, readonly, same-poster: 6c70d09ef (manager delete
    characterization); 0fa540eb3, 95fc0245e, b5e3183d1, a564e9e50 (readonly);
    51a7ec6c1, 184a32c7a, ed5210e22, f7f159f6c (invalid usejournal), ce765e52b,
    936b31e35, 7b05844c5, afeafd8ca, bbd359599 (same-poster POST dispatch),
    6d114aa98, 287b74adb, 5fade5774, 46aa7cdb8, d43dde452, deff039ce,
    c7c237d39, fab612d4c, 9db37b6db, bea19757a, 25578c9a8, 2e4a449f6.
11. Anonymous and manager property: e14dda093, fd7445599, 9f0bb8848,
    fbe73790b, f26b50442, d5d91fc4f, 88eaa5b1c, a88bb4e97, 1e7bd2faa,
    ddb515a8a, fd8c6954b, d2b7cc6ba, 8d2be92c5 (manager dispatch in
    EntryPicker), 88a819e17.
12. Share: 689cb2725, 45bf590ce, 800f8d52a.
13. Anonymous auth and continuation: bb6b088e3 (edits `htdocs/update.bml`
    draft JS defaults), 9df4acb83, e018e1fa0, d5aa0905b, 94a035428 (public
    share), 7f5dc5da1, ca854f263, 906fd65f4.
14. Alternate login: 3d68a723a, 7e2ec8b73, 29cc1537a, 33674d641, f04f3877d,
    b3a745609, d4e5cac46, 45e7bf723, 7410b2fc9 (mapper), d5f8a157e.
15. Public anonymous: 716af91af (last change to the `/update` block),
    6986108cd, 25c12c3bc, 929144171, 7aa7ddcbc, fb44e3f87, 2f0dce4d2,
    eac62c500, 9b1a49303, 9dc3bebe8, 163dc9dde, 32223574c, 77b04d919,
    13b400adc, 31c1f0384, ad3d8d9d0.
16. Request delta, raw hook builder, rerender, composition: c7a4131c1,
    f62a8b25e, 17b61d7f1, cee270600, 96c253a44, ff2163b19, e473de049,
    e8068aa3c, 2dba301fa, 334b531dc, 35329b053.

Unintegrated, preserved on worker branches (also bucket B): 5ec8dec2a,
d21b1c3a3 (editor-date branch, patch-identical to 334b/3532); eda6394a6,
5d282324c (hook composition); e1a991d88, a0cfe4f23 (altlogin POST
characterization); 68789a565 (WIP draft.bml characterization).

## C. Mixed (26)

| Commit | Shared part | Native needs it? |
|---|---|---|
| 3862f9eba | `t/plack-entry-moderated-post.t` native `/entry/new?usejournal=` subtests | keep native subtests |
| d6aa5dbb7 | `t/plack-entry-crosspost.t` native subtests | keep native subtests |
| f6a8261d7, c6c1f96f9 | `t/plack-editor-spellcheck-baseline.t` parity reference | keep native subtests, drop `/update` ones |
| abc509db6, 38dca7bd7 | `/preview/entry` route and `legacy_preview_handler`; deletes `htdocs/preview/entry.bml`; `LJ::Lang::ml` in `entry_form_decode` | needed while `js/entry.js` (BML editors) is served; native uses `/entry/preview` |
| 46a1a5398, 31a4c2fd3 | moves `LJ::entry_form_decode` body into `DW::Entry::Legacy::decode_entry_form`; `LJ/Web.pm:2144-2146` delegates | **shared**: callers are update.bml, editjournal.bml, legacy preview. Keep `decode_entry_form` (or move it back) until the BML editors are deleted |
| be40787bf, 5bead7879, b92d6bd49 | pure extractions `_render_new_form`, `_render_edit_form`, `_render_maintainer_form` | **yes, keep** |
| d8b910151 | null guard `$u && $ju` in `_queue_crosspost`, callback default | keep guard; legacy_success branch is drop |
| 0c3bb1722, a272189a0 | legacy-only hook seams inside `_do_post`, `_do_edit`, `success.tt` | no; removal edits shared subs |
| da092e789 | `_legacy_post_spam_check` call inside `_do_post` | no |
| b96357e07 | `$render_opts` on `_render_new_form`; `use DW::Entry::Legacy` | no (defaults) |
| cef5672e6 | `action` override on `_render_edit_form` | no (defaults) |
| b79ea4bf2, 58d84973c | legacy_attempt/suppress variables in `_do_post` (added then removed) | no |
| 9e05a87a8 | `title_override` in `form.tt:65`, `Entry.pm:960-961` | no (fallback) |
| 4d3c64c78, 6efc4451e, 05d40134a | altlogin presentation in `form.tt`, `login.tt`, `_init` suppress_crosspost, `submit_action_name` | no, but **6efc4451e broke the native edit submit name** |
| a239fd248 | `submit_action_name \|\| "action:post"` (`form.tt:260,407`) plus rendering-parity test | **yes while 6efc4451e is in tree**; remove together or keep both |
| d6bd37f19, 77930b27b | `htdocs/js/xpost.js` guard and test | real BML bug fix; keep while any BML editor is served |

## D. Legacy docs and evidence (143)

Doc-only commits about the port (BML-UPDATE-*, BML-ALTLOGIN-*, BML-ANONYMOUS-*,
BML-OWNED-*, BML-MANAGER-*, BML-COMMUNITY-*, BML-SAME-POSTER-*,
BML-EDITOR-POST-COMPATIBILITY, BML-LEGACY-POST-HOUSEKEEPING,
BML-ENTRY-LEGACY-*, handoff/progress entries) and the legacy-only evidence
directories under `doc/bml-evidence/2026-09-23/`: legacy-update-adapter,
legacy-owned-edit-adapter, legacy-owned-edit-public, legacy-owned-edit-get,
legacy-update-get, community-edit-get, community-edit-get-public,
update-terminal, update-readonly-callable, update-readonly-public,
update-invalid-terminal, community-edit-post-callable,
community-edit-post-public, update-anonymous-callable,
manager-property-callable, manager-property-public, update-share-callable,
update-share-public, anonymous-update-callable, anonymous-failure-callable,
update-altlogin-callable, anonymous-update-public, update-altlogin-rerender.
No code depends on any D commit; they can stay as history or be pruned in a
single docs commit.

## Dependency facts for the removal sequence

- First B commit: b1f8b13cc (tests). First production code: 7d3a8eb70
  (`Legacy.pm`). First `Entry.pm` change: 83765695c. First route activation:
  8ba94e59d.
- `DW::Entry::Legacy.pm`: only 31a4c2fd3 (C) precedes the B commits and no A or
  C commit touches it afterward, so its B history is cleanly separable;
  `decode_entry_form` must survive.
- `EntryPicker.pm`: e83cddf0e (A) first, then only B (5ea5858fc, 5c91b54a2,
  af0643fbe, bbd359599, 8d2be92c5). The `/editjournal` registration is A; the
  itemid dispatch block (lines 35-52) is B and removable alone.
- `Entry.pm` and `form.tt`: B and C alternate (9e05a87a8, 4d3c64c78,
  6efc4451e, 05d40134a build on legacy_update_get_render and the share
  handler; b79ea4bf2/58d84973c rewrite `_do_post` regions from d8b910151,
  0c3bb1722, da092e789; a239fd248 fixes 6efc4451e). A newest-first
  `git revert` of B alone conflicts. Use one forward deletion commit instead.
- The `/update` block (`Entry.pm:92-112`, from 8ba94e59d, d419097ae,
  53f82843f, 716af91af) can be removed or replaced by a redirect on its own;
  every handler in it returns undef to fall through, so removing it sends all
  `/update` traffic back to `update.bml` and leaves the helpers as dead but
  compiling code.
- Test files shared between buckets, B always last so newest-first removal is
  clean: `t/plack-editor-spellcheck-baseline.t`, `t/plack-entry-moderated-post.t`,
  `t/plack-entry-picker.t`, `t/plack-entry-rendering-parity.t`.
- `cgi-bin/LJ/Hooks.pm`: no commits in range. `htdocs/js/pages/entry/*.js`:
  changed only by A commits.

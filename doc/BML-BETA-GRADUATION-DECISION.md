# BML graduation decision report

Analysis only, 2026-09-23, per [BML-DIRECTION.md](BML-DIRECTION.md). Tree
surveyed at `81c11fe82`..`a9a077a3d` (branch `bml-astra-foreman-20260922`);
nothing was reverted, deleted, activated or pushed. Commit-level detail is in
[BML-BETA-GRADUATION-ROLLBACK-INVENTORY.md](BML-BETA-GRADUATION-ROLLBACK-INVENTORY.md).
Line references are to this tree.

## 1. Summary and recommended path

- Two legacy surfaces have working native replacements: the entry pages
  (`update.bml`, `editjournal.bml`, plus `imgupload.bml` and `draft.bml`) and the
  inbox (`inbox/index.bml`, `compose.bml`, `markspam.bml`). Both replacements are
  reached today only through an opt-in beta (`updatepage`, `inbox`), and no
  tracked config enables either sitewide.
- The native entry page already covers everything the old page does except:
  alternate login (post as another account while logged in), community-manager
  delete and delete-as-spam of other posters' entries, a plain-editor embed
  button, several legacy-only extension hooks, and two cosmetic notices. The RTE
  is the same FCKeditor on both pages, so nothing is lost there.
- The native inbox covers all core flows; it lacks a bookmark-delete confirm,
  shift-click expand-all persistence, in-place result pages, and has one
  must-fix security defect (unvalidated `view` reaching a string `eval`).
- Of the 533 commits on this branch above the overnight base, 161 code/test
  commits and 143 doc/evidence commits exist only to make the retained BML entry
  flows run natively. They are separable, but not by `git revert`: a single
  forward deletion commit is the safe removal. 203 commits are shared work to
  keep; 26 are mixed and are itemised.
- **Recommended path:** graduate both replacements. Close only the moderation
  gap (manager delete/spam) and the inbox `eval` before cutover; accept the
  other losses unless the user chooses otherwise; then cut `/update`,
  `/editjournal` and `/inbox/*` over by redirect, retire the beta keys, delete
  the legacy adapters in one forward commit, and delete the `.bml` pages with
  their JS. Nothing built so far needs to be reverted first; the deletion
  happens after cutover so the tree never loses a working path.

## 2. Inventory of beta replacements and legacy entry points

| Beta key / replacement | Native routes | Legacy entry points still served | How users reach native today |
|---|---|---|---|
| `updatepage`: native entry page | `/entry/new`, `/entry/<comm>/new`, `/entry/<user>/<ditemid>/edit`, `/entry/preview`, `/__rpc_draft`, `/entry/options` (`cgi-bin/DW/Controller/Entry.pm:63-91`); picker `/editjournal` no-itemid (`DW/Controller/EntryPicker.pm:28`) | `htdocs/update.bml`, `htdocs/editjournal.bml`, `htdocs/imgupload.bml`, `htdocs/tools/endpoints/draft.bml`; `htdocs/js/entry.js`, `htdocs/js/xpost.js` (loaded only by those two pages) | `/entry/new` is **not gated**; beta members are redirected from `/update` GET and `/editjournal?itemid` (`update.bml:57-58`, `editjournal.bml:195-196`, native copies `Entry.pm:1305-1311,326-332,390-395`). 13 nav links still point at `/update`, 12 at `/editjournal`; only `DW/Controller/Poll.pm:686-690` chooses by beta. On this branch `/update` and `/editjournal?itemid` are native routes with BML fallthrough (`Entry.pm:92-112`, `EntryPicker.pm:35-52`, `app.psgi:166-172`). |
| `inbox`: native inbox | `/inbox/new`, `/inbox/new/compose`, `/inbox/new/markspam`, `/__rpc_inbox_actions` (`DW/Controller/Inbox.pm:29-32`) | `htdocs/inbox/index.bml`, `compose.bml`, `markspam.bml`; `LJ::Widget::InboxFolder`, `InboxFolderNav`; `htdocs/js/esn_inbox.js` and 6alib scripts | Beta members redirected from `index.bml` GET only (`index.bml:37-38`). All nav links, ESN mails and native redirects point back at legacy `/inbox/` (`LJ/Web.pm:2651`, `DW/Logic/MenuNav.pm:213`, `Inbox.pm:447,451,608,622,695-703,728`). |
| Image dialogs (already graduated) | `/imguploadrte`, `/imgpreview`, `/tools/fck_poll` native (`DW/Controller/ImageDialog.pm:24-32`, `ImagePreview.pm`, `FCKPoll.pm`) | none tracked | default |
| `nos2foundation`, `manage2fa`, `canary` | not BML related | none | out of scope |

Beta mechanics that matter for cutover (`cgi-bin/LJ/BetaFeatures.pm`,
`LJ/BetaFeatures/default.pm`): an unconfigured key counts as active; removing a
key from config does not end memberships; the only force-on is `sitewide`, the
only force-off is `end_time` in the past. Retiring a gate therefore means
deleting the `user_in_beta` calls. Two incidental findings from the survey, not
acted on: the `/beta` POST toggles betas for `$post->{user}` without checking it
is the remote user (`DW/Controller/Misc.pm:61-71`, form-auth protected); and
`DW/Controller/Inbox.pm:56` and `index.bml:74` compare `view eq 'archive'` while the method is
`archived_items`, so the archive folder gate never matches in either inbox.

## 2. Entry pages: `/update` and `/editjournal` versus native `/entry/new` and `/entry/<user>/<ditemid>/edit`

### 2.1 How the pages are reached today (worktree HEAD)

- Beta key `updatepage`; no handler class, default handler. Site config `%LJ::BETA_FEATURES` has only commented examples (`etc/config-local.pl.example:189-193`). A `sitewide` flag would enable it for everyone including anonymous visitors (`cgi-bin/LJ/BetaFeatures.pm:114-118`, `BetaFeatures/default.pm:104-110`).
- Per-user opt-in needs cap `betafeatures` plus userprop `betafeatures_list` (`BetaFeatures.pm:174-175`); UI at `/beta` (`DW/Controller/Misc.pm:40,77-90`).
- **`/entry/new` and `/entry/.../edit` are not gated at all** (`DW/Controller/Entry.pm:63-64,89,128-145`). Only the redirect from `/update` GET (`update.bml:57-58`, native copy `Entry.pm:1305-1311`) and from `/editjournal` (`editjournal.bml:195-196`, native `Entry.pm:326-332,390-395`) consults the beta.
- Navigation still points at `/update` in 13 places and `/editjournal` in 12 (menu, schemes, control strip, login/index views, S2 `edit_entry` link `LJ/S2.pm:4328`, `LJ/Talk.pm:202`, protocol messages `LJ/Protocol.pm:1666,2188`, ESN mails `LJ/Event/Birthday.pm:147`, `RemovedFromCircle.pm:98,114`). Only `DW/Controller/Poll.pm:686-690` chooses by beta.
- On this branch `/update` (`Entry.pm:97-112`) and `/editjournal` (`DW/Controller/EntryPicker.pm`) are already native routes whose adapters render `views/entry/form.tt` and return undef to fall through to the BML file (`app.psgi:166-172`). The beta banner `.beta.on` is unconditional (`form.tt:126`, `Entry.pm:1662-1663`), so non-beta users already see it on natively rendered `/update`.

### 2.2 Feature delta (legacy → native), with recommendation

| Feature | Legacy | Native | Delta | Recommendation |
|---|---|---|---|---|
| Rich text | FCKeditor (`LJ/Web.pm:1297`) | Same FCKeditor (`form.tt:57-58`, `js/pages/entry/rte.js`) | none | accept |
| Formatting modes | plain/rich + no-autoformat box → `prop_opt_preformatted`/`prop_used_rte` | `editor` select: casual HTML, Markdown, raw HTML, RTE (`DW/Formats.pm:30`) | native is a superset; userprop `entry_editor` vs `entry_editor2` | accept; **decision: one-time migration of `entry_editor` → `entry_editor2` or let users re-pick** |
| Preview | `/preview/entry` (now native `legacy_preview_handler`) | `/entry/preview`; shared `_render_preview` | none | accept; retire `/preview/entry` only after legacy JS is gone |
| Spellcheck | update.bml:143-155 | `form.tt:247-249`, `Entry.pm:1438-1460` (added on this branch) | none when `$LJ::SPELLER` set | accept |
| Drafts/autosave | `draft.bml` via `js/entry.js` | `/__rpc_draft` (`Entry.pm:3218-3326`); same storage, also saves editor | none | accept; **retire `draft.bml` with `js/entry.js`**; existing drafts stay readable |
| Image insert/upload | `/imgupload` popup with URL+alt and `upload_count` | inline URL+alt panel (`image-insert.js`); RTE uses native `ImageDialog` | no file upload in either; native lacks the `upload_count` hook callback | accept; retire `imgupload.bml` |
| Embed insert button | toolbar button (`entry.js:572-584`) | none in plain editor (FCK prompt strings only) | **gap** | **decision**: accept loss (users paste `<site-embed>` markup) or add a small button |
| Crosspost | Web.pm:1667-1776 | `module-crosspost.tt`, `_queue_crosspost` | none | accept |
| Security/custom groups | `custom_bit_N` | `module-access.tt`, `Entry.pm:1556-1608` | none | accept |
| Date/backdate | `date_ymd`/`hour`/`min`, `prop_opt_backdated` | `entrytime_*`, `entrytime_outoforder` | none | accept |
| Tags/currents/icon/comments/adult | all present | all present (`module-*.tt`) | none | accept |
| Sticky, admin flag, slug | absent | native only | native superset | accept |
| Community posting | `usejournal` select | `journallist` + `/entry/<comm>/new` | none | accept |
| Anonymous one-time login | `user`/`password` on the form | login modal, `username`/`password`, `_auth` (`Entry.pm:2073-2114`); `remember_me` set by JS but unread | functional; `remember_me` dead | accept; **optional**: wire or drop `remember_me` |
| **Alternate login** (`altlogin=1`: logged in, post as another account) | supported (`update.bml:121-185,280-290`) | **not possible**: `_auth` ignores `username` when a remote exists (`Entry.pm:2085-2089`); `module-journal.tt` post_as fields exist but are not included | **gap** | **decision**: retire (log out / use the other account) or close by including `module-journal.tt` and extending `_auth`. Recommend retire. |
| Share (`?share=`) | update.bml:103-106 | `_prepopulate` (`Entry.pm:2642-2652`; reads `tags` not `prop_taglist`) | callers must send `tags` | accept; check share-link generators |
| Edit own entry | editjournal.bml | `/entry/.../edit` (`Entry.pm:1706-1876`) | native has no `authas` | accept (authas is a legacy-only affordance) |
| Delete own entry | yes | yes (`Entry.pm:1799-1812`) | none | accept |
| **Manager delete / delete-as-spam of another poster's entry** | yes (`editjournal.bml:183-188,251-257`, `LJ::mark_entry_as_spam`) | **none**; managers get property form only (`Entry.pm:1847-1851`, `views/entry/maintainer.tt`) | **gap** (moderation capability) | **must close** before retiring `editjournal.bml`: add delete and delete-as-spam actions to the maintainer form. Small backend seam; this was previously held as a policy question, now a required native capability. |
| Entry picker (`/editjournal` no itemid) | editjournal.bml:506-657 | native `DW::Controller::EntryPicker` (this branch) | none | accept |
| Hooks `update_fields`, `transform_update_*`, `after_entry_post_extra_*`, `entry_deleted_page_extras`, `entryforminfo` | run | only in `legacy_*` adapters; native never calls them | **deployment unknown**: dw-nonfree implements `entryforminfo` (`ext/dw-nonfree/cgi-bin/DW/Hooks/EntryForm.pm`); others unknown in production | **decision**: audit production hook implementations; add `entryforminfo` sidebar to native form if wanted; drop the rest |
| Post-save prefs `disable_auto_formatting`, `entry_editor` | saved (`update.bml:383-394`) | not saved; native uses `entry_editor2` | minor | accept |
| Suspended-entry notice, `converted_with_loss` warning | yes | only via legacy adapter / absent | minor | **decision**: accept loss or add two strings to native edit |
| Poll permission in RTE | `rte_js_vars($remote)` | called without `$remote` → `canmakepoll` always true (`Entry.pm:970,1929`) | native bug | **close** (one-line fix) |

### 2.3 Shared dependencies the native page keeps

- Native code never calls `LJ::entry_form`, `BML::*`, `Apache::BML`; `DW::Entry::Legacy` is loaded by `Entry.pm:30` but used only by `legacy_*` adapters.
- Native still uses `LJ::rte_js_vars` (`LJ/Web.pm`), FCK assets under `htdocs/stc/fck`, native FCK dialogs (`ImageDialog`, `FCKPoll`, `ImagePreview`).
- **Language strings**: native templates/code read `/update.bml.*`, `/editjournal.bml.*`, `/imgupload.bml.*`, `/preview/entry.bml` scopes (`views/entry/login.tt:20,26`, `Entry.pm:865,1100,1159,1172-1182,1217,1279,2519`, `EntryPicker.pm`, `form.tt:237-241`). The `.text` files must be retained or the keys relocated before deleting the `.bml` files.
- `js/entry.js`, `draft.bml`, `imgupload.bml`, `/preview/entry` are used only by the two legacy pages.

## 3. Inbox: legacy `inbox/*.bml` versus native `/inbox/new/*`

Native implements login and form-auth on all pages and RPC actions, ESN
readiness, all folders, singleentry view, mark read/unread/delete/all, bookmark
on/off, pagination, expand state, compose with the full validation set, reply
quoting, autocomplete, and markspam with sysban (`DW/Controller/Inbox.pm`).
Two earlier acceptance bugs are fixed (3dd1c4464, e772d7919).

| Delta | Legacy | Native | Recommendation |
|---|---|---|---|
| **RPC `view` string-eval** | n/a | unvalidated `view` reaches `eval "\$inbox->${view}_items"` (`Inbox.pm:298,421`) | **must close** before graduation (validate against `can("${view}_items")` as the page does at `:53-58`) |
| Compose eligibility | requires validated sender (`compose.bml:36-37`) | checks `user_messaging` only, wrong string (`Inbox.pm:442-448`) | **close** (one condition) |
| Confirm before deleting bookmarked items | yes (`esn_inbox.js:211-219`) | Delete All only (`jquery.inbox.js:13-14`) | close (small JS) or accept; recommend close |
| Shift-click expand/collapse all saved as default | yes via `/__rpc_esn_inbox set_default_expand_prop` | reads prop only | accept loss, or expose in settings later |
| Result pages after compose/markspam | in-place links | flash + redirect to legacy `/inbox` | accept (redirect target must become native) |
| `subject_limit` maxlength, icon reselect on error | present | missing (`compose.tt:57`, `icon-select-dropdown.tt:13`) | close (trivial) |
| Filter-link hiding, `mode` for item titles, newest-only expand in sent view | present | absent | accept |
| Legacy index POST and `/__rpc_esn_inbox` have no CSRF | weakness | native RPC checks form auth | graduation removes the weakness; add form-auth to `/__rpc_esn_inbox` mutations (it must stay for the nav unread count) |

No tests cover the legacy inbox pages, the `inbox_actions` RPC, native
index/bookmark/pagination or the beta redirect; only compose and markspam error
paths are tested (`t/plack-inbox-compose-errors.t`, `t/plack-inbox-spam-errors.t`).

## 4. Shared dependencies and deployment unknowns

- **Strings.** Native code reads `/update.bml.*`, `/editjournal.bml.*`,
  `/imgupload.bml.*` and the `/preview/entry.bml` scope from the legacy `.text`
  files. Deleting a `.bml` page is fine, but its `.text` must stay or the keys
  must move to `views/entry/*.tt.text` first. Production loads missing strings
  from file on demand (`LJ/Lang.pm:664-690`), so a key rename is a code change
  plus first-request load, not a DB migration. Native inbox uses only
  `views/inbox/*.tt.text` and global `inbox.*` keys.
- **Decoder.** `LJ::entry_form_decode` now delegates to
  `DW::Entry::Legacy::decode_entry_form` (`LJ/Web.pm:2144-2146`); its callers
  are the two BML pages and `/preview/entry`. It dies with them.
- **Extension hooks the native page never calls:** `update_fields`,
  `transform_update_*`, `after_entry_post_extra_options`/`_html`,
  `entry_deleted_page_extras`, `entryforminfo`. In-tree, only `entryforminfo`
  has an implementation (`ext/dw-nonfree/cgi-bin/DW/Hooks/EntryForm.pm:20-21`).
  **Unknown:** whether `ext/local` (not in the checkout) implements any of them
  in production. Decision needed before deleting the BML pages.
- **Beta config in production** (`%LJ::BETA_FEATURES`, `ext/local/etc`) is not
  in the checkout. Cutover must expire or delete `updatepage` and `inbox` there.
- **Journal request adapter** (`DW/Controller/Journal.pm:25,285,317`,
  `DW::BML::RequestAdapter`) and the held external contracts
  (`s2_head_content_extra`, `data_handler:*`, `DISABLE_PROTOCOL`, PageStats
  filename) are unaffected by this decision and stay held.
- **What remains of BML after entry and inbox are gone:** the engine
  (`Apache/BML.pm`, `DW/BML.pm`, `lj-bml-blocks.pl`, `BMLInit.pm`, scheme looks),
  `htdocs/_config.bml` and `ext/dw-nonfree/htdocs/_config-local.bml`
  (`ext/dw-nonfree/htdocs/_config.bml` is dead), the RequestWrapper
  `BML::set_language` shim, `LJ::entry_form` (99 `BML::ml` calls, deletable with
  the pages), and 14 small ordinary callers (`LJ/Web.pm:316-378,548,631`,
  `LJ/User/Login.pm:287,321`, `LJ/Protocol.pm:562,2339`, `ljlib.pl:496`,
  `LJ/Sysban.pm:502`, `LJ/PageStats.pm:145`, `DW/User/Rename.pm:419`,
  `DW/Hooks/Changelog.pm:34`, `LJ/Console.pm:203`, `LJ/Poll.pm:940`). The
  `LJ::Widget` framework stays (customize, shop, search, profile callers);
  `UserpicSelector`, `InboxFolder`, `InboxFolderNav`, `TagCloud` lose all callers.

## 5. Audit of completed and in-flight work

Classification of the 533 branch commits (detail in the inventory doc):

| Bucket | Count | Disposition |
|---|---|---|
| A shared/keep | 203 | language plumbing, request notes, settings, customize, picker, native maintainer editor, native drafts/spellcheck/preview/image insert, FCK dialogs, inbox fixes, checkpoints |
| B legacy entry port (code+tests) | 161 | obsolete under the new policy: `DW::Entry::Legacy` helpers, 26 `legacy_*` subs in `Entry.pm`, EntryPicker itemid dispatch, `/update` route block, `views/entry/update-terminal.tt`, `t/lib/LJ/Test/LegacyOwnedEditRoute.pm`, ~51 Perl and ~43 browser test files, 23 evidence directories |
| C mixed | 26 | keep the three renderer extractions (be40787bf, 5bead7879, b92d6bd49), the `_queue_crosspost` null guard (d8b910151), the decoder move (46a1a5398, 31a4c2fd3) until the pages go, `/preview/entry` (abc509db6, 38dca7bd7) until `js/entry.js` goes, the `xpost.js` guard (d6bd37f19) until the pages go, and a239fd248 for as long as 6efc4451e is in tree; drop the legacy-only branches inside `_do_post`/`_do_edit` |
| D legacy docs/evidence | 143 | history; prune in one docs commit or leave |

In-flight, preserved and unintegrated (all bucket B): themenav 5d282324c atop
eda6394a6 (decode-hook composition); widgets a0cfe4f23 atop e1a991d88
(altlogin POST characterization) and WIP 68789a565 (draft.bml
characterization). Integrated today before the policy change: 96c253a44..e473de049
(raw builder), e8068aa3c/2dba301fa (rerender browser), 334b531dc/35329b053
(composition). All are obsolete under the recommended path; none touches
shared code except additively in `Legacy.pm` and three test files.

Shared work produced by the port that the native page keeps: native spellcheck,
native image insertion, draft race fix, owned delete, maintainer editor, entry
picker, FCK dialogs, `/preview/entry` shared renderer, the three render
extractions, the crosspost null guard, form-auth isolation, and the native
subtests inside `t/plack-entry-moderated-post.t`, `t/plack-entry-crosspost.t`,
`t/plack-editor-spellcheck-baseline.t`, `t/plack-entry-rendering-parity.t`.

## 6. Orderly removal sequence (proposal, not executed)

Use forward commits; do not `git revert` bucket B (B and C interleave in
`Entry.pm` and `form.tt`, and `Legacy.pm` history is only cleanly separable
because nothing shared follows it). Nothing has been pushed, so history can
also be left as is.

1. **Decide gaps** (section 7). Close the mandatory ones natively: manager
   delete and delete-as-spam on `views/entry/maintainer.tt` and `_edit`
   (`Entry.pm:1847-1851`, reuse `LJ::mark_entry_as_spam`); inbox `view`
   validation; poll permission `rte_js_vars($remote)` (`Entry.pm:970,1929`).
   Optional closes: embed button, bookmark-delete confirm, compose eligibility.
2. **Cutover commit (entry).** Replace the `/update` block (`Entry.pm:92-112`)
   with a 302 to `/entry/new` that maps `usejournal` to `/entry/<comm>/new` and
   forwards `subject`, `event`, `prop_taglist`→`tags`, `share`; replace the
   EntryPicker itemid dispatch (`EntryPicker.pm:35-52`) with a 302 to
   `/entry/<journal>/<ditemid>/edit`; keep the no-itemid native picker. Remove
   the `updatepage` `user_in_beta` checks (`Entry.pm:328,391,452,521,1076,1123,
   1306`, `Poll.pm:688`) and the unconditional beta banner (`form.tt:126`,
   `Entry.pm:1662-1663`). Optionally retarget the 25 nav links. Expire the key
   in production config. Drafts and preferences need no migration: both pages
   store `entry_draft`/`draft_properties`; decide `entry_editor`→`entry_editor2`.
3. **Cutover commit (inbox).** Register the native handlers at `/inbox/`,
   `/inbox/compose`, `/inbox/markspam` (or 302 from them), point native
   redirects and `msg_list.tt:16,18` at native, remove the `inbox`
   `user_in_beta` checks (`index.bml:37-38`, `UserMessageRecvd.pm:53-56,145-148`,
   `LJ/User/Message.pm:405-416`) and banner (`views/inbox/index.tt:21`). No data
   migration: same `NotificationInbox` rows and bookmarks.
4. **Forward deletion commit (entry adapters).** Delete the 26 `legacy_*`/
   `_legacy_*` subs and the `legacy_success`/`legacy_edit` branches in
   `_do_post`/`_do_edit` (`Entry.pm:299-1437,2375,2549-2623`), `use
   DW::Entry::Legacy` (`Entry.pm:30`), `views/entry/update-terminal.tt`, all
   bucket-B tests and browser fixtures, `t/lib/LJ/Test/LegacyOwnedEditRoute.pm`,
   the legacy subtests in the four mixed test files, and the worker branches'
   unintegrated candidates. Keep `submit_action_name || "action:post"` or
   remove it with 6efc4451e's presentation options together.
5. **Delete the pages.** `update.bml`, `editjournal.bml`, `imgupload.bml`,
   `tools/endpoints/draft.bml`, `htdocs/js/entry.js`, `htdocs/js/xpost.js` (and
   its test), `LJ::entry_form` (`LJ/Web.pm:984-2143`), `LJ::entry_form_decode`
   and `DW::Entry::Legacy` entirely, `/preview/entry` route and
   `legacy_preview_handler`, `LJ::Widget::UserpicSelector`. First move the
   natively used `/update.bml.*`, `/editjournal.bml.*`, `/imgupload.bml.*`
   strings into `views/entry/*.tt.text` (or keep the `.text` files). Delete
   `inbox/*.bml`, the two inbox widgets, `esn_inbox.js`, `stc/inbox.css`; keep
   `/__rpc_esn_inbox` for the nav count with form-auth on its mutations.
6. **Docs.** Replace the parity-era BML-UPDATE/ALTLOGIN/ANONYMOUS/OWNED/MANAGER/
   COMMUNITY/SAME-POSTER audits and their evidence directories with one
   graduation record, or leave them as history.

**Risks.** (a) Anyone using alternate login loses it (mitigation: log in as the
other account; the native one-time login covers the logged-out case).
(b) Production `ext/local` may implement the dropped hooks; audit before step 5.
(c) Manager moderation must exist natively before `editjournal.bml` goes,
otherwise community managers lose delete/spam. (d) Old links keep working via
redirects; bookmarked `update.bml?usejournal=` forms are GET and redirect
cleanly; third-party clients use the protocol, not these pages. (e) The
`.bml.text` string dependency will 500 the native page if a `.text` file is
deleted early. (f) The branch is 533 unpushed commits; step 4 is a large
mechanical diff that needs one careful review, but it removes about 1,100 lines
of adapters and ~94 test files rather than editing shared logic.

## 7. Decisions for the user

1. Alternate login (`altlogin=1`): **retire** (recommended) or close natively
   by including `module-journal.tt` and extending `_auth`.
2. Manager delete / delete-as-spam of other posters' entries: **close natively
   before cutover** (recommended; small) or accept loss of in-editor moderation.
3. Plain-editor embed button: accept loss (recommended; users paste
   `<site-embed>` markup) or add a small button.
4. Legacy hooks (`update_fields`, `transform_update_*`, `after_entry_post_*`,
   `entry_deleted_page_extras`, `entryforminfo`): audit `ext/local` in
   production, then drop; add `entryforminfo` to the native form only if the
   dw-nonfree sidebar is wanted.
5. Editor preference: one-time `entry_editor`→`entry_editor2` mapping, or let
   users re-pick (recommended: re-pick; `entry_editor2` already exists for
   beta users).
6. Inbox gaps: fix `view` eval, compose eligibility and `subject_limit`
   (recommended, all small); bookmark-delete confirm and expand-all persistence
   accept or close.
7. Native URLs: keep `/inbox/new/*` and redirect, or move native to `/inbox/`
   (recommended) and retarget nav links; same question for `/update` versus
   `/entry/new` in navigation (recommended: retarget links, keep redirects).
8. History: keep the 304 legacy commits as history behind a forward deletion
   (recommended, no rewrite) or rebuild the branch from bucket A/C only.
9. Sequencing: gaps → entry cutover → inbox cutover → deletion, or inbox first
   (independent; inbox is smaller and has the security fix).

Once the user chooses, the next foreman action is a bounded implementation
plan per chosen step; no worker starts before that.

# BML graduation implementation plan

Authorized 2026-09-23 by the user ([BML-DIRECTION.md](BML-DIRECTION.md), top
section) after review of [BML-BETA-GRADUATION-DECISION.md](BML-BETA-GRADUATION-DECISION.md).
Foreman: bml-fable-foreman. Builders: bml-sonnet-themenav, bml-sonnet-widgets.
Independent review: bml-opus-review. Every package lands as an immutable
commit on a worker branch from root, is reviewed, then cherry-picked to root
with focused tests, tidy and compile. Nothing is pushed or deployed.

User decisions applied: retire alternate login; accept plain-editor embed
loss and cosmetic notices; users reselect editor preference; retain drafts,
data, working old GET links and manager moderation; canonical inbox and entry
URLs with legacy redirects; old POST content must never be silently discarded;
obsolete worker branches are preserved, not integrated; production-local hook
and config unknowns stay explicit gates.

## Packages

| # | Owner | Package | Gate before it |
|---|---|---|---|
| T1 | themenav | Native manager moderation: delete and delete-as-spam of another poster's entry from the native maintainer form, plus `rte_js_vars($remote)` poll permission fix | none |
| W1 | widgets | Inbox correctness/security: validate RPC `view`; compose requires validated sender; `subject_limit`; icon reselect on error; bookmark-delete confirm; form-auth on `/__rpc_esn_inbox` mutations | none |
| W2 | widgets | Inbox cutover: native handlers at `/inbox/`, `/inbox/compose`, `/inbox/markspam`; 302 from `/inbox/new/*`; drop `inbox` beta checks and banner; retarget nav/ESN links; native redirects target native | W1 reviewed |
| T2 | themenav | Entry cutover: `/update` GET 302 to `/entry/new` (map `usejournal`, `subject`, `event`, `prop_taglist`, `share`); `/editjournal?itemid` GET 302 to native edit; old-schema POST to `/update` or `/editjournal` renders the native form prefilled from the submitted content with an explicit notice and no save; drop `updatepage` beta checks and banner; retarget nav links | T1 reviewed |
| W3 | widgets | Inbox legacy removal: `inbox/*.bml` and `.text`, `LJ::Widget::InboxFolder*`, `esn_inbox.js`, `stc/inbox.css`, dead `/__rpc_esn_inbox` mutating modes, inbox beta strings; grep evidence per deletion in the commit message | W2 reviewed; the inbox track is deliberately decoupled from the entry chain because no explicit gate is inbox-specific |
| T3 (=F1) | themenav | Forward deletion: `legacy_*` adapters, `DW::Entry::Legacy` except what the transitional POST handler needs, bucket-B tests/fixtures, `update-terminal.tt`, `LegacyOwnedEditRoute.pm`, legacy subtests in mixed tests | T2 reviewed; prepared on top of T2 so review overlaps |
| F2 | foreman | Page deletion: `update.bml`, `editjournal.bml`, `imgupload.bml`, `draft.bml`, `js/entry.js`, `js/xpost.js`, `LJ::entry_form`, `/preview/entry`, `UserpicSelector`; relocate natively used `.bml.text` strings first (inbox removal moved to W3) | F1 reviewed; hook/config gate below |
| F3 | foreman | Docs: graduation record, prune parity-era audits | F2 |

## Explicit gates (not closed by local work)

- Production `%LJ::BETA_FEATURES` for `updatepage` and `inbox` must be expired
  or removed at deploy time; the local change removes the `user_in_beta` calls.
- Production `ext/local` may implement `update_fields`, `transform_update_*`,
  `after_entry_post_extra_*`, `entry_deleted_page_extras`, `entryforminfo`,
  `LJ::Local::BMLInit`. Until checked, F2 keeps the `.text` files and does not
  assert those hooks unused.
- Production may populate `%LJ::AJAX_URI_MAP` (Apache-era `/__rpc_delcomment`,
  `/__rpc_talkscreen`); the in-tree fallback was dead and is removed (W7-A),
  so any such mapping must be checked at deploy time.
- The transitional old-schema POST handler is a deliberate retained dependency
  on the legacy decoder; its removal date is a separate user decision.

## Boundaries

No push, remote merge, deployment, real moderation or report side effects
(tests use disposable entries and stub any external reporting), no new
authentication policy, no changes to held external contracts.

## Cutover package specifications

### W2 inbox cutover (after W1 clears)

- Register native `index_handler`, `compose_handler`, `markspam_handler` at
  `/inbox/` (with `no_redirects => 1`, as `/poll/` does in `DW/Controller/Poll.pm:29`),
  `/inbox/compose` and `/inbox/markspam`. Routing runs before the BML file
  fallback (`app.psgi:166-172`), so the `.bml` pages become unreachable and are
  deleted in F2. Keep `/inbox/new`, `/inbox/new/compose`, `/inbox/new/markspam`
  as 302s to the canonical URLs, preserving query args.
- Native redirects (`Inbox.pm:447,451,608,622,695-703,728`) and
  `views/inbox/msg_list.tt:16,18` already target `/inbox`; keep them canonical.
- Remove the `inbox` beta: `index.bml:37-38` (page goes in F2),
  `LJ/Event/UserMessageRecvd.pm:53-56,145-148`, `LJ/User/Message.pm:405-416`
  (`message_url`), the banner `views/inbox/index.tt:21` and `dw_beta` load
  (`Inbox.pm:152-153`). Retarget `views/widget/latestinbox.tt:6`,
  `UserMessageRecvd.pm:158`, `LJ/Event/JournalNewComment.pm:348` to canonical
  native URLs (they already are `/inbox/...`; verify each resolves natively,
  including `?view=singleentry&itemid=`).
- Tests: routes resolve natively for a logged-in ESN user (both index and
  compose/markspam, GET and POST with form auth), `/inbox/new*` 302s, anonymous
  gets the login page, legacy `.bml` URLs (`/inbox/index.bml`) reach native via
  suffix stripping (`DW/Routing.pm:113-114`); no `user_in_beta('inbox')` remains.

### T2 entry cutover (after T1 clears)

- Replace the `/update` route block (`Entry.pm:92-112`):
  - GET: 302 to `/entry/new` (or `/entry/<usejournal>/new` when `usejournal`
    names a journal) carrying `subject`, `event`, `prop_taglist` as `tags`,
    `share`, and any other native-recognised query args; drop `altlogin`. Let
    `/entry/new` produce its own identity/cannot-post/login responses.
  - POST (old-schema form from a stale tab): never save and never discard.
    Decode once with `DW::Entry::Legacy::prepare_entry_form({ tz => 'guess' },
    $post)` and render the native form prefilled through
    `legacy_new_rerender` with a single explicit notice string ("the previous
    posting page has been retired; your content is carried over, review and
    post"), `action_url` `/entry/new`, default submit name, no crosspost
    suppression, no `legacy_altlogin`. Anonymous old POSTs render the same form
    with the native login modal; the submitted password is discarded and never
    echoed. Transforms, spellcheck and preview buttons from the old form get the
    same carry-over rendering.
- `/editjournal?itemid=` (`EntryPicker.pm:35-52`): GET 302 to
  `/entry/<journal>/<ditemid>/edit` (journal from `usejournal`/`journal` or the
  remote); old-schema POST renders the native edit form prefilled through the
  existing rerender helper with the same notice and no save. No-itemid picker
  unchanged.
- Remove the `updatepage` beta: `Poll.pm:686-690` chooses `/entry/new`
  unconditionally; delete the banner `form.tt:126` and `betacommunity`
  (`Entry.pm:1662-1663`); `.beta.on`/`.beta.off` strings become unused.
- Retarget navigation to native: `/update` links in `DW/Logic/MenuNav.pm:82`,
  `schemes/common.tt:140,221`, `schemes/lynx.tt:62`, `LJ/Web.pm:2627,2685`,
  `views/login.tt:36`, `views/site/index.tt:42`, `views/index-free.tt:40`,
  `views/create/next.tt:28`, `views/manage/circle/editfilters.tt:21`,
  `DW/Controller/Create.pm:255`, `DW/Controller/Circle.pm:243`,
  `DW/Controller/Journal.pm:261`, ESN mails `LJ/Event/Birthday.pm:147`,
  `RemovedFromCircle.pm:98,114`; edit links `LJ/S2.pm:4328`, `LJ/Talk.pm:202`,
  `LJ/Protocol.pm:1666,2188`, `LJ/Web.pm:2634`, `views/edittags.tt:8`,
  `views/manage/index.tt:194`, `views/site/index.tt:43`,
  `views/index-free.tt:61`, native success links `Entry.pm:2038,2311,2447,2489`.
- Tests: GET redirects with argument mapping; old-schema POST carry-over
  renders every submitted field, saves nothing (force-fresh entry count and
  draft unchanged), never echoes a password; anonymous carry-over; edit GET
  redirect and edit POST carry-over; no `updatepage` check remains; native
  success links point at native edit.

## Status and open decisions (2026-09-23, evening)

Done on root and independently reviewed: T1 manager moderation, W1 inbox
fixes, W2 inbox cutover, W3 inbox legacy removal, T2 entry cutover, T3 entry
adapter deletion, W4 string relocation, W5 ordinary BML runtime callers, F2
entry page deletion, W7-A dead RPC fallback, W7-B/W8 journal request
decoupling, T4/T6/W6/W9 audits, T5 cleanup, W9 dead widgets, W10 help icon,
W11 test repair. No BML page remains except the three `_config*.bml` engine
files. CI-equivalent suites are green on root under the allowlist discipline.

Remaining in flight: T8 (adapter module extraction; fix for the non-web shim
load regression), W12 (sendmessage language characterization, test-only).

Direction confirmed by the user after this status: the sendmessage language
replacement and the BML engine retirement (hook ABIs still receive a
`DW::BML::RequestAdapter`) are already authorized as behaviour-preserving
local steps once equivalence tests and independent review pass; they are not
additional decision gates. The transitional POST carry-over and the obsolete
worker branches stay as they are. Production config and `ext/local` checks
remain deployment gates; no push or deploy.

## Engine retirement sequence (authorized; bounded, reviewed)

| # | Owner | Package | Gate |
|---|---|---|---|
| E1 | widgets | Replace `Protocol.pm:563` `BML::set_language('en')` with `LJ::Lang::set_request_context(lang => 'en')`, proven equivalent by W12's characterization test in-request and ljlib-only | W12 reviewed |
| E2 | themenav | Remove the last non-engine `BML::*` callers: RequestWrapper `BML::set_language` shim (native request language is set by `LJ::Lang::set_request_context` per T4; prove with `t/ml.t`, `t/native-*-language.t`, `t/plack-bml.t` replacement), `LJ::Web` no-request fallbacks (`Web.pm:391/:564`), PageStats `BML::get_request` (filename stays undef); drop the `use DW::BML` lines added by T8 where no caller remains | E1 reviewed, T8 integrated |
| E3 | themenav | Delete the engine: `cgi-bin/Apache/BML.pm`, `cgi-bin/DW/BML.pm` (adapter module stays), `cgi-bin/lj-bml-blocks.pl`, `cgi-bin/LJ/Global/BMLInit.pm` (move any hook it registers that a native path still needs, e.g. `ml_getter` for `LJ::Lang`, into native startup first with tests), `cgi-bin/bml/scheme/*.look`, `htdocs/_config.bml`, `ext/dw-nonfree/htdocs/_config*.bml`, the app.psgi BML fallback, `t/plack-bml.t`; `DW::SiteScheme` `tt_runner` engine entry; update `doc/PLACK.md`, `BML-REMOVAL-PLAN.md`, `BML-MIGRATION.md` | E2 reviewed |
| E4 | foreman | Final docs and evidence record; deploy-gate checklist | E3 integrated |

Held externally (deployment gates, unchanged): production `%LJ::BETA_FEATURES`
for `updatepage`/`inbox`, `ext/local` hooks and `LJ::Local::BMLInit`,
`%LJ::AJAX_URI_MAP`, `%LJ::HELPURL`.

Status record kept for history:

Items as they stood before the user's confirmation:

1. **Sendmessage forced English** (`cgi-bin/LJ/Protocol.pm:563`
   `BML::set_language('en')`): T4 shows it only forwards to
   `LJ::Lang::set_request_context`. Authorize the mechanical replacement with
   `LJ::Lang::set_request_context(lang => 'en')` once W12's characterization
   test proves equivalence? This is the last non-engine `BML::set_language`
   caller and gates removal of the RequestWrapper shim.
2. **BML engine retirement**: after (1), authorize the package sequence in
   `BML-ENGINE-RETIREMENT.md` and `BML-PROTOCOL-PAGESTATS.md`: drop the
   RequestWrapper `BML::set_language` shim, the `LJ::Web` no-request fallbacks
   (`Web.pm:391/:564`), the `BML::get_request` call in PageStats (already
   undef-safe), then delete `Apache/BML.pm`, `DW/BML.pm` (the adapter now lives
   in `DW/BML/RequestAdapter.pm`), `lj-bml-blocks.pl`, `BMLInit.pm`, the scheme
   looks, the three `_config*.bml`, the app.psgi BML fallback and
   `t/plack-bml.t`. Held hook ABIs (`DISABLE_PROTOCOL` third argument,
   `data_handler:*`, `s2_head_content_extra`) keep receiving a
   `DW::BML::RequestAdapter`, so they need no decision unless the user wants
   them changed.
3. **Transitional old-schema POST carry-over** (`/update` and
   `/editjournal?itemid` POST): keep indefinitely, or set a removal date after
   which those POSTs get a plain notice; removal also deletes
   `DW::Entry::Legacy` and the three rerender helpers.
4. **Deploy-time checks** (not code decisions): expire or remove `updatepage`
   and `inbox` from production `%LJ::BETA_FEATURES` (the retired strings are
   now in deadphrases); confirm `ext/local` does not implement
   `update_fields`, `transform_update_*`, `after_entry_post_extra_*`,
   `entry_deleted_page_extras`, `entryforminfo` or `LJ::Local::BMLInit`, and
   does not populate `%LJ::AJAX_URI_MAP`; note `help_icon` now renders wherever
   `%LJ::HELPURL` is configured.
5. **Obsolete worker branches** (hook composition, altlogin characterization,
   draft.bml WIP): preserved and unintegrated per direction; delete later or
   keep as history.

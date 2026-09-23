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
| F1 | foreman | Forward deletion: `legacy_*` adapters, `DW::Entry::Legacy` except what the transitional POST handler needs, bucket-B tests/fixtures, `update-terminal.tt`, `LegacyOwnedEditRoute.pm`, legacy subtests in mixed tests | T2 integrated |
| F2 | foreman | Page deletion: `update.bml`, `editjournal.bml`, `imgupload.bml`, `draft.bml`, `js/entry.js`, `js/xpost.js`, `LJ::entry_form`, `/preview/entry`, `UserpicSelector`; relocate natively used `.bml.text` strings first; inbox `.bml`, widgets, `esn_inbox.js` | F1 reviewed; hook/config gate below |
| F3 | foreman | Docs: graduation record, prune parity-era audits | F2 |

## Explicit gates (not closed by local work)

- Production `%LJ::BETA_FEATURES` for `updatepage` and `inbox` must be expired
  or removed at deploy time; the local change removes the `user_in_beta` calls.
- Production `ext/local` may implement `update_fields`, `transform_update_*`,
  `after_entry_post_extra_*`, `entry_deleted_page_extras`, `entryforminfo`,
  `LJ::Local::BMLInit`. Until checked, F2 keeps the `.text` files and does not
  assert those hooks unused.
- The transitional old-schema POST handler is a deliberate retained dependency
  on the legacy decoder; its removal date is a separate user decision.

## Boundaries

No push, remote merge, deployment, real moderation or report side effects
(tests use disposable entries and stub any external reporting), no new
authentication policy, no changes to held external contracts.

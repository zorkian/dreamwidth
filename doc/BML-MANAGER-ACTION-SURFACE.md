# Manager action-surface migration audit

Date: 2026-09-23
Scope: source-only handoff for the remaining other-poster community editor
surface.  This does not authorize or implement deletion, spam reporting,
routing, or authorization-policy changes.

## Current split

The pending public same-poster candidate invokes `legacy_community_edit_get_handler` only with
`same_poster_only => 1` (`cgi-bin/DW/Controller/EntryPicker.pm:35-45`).  An
other-poster manager request therefore deliberately returns `undef` and falls
through to retained `editjournal.bml`.  This is necessary today because the
accepted native `views/entry/maintainer.tt` is property-only: it renders
`action:savemaintainer`, the adult override/reason controls, and the comments
override, but not deletion controls.

`DW::Controller::Entry::_render_maintainer_form` already accepts an explicit
canonical action URL and supplies the three current log properties plus poster
adult/comment values (`Entry.pm:1133-1157`).  It is a usable subcomponent for a
future manager surface, not a complete replacement for the retained action
bar.

## Retained manager contract

`htdocs/editjournal.bml:179-196` computes three independent flags:

- Other-poster community editing disables ordinary `action:save`; deletion is
  enabled only for a journal manager.
- Spam deletion is disabled when deletion is disabled, no community journal is
  selected, the poster is the actor, or the journal is spam-report sysbanned.
- Read-only changes the ordinary-save availability; it must not be collapsed
  into a new manager authorization rule.

`LJ::entry_form` renders the maintained property save, delete, and conditional
spam-delete in the same edit form (`cgi-bin/LJ/Web.pm:1847-1905, 2076-2116`):

| Submitted control | Retained eligibility/effect |
| --- | --- |
| `action:savemaintainer` | Only when `!disabled_spamdelete`; validates form auth and writes only `adult_content_maintainer_reason`, `adult_content_maintainer`, and `opt_nocomments_maintainer`; redirects to the entry (`editjournal.bml:221-234`). |
| `action:delete` | Validates form auth, decodes the ordinary edit payload, empties event, logs `delete_entry`, runs `spam_check`, then executes `editevent` (`:238-275`). The button has the existing xpost-aware confirmation. |
| `action:deletespam` | Same delete pipeline, but first calls `LJ::mark_entry_as_spam`; success additionally uses the spam-delete success message. It has a distinct confirmation and must retain the sysban guard (`:251-254, 323-331`; `LJ/Web.pm:2106-2116`). |

The retained path accepts the hidden `itemid` form value after its GET itemid
resolution and forms an `editevent` request with the retained journal/actor
schema.  The native canonical edit target used by callable GET is
`/entry/<community>/<ditemid>/edit` with the original encoded query retained
(`Entry.pm:380-409`).  A future renderer must preserve that canonical action
and raw query without treating query formatting as a new authorization input.

## Existing native pieces and ordering

The direct native `_edit` maintainer branch currently accepts only
`action:savemaintainer` (`Entry.pm:1178-1210`).  It checks exact `ditemid`/anum,
visibility/editability, other-poster status, community manager status,
non-readonly journal, and explicit form auth before `LJ::set_logprop`.
This is the safe property-only action seam.

The accepted ordinary legacy edit seam, `legacy_owned_edit_post`, is explicitly
owner/personal and intentionally returns before manager/community/spam-delete
requests (`Entry.pm:1435-1478`).  Its delete path is not a reusable substitute:
it is limited to an owner editing their personal journal.  Although the shared
`_do_edit` success path can append legacy deletion extras
(`Entry.pm:1952-1956`), a manager adapter must establish its own authorization,
spam-report, and retained request ordering before it can call shared mutation
code.

## Smallest safe future package

1. **Renderer extraction/extension only after action implementation is ready.**
   Extend the manager view (or a dedicated manager action partial) with the
   retained delete and conditionally rendered spam-delete controls, existing
   translated labels/confirmation text, and the explicit canonical action URL.
   Retain `action:savemaintainer` as a separate property-only submit.  Do not
   expose a button that has no matching native action handler.
2. **Dedicated callable manager POST adapter.**  Resolve the retained itemid,
   actor/authas/usejournal, entry visibility, community manager state,
   read-only state, and action *before* decoding or effects.  Use an explicit
   three-way classifier: `savemaintainer`, `delete`, or `deletespam`; return
   `undef` for no action, unknown actions, ordinary `action:save`, spellcheck,
   and unsupported contexts so BML remains owner until their contracts are
   migrated.
3. **Keep deletion paths separate.**  `deletespam` must never fall through to
   ordinary save, ordinary delete, or the property-only `set_logprop` path.
   Its sequence must preserve authorization/form-auth validation before
   effects, then the retained spam marker, delete event/logging, spam check,
   canonical deletion, legacy success extras, and the distinct success text.
   Plain delete must not report spam.  The exact backend ordering should be
   characterized with local reporting stubs before implementation; no external
   reporting or delivery is part of this package.
4. **Activate public other-poster GET only after those controls and dispatch
   are both present and reviewed.**  Until then, keep the current
   `same_poster_only` public guard, which is what preserves BML manager delete,
   spam-delete, and maintainer save.

## Finite acceptance matrix for that package

- Actual BML and native manager GET: action URL with exact raw query; adult
  select/reason/comment controls and all eligible action controls.  Confirm
  buttons/labels remain translated and their existing confirmation contracts
  are retained.
- `savemaintainer`: real clicked form; fresh DB proves exactly the three
  properties changed, while subject/body/security and unrelated props remain
  unchanged.
- `delete`: real clicked form and confirmation; exactly the intended entry is
  removed, an unrelated entry survives, one retained-compatible delete log is
  recorded, and success/extras ordering is asserted with local hooks.
- `deletespam`: independent fixture; retain sysban and eligibility guard,
  assert one local spam mark plus deletion/log/success ordering, and prove it
  did not take either save or plain-delete-only path.
- Missing/invalid CSRF, denied manager/authas, readonly, invalid/composite
  itemid, own-poster, unknown/no action, and non-POST requests produce no
  mutation and fall through to retained behavior where the new adapter is not
  responsible.
- Browser desktop and 390px: same manager state, all enabled controls usable,
  exact confirmation behavior, no unexpected JS/network errors, and no loss of
  retained manager controls during public activation.

## Explicit non-goals

No deletion/reporting implementation, policy change, public manager-route
activation, itemid BML retirement, spam/deployment hook work, or external
transport is included in this audit.

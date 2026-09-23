# Editor crossposting characterization

This is a bounded pre-retirement contract audit. It covers ordinary own-journal
entry creation and editing only. Community posting, account setup, delivery
workers, and external network protocols remain outside this package.

## Rendered form contract

The retained `update.bml` form is populated by `LJ::Web::entry_form`:

- Master enable: `prop_xpost_check`.
- Per-account selection: `prop_xpost_<acctid>`.
- Credential challenge fields: `prop_xpost_password_<acctid>`,
  `prop_xpost_chal_<acctid>`, and `prop_xpost_resp_<acctid>`.
- Initial checked state comes from the submitted form during a retry, then the
  entry `xpostdetail` value when editing, otherwise `xpostbydefault`.

The native `entry/form.tt` uses the crosspost module:

- Master enable: `crosspost_entry`.
- Repeated selected account field: `crosspost`.
- Per-account fields: `crosspost_password_<acctid>`,
  `crosspost_chal_<acctid>`, and `crosspost_resp_<acctid>`.
- New forms initialize account selection from `xpostbydefault`; edit forms
  initialize from the entry `xpostdetail` hash.

These are distinct rendered protocols. A compatibility wrapper must translate
field names deliberately; it must not alias a legacy POST directly to the
native decoder.

## Successful post/edit behavior

Both paths disable protocol-native xposting (`xpost => 0`) while saving the
entry, then call `LJ::Protocol::schedule_xposts` only if all of these are true:

1. the entry save succeeded;
2. the target journal is the authenticated poster's own journal; and
3. the master crosspost control is selected.

Both provide a callback that returns selected state plus password/challenge
credentials for each configured external account. Both render translated
per-account success and error rows after scheduling. Native calls
`DW::Controller::Entry::_queue_crosspost` for new and edit success pages;
legacy calls `schedule_xposts` directly from `update.bml`.

A native successful new post clears `entry_draft` and `draft_properties` before
crosspost scheduling. The retained legacy new-post path clears `entry_draft`;
its `draft_properties` behavior must remain independently characterized rather
than normalized here. Editing does not use the new-post draft-clear path.

## Smallest disposable test-only package

A focused Plack test can create a disposable ordinary user and a fake external
account object, then locally replace only `LJ::Protocol::schedule_xposts`.
The replacement must record poster, ditemid, deleted flag, and callback output
without invoking account transport, event delivery, mail, or workers.

For each legacy `/update` and `/update.bml` form plus native `/entry/new` and
owned `/entry/<user>/<ditemid>/edit` form, the test should:

- parse the actual rendered form and assert the corresponding master,
  selection, and credential field names;
- submit one selected and one unselected account through the actual form;
- force-load the saved entry and assert normal entry persistence;
- assert exactly one scheduler invocation for own-journal enabled submission,
  exact callback values for both accounts, and translated result rows;
- assert zero scheduler calls for disabled master controls and a community
  target; and
- separately record new-post draft body/properties state after success.

## Deployment interface gate

`DW::External::Account` configuration, account-specific challenge generation,
and actual account delivery are deployment interfaces. This audit does not
invent an account type or invoke them. The disposable package should replace
only the scheduler after the real form decoder has constructed its callback;
if a configured test account is required to render a nonempty account module,
that is an explicit fixture dependency to resolve before claiming UI parity.

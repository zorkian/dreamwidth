# Entry picker extraction acceptance

Sol inspected immutable foreman `6300adc42` without changing implementation.
The picker can be extracted before deciding editor beta cutover. It must leave
legacy itemid editing and mutation branches available until their parity gates
are met. This document records source contracts, not completed runtime tests.

## Safe package boundary

Migrate GET init/default-five selection and POST `mode=edit` with no itemid to a
controller/template picker. Preserve `/editjournal` and `.bml` entry points.
Any GET or POST itemid forces the legacy edit path; do not redirect mutation
POSTs through a read-only picker. A one-result selection can continue to return
the legacy itemid URL until the replacement editor supports all actors/actions.

Current modern `Entry::_edit` rejects a community manager editing another
poster's entry, while the legacy editor offers delete and maintainer controls.
That is an editor parity gate, not evidence those old actions are obsolete.

## Inputs and selection behavior

- Login is required. GET `authas` must resolve an authorized individual account.
- Effective journal precedence: GET `usejournal`, POST `usejournal`, GET `journal`.
  Collapse same-as-user journal context; validate other journals and permissions.
- Mode precedence is GET, then POST, then `init`; any itemid forces edit mode.
- Init shows latest five plus selector controls. Selector defaults to `last`;
  `lastn` defaults to 20, and day controls default to today's date.
- Read-only selection maps `last` to getevents one/-1, `lastn` to howmany, and
  `day` to year/month/day. Preserve empty-result messages and one-result redirect.
- Multiple results retain date, security marker, community poster, cleaned subject
  and visible summary. Item IDs are `(jitemid << 8) + anum`.

Preserve delegated identity explicitly: old BML compares authas to the already
resolved user's name, so it accidentally omits authas from forms/redirects.
Encode query components and escape form actions instead of copying legacy raw
interpolation. Current `LJ::User::can_manage` rejects management of any other
personal account, and the picker rejects community authas actors; consequently
a delegated individual fixture is not currently reachable through production
permissions. Do not invent a grant to claim current coverage. Preserve explicit
identity context if this branch becomes reachable through an audited extension.

## Permissions and mutation separation

Test personal, authorized delegated, community poster, community manager/other
poster, readonly journal, denied authas and invalid/noncommunity journal. Verify
visibility/editability and actual entries rather than only getevents success.

The legacy itemid branch includes `submit_value` synthesized actions, maintainer
log-property saves, save/delete/spam-delete, spam reporting, log events and
crossposting; mutation actions require their existing CSRF checks. Spellcheck
also executes there. Preserve method/body/query contracts when dispatching those
requests, and demonstrate picker routes cannot accidentally execute these paths.

Modern Entry links back to the picker, and legacy Protocol/Talk/S2 links use
journal/itemid aliases. Inventory and test those callers before changing URLs.
Capture old/new default, filtered, empty and community result states plus narrow
layout; validate selector submission and per-entry navigation in a real browser.
Beta promotion and full editor retirement remain separate external/product gates.

## Executed baseline

Foreman `t/plack-entry-picker.t` now passes 64 real-session assertions: both
legacy URLs, default five, actual recent/single/date form submissions, exact
composite IDs, owner private summaries, login/authas denial, and unchanged bodies.
Community cases cover both journal aliases, GET/POST journal precedence, empty
recent results, read-only selection, and actual other-poster delete/maintainer
controls. Fixtures use disposable validated accounts and real persisted entries.
This is baseline coverage, not picker extraction or editor cutover approval.
Browser evidence, denied community actors and itemid mutation separation remain
required. Logs: `/tmp/bml-entry-picker-{baseline3,community}.log` in foreman container.

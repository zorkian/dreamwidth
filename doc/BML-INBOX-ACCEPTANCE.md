# Inbox replacement acceptance

Disposition: complete the existing TT replacement, then retire three legacy BML
pages after parity and cutover gates. This source audit at foreman `80ba04c72`
is not runtime acceptance. Test old and new endpoints separately before changing
routing. Never send test messages to real users or external mail services.

## Routes and legacy forms

Keep `/inbox/`, index and `.bml` aliases, compose and markspam links working.
Legacy index GET redirects beta members to `/inbox/new`; POST stays legacy.
Legacy compose/markspam remain independently reachable. A redirect cannot safely
translate legacy mutation POST bodies.

| Contract | Legacy | Modern acceptance |
|---|---|---|
| Selected actions | `markRead`, `markUnread`, `delete`, including `_1`/`_2` button suffixes | Map deliberately to `mark_read`, `mark_unread`, `delete`; preserve selected IDs and reject foreign IDs |
| All actions | `markAllRead`, `deleteAll` | `mark_all`, `delete_all`; assert current view and single-entry scope only |
| Selection fields | `all_Check-QID` in the index handler | `check_*` field values / RPC `ids`; exercise actual rendered forms |
| Pagination | Zero-based legacy page | One-based modern page; test old links, lower/upper bounds and last-item deletion |
| View precedence | POST before GET | Modern GET before POST; preserve old form semantics in compatibility dispatch |
| Bookmarks | GET `bookmark_off` adds; `bookmark_on` removes | Both current implementations mutate on GET; replace with a safe POST/confirmation path and retain usable non-JS controls |

Exercise all/unread, received/sent, bookmarks, single-entry and category folders,
archive enabled/disabled, invalid views, empty inbox and multiple pages. Assert
fresh item state, unread counts, pagination and folder summaries after actions.
RPC expansion is read-only; every mutation must reject missing/invalid CSRF with
unchanged target. Test logged-out, unavailable ESN, normal and privileged actors.

## Compose and reply

Use disposable validated users with mail/queue delivery isolated. Test recipient
whitespace/case/deduplication, multiple recipients, CC default persistence,
renamed/identity/community/invalid recipients, recipient validation and message
privacy, banned sender, suspended sender, byte/character limits and UTF-8,
empty-body confirmation, userpic, rate limits and send failures. Preserve entered
subject/body/recipients on errors and reject missing/invalid tokens before effects.
Verify persisted sent/received copies, not only a success redirect.

Reply must load an owned message, enforce can_reply, retain parent linkage and
quoted text, and reject missing/foreign/deleted IDs without sending anything.
Notification-generated reply and spam links remain compatibility consumers;
`LJ::Event::UserMessageRecvd` currently selects compose URL by beta membership,
while its spam link still uses the legacy path.

Source findings requiring reproductions and fixes before cutover:

- Rejected recipient calls `errors->add` rather than `$errors->add`.
- `can_send`/`send` error loops call `$error->add` on each error instead of the
  form error collection; exercise nonempty error returns explicitly.
- Legacy compose requires validated sender. Modern early eligibility checks the
  messaging feature instead and uses the validation message for that condition.
  Sender eligibility is an unresolved product contract; preserve the existing
  legacy restriction at any public cutover unless explicitly decided otherwise.
- Scope-dependent error translations need real request tests, including suspended
  sender and rate-limit responses, rather than successful rendering only.

## Spam and ban

Cover received-message ownership, outgoing/invalid message rejection, spamreport
sysban, spam only, ban only, both, neither, and invalid/missing CSRF. Confirm spam
state and ban relation independently. Modern neither-selected branch currently
adds an error then redirects without rendering it; preserve an actionable form
error. Keep logging and response behavior reviewable and isolate external effects.

## Browser and cutover gates

Capture matching empty/populated/filtered/compose/error/spam states, desktop and
narrow. Exercise expansion, selection, bulk actions, bookmarks, page boundaries,
compose/reply/CC, validation and non-JS forms with console/network assertions.
Restore fixtures on success and failure or use disposable accounts.

Parity fixes and characterization can proceed independently of editor/settings
work. Do not remove beta gating, change sender eligibility or delete the three
BML pages solely because TT routes exist. Public route promotion and deployment
beta/local-overlay evidence remain explicit gates in BML-REMOVAL-PLAN.md.

## Reproduced compose denial baseline (2026-09-22)

Foreman tested both real HTTP handlers at integrated `0fe7f64c0`, using two
validated disposable users, a real session cookie, and the rendered form token.
The recipient had `opt_usermsg=N`; entered subject/body were distinct markers.
Message delivery was explicitly replaced with a throwing guard, so no external
send was possible. Legacy `/inbox/compose.bml` returned 200, retained both inputs,
and rendered validation without an exception. `/inbox/new/compose` returned 500
at Inbox.pm:551 (`errors->add`), losing both inputs. This is a reproduced
pre-existing replacement defect and a retirement gate, not a BML migration
regression. Probe and captured responses are in the foreman container:
`/tmp/bml-inbox-rejection-probe.pl`, `/tmp/bml-inbox-rejection-probe.log`, and
`/tmp/bml-inbox-{legacy,modern}-denial.html`.

The first bounded repair package should cover this rejection and the analogous
`can_send`/`send` error collections with actual handler requests and no-delivery
fixtures. Preserve native translation scope and entered inputs, and prove no
success redirect on failures. It can proceed without changing beta eligibility
or public routes. Spam neither-selected and safe bookmark mutation are separate
bounded packages before full index/compose browser parity.

## Reproduced spam no-action baseline (2026-09-22)

Foreman constructed a local message with `LJ::Message::save_to_db` between two
disposable users; no message-send/event method was invoked. A real owner session
and rendered form submitted with both spam and ban unchecked produces legacy
HTTP200 with `No action selected`, but modern HTTP303 to `/inbox` with the error
lost. Evidence: `/tmp/bml-inbox-spam-probe.pl` and
`/tmp/bml-inbox-spam-probe.log` in the foreman container. The modern form also
emits a development warning for a checkbox without an explicit value; actual
rendered submission values should be characterized in the repair tests.

Terra's bounded repair should prove neither-selected nonmutation and useful
response, independent spam/ban/both outcomes, CSRF and owned-message guards,
using fresh database reads and isolating report delivery. This does not authorize
or certify public inbox cutover by itself.

## Bookmark GET baseline (2026-09-22)

Foreman queued local AddedToCircle events directly into a disposable account's
inbox, without firing delivery events. GET requests without CSRF to both
`/inbox/index.bml?bookmark_off=ID` and `/inbox/new?bookmark_off=ID` returned200
and changed fresh bookmark state from false to true. Probe/log:
`/tmp/bml-inbox-bookmark-probe.{pl,log}` in the foreman container. These are
pre-existing mutation boundaries requiring safe confirmation/POST handling.
The modern rendered fallback link currently points to `/inbox/`, while its JS
intercepts and uses token-bearing `/__rpc_inbox_actions`; preserve both JS and
usable non-JS paths, including owned IDs, view/page context and legacy aliases.

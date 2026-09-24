# Remaining direct BML language/request consumer audit

Audit base: `24fddcb8244b1b790278f6ad1e12b222d37a3d79`.

Scope is production references in `cgi-bin/` to `BML::ml`, `BML::set_language`,
`BML::get_language`, `BML::get_request`, or `$BML::ML[_SCOPE]`.  This excludes
held inbox/message sending, Journal deployment hooks, authentication/anonymous
implementation, and current Entry work.

## Concrete inventory

| Site | Direct usage | Disposition |
| --- | --- | --- |
| `cgi-bin/Apache/BML.pm` | 25 matches, including its own language rebinding, cookie/request accessors, and scope globals | BML engine; not a consumer conversion. |
| `cgi-bin/DW/BML.pm` | 27 matches, including the Plack `RequestAdapter` and compatibility definitions | Required transition adapter; do not remove in a caller package. |
| `cgi-bin/Plack/Middleware/DW/RequestWrapper.pm:53-56` | `BML::set_language($lang, \&LJ::Lang::get_text)` | Keeps BML pages working. It is foundational adapter work, not an ordinary rendering slice. |
| `cgi-bin/LJ/Web.pm:1061-2113` | 98 `BML::ml` calls | All are in retained `entry_form`/legacy editor output. The non-entry shared error/warning helpers already use `LJ::Lang::ml`; this range is current Entry WIP and must move with editor parity. |
| `cgi-bin/LJ/Protocol.pm:562` | `BML::set_language('en')` in `sendmessage` | Held inbox/message-sending scope. Do not test or convert here. |
| `cgi-bin/LJ/Protocol.pm:2339` | `BML::get_request` passed to `DISABLE_PROTOCOL{getevents}` callback | External callback ABI; retain adapter unchanged. |
| `cgi-bin/LJ/PageStats.pm:145,154-160` | `get_request` feeds only `filename` | Explicitly deferred: `DW::Request` has no physical filename and neither in-tree GA plugin consumes it. Do not synthesize one from URI. |
| `cgi-bin/LJ/Global/BMLInit.pm:34` | startup hook reads BML request URI | Legacy BML engine startup behavior, not ordinary rendering. |
| `cgi-bin/LJ/Widget/InboxFolderNav.pm:54,66` | two inbox labels | Held inbox scope. |

`LJ::UniqCookie.pm` and `LJ::Lang.pm` hits in this scan are comments only; they
are not remaining direct production calls.

## Safe nomination

There is **no safe independent ordinary rendering or translation production
package** in this inventory after exclusions. In particular:

- Replacing the `Protocol::sendmessage` setter would alter a held message-send
  path and may change the English error contract used by `LJ::Message::can_send`.
- Replacing `PageStats::get_request` would require inventing a filename API;
  the source audit explicitly rejects URI-to-filesystem synthesis.
- Mechanical `LJ::Web::entry_form` conversion would conflict with active legacy
  Entry route/editor parity work.
- Removing RequestWrapper/DW::BML/Apache::BML access would break retained BML
  pages, contrary to the migration seam requirement.

The next non-held work should therefore follow the separate anonymous GET audit
at `doc/BML-ANONYMOUS-UPDATE-GET-RENDER.md` on the newer foreman root (it is
not present in this preserved review branch), rather than widening this inventory.

## Future finite contracts, only if separately released

1. **PageStats filename disposition:** characterize no-request, BML adapter
   filename, and both GA plugin output before deciding whether `filename` can be
   removed or must use a dedicated non-BML compatibility API.
2. **Protocol external callback:** preserve the third `DISABLE_PROTOCOL` callback
   argument until an ABI decision; no conversion is implied by this audit.
3. **Legacy editor labels:** use actual retained update/edit form rendering with
   scoped getter/substitution and background fallback only as part of the Entry
   retirement range.

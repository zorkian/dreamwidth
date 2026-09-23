# DW::BML::RequestAdapter usage in journal rendering

Test-only characterization, no production code changed. Base: root HEAD
`4ae0436d3` (W5/W6 already integrated). See `t/journal-request-adapter.t`
(recording proxy over `DW::BML::RequestAdapter`, driven through real
`DW::Controller::Journal->render` calls) and static reads of every
`$opts->{r}`/`$apache_r` use in `cgi-bin/LJ/S2.pm` and `cgi-bin/LJ/Feed.pm`.

`DW::Controller::Journal.pm` constructs two, independent
`DW::BML::RequestAdapter` instances:
- `:317`, always built, passed as `$opts->{r}` into `LJ::make_journal($user,
  $mode, $remote, $opts)` (`LJ::S2.pm:49`, aliased there to `$apache_r`).
- `:285`, built fresh only when `$mode eq "data"` and a `data_handler:$mode`
  hook is registered, passed directly as the sole argument to that hook's
  returned handler coderef.

## Method table

| Method | Caller (file:line) | Called with | Returns / used for | DW::Request equivalent |
| --- | --- | --- | --- | --- |
| `OK` | `LJ::S2.pm:80` (main adapter, early "no journal" bail-out) | no args | Apache-style status constant (`0`), stored into `$opts->{handler_return}` | `$r->OK` (`DW::Request::Base.pm`; same constant, already implemented) |
| `NOT_FOUND` | `LJ::S2.pm:69` (main adapter, `$u->should_block_robots`-adjacent bail-out) | no args | Constant (`404`), stored into `$opts->{handler_return}` | `$r->NOT_FOUND`, already implemented |
| `notes` | `LJ::S2.pm:118` | `->{'no_control_strip'} = 1` (tied-hash STORE, not a method call) | Sets a per-request note read elsewhere in the render pipeline | `$r->note('no_control_strip', 1)` — `DW::Request` already has `note`/`pnote`; only the tied-hash sugar is adapter-specific |
| `status` | `LJ::S2.pm:291` (`s2_run`) | one arg, the HTTP status | Sets response status for the rendered page | `$r->status($val)`, already implemented, identical signature |
| `content_type` | `LJ::S2.pm:292` (`s2_run`) | one arg, the content-type string | Sets response content type | `$r->content_type($val)`, already implemented, identical signature |
| `send_http_header` | `LJ::S2.pm:295` | — | **Dead**: the call is commented out (`#$apache_r->send_http_header();`) | n/a |
| *(all of the above)* | `LJ::S2.pm:2467-2468`, via `s2_head_content_extra` hook | hook receives `$opts->{r}` as its second positional arg (`($remote, $r)`) | Whatever the production-local hook chooses to call; confirmed via direct invocation in the test that a hook can call `connection->client_ip` and any other adapter method | Same surface as above; the hook itself is the "held" part (see below) |
| `content_type`, `print`, *(unbounded)* | `DW::Controller::Journal.pm:286`, via `data_handler:$mode` hook's returned coderef | coderef receives the fresh adapter as its sole arg | Hook is expected to write a complete response (headers + body) itself | `content_type`/`print` both already exist on `DW::Request`; the coderef could accept a plain `DW::Request` instead, since nothing here needs Apache-specific shape |

**Confirmed empirically not used**: `uri`, `method`, `args`, `path_info`,
`hostname`, `header_only`, `headers_in`, `headers_out`, `err_headers_out`,
`document_root`, `pool`, `dir_config`, `DECLINED`, `status_line`, `finfo`,
`filename`, `connection->remote_host`, `connection->user` — none of these
appear in `LJ::S2.pm`'s or `LJ::Feed.pm`'s own use of `$opts->{r}`/`$apache_r`
(verified by grep, not just the test run). They exist on the adapter only
because it implements the general Apache-request shape uniformly; a
production-local `data_handler:*` or `s2_head_content_extra` hook could still
call any of them — see "Held" below.

**RSS/Atom never touch the adapter at all.** `grep -n '\$opts->{.r.}\|apache_r'
cgi-bin/LJ/Feed.pm` has zero matches, and `t/journal-request-adapter.t`'s RSS
subtest confirms zero adapter method calls for a real `/data/rss` render.
Feed rendering flows entirely through the `$html` string
`LJ::make_journal` returns plus `$opts`'s own `contenttype`/`status` fields,
which `DW::Controller::Journal.pm:335-410` applies directly to the real
`DW::Request` afterward — never through the adapter. This also means
`data_handler:*` is **not** how rss/atom work today; it is a pure extension
point for modes `LJ::Feed.pm` doesn't natively handle (FOAF is the
historical example — no "foaf" string appears anywhere in `LJ::S2.pm` or
`LJ::Feed.pm`).

## Smallest safe native replacement

For the main adapter (`Journal.pm:317` -> `LJ::make_journal` -> `s2_run`):
every method actually called (`OK`, `NOT_FOUND`, `status`, `content_type`,
plus the `notes` tied-hash sugar) already exists on `DW::Request` with the
identical name and signature. `s2_run`/`LJ::S2.pm` could take a plain
`DW::Request` in place of the adapter with **no new native code needed** —
only the removal of `DW::BML::RequestAdapter->new($r)` at `Journal.pm:317`
and passing `$r` itself as `$opts->{r}`. The one dead call
(`send_http_header`, commented out) needs no replacement.

For `Journal.pm:285`'s `data_handler:*` construction: same conclusion for
the methods *this codebase's own code* would call, but this adapter is
handed directly to arbitrary hook code with no in-tree caller to check
against (§ "Held" below).

## Held: production-local hook unknowns (not proposing an ABI change)

Both hook contracts hand the *entire* adapter object to code this repository
cannot see, so "smallest safe replacement" for the adapter's own use is not
the same question as "safe to change what a hook receives":

1. **`s2_head_content_extra`** (`LJ::S2.pm:2467-2468`): a production/`ext/`
   hook could call any of the ~20 adapter methods, including ones nothing
   in-tree uses (`headers_in`, `filename`, `dir_config`, etc.). Swapping the
   adapter for a plain `DW::Request` would silently break any hook that
   calls a method `DW::Request` doesn't have under the same name (e.g.
   `->connection->client_ip` — `DW::Request` has `get_remote_ip` directly,
   not a `connection` sub-object).
2. **`data_handler:*`** (`DW::Controller::Journal.pm:281-288`): same
   concern, and additionally the hook's *registration* function itself
   receives `($user, $data_path)` and must *return a coderef* that then
   receives the adapter — changing the adapter shape changes what every
   registered handler coderef assumes about its single argument.

Per the assignment, this document does not propose changing what either
hook receives. The gate is a user decision: whether any production or
`ext/dw-nonfree` code registers `s2_head_content_extra` or `data_handler:*`
today, and if so, exactly which adapter methods it calls — that inventory
has to come from outside this tree before the adapter can be swapped for a
plain `DW::Request` in either construction site without a coordinated
production change.

## Test environment note

This devcontainer's test database has no S2 style layers installed (matching
the existing comment in `t/plack-adult-content.t`), so `t/journal-request-
adapter.t`'s HTML-journal-page subtest cannot drive a fully successful S2
render — it hits `LJ::S2.pm`'s "no journal"/style-compile error path instead,
which still calls `OK` on the adapter and is why the method table above is
cross-checked against a direct read of `LJ::S2.pm`, not solely the dynamic
test. The `s2_head_content_extra` subtest similarly cannot reach the hook
through a live render for the same reason, so it invokes the hook directly
with the same call shape `LJ::S2.pm:2468` uses, against a real recording-
wrapped adapter.

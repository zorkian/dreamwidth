# Journal request-adapter audit

Disposition: **leave both adapters in place for now.**  The normal journal
adapter can be removed only with a small, explicit S2 request-interface
conversion; the data-handler adapter is an opaque hook ABI and needs a
separate hook-contract inventory.  This audit does not change production code.

## Construction sites

| Site | Consumer | Observed request surface | Native mapping / disposition |
| --- | --- | --- | --- |
| `DW::Controller::Journal` data branch (lines 278-287) | `data_handler:<mode>` hook callback | Opaque Apache-style request; no in-tree `data_handler:*` registrations | Keep the adapter until deployed hook implementations have a native callback contract.  Its current public surface is listed below. |
| `DW::Controller::Journal` render branch (lines 314-335) | `LJ::make_journal`, then S2 for non-feed views | `LJ::S2::make_journal`: `OK`, `NOT_FOUND`, `status`, `content_type`, and tied `notes`; `LJ::S2::EntryPage`: `uri` and tied `notes`; `s2_head_content_extra` receives the request object | `DW::Request` already has `OK`, `NOT_FOUND`, `status`, `content_type`, and `uri`.  Replace each tied-note write with `note($key, $value)` before passing it directly.  The hook argument is the remaining external compatibility gate. |

The adapter itself additionally exposes `method`, `args`, `path_info`,
`hostname`, `header_only`, `print`, `no_cache`, `headers_in`, `headers_out`,
`err_headers_out`, `connection`, `document_root`, `pool`, `dir_config`,
`status_line`, `finfo`, and `filename`.  None of those are dereferenced by the
in-tree normal Journal → S2 path above; they remain relevant to the opaque data
handler ABI.

## Feed path is already native

`LJ::User::Styles::make_journal` reads `DW::Request->get` and routes `view eq
'data'` to `LJ::Feed::make_feed`; it does **not** pass `opts->{r}` there.
`LJ::Feed` uses the native request for `query_string`, `get_args`,
`set_last_modified`, `meets_conditions`, and `OK`.

`DW::Request::Plack` maps the two conditional APIs directly:

| Feed operation | Native response API | Result |
| --- | --- | --- |
| feed revision time | `set_last_modified($epoch)` | `Last-Modified` response header |
| `If-Modified-Since` comparison | `meets_conditions()` | `304` before XML generation when current |
| generated feed return | `OK` | normal `200` response |

`t/plack-journal-feeds.t` characterizes the real controller with a disposable
public entry: RSS and Atom return XML UTF-8, contain the public entry, and set
`Last-Modified`; a repeat RSS request with that header returns `304` and no
body.  The test uses a narrow local `userdomain` capability only to bypass the
separate users-vhost notice, and a direct controller HTTP harness to avoid
vhost routing policy.  It does not stub feed generation or response methods.

## Smallest safe conversion package

1. Convert in-tree S2 note writes in `LJ::S2` and `LJ::S2::EntryPage` from
   Apache `notes` hash assignment to the native `DW::Request->note` API,
   preserving the Apache branch for direct Apache callers.
2. Pass the Journal `DW::Request` to normal `LJ::make_journal`/S2 rendering
   instead of constructing `DW::BML::RequestAdapter`.
3. Establish and test a replacement argument contract for
   `s2_head_content_extra`; it currently receives the adapter and has no
   in-tree implementation to characterize.  Do not silently substitute a
   renamed adapter.
4. Leave the `data_handler:<mode>` adapter untouched until the deployment hook
   inventory supplies equivalent native handler contracts.

Until steps 1-3 are agreed, removing the normal adapter would change the
external `s2_head_content_extra` callback object.  The feed path needs no
adapter conversion and its HTTP semantics are covered independently.

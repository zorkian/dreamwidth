# BML engine retirement audit

Audit base: `28bafa21f` (root HEAD at time of writing). Read-only audit; no code,
test, or existing-doc changes. Scope: what still loads or calls the BML engine
once F2 (themenav, in progress) deletes the last **entry** `.bml` pages.

## 0. Page inventory as of this audit

`htdocs/*.bml` today: `editjournal.bml`, `imgupload.bml`, `update.bml`,
`tools/endpoints/draft.bml`, `_config.bml`. `/preview/entry.bml` has no file on
disk; it is already a native route (`DW::Controller::Entry::legacy_preview_handler`,
registered in `Entry.pm`, per `doc/BML-BETA-GRADUATION-DECISION.md:41`). F2's
scope per `doc/BML-GRADUATION-PLAN.md:27` is `update.bml`, `editjournal.bml`,
`imgupload.bml`, `draft.bml`, `js/entry.js`, `js/xpost.js`, `LJ::entry_form`,
`/preview/entry`, `UserpicSelector`. After F2, the only `.bml` files left are
`htdocs/_config.bml`, `ext/dw-nonfree/htdocs/_config.bml`, and
`ext/dw-nonfree/htdocs/_config-local.bml` — the BML engine's own config-file
format (`LookRoot`, `DefaultScheme`, etc.; `htdocs/_config.bml:1-9`), not a
rendered page. **This does not mean the engine is otherwise idle** — see §2.

## 1. Inventory: everything that still loads or calls the BML engine

| Site | What it does |
| --- | --- |
| `cgi-bin/Apache/BML.pm` (2200 lines, ~182 `BML::` refs) | Core engine: decoder (`bml_decode` :999, `bml_block` :698), look/scheme resolution (`set_scheme` :1415), cookie jar, `_config.bml` loader (`load_conffile` :526, walk-up at :132-143). |
| `cgi-bin/DW/BML.pm` (1210 lines, ~224 `BML::` refs) | Plack shim: stubs `Apache2::*` into `%INC` (:52-62) so `Apache::BML.pm` loads without mod_perl; overrides ~30 `BML::*` symbols to route through `DW::Request` (`get_request` :231, `get_method`/`get_remote_ip`/`get_client_header` :250-278, `reset_cookies` :428); `DW::BML::RequestAdapter` (:971-1092) plus `::Connection`/`::HeadersIn`/`::HeadersOut`/`::Notes`/`::Pool` (:1092-1210) wrap a `DW::Request` in an Apache-request shape; `render`/`resolve_path` (:599, :547) are app.psgi's entry points. |
| `cgi-bin/lj-bml-blocks.pl` (58 lines) | Registers three static BML blocks (`LJUSER`, `LJCOMM`, `DL`) and the dynamic `NEEDLOGIN` block (:38-51), which calls `BML::redirect` when a full BML page body contains `<?needlogin?>`. `_parent` of every `.look` file. |
| `cgi-bin/LJ/Global/BMLInit.pm` (112 lines) | Engine bootstrap, `use Apache::BML` (:20): registers language codes, cookie config, the `startup`/`codeerror`/`ml_getter`/`include_getter`/`default_scheme_override`/`codeblock_init_perl` hooks (:31-98). `ml_getter` (:70) is what makes `<?_ml key _ml?>` and `BML::ml` resolve through `LJ::Lang::get_text`. |
| `cgi-bin/bml/scheme/global.look` (121 lines), `tt_runner.look` (18 lines) | Only two `.look` files left (`find cgi-bin/bml/scheme`). `global.look` defines shared macros (`SECURITYPRIVATE`, `HELP`, `BADINPUT`, `REQUIREPOST`, `H1`/`H2`) used by any remaining `.bml` page. `tt_runner.look` is a **reverse bridge**: when `BML::set_scheme` (Apache/BML.pm:1415-1436) is asked for a scheme whose engine is `tt`, it substitutes this internal look file, which calls `DW::Template->render_scheme` and returns the result through `BML::ebml`. Only scheme registered with `engine => 'bml'` is `tt_runner` itself, `internal => 1` (`DW/SiteScheme.pm:35-36`) — there is no end-user-selectable BML-engine site scheme left. |
| `app.psgi:26,111-119,166-174` | `use DW::BML`; `__rpc_*` legacy AJAX fallback (:111-119) renders via `DW::BML->render` if `%LJ::AJAX_URI_MAP` has an entry; **dead today** — `LJ::Global/Defaults.pm:267` initializes `%ajaxmapping = ()` and nothing else populates `%LJ::AJAX_URI_MAP` anywhere in-tree (`grep -rn AJAX_URI_MAP`). Final fallback (:166-174) calls `DW::BML->resolve_path`/`render` for any URI `DW::Routing` and journal routing didn't claim. |
| `cgi-bin/Plack/Middleware/DW/RequestWrapper.pm:53-56` | Every request: `LJ::Lang::set_request_context(...)` (native) immediately followed by `BML::set_language($lang, \&LJ::Lang::get_text)`. Comment says this is "so LJ::Lang::ml / BML::ml work everywhere" — but see §2, the only remaining production `BML::ml` caller is `entry_form`, which F2 deletes. |
| `cgi-bin/DW/Controller/Journal.pm:285,317` | `LJ::make_journal` (legacy S1/S2 journal rendering) and the `data_handler:$data_mode` hook (:281-288, RSS/Atom/FOAF) both take `DW::BML::RequestAdapter->new($r)`, not a plain `DW::Request`. **Not a `.bml`-page dependency at all** — this is core journal viewing, S1 and S2 alike. |
| `cgi-bin/LJ/S2.pm:2467-2468` | `s2_head_content_extra` hook fires with `$opts->{r}` — the same adapter threaded down from Journal.pm through `LJ::make_journal`. |
| `cgi-bin/LJ/Protocol.pm:562` | `BML::set_language('en')` in `sendmessage`, marked `# FIXME` already. Held (inbox/message-send scope per `doc/BML-REMAINING-NATIVE-CONSUMERS.md:18`). |
| `cgi-bin/LJ/Protocol.pm:2333-2338` | `$LJ::DISABLE_PROTOCOL{getevents}` (only key referenced in-tree) is called with `($req, $flags, $apache_r)`, where `$apache_r = eval { BML::get_request() }`. External callback ABI — no in-tree caller sets `%LJ::DISABLE_PROTOCOL`; this exists for production-local config. |
| `cgi-bin/LJ/PageStats.pm:141-145,169-177` | `get_request` returns `BML::get_request()`; `filename` (:170) strips `$LJ::HOME` off `$r->filename`. Zero in-tree callers of `PageStats->filename` or the plugin base it presumably serves (`grep -rn "->filename\b" cgi-bin/LJ/PageStats*` empty). |
| `cgi-bin/LJ/Web.pm:1061-2158` (98 `BML::ml` calls, `entry_form` :984, `entry_form_decode` :2144) | Explicitly F2's to delete (`doc/BML-GRADUATION-PLAN.md:27`: "LJ::entry_form"). Not touched by W5 (excluded there by name). |
| `t/plack-bml.t` (131 lines) | Exercises `DW::BML::render`/`resolve_path` against a synthetic fixture `.bml` file it writes to a tempdir under `htdocs/` — tests the **engine**, independent of any real page. Will still pass after F2 with zero real pages left. |
| `bin/upgrading/texttool.pl`, `deadphrases.dat`, `proplists.dat` | Grep hits are the string "BML" inside comments/data, not engine calls — false positives, no action. |
| `ext/dw-nonfree/views/site/bot.tt` | Same — a prose mention, not a call. |
| `LJ::Lang.pm:840`, `LJ::UniqCookie.pm:393` | Comments only (confirmed already in `doc/BML-REMAINING-NATIVE-CONSUMERS.md:24`), not live calls. |

Resolved since the last audit (`doc/BML-REMAINING-NATIVE-CONSUMERS.md`, base
`24fddcb82`): `cgi-bin/LJ/Widget/InboxFolderNav.pm` no longer exists (deleted in
W3, this branch's inbox-removal package).

## 2. Classification

**Deletable once no page exists** (i.e., after F2, contingent on nothing else in
this table):
- The three deleted-by-F2 `.bml` files and `LJ::Web::entry_form`/`entry_form_decode`
  (F2's own scope; not re-litigated here).
- `app.psgi`'s `__rpc_*`/`%LJ::AJAX_URI_MAP` fallback (§1) — already dead, confirmed
  no populated mapping exists; safe to delete independently of F2.
- `t/plack-bml.t` — once the engine itself is scheduled for removal (not merely
  once pages are gone; it tests the engine directly via a synthetic fixture).

**Needed by a held external contract** (production-local hook/config code may
depend on the exact shape passed today; removing requires a user decision on
the replacement ABI, not just a code change):
- `LJ::Protocol.pm:2333` `$LJ::DISABLE_PROTOCOL{...}` third argument. Native
  replacement ABI sketch: pass the `DW::Request` object directly (it already
  has `uri`, `get_remote_ip`, `header_in`) instead of an Apache-shaped object;
  requires knowing whether any production `$LJ::DISABLE_PROTOCOL` callback calls
  Apache-only methods (`->connection`, `->headers_in` as a hash) that `DW::Request`
  doesn't expose the same way.
- `cgi-bin/DW/Controller/Journal.pm:281-288` `data_handler:*` hooks and
  `LJ::S2.pm:2467-2468` `s2_head_content_extra`. Same shape question: both
  receive the adapter, not a plain `DW::Request`. Native replacement ABI sketch:
  same as above, contingent on which methods production `ext/`/local hooks
  actually call on the object.
- `cgi-bin/LJ/PageStats.pm:170-177` `filename`. `doc/BML-REMAINING-NATIVE-CONSUMERS.md:20,47-49`
  already flagged this as deferred: `DW::Request` has no filesystem-path concept
  to synthesize one from, and no in-tree GA plugin consumes it, so there's no
  way to characterize correctness without knowing what a production plugin
  expects `filename()` to return today.
- `cgi-bin/LJ/Protocol.pm:562` `BML::set_language('en')` in `sendmessage`. Held
  per existing audit; changing it risks the English error-message contract of
  `LJ::Message::can_send`.

**Translation/request shim with an already-existing native equivalent** (safe
to convert without an external-ABI decision, but each is load-bearing for
*journal viewing*, not just for `.bml` pages, so needs its own characterization
package, not a blanket removal):
- `cgi-bin/DW/Controller/Journal.pm:317` `LJ::make_journal`'s `'r' => $adapter`.
  `DW::Request` already implements `print`, `header_out`, `content_type`, `uri`,
  `get_remote_ip`, `header_in` — the same surface `DW::BML::RequestAdapter`
  wraps. Converting requires auditing every method `LJ::make_journal` and the
  S2/S1 code it calls invoke on `$opts->{r}` (e.g. `->connection`, which
  `DW::Request` does not have; `RequestAdapter::Connection` at `DW/BML.pm:1176-1193`
  would need a `DW::Request` equivalent, or callers would need to switch to
  `$r->get_remote_ip` directly) before `$opts->{r}` can become a plain
  `DW::Request`.
- `cgi-bin/bml/scheme/tt_runner.look` / `Apache::BML.pm:1415-1436` `set_scheme`'s
  tt-engine substitution. This is the reverse bridge used whenever the BML
  look-file engine renders a page (or journal siteskin) chosen scheme is a
  modern TT scheme; `DW::Template->render_scheme` (`DW/Template.pm:378`) is
  already the native renderer this bridges *to*. The forward path
  (`DW::Template->render_string`, `DW/Template.pm:331-362`) already calls
  `render_scheme` directly with **no BML involvement** when
  `$scheme->supports_tt` — confirming ordinary native controller pages never
  touch this bridge today. It only matters while `LJ::make_journal`'s
  siteskinned/S1 rendering path can still hand off to a TT scheme through BML;
  removing it is gated on the `LJ::make_journal` item above, not on F2.
- `cgi-bin/Plack/Middleware/DW/RequestWrapper.pm:56` `BML::set_language(...)`.
  Once `LJ::Web::entry_form` (the last production `BML::ml` caller) is deleted
  by F2, this call's only remaining beneficiaries are the BML engine's own
  internals (look-file `<?_ml?>` tags, which already resolve via the `ml_getter`
  hook set in `BMLInit.pm:70`, not via `set_language`) and any still-existing
  `.bml` page's `BML::ml`/`%ML` usage. Needs a fresh grep for production
  `BML::ml`/`%ML` callers *after* F2 lands before this line can be dropped.

**Legacy engine bootstrap, not a per-page dependency** (only removable by
retiring the whole engine, i.e. last in the sequence):
- `Apache::BML.pm`, `DW::BML.pm`, `lj-bml-blocks.pl`, `LJ::Global::BMLInit.pm`,
  `cgi-bin/bml/scheme/global.look`. These are what make `.bml` rendering possible
  at all; nothing here scales down as pages are deleted, only as the engine
  itself is scheduled for removal.

## 3. Proposed ordered removal sequence

1. **Now, independent of F2**: delete `app.psgi`'s `__rpc_*`/`%LJ::AJAX_URI_MAP`
   fallback (:111-119) — confirmed dead, no user decision needed.
2. **After F2 lands**: re-grep for `BML::ml`/`%ML`/`%BML::ML` production callers.
   If none remain outside the engine itself, drop
   `RequestWrapper.pm:56`'s `BML::set_language` call and re-run `t/plack-bml.t`
   plus a full-site smoke pass (language selection touches every page).
3. **Separate characterization package**: audit every method `LJ::make_journal`
   and S2/S1 rendering call on `$opts->{r}` (`DW::Controller::Journal.pm:317`),
   and replace `DW::BML::RequestAdapter` with a plain `DW::Request` plus
   whatever thin native additions are needed (e.g. a `get_remote_ip`-based
   `connection` shim, if S2 code still wants `->connection->client_ip` shaped
   access). This is the single highest-leverage removal, since it also lets
   `tt_runner.look` shrink to "no S1/BML-look content ever needs the bridge."
4. **User decision required before any code**: what ABI to offer
   `$LJ::DISABLE_PROTOCOL{*}` callbacks, `data_handler:*` hooks, and
   `s2_head_content_extra` — whether production/`ext/dw-nonfree` code depends on
   Apache-specific methods (`->connection`, `->headers_in` as a hash) that a
   plain `DW::Request` doesn't provide the same way. Without knowing what a
   production-only hook actually calls, converting these blind risks a silent
   production breakage with no test coverage in this tree.
5. **User decision required, deferred**: `LJ::PageStats::filename`'s contract —
   confirm whether any production GA/analytics plugin reads it, and if so what
   it expects, before deciding "remove" vs. "give it a native replacement."
6. **Last**: once nothing above depends on it, delete `Apache::BML.pm`,
   `DW::BML.pm`, `lj-bml-blocks.pl`, `LJ::Global::BMLInit.pm`,
   `cgi-bin/bml/scheme/*.look`, `htdocs/_config.bml`,
   `ext/dw-nonfree/htdocs/_config*.bml`, and retire `t/plack-bml.t` (or repurpose
   its assertions if any survive as native-equivalent tests).

**Risks**: steps 3-5 touch code with no in-repo test coverage for the external
hook contracts (§2's "held" items) and touch `LJ::make_journal`, which is large,
old, and load-bearing for every journal view — this is not a mechanical
BML-symbol swap like W5, it needs its own dedicated test-writing package before
any conversion commit. Step 2 risks are limited to language selection on
still-existing `.bml` pages if the re-grep is wrong; the plack-bml.t suite
already covers basic engine rendering as a regression guard until step 6.

**Test changes**: no test changes proposed or made in this audit (read-only,
per instruction). Step 1 needs no new test (removing dead code). Step 2 needs a
full-suite run plus a targeted check that `.bml` pages still resolve `<?_ml?>`
correctly with `set_language` removed. Step 3 needs new characterization tests
for `LJ::make_journal`'s output before/after switching away from the adapter
(no existing test exercises this directly). Step 5 needs `t/plack-bml.t`
deleted or replaced.

## 4. W5 scope remainders

None outstanding. W5 covered `LJ::User::Login.pm`, `DW::User::Rename.pm`,
`DW::Hooks::Changelog.pm`, `LJ::Sysban.pm`, `ljlib.pl`, `LJ::Web.pm`
(`did_post`/`check_referer`/`check_form_auth`/`error_list`/`error_noremote`/
`warning_list`), and `LJ::Poll.pm`'s needlogin branch, plus `LJ::Console.pm`.
Everything W5 explicitly excluded (`LJ::Protocol.pm:562,2339`,
`LJ::PageStats.pm`, `RequestWrapper.pm`'s `set_language`, `Apache::BML.pm`,
`DW::BML.pm`, `lj-bml-blocks.pl`, `BMLInit.pm`, journal request adapters,
`LJ::Web::entry_form`) reappears in this audit's §1-§2 as still-live engine
dependencies, none of them ordinary-caller conversions W5's pattern applies to.

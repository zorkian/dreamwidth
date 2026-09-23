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

## 5. Post-F2 state (W9 re-audit)

Re-audit base: root HEAD `072b7dba6` ("Record F2 entry page deletion
integration"). F2 has landed: confirmed `entry_form`/`entry_form_decode`
are gone from `LJ::Web.pm` (`grep -c BML::ml cgi-bin/LJ/Web.pm` → 0) and
`find htdocs ext -iname '*.bml'` returns exactly the three config files —
`htdocs/_config.bml`, `ext/dw-nonfree/htdocs/_config.bml`,
`ext/dw-nonfree/htdocs/_config-local.bml` — matching §0's prediction.

### 5.1 Full re-grep, cgi-bin/views/htdocs/app.psgi/bin/ext

`BML::`/`$BML::` (per-file counts, `grep -rn 'BML::' ...`):

| File | Count | Disposition |
| --- | --- | --- |
| `cgi-bin/DW/BML.pm` | 199 | Engine (Plack shim). Unchanged bucket from §1/§2. |
| `cgi-bin/Apache/BML.pm` | 166 | Engine (core decoder). Unchanged bucket. |
| `cgi-bin/lj-bml-blocks.pl` | 15 | Engine bootstrap. Unchanged bucket. |
| `cgi-bin/LJ/Global/BMLInit.pm` | 12 | Engine bootstrap. Unchanged bucket. |
| `cgi-bin/LJ/Web.pm` | 5 | `:391,:564` are W5's own native-first/BML-fallback lines (`did_post`/`check_referer`) — expected, by design, not a new finding. `:459,:471,:554` are comments. **New finding, not previously documented: `:269` (`help_icon`) and `:295` (`bad_input`) — see §5.2.** |
| `cgi-bin/Plack/Middleware/DW/RequestWrapper.pm` | 2 | `:56` `set_language` call (comment `:53`) — unchanged from §1/T4's audit. |
| `cgi-bin/LJ/Protocol.pm` | 2 | `:562` (held), `:2335` (held, `DISABLE_PROTOCOL` third arg) — unchanged. |
| `cgi-bin/DW/Controller/Journal.pm` | 2 | `:285` (`data_handler:*`, held), `:317` (`LJ::make_journal`'s adapter). **W8 (queued for review, not yet on this root) converts `:317` to a plain `DW::Request` and adds a marked/conditional adapter at `LJ::S2.pm:2468` instead — not yet reflected in this root's line count.** |
| `cgi-bin/ljlib.pl` | 1 | `:496`, W5's `defined &BML::reset_cookies` guard — unchanged, by design. |
| `cgi-bin/bml/scheme/tt_runner.look` | 1 | Engine bridge — unchanged bucket. |
| `cgi-bin/bml/scheme/global.look` | 1 | `BML::ml(...)` call at `:105` inside a nav-item loop — engine-internal, only reachable from a `.bml`/look-file render. |
| `cgi-bin/LJ/UniqCookie.pm`, `cgi-bin/LJ/PageStats.pm` (`:145`), `cgi-bin/LJ/Lang.pm` | 1 each | Comment (UniqCookie, Lang) or held (`PageStats::get_request`) — unchanged. |

`Apache::BML`/`DW::BML` as bareword package references (beyond the `BML::`
table above, i.e. `use`/`->new`/`->render`/`->resolve_path` style):
`app.psgi:26` (`use DW::BML`), `cgi-bin/DW/Controller/Journal.pm:25`
(`use DW::BML`, for `:285`'s adapter), `cgi-bin/LJ/Global/BMLInit.pm:20`
(`use Apache::BML`) — all unchanged from §1.

`<?` BML-tag literals (excluding the engine files themselves and the two
`.look` files, which legitimately use them):

| Site | Literal | Disposition |
| --- | --- | --- |
| `cgi-bin/LJ/Web.pm:269` (`help_icon`) | `"$pre<?help ... help?>$post"` | **New finding.** `help_icon` (BML) has 8 live call sites feeding *native* TT templates or template variables directly — see §5.2. A native sibling, `help_icon_html` ("like help_icon, but no BML"), already exists one function below it and is unused by any of them. |
| `cgi-bin/LJ/Web.pm:295` (`bad_input`) | `"<?badcontent?>\n<ul>\n"` | **New finding.** Zero callers anywhere (`grep -rn "LJ::bad_input\b"` matches only the definition and its own doc comment) — dead code, and the tag itself doesn't even match `global.look`'s real `BADINPUT` block (case/name mismatch), so it was already broken even for a hypothetical BML caller. |
| `views/shop/confirm.tt:15-19` | `<?p $email_checkbox p?>` plus raw `if ( $email_checkbox ) { ... }` Perl inside the template | **New finding, and not really a BML-retirement issue** — this block is corrupted TT (literal Perl control flow and a stray BML tag inside a `.tt` file, plus a malformed `[%` on the line above it). Pre-existing breakage surfaced by this grep, unrelated to F2/W5/W8; flagged for whoever owns `views/shop/confirm.tt`, not actioned here. |
| `views/beta.tt.text:43,49`, `ext/dw-nonfree/views/beta.tt.text.local:1`, `ext/dw-nonfree/views/index.tt.text.local:12`, `ext/dw-nonfree/bin/upgrading/en_DW.dat:432` | `<?ljuser NAME ljuser?>` / `<?ljcomm NAME ljcomm?>` inside translation *values* | **New finding.** `<?ljuser?>`/`<?ljcomm?>` are the two static blocks `lj-bml-blocks.pl:33-34` registers, resolved only by `bml_decode`/`bml_block` during an actual BML render. `LJ::Lang::ml()` (`LJ/Lang.pm:569-587`, confirmed by grep — no `bml_decode`/`BML::` call anywhere in `LJ::Lang.pm`) does not post-process its return value through BML at all, so any native `.tt` page rendering one of these ml keys via `dw.ml(...)` would show the literal tag text, not a linked username/community. Not verified end-to-end against a live render of every consuming page (out of this docs-only pass's scope) but the mechanism gap is confirmed by source. |

`LJ::Widget` (framework + subclass inventory): the framework file itself
(`cgi-bin/LJ/Widget.pm`) has zero `BML::` references (`grep -c` confirms) and
is unrelated to BML engine retirement directly. W9 Part A deleted the four
subclasses with zero remaining callers that a prior pass (informally,
"W6" per the assignment) had flagged: `LJ::Widget::TagCloud`,
`::ExamplePostWidget`, `::ExampleAjaxWidget`, `::ExampleRenderWidget`
(re-verified independently by grep across `cgi-bin/`, `views/`, `htdocs/`,
`ext/`, `bin/`, `t/` before deleting — see the Part A commit message for the
full evidence). 28 `LJ::Widget`/`DW::Widget` subclasses remain; a full
per-widget caller audit of all 28 was not performed in this pass (out of
the stated Part A scope, which named specific widgets to re-verify, not an
open-ended widget sweep) — flagged here as a possible future package if a
broader dead-widget sweep is wanted.

### 5.2 New findings this re-audit surfaced (not in the original W6 doc)

1. **`LJ::help_icon` (`cgi-bin/LJ/Web.pm:264-270`) is a live, visible bug on
   multiple native pages.** It returns a literal `<?help URL help?>` BML tag
   that only resolves inside an actual BML render (`global.look:16`'s
   `HELP` macro). It is called directly, or passed as a template variable
   later called from a `.tt` file, from: `cgi-bin/LJ/Widget/S2PropGroup.pm`
   (4 call sites), `cgi-bin/LJ/Widget/NavStripChooser.pm:60`,
   `cgi-bin/LJ/Widget/JournalTitles.pm:35`,
   `cgi-bin/DW/Controller/Manage/Profile.pm:188`,
   `cgi-bin/DW/Controller/SettingsHub.pm:381` — consumed by
   `views/manage/profile.tt:50`, `views/widget/journaltitles.tt:7`,
   `views/widget/moodthemechooser.tt:4`, `views/edit/icons.tt:62,72,82,251`,
   `views/widget/navstripchooser.tt:7`, all native TT pages. A native
   sibling already exists and is already used correctly elsewhere
   (`cgi-bin/LJ/Talk.pm:1585`, `cgi-bin/DW/Controller/EditIcons.pm:298`):
   `LJ::help_icon_html` ("like help_icon, but no BML"). This looks like a
   migration gap (callers updated to native TT, but not switched from
   `help_icon` to `help_icon_html`) rather than anything F2/W5/W8 touched.
   Not fixed here (Part B is docs-only); flagged as a small, well-scoped
   future package (swap the call sites, confirm each rendered page shows a
   real help link instead of literal tag text).
2. **`LJ::bad_input` (`cgi-bin/LJ/Web.pm:292-299`) is dead code with a
   broken tag** — see table above. Candidate for deletion in a future
   small package, same shape as W9 Part A.
3. **`views/shop/confirm.tt`'s error-display block is corrupted TT**,
   unrelated to BML retirement — flagged for the owning team, not this
   package.
4. **Translation strings can embed `<?ljuser?>`/`<?ljcomm?>` tags that
   native `LJ::Lang::ml()` never expands** — see table above. This is a
   narrower, more general version of the `help_icon` problem (a BML-only
   content convention silently surviving into native-rendered translation
   values) and may affect other translation keys beyond the four sites
   found by this pass's literal grep (a key could embed these tags without
   the literal `<?` substring being adjacent to `ljuser`/`ljcomm` in a way
   this grep's pattern would still catch — the pattern used was
   `<?[a-zA-Z_]`, which is not scope-limited to only these two tag names,
   so this is unlikely to have missed other tag names, but was not
   independently re-verified with a second pattern).

### 5.3 What W5/W7-A/F2/W8 removed vs. what is left

Removed since the original audit (`28bafa21f`): the app.psgi `__rpc_*`
fallback and `%LJ::AJAX_URI_MAP` default (W7-A); `LJ::User::Login.pm`,
`DW::User::Rename.pm`, `DW::Hooks::Changelog.pm`, `LJ::Sysban.pm`,
`ljlib.pl`'s `reset_cookies` guard, `LJ::Web.pm`'s
`did_post`/`check_referer`/`check_form_auth`/`error_list`/`error_noremote`/
`warning_list`, `LJ::Poll.pm`'s needlogin branch, `LJ::Console.pm`'s
`<?_ml?>` literal (W5); the three entry `.bml` pages, `draft.bml`,
`LJ::Web::entry_form`/`entry_form_decode` (F2); and (queued for review, not
yet on this root) `DW::Controller::Journal.pm:317`'s adapter, replaced with
a plain `DW::Request` plus a marked/conditional adapter at
`LJ::S2.pm:2468` for the held `s2_head_content_extra` hook (W8).

Left, matching §1/§2's classification exactly (nothing has moved buckets):
the engine itself (`Apache::BML.pm`, `DW::BML.pm`, `lj-bml-blocks.pl`,
`BMLInit.pm`, the two `.look` files); `RequestWrapper.pm:56`'s
`set_language` shim (see T4 cross-check below for a refinement to when this
is actually safe to drop); `LJ::Protocol.pm:562,2335` (held); `PageStats.pm`
(held); `DW::Controller::Journal.pm:285`'s `data_handler:*` adapter (held,
explicitly untouched by W8 too); `LJ::S2.pm:2468`'s hook adapter (held,
now conditional per W8 rather than unconditional); the three `_config.bml`
files; the two scheme `.look` files; `lj-bml-blocks.pl`; `t/plack-bml.t`.

### 5.4 Cross-check against T4 (`doc/BML-TRANSLATION-SHIM.md`, themenav,
`bml-sonnet-translation-shim-audit-20260923` at `cb9c10831`) and this
document's own W6 baseline

T4 is a rigorous, well-evidenced companion audit of the *translation* shim
family (`RequestWrapper.pm`'s `BML::set_language`, `<?_ml?>`,
`BML::ml`/`%BML::ML`) that this document treated only at a summary level
in §1-§2. Its mechanism-level findings (§2-§4, §7 of T4) do not contradict
anything here — they refine §2's `RequestWrapper.pm` row and step 2 of §3's
removal sequence with exact line citations this document didn't have.

**One factual contradiction found, with evidence:** T4 §3, §6, §8, and §9
repeatedly rely on a claim that eight named `.bml` pages —
`customize/index.bml`, `customize/options.bml`,
`manage/circle/editfilters.bml`, `manage/settings/index.bml`,
`imguploadrte.bml`, `imgpreview.bml`, `tools/fck_poll.bml`,
`stc/fck/editor/dialog/imguploadrte.bml` — are "out of F2's scope and still
render through this exact path" as of T4's own stated audit base,
`4a3a24100`. This is not correct: `git ls-tree -r 4a3a2410062cc377bb812e22a483fe0c7dd46ff2 --name-only`
lists no `.bml` files at all beyond `_config.bml`/`_config-local.bml`,
`editjournal.bml`, `imgupload.bml`, `update.bml`, and
`tools/endpoints/draft.bml` — the same five (plus two `_config` files) this
document's own §0 already found at the earlier base `28bafa21f`. All eight
of T4's named pages were migrated to native controllers and deleted by
commits that are themselves ancestors of `4a3a24100` (confirmed via
`git merge-base --is-ancestor`), well before T4's audit — e.g.
`bcdced59f` "Migrate customization pages to native controllers" (deletes
`customize/index.bml`), `035e27196`/`bcb019343` "Migrate the settings hub
to native request handling and templates"/"Migrate settings hub from BML
to TT" (deletes `manage/settings/index.bml`), `6dca2d923` "Consolidate FCK
image dialogs on native routes" (the FCK/`imguploadrte.bml`/`imgpreview.bml`
family). This means T4's §8/§9 caveat — that `RequestWrapper.pm:56`'s
removal needs those eight specific pages individually re-audited for
inline `BML::ml()`/`%BML::ML` calls before their own dispatch runs — rests
on pages that do not exist in this tree at any commit T4 or this document
audited; the caveat's *shape* (re-audit whichever `.bml` pages still exist
for this specific risk) still stands, but its *named instances* do not,
and today (post-F2) there are zero non-config `.bml` pages left to
re-audit for it at all — T4's own risk, as stated, is now moot on this
root, though T4's broader sequencing point (gate `RequestWrapper.pm:56`'s
removal on "no `.bml` page can call `BML::ml()` before its own dispatch"
rather than merely "F2 landed") remains valid in principle for any
`.bml` page that might exist at removal time.

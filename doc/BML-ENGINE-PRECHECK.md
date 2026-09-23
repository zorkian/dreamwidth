# BML engine deletion precheck (W13)

Precheck for E3 (BML engine deletion, themenav). Lists the behaviours E3 must
preserve, each locked by a new test (all pass today, before any engine code is
touched), then walks the exact files E3 deletes and every remaining in-tree
reader of each, so E3 knows precisely what else has to move first. No
production code is changed by this document or its tests.

## 1. Preserved behaviours and their tests

| # | Behaviour | Test |
|---|---|---|
| 1a | An unknown URL gets the router's own 404 (`app.psgi`'s `_render_error_document`), not a bare BML "Not Found" | `t/plack-no-bml-fallback.t` |
| 1b | `/_config.bml` and `/_config-local.bml` (base and `ext/dw-nonfree` overlay) stay 403, regardless of which overlay directory serves them | `t/plack-no-bml-fallback.t` |
| 1c | A `.bml` suffix on a native page (`/inbox/index.bml`, `/update.bml`) strips via `DW::Routing::get_call_opts` and reaches the exact same handler as the bare path | `t/plack-no-bml-fallback.t` |
| 1d | `/update` GET still 302s to `/entry/new`, carrying query args, with or without the `.bml` suffix | `t/plack-no-bml-fallback.t` |
| 2a | Every currently selectable `DW::SiteScheme` (`->available`) `supports_tt` | `t/site-scheme-native.t` |
| 2b | `tt_runner` is the only scheme anywhere in-tree with `engine => 'bml'` | `t/site-scheme-native.t` |
| 2c | `DW::Template->render_string` for a native page never calls `BML::ml` or `DW::BML::render` | `t/site-scheme-native.t` |
| 3a | No `*.bml.text` file exists anywhere under `htdocs/` or `ext/` any more | `t/lang-bml-file-branch.t` |
| 3b | `LJ::Lang::get_text`'s `.bml.` `from_files` branch is not dead code: 14 live call sites still ask for a `.bml.` key (see §4 below) | `t/lang-bml-file-branch.t` |
| 3c | (bug, not a target behaviour -- locked so E3 isn't blamed for it) on a dev server, all 14 of those keys currently render as `[missing string ...]` | `t/lang-bml-file-branch.t` |
| 4a | `Plack::Middleware::DW::RequestWrapper` establishes the request's starting language as `$LJ::DEFAULT_LANG` (no cookie/header input at this stage) | `t/lang-native-request-context.t` |
| 4b | RequestWrapper's starting getter is exactly `\&LJ::Lang::get_text`, by reference | `t/lang-native-request-context.t` |
| 4c | `LJ::Lang::ml()` keeps resolving a `.tt` key correctly through that getter after a later stage renegotiates to a different language code | `t/lang-native-request-context.t` |

## 2. Engine files E3 deletes, and their remaining in-tree readers

### `cgi-bin/Apache/BML.pm`

Required by `cgi-bin/lj-bml-blocks.pl` and `cgi-bin/LJ/Global/BMLInit.pm`
(both `use Apache::BML;`) and by `cgi-bin/DW/BML.pm` (which glob-overrides
several of its subs and calls others, e.g. `BML::bml_decode`,
`Apache::BML::initialize_cur_req`, `Apache::BML::is_initialized`). No other
file reads it. Its own mod_perl `content_handler` entry point is unused under
Plack (confirmed earlier, `doc/BML-ENGINE-RETIREMENT.md`); the two functions
still genuinely reachable from `DW::BML::render()` under Plack --
`Apache::BML::set_scheme` and `BML::decide_language` (see below) -- are
themselves unreachable in practice today, because there is no remaining `.bml`
page whose render would call them (the three `_config*.bml` files 403 before
reaching that code; `find htdocs ext -iname '*.bml'` returns only those three).

### `cgi-bin/DW/BML.pm` minus the adapter

`DW::BML::RequestAdapter` is already split into its own file,
`cgi-bin/DW/BML/RequestAdapter.pm` (its header says so explicitly: "Split out
of DW::BML so callers that only need the adapter don't have to load the whole
BML rendering engine"), and is `use`d directly by `LJ::Protocol.pm` and
`DW::Controller::Journal.pm` without touching `DW::BML.pm` at all. E3 deleting
`DW::BML.pm` does not need to touch `RequestAdapter.pm`.

The rest of `DW::BML.pm` (the module actually being deleted) still has real
readers beyond the adapter:

- `app.psgi` calls `DW::BML->resolve_path` and `DW::BML->render` directly --
  this *is* the fallback chain §1 characterizes. E3 needs to either delete
  this fallback block entirely (per §1's tests, an unknown URL already 404s
  correctly without it -- the only paths that currently reach `render()`
  successfully are the two forbidden `_config*.bml` files, which 403; nothing
  currently depends on `render()` actually rendering content) or replace it.
- `LJ::PageStats.pm` calls `BML::get_request()` (a glob sub `DW::BML.pm`
  installs, not a class method) -- a real functional dependency, not just a
  `use` for side effects. `LJ::PageStats.pm:179`'s own comment already notes
  `DW::BML::RequestAdapter->new` never sets `_filename`, i.e. this file already
  knows it's operating against the held `PageStats` hook ABI (see
  `doc/BML-PROTOCOL-PAGESTATS.md`) and has code specifically compensating for
  the adapter's shape.
- `LJ::Web.pm` calls `BML::get_method()` (in `did_post`) and
  `BML::get_client_header('Referer')` (in `check_referer`'s fallback) -- also
  glob subs, also a real functional dependency, not just a `use` for loading.
- `LJ::S2.pm` has `use DW::BML;` but no other file-level call to a `BML::*`
  glob sub; its own comment says it loads the shims "that still-BML-dependent
  code elsewhere may call," i.e. this looks like an eager-load carried along
  for other consumers rather than a hard dependency of `LJ::S2.pm` itself.

So `BML::get_request`, `BML::get_method`, and `BML::get_client_header` are the
three glob subs E3 needs native equivalents for (or converted call sites for)
before `DW::BML.pm` can go -- distinct from, and in addition to, the four
already-held Apache-request-shaped-adapter call sites tracked elsewhere
(`LJ::Protocol.pm`'s `DISABLE_PROTOCOL`, `DW::Controller::Journal.pm`'s
`data_handler:*`, `LJ::S2.pm`'s `s2_head_content_extra`, `LJ::PageStats.pm`'s
`filename`), which only need the adapter and are already unaffected by this
split.

### `cgi-bin/lj-bml-blocks.pl`

Registers `<?DOMAIN?>`/`<?LJUSER?>`/`<?NEEDLOGIN?>`/etc. BML template blocks.
Its only in-tree reader is `cgi-bin/bml/scheme/global.look`'s `LookRoot`
mechanism loading it as part of BML scheme setup -- itself only reachable
during a real `.bml` page render, of which there are none left. Dead in
practice today.

### `cgi-bin/LJ/Global/BMLInit.pm`

Registers the `startup`, `codeerror`, `ml_getter` (-> `\&LJ::Lang::get_text`),
`include_getter`, `default_scheme_override`, and `codeblock_init_perl` BML
hooks, plus isocode/language and cookie config. Its only in-tree reader is
`ExtraConfig` in `ext/dw-nonfree/htdocs/_config.bml` (and the base
`htdocs/_config.bml` names it too) -- i.e. it is loaded as `_config.bml`
processing for any BML page under that scope, which again requires a live
`.bml` page render to ever run, and there are none. Dead in practice today;
its `ml_getter` hook is the same `\&LJ::Lang::get_text` function natives
already use directly (§1 of `doc/BML-TRANSLATION-SHIM.md`), so nothing loses
translation coverage by this hook going away.

### `cgi-bin/bml/scheme/*.look` (`global.look`, `tt_runner.look`)

Loaded by `DW::BML.pm`/`Apache::BML.pm` scheme setup during a `.bml` page
render. `tt_runner.look` backs the `tt_runner` scheme (§2b); the switch to it
(`Apache::BML::set_scheme`, `cgi-bin/Apache/BML.pm:1415-1434`: `if
($dw_scheme->engine eq 'tt') { $scheme = 'tt_runner'; ... }`) is itself only
reached from `DW::BML::render()`, so it is unreachable for the same reason as
everything else gated behind "a `.bml` page actually renders."

### The three `_config*.bml` files

`htdocs/_config.bml`, `ext/dw-nonfree/htdocs/_config.bml`,
`ext/dw-nonfree/htdocs/_config-local.bml`. Never served (§1b, 403 via
`DW::BML::render`'s `\b_config` check, before any of their directives run).
`ext/dw-nonfree/htdocs/_config-local.bml` is also where `en_DW` (used as the
non-`en` language code in `t/lang-native-request-context.t` and
`t/lang-bml-file-branch.t`'s DB, since it's the only other language actually
loaded via `texttool.pl load` in this environment) gets set as
`DefaultLanguage`.

### `app.psgi`'s BML fallback and `use DW::BML`

Covered above under `DW::BML.pm`; the `use DW::Controller::Journal;` and
`use DW::Routing;` imports next to it are unrelated and stay.

### `DW::SiteScheme`'s `tt_runner` row

`cgi-bin/DW/SiteScheme.pm:36`. Only consumer is `Apache::BML::set_scheme`
(above); `DW::Template::render_scheme` never looks at it (it only checks
`supports_tt`, true for every real scheme per §2a). Safe to delete once
`Apache::BML.pm` is gone, since nothing else names `tt_runner`.

### `t/plack-bml.t`

Currently the only test that proves the BML engine actually *executes*
content: it writes a temp `.bml` fixture under `htdocs/`, requests it through
a real `app.psgi`, and asserts the `<?_code?>`/`<?_ml?>` output, plus
`resolve_path` unit checks and the directory-index/`_config.bml`/404/`__rpc_*`
fallback checks. E3 deletes the whole thing: its execution-proving assertions
(tests 1-5, 7, 8 -- `resolve_path`, the fixture's rendered output, the
directory-URL relative-scope quirk) become meaningless once there is no BML
engine to execute anything, and its fallback-chain assertions (`_config.bml`
403, unknown-path 404, `__rpc_*` 404, controller routes unaffected) are now
independently covered by `t/plack-no-bml-fallback.t` (§1), which does not
depend on the engine being present.

### `LJ::Lang`'s `.bml.text` branch

Covered in full in §1 (3a-3c) and `t/lang-bml-file-branch.t`. Unlike every
other item in this section, this one is **not safe to delete without a code
change**: `LJ::Lang::get_text`'s `from_files` closure still has 14 live
callers asking for a `.bml.`-prefixed key (listed in the test), across
`LJ/Setting/Gender.pm`, `LJ/Setting/BirthdayDisplay.pm`,
`DW/Controller/Entry.pm`, `views/manage/index.tt`,
`views/manage/circle/index.tt`, and `views/delcomment.tt`. E3 removing the
`.bml.` regex branch from `get_text` (as opposed to removing the BML
*rendering* engine) would need those 14 keys renamed to a `.tt.`-style or
plain scope first, or the branch kept solely for DB-backed (non-file)
resolution. This document does not propose which; it only establishes that
the branch is live and lists every caller so that decision can be made with
full information.

### Other doc references

`doc/BML-ENGINE-RETIREMENT.md` and `doc/BML-TRANSLATION-SHIM.md` are the two
audit docs that describe these files' internals in the most depth and will
need a follow-up pass once E3 lands (mechanism descriptions, not just
mentions). `doc/PLACK.md`, `doc/BML-GRADUATION-PLAN.md`, and
`doc/BML-REMOVAL-PLAN.md` reference the engine at a planning level and should
get their BML-engine sections marked done/removed at that point. The dozens of
per-package `doc/BML-*-ACCEPTANCE.md`/`doc/BML-*-CONTRACT.md` files are
historical records of already-completed migrations and do not need editing.

## 3. Summary for whoever picks up E3

- The adapter split (`DW::BML::RequestAdapter.pm`) is already done; E3 does
  not need to extract it.
- Three real glob-sub dependencies block deleting `DW::BML.pm` outright:
  `BML::get_request` (`LJ::PageStats.pm`), `BML::get_method` and
  `BML::get_client_header` (`LJ::Web.pm`). These need native replacements or
  converted call sites first.
- Everything else this document traced under `Apache::BML.pm`
  (`lj-bml-blocks.pl`, `LJ::Global::BMLInit.pm`, both `.look` files,
  `Apache::BML::set_scheme`'s `tt_runner` branch, `BML::decide_language`) is
  already unreachable in production today, independent of E3 -- there is no
  remaining `.bml` page whose render would ever exercise them. Deleting them
  carries no behavior-preservation risk that this document's tests don't
  already cover.
- `LJ::Lang::get_text`'s `.bml.` `from_files` branch is the one exception:
  it is live, has 14 callers, and needs an explicit decision (rename the keys,
  or keep DB-only resolution) before it can go.
- `t/plack-bml.t` should be deleted as part of E3, once its fallback-chain
  coverage is confirmed redundant with `t/plack-no-bml-fallback.t` (it already
  is, per this document).

No code changes were made in W13. All four new tests pass against the current
tree and are ready to catch a regression in any of the above.

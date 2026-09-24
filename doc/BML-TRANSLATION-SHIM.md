# BML translation/request shim characterization

Read-only audit; no code, test, or existing-doc changes, and the server was
not run. Audit base: root HEAD `4a3a24100` ("Record W7-A integration and the
AJAX map deploy gate"). F2 (themenav: delete `update.bml`, `editjournal.bml`,
`imgupload.bml`, `tools/endpoints/draft.bml`, `js/entry.js`, `js/xpost.js`,
`LJ::Web::entry_form`/`deemp`, `/preview/entry`, `LJ::Widget::UserpicSelector`)
is commit range `508229ae9..322205da0`, currently with the reviewer — **not
yet integrated into this branch's base**, so every `htdocs/*.bml` file F2
deletes still exists on disk as of this audit. Findings below are written
against the current tree and explicitly call out what changes once F2 lands.
`doc/BML-JOURNAL-ADAPTER.md` is read from `bml-sonnet-journal-adapter-20260923`
at `74fb0ab92` (W7-B) via `git show`, since it is not on this branch either;
the foreman noted "plus a pending doc fix" there that this document has no
access to (another session's uncommitted work) — treat citations to it as
current as of `74fb0ab92` only.

**Correction (2026-09-23, this branch's second commit):** the original text
of §7-§9 below named an "eight out-of-F2-scope `.bml` pages" list
(`customize/index.bml`, `customize/options.bml`,
`manage/circle/editfilters.bml`, `manage/settings/index.bml`,
`imguploadrte.bml`, `imgpreview.bml`, `tools/fck_poll.bml`,
`stc/fck/editor/dialog/imguploadrte.bml`) as an unverified residual risk.
That list was carried over from `doc/BML-ENGINE-RETIREMENT.md`'s "Findings
and scope" section without re-checking it against this document's own audit
base — none of those eight pages exist at `4a3a24100` (confirmed:
`git ls-tree -r --name-only 4a3a24100 | grep '\.bml$'` lists only the four
`.bml` files F2 deletes plus the three `_config*.bml` files); they were
migrated to native controllers/templates in seven earlier, unrelated commits
(`c2ed9b0f9`, `50276ed0a`, `d5c4037a8`, `80c1c7c27`, `bcdced59f`,
`035e27196`, `6dca2d923`), all ancestors of `4a3a24100`. Root HEAD after F2
(`8d03595e9`) confirms the same: `git ls-tree -r --name-only 8d03595e9 |
grep '\.bml$'` returns only the three `_config*.bml` files. §7-§9 below are
corrected in place to reflect this; the practical effect is that the residual
risk they described is not merely unconfirmed but **moot** — there is no
other `.bml` page left to carry it.

## 1. Scope

"Once the journal adapter work lands" (W7-B's proposed conversion of
`DW::Controller::Journal.pm:317`'s `DW::BML::RequestAdapter->new($r)` to a
plain `DW::Request`) removes the *journal-rendering* caller of the BML
request-adapter shape, but does not touch translation. This document is
about the **other** shim family: how a request's language gets attached to
`LJ::Lang::ml()` (native) and `BML::ml()`/`%BML::ML`/`<?_ml?>` (BML), and
what still depends on `Plack::Middleware::DW::RequestWrapper.pm`'s
per-request `BML::set_language` call once F2's last production `BML::ml`
caller (`LJ::Web::entry_form`) is gone.

## 2. `RequestWrapper.pm:53-56`

```perl
# cgi-bin/Plack/Middleware/DW/RequestWrapper.pm:53-56
# Initialize BML language getter so LJ::Lang::ml / BML::ml work everywhere
my $lang = $LJ::DEFAULT_LANG || $LJ::LANGS[0];
LJ::Lang::set_request_context( lang => $lang, getter => \&LJ::Lang::get_text );
BML::set_language( $lang, \&LJ::Lang::get_text );
```

Runs once per request, inside `call()`'s `eval` (`RequestWrapper.pm:38-59`),
*before* `$self->app->($env)` dispatches to `DW::Routing`/`DW::Controller::
Journal`/`DW::BML`. Two separate, only-loosely-coupled effects:

1. `LJ::Lang::set_request_context(lang => $lang, getter => \&LJ::Lang::
   get_text)` (`LJ/Lang.pm:544-550`) merges `{lang, getter}` into a
   `DW::Request` pnote (`language_context`), read by every subsequent
   `LJ::Lang::ml()` call in the request (§3). This establishes
   `$LJ::DEFAULT_LANG` (or `$LJ::LANGS[0]`) as the *starting* language — it
   is **not** the final per-request negotiated language. Nothing in
   `RequestWrapper.pm` calls `LJ::Lang::set_lang_from_cookie_or_headers` or
   equivalent; every controller/S2 path that wants the visitor's actual
   negotiated language re-establishes it later by calling
   `LJ::Lang::set_request_context(lang => ...)` again with the negotiated
   value (this is exactly the pattern `t/native-*-language.t` characterize —
   see §7).

2. `BML::set_language($lang, \&LJ::Lang::get_text)` — see §3 for what this
   call does today; the key fact for this line specifically is that it is
   *not* how per-`.bml`-page language negotiation happens (that is
   `Apache::BML.pm:333-335`, inside real page dispatch, independent of this
   call — §3). This call's job is narrower: it warms the **process-global**
   `BML::ml`/`BML::ML::FETCH` closures (`Apache::BML.pm:1831-1871`, or
   `DW::BML.pm:157-210` under Plack — see below) so that *any* code that
   calls `BML::ml()`/`%BML::ML` programmatically, at any point before a real
   `.bml` page's own dispatch would otherwise set them up, gets a working
   getter instead of the `"[ml_getter not defined]"` stub
   (`DW::BML.pm:108-109`, `Apache::BML.pm:1875-1877`).

## 3. How the four names interact today

`DW::BML.pm` **replaces** `Apache::BML.pm`'s `set_language`/
`set_language_scope`/`get_language`/`get_language_default` wholesale via glob
assignment (`DW::BML.pm:157,212,217,221,226` — `*BML::set_language = sub {
...}` etc.), not by calling through to the Apache::BML.pm versions. Under
Plack (i.e., always, in this codebase today), `DW::BML.pm`'s versions are the
ones that actually run; `Apache::BML.pm`'s own definitions (`:1813-1871`,
cited in the assignment) are present in the loaded module but shadowed.

- **`BML::get_language`** (`DW::BML.pm:221-224`): returns
  `$Apache::BML::cur_req->{'lang'}` if `Apache::BML::is_initialized()`
  (`Apache::BML.pm:478-480`: true only while an actual `.bml` page render is
  in progress, i.e. inside `Apache::BML`'s own request-dispatch call chain),
  else `undef`. Native TT pages never initialize `$cur_req`, so this always
  returns `undef` for them — nothing native reads it.

- **`BML::set_language($lang, $getter)`** (`DW::BML.pm:157-210`): sets
  `$apache_r->notes->{langpref}` (best-effort, `eval`-wrapped) and, if a BML
  page is mid-render, `$Apache::BML::cur_req->{lang}` and the page's own
  `HOOK-ml_getter` default. **Then, unconditionally** (line 170-171):
  ```perl
  LJ::Lang::set_request_context( lang => $lang, getter => $getter )
      if defined &LJ::Lang::set_request_context;
  ```
  This is the load-bearing fact for §4: **every** `BML::set_language` call,
  from anywhere, also overwrites the *native* `LJ::Lang` request context's
  `lang` (and `getter`, even to `undef` if the caller didn't pass one — safe
  in practice because `LJ::Lang::ml()`'s own fallback, `$context->{getter}
  || \&LJ::Lang::get_text` at `LJ/Lang.pm:579`, treats a `undef` getter the
  same as none). Finally it redefines the process-global `*BML::ml` and
  `*BML::ML::FETCH` subs (lines 174-209) to close over `$lang`/`$getter` —
  this redefinition is a **global symbol-table mutation**, not
  request-scoped state; in a persistent worker it survives until the next
  call to `BML::set_language` from *any* request.

- **`BML::ml($code, $vars)`**: starts as the stub
  (`DW::BML.pm:108-109`, `"[ml_getter not defined]"`); after the first
  `BML::set_language` call in a worker's lifetime it is the closure from
  `DW::BML.pm:183-196`, which resolves a leading-`.` relative key against
  `$BML::ML_SCOPE` (falling back to `DW::Request->get->note('ml_scope')` —
  the same note `DW::Template::template_string` sets, see below) and calls
  the captured `$getter->($lang, $code, undef, $vars)`. Nothing in native TT
  rendering calls this — native pages call `LJ::Lang::ml()` (`LJ/Lang.pm:
  569-587`) directly. As of this audit, the only production caller of
  `BML::ml()` (not `<?_ml?>` — see below) is `LJ::Web::entry_form`
  (`LJ::Web.pm`, ~98 calls per `doc/BML-ENGINE-RETIREMENT.md:37`), which F2
  deletes.

- **`%BML::ML`** (tied hash, `DW::BML.pm:112-114,150`): `FETCH` is the same
  closure family as `BML::ml`, redefined by the same `set_language` call
  (`DW::BML.pm:197-208`). Used by `.bml` page bodies as `$ML{key}`; no
  native code ties or reads this hash.

- **`<?_ml key _ml?>` tags** (in `.bml` page bodies and `.look` files, e.g.
  `cgi-bin/bml/scheme/global.look:23,24,27,62,63`) do **not** go through
  `BML::ml()`/`%BML::ML` at all. They compile to the `_ML` built-in block
  type in `bml_block` (`Apache/BML.pm:812-824`):
  ```perl
  if ( $type eq "_ML" ) {
      my $code = $data;
      return $code if $req->{'lang'} eq 'debug';
      my $getter = $req->{'env'}->{'HOOK-ml_getter'};
      return "[ml_getter not defined]" unless $getter;
      $code = $req->{'r'}->uri . $code if rindex( $code, '.', 0 ) == 0;
      return $getter->( $req->{'lang'}, $code );
  }
  ```
  `HOOK-ml_getter` is `\&LJ::Lang::get_text`, registered **once at process
  boot** by `LJ::Global::BMLInit.pm:68` (`BML::register_hook('ml_getter',
  \&LJ::Lang::get_text)`) — not per-request, not by `RequestWrapper.pm`, and
  not by `BML::set_language`'s `$getter ||= ...HOOK-ml_getter` fallback
  (that fallback is for when `set_language` is called *without* an explicit
  getter and a page is mid-render; it reads the same permanently-registered
  hook). What *does* need to be per-request-correct for `<?_ml?>` is
  `$req->{'lang'}`, and that is set by `Apache::BML.pm:333-335`, **inside
  real per-`.bml`-page dispatch**, independent of `RequestWrapper.pm`:
  ```perl
  # Apache/BML.pm:329-335, inside the real per-page render path
  my $lang_scope = $uri; $lang_scope =~ s/$path_info$//;
  BML::set_language_scope($lang_scope);
  my $lang = BML::decide_language();   # real per-request negotiation
  BML::set_language($lang);            # no explicit getter -> falls back to HOOK-ml_getter
  ```
  Consequence: **`<?_ml?>` resolution for any `.bml` page** (at this
  document's audit base, only the four F2-scoped entry pages and
  `global.look`/`tt_runner.look`; see the correction above — no other
  `.bml` page exists in the tree) **does not depend on
  `RequestWrapper.pm`'s `BML::set_language` call at all** — it is
  self-contained within `Apache::BML.pm`'s own dispatch.

- **Native TT pages** (`DW::Template->render_template`/`render_string`/
  `template_string`) never call any `BML::*` symbol. `template_string`
  (`DW/Template.pm:110-140`) sets `$r->note('ml_scope', $scope)` **and**
  `LJ::Lang::set_request_scope($scope)` (`:123-124`) in lockstep, restoring
  both on exit (`:135-136`) — a BML page can render a TT fragment
  mid-request (e.g. `tt_runner.look`, §5) without corrupting either scope.
  `LJ::Lang::ml()` (`LJ/Lang.pm:569-587`) resolves a relative key by
  preferring `$context->{scope}` (the `set_request_scope` value) and falling
  back to `DW::Request->get->note('ml_scope')` only if that is undefined
  (`:574-577`) — the two are kept in sync by `template_string` so this
  fallback is only exercised by code that sets the note directly without
  going through `template_string` (none found in this audit).

## 4. `LJ::Protocol.pm:562` — held, no change proposed

```perl
my @msg;
BML::set_language('en');    # FIXME
```

Inside `sendmessage`, before validating/dispatching recipients. `sendmessage`
itself contains no `LJ::Lang::ml`/`BML::ml` call (grepped the full sub body).
What this line actually changes, precisely:

- Via `DW::BML.pm:170-171` (§3), it calls
  `LJ::Lang::set_request_context(lang => 'en', getter => undef)` — since
  `Apache::BML::is_initialized()` is false here (sendmessage is not a
  `.bml`-page render; it is reached from message-send flows, which after
  W2/W3's inbox migration are native routes), `$getter` is never resolved
  from `HOOK-ml_getter` either, so `getter` is passed as `undef`.
  `LJ::Lang::ml()`'s `$context->{getter} || \&LJ::Lang::get_text` fallback
  (§3) absorbs the `undef` harmlessly, but **`lang` has no such fallback** —
  it is force-set to `'en'` for the rest of the request's native
  `LJ::Lang::ml()` calls, not just for anything that calls `BML::ml()`.
- The concrete downstream consumer: `LJ::Message::can_send`
  (`LJ/Message.pm:387,395-396,403`) calls `LJ::Lang::ml('error.message.
  individual'|'deleted'|'expunged'|'canreceive', {...})` — the **native**
  function, not `BML::ml` — to build the rejection message returned through
  the protocol layer. Forcing `lang => 'en'` here is what keeps these
  specific protocol-error strings in English regardless of the sender's
  browser-negotiated language; this is presumably intentional (protocol/API
  error codes are a machine-facing wire contract, not a rendered page), but
  it is done by mutating shared per-request state rather than by passing an
  explicit language to the one function that needs it.
- Also (relevant, not load-bearing for `can_send`): the process-global
  `*BML::ml`/`*BML::ML::FETCH` closures get redefined to `lang => 'en'` with
  whatever `HOOK-ml_getter`/explicit getter applies (none here, so they'd
  return `"[ml_getter not defined]"` if called before the next
  `set_language`) — this only matters to something that later calls
  `BML::ml()` programmatically in the same worker before another
  `set_language` call runs, which (once F2 lands) is nothing in production.

**Smallest native equivalent, not proposed as a change**: replacing this
line with `LJ::Lang::set_request_context(lang => 'en')` directly would
achieve the same effect on `can_send`'s `LJ::Lang::ml()` calls without the
`BML::*` side effects (notes mutation, global closure redefinition), and
without depending on `Apache::BML::is_initialized()`/`HOOK-ml_getter`
resolution at all. This document does not recommend making that change — see
§8 gates.

### Observed behaviour (`t/protocol-sendmessage-language.t`)

W12 adds a test that drives `sendmessage` through a real `DW::Request`
context and observes the effect directly, confirming and extending the
mechanism traced above:

- With a request-context language of `ru` and a custom recorder getter
  installed beforehand, sending a message to a community (which fails
  `LJ::Message::can_send`'s `is_person`/`is_identity` check, before
  `LJ::Message::send` is ever reached — no persistence, no moderation
  side effect) produces an error string built from genuine, natively-fetched
  **English** text (`LJ::Lang::get_text('en', 'error.message.individual',
  ...)`), and the custom getter records **zero** calls. This empirically
  confirms §3's `getter => undef` clobbering claim is not merely theoretical:
  a getter that was already installed and differs from the default
  (`\&LJ::Lang::get_text`) is silently discarded, not just defaulted.
- The forced state is not scoped to the `sendmessage`/`can_send` call chain:
  after `sendmessage` returns, `LJ::Lang::ml()` for the same key still
  resolves via the real native getter on `en`, not the `ru` recorder that was
  active before the call. Nothing restores the prior context.
- With no active `DW::Request` (e.g. an ljlib-only script context),
  `BML::set_language('en')`'s forwarding into
  `LJ::Lang::set_request_context`/`LJ::Lang::request_context` is a safe
  no-op — both functions early-return without a request (`LJ/Lang.pm:539,
  545`) — and `LJ::Lang::get_effective_lang()` still falls back to
  `$LJ::DEFAULT_LANG`.

Nuance for the §4 "smallest native equivalent" proposal above: a literal
`LJ::Lang::set_request_context(lang => 'en')` replacement (passing no
`getter` key at all) would leave any *existing* getter in the context
untouched, rather than overwriting it to `undef`. For real request traffic
this is equivalent in output, because `RequestWrapper.pm:56` (§2) always
installs `\&LJ::Lang::get_text` as the getter before dispatch, and `undef`
falls back to the exact same function (§3) — so `can_send`'s error text
comes out identical either way. It stops being equivalent only for a caller
that has installed some other, non-default getter on the request before
`sendmessage` runs (as this test does, and as `lang => 'debug'` callers do,
per §3's debug-key handling) — the current code destroys that getter, the
proposed replacement would preserve it. No in-tree production caller does
this today (grepped for `set_request_context.*getter` outside `RequestWrapper.pm`
and this test); it is a latent difference, not an active regression.

No code change is made in this commit. This subsection is evidence for a
future decision at §8/§9, not an implementation of one.

## 5. `LJ::Global::BMLInit.pm` hooks — which matter for non-BML requests

| Hook (registered at) | What it does | Matters for a native (non-`.bml`) request? |
| --- | --- | --- |
| `startup` (`:31-41`) | Computes a URI-derived code-block cache key for the page about to render | No — only invoked from inside `Apache::BML`'s own per-page dispatch, which native requests never enter |
| `codeerror` (`:43-63`) | Formats a BML `<?perl?>` code-block exception into HTML, gated on `$remote->show_raw_errors`/`$LJ::IS_DEV_SERVER` | No — only fires when a BML code block throws; native TT rendering has its own error path (`DW::Template`/`eval` in `template_string`, §3) that never calls this hook |
| `ml_getter` (`:68`, `\&LJ::Lang::get_text`) | The getter every `<?_ml?>` tag resolves through (`Apache/BML.pm:819`), and the fallback getter `BML::set_language` uses when called without an explicit one (`Apache/BML.pm:1842`, `DW/BML.pm:167`) | Indirectly yes, but only insofar as it is the same underlying function (`LJ::Lang::get_text`) native code also calls directly — no native code reads this hook *registration* itself; it is BML-internal plumbing that happens to point at the same native function |
| `include_getter` (`:71-80`) | Resolves `<?include file?>` via `LJ::load_include` | No — only meaningful inside BML page/look-file parsing |
| `default_scheme_override` (`:83-93`) | Lets `%LJ::BML_SCHEME_OVERRIDE`/`$LJ::SCHEME_OVERRIDE` force a different scheme for a given current scheme | No directly, but see §6 — this only fires from `BML::set_scheme` (`Apache/BML.pm:1415-1436`), which native `DW::SiteScheme`/`DW::Template` rendering never calls |
| `codeblock_init_perl` (`:97-102`) | Injects `*errors = *BMLCodeBlock::errors;` at the top of every compiled BML code block | No — BML code-block compilation only |

None of these six hooks are read by any native TT/controller code path
directly; they are all reached exclusively through `Apache::BML.pm`'s own
internal dispatch (`bml_block`, `bml_decode`, `set_scheme`, code-block
compilation), which native requests (everything `DW::Routing`/
`DW::Controller::Journal` claims) never enter. They remain load-bearing only
for as long as any `.bml` page — entry or otherwise — still exists to be
rendered through that dispatch.

## 6. Scheme `.look` files and `render_scheme` coverage

`cgi-bin/bml/scheme/` contains exactly two files (confirmed:
`find cgi-bin/bml/scheme -type f`):

- **`global.look`** (121 lines): `_parent` of every remaining `.bml` page
  (registered via `lj-bml-blocks.pl`'s static/dynamic blocks, not itself).
  Defines shared macros using `<?_ml?>` tags (§3): `BADINPUT` (`:23-24`),
  `REQUIREPOST` (`:27`), error headers (`:62-63`), plus `SECURITYPRIVATE`,
  `HELP`, `H1`/`H2` per the existing W6 audit. Only reachable from a `.bml`
  page render.
- **`tt_runner.look`** (19 lines): the reverse bridge. Its body is a single
  `<?_code?>` block that calls `DW::Template->render_scheme($scheme, ...)`
  directly (`:5-14`) and wraps the result in `BML::ebml()`. Reached only
  when `BML::set_scheme` (`Apache/BML.pm:1415-1436`) is asked for a scheme
  whose `engine` is `'tt'`/`'current'` while *inside a BML page render* —
  i.e., a BML page or a BML-rendered journal siteskin choosing a modern
  scheme.

**Forward path never touches BML for ordinary native pages** (verifying
W6's claim with exact citations): `DW::Template->render_string`
(`DW/Template.pm:331-362`) checks `$scheme->supports_tt`
(`DW/SiteScheme.pm:84-86`: `engine eq 'tt' || engine eq 'current'`) and, if
true, calls `$class->render_scheme($scheme, $out, $extra)` directly
(`:350-352`) — no `BML::*` call anywhere in that path. `render_scheme`
(`:378-401`) itself only ever calls `$scheme_engine->process('_init.tt', ...)`
(a `Template::Toolkit` object, `DW/Template.pm`'s own `$scheme_engine`, not
`Apache::BML`). The scheme registry (`DW/SiteScheme.pm:28-37`) has exactly
one scheme with `engine => 'bml'`: `tt_runner` itself, marked
`internal => 1` (not user-selectable); every real, selectable scheme
(`blueshift`, `celerity`, `common`, `gradation-*`, `lynx`, `global`) either
has no explicit `engine` key (defaults to `'tt'`, `DW/SiteScheme.pm:81`) or
is explicitly `engine => 'current'`. So `supports_tt` is true for every
scheme an end user (or a native controller) can actually select, and
`render_string`'s `else` branch (`die "Can not use invalid/unknown engine
..."`, `:356-360`) is unreachable for them. **Confirmed: yes, for ordinary
native pages, `DW::Template->render_scheme` already covers every one of them
without `tt_runner.look`/`global.look`/`lj-bml-blocks.pl` — `DW/Template.pm:
331,350-352,378-401`, `DW/SiteScheme.pm:28-37,81,84-86`.**

The two `.look` files and `lj-bml-blocks.pl` remain load-bearing only for
(a) any still-existing `.bml` page's own body/macros, and (b)
`LJ::make_journal`'s siteskinned/S1 rendering path choosing a TT scheme
through `set_scheme` — the case `doc/BML-ENGINE-RETIREMENT.md:94-104`
already flagged as gated on the journal-adapter conversion (W7-B), not on F2
or on this document's translation-shim scope.

## 7. Method/hook table

| Name | Defined at | Reads/writes | Per-request or global? | Still needed after F2? |
| --- | --- | --- | --- | --- |
| `LJ::Lang::set_request_context` | `LJ/Lang.pm:544-550` | `DW::Request` pnote `language_context` | Per-request (pnote) | Yes — the only mechanism native `LJ::Lang::ml()` uses |
| `LJ::Lang::request_context`/`get_effective_lang` | `LJ/Lang.pm:538-542,559-567` | reads the pnote above | Per-request | Yes |
| `LJ::Lang::ml` | `LJ/Lang.pm:569-587` | reads pnote, `$r->note('ml_scope')` fallback | Per-request | Yes — this is native translation |
| `LJ::Lang::set_request_scope` | `LJ/Lang.pm:552-557` | pnote's `scope` key | Per-request | Yes — paired with `DW::Template::template_string`'s `ml_scope` note |
| `DW::Template::template_string`'s `ml_scope`/`set_request_scope` pairing | `DW/Template.pm:117-136` | `$r->note('ml_scope')` + the pnote above, in lockstep | Per-request, save/restore | Yes |
| `BML::get_language` | `DW/BML.pm:221-224` (shadows `Apache/BML.pm:1813-1816`) | `$Apache::BML::cur_req->{lang}` | Global (per-in-progress-page) | Only while a `.bml` page exists |
| `BML::set_language` | `DW/BML.pm:157-210` (shadows `Apache/BML.pm:1831-1871`) | `$apache_r->notes`, `$Apache::BML::cur_req->{lang}`, **and** `LJ::Lang::set_request_context` (§3), plus redefines `*BML::ml`/`*BML::ML::FETCH` | Global symbol-table mutation, persists across requests in a worker until next call | Needed by: any remaining `.bml` page's per-page dispatch (`Apache/BML.pm:333-335`); `LJ::Protocol.pm:562` (held, §4); `RequestWrapper.pm:56` (safety net, §8) |
| `BML::ml` / `%BML::ML` | `DW/BML.pm:108-114,150,183-208` | reads `$BML::ML_SCOPE`/`$r->note('ml_scope')`, calls the captured getter | Global closure, request-independent once set | Only production caller (`LJ::Web::entry_form`) deleted by F2 — after F2, no in-tree production caller remains |
| `<?_ml?>` tag (`_ML` block type) | `Apache/BML.pm:812-824` | `$req->{lang}`, `$req->{env}{HOOK-ml_getter}` | Per-in-progress-page | Only for `global.look`/`tt_runner.look` themselves and the four F2-scoped pages before F2 lands — no other `.bml` page exists at this audit's base (see correction above) |
| `ml_getter` hook | `LJ/Global/BMLInit.pm:68` | registers `\&LJ::Lang::get_text` once at boot | Global, boot-time, not per-request | Yes, as long as `<?_ml?>` tags exist anywhere |
| `Apache::BML.pm:333-335` per-page language negotiation | `Apache/BML.pm:329-335` | calls `BML::decide_language()` then `BML::set_language($lang)` | Per-page, inside real dispatch | Yes, as long as any `.bml` page exists; independent of `RequestWrapper.pm` |

## 8. Smallest safe native replacement for the `RequestWrapper.pm` shim

**What `RequestWrapper.pm:56`'s `BML::set_language` call is actually for**,
given §2-§3: not per-page `<?_ml?>` correctness (self-contained in
`Apache::BML.pm:333-335`), not `LJ::Lang::ml()` correctness (already fully
established by line 55's `LJ::Lang::set_request_context` call, one line
above). Its only job is warming the **process-global** `*BML::ml`/
`*BML::ML::FETCH` closures so that if *anything* calls `BML::ml()`/
`%BML::ML` programmatically — outside of, or before, a real `.bml` page's
own dispatch — it gets a working getter instead of the
`"[ml_getter not defined]"` stub. Because this is a persistent
process-global (not reset between requests in a worker), the failure mode
without it is not "every request breaks" but "the *first* request in a
fresh worker that calls `BML::ml()` programmatically before any real `.bml`
page has rendered in that worker gets the stub; every later request in that
same worker inherits whatever the *previous* caller last set it to" —
exactly the kind of cross-request global-state bug this line currently
prevents by re-establishing a known-good state every request.

**Once F2 lands** (it has, on root, as of the correction above), the only
remaining programmatic `BML::ml()`/`%BML::ML` caller in production code is
gone (`LJ::Web::entry_form`), **and** — per the correction above — there is
no other `.bml` page left in the tree at all except the three `_config*.bml`
files, which are configuration data, never rendered as a page
(`DW::BML`'s own path-traversal/`_config.bml`-access blocking, confirmed
live by `t/plack-bml.t`'s "Direct access to `_config.bml` returns 403"
case). That means `Apache::BML.pm:333-335`'s per-page dispatch — the code
path that made §3's `<?_ml?>`/`ml_getter` analysis independent of this
line — is itself unreachable for any real request post-F2: there is no
`.bml` file left for `DW::BML->resolve_path`/`render` (`app.psgi`'s final
fallback) to find and dispatch to. The two residual risks this document
originally raised (§7's now-corrected table row) collapse to one:

1. ~~Any still-existing `.bml` page's own inline Perl calling `BML::ml()`~~
   — moot; no such page exists post-F2 (confirmed above, not merely
   unverified).
2. `LJ::Protocol.pm:562` (held, §4), which needs `BML::set_language` to
   remain callable and functioning — removing `RequestWrapper.pm`'s call
   does not break this caller (it calls `set_language` itself, and does not
   depend on `Apache::BML::is_initialized()` being true — §4), but does
   mean the *pre-sendmessage* state of the global `*BML::ml` closure is
   whatever the *previous* request in that worker last left it as, not a
   freshly-reset default, between the time this line stops running and the
   time `LJ::Protocol.pm:562` itself is converted or deleted.

**Smallest safe replacement, not proposed as a change**: since
`LJ::Lang::set_request_context` (line 55) already does everything native
code needs, and `BML::set_language`'s only *other* per-request-relevant
effect is the same `set_request_context` call redundantly (§3), and — per
the correction above — no `.bml` page exists post-F2 to depend on the
per-page dispatch this line is unrelated to anyway, the residual case for
keeping line 56 is narrower than this document originally stated: it comes
down to whether `LJ::Protocol.pm:562`'s `BML::set_language('en')` call
(§4, held) is comfortable inheriting stale global-closure state from a prior
request in the same worker, rather than a freshly-reset one, in the window
between "F2 lands" and "`LJ::Protocol.pm:562` is itself converted or
deleted." `doc/BML-ENGINE-RETIREMENT.md`'s own step-2 suggestion
(`BML-ENGINE-RETIREMENT.md:124-127`, re-grep and drop the line right after
F2) is, per this correction, not blocked by any remaining-page concern —
only by that one held item's own gate.

### Test plan

| Test | Covers | Relevant to this shim? |
| --- | --- | --- |
| `t/ml.t` | `LJ::Lang::set_text`/`get_text`/`get_text_multi`, DB+memcache caching, parent-language fallback | Indirectly — exercises `get_text`, the function both `LJ::Lang::ml` and (via `ml_getter`) `<?_ml?>` ultimately call; does not touch `set_request_context`/`BML::*` at all |
| `t/native-language-callers.t`, `t/native-language-services.t`, `t/native-event-language.t`, `t/native-faq-language.t`, `t/native-s2-language.t` | Each stubs `LJ::Lang::set_request_context` directly to assert specific native controllers/services/events/S2 constructors request the correct language without going through `BML::*` | Directly — these are the existing regression suite for "does native code get the right language independent of BML"; `t/native-faq-language.t:177,213-216` explicitly asserts native FAQ rendering does not mutate `$Apache::BML::base_recent_mod`; `t/s2-make-journal-language.t:93` makes `BML::set_language` `die` if called during S2 rendering, proving that path is already BML-independent |
| `t/plack-bml.t` | A live round-trip through a synthetic `.bml` fixture, exercised via the real Plack app with `RequestWrapper` active (tests 7-8, lines 89-114) | Directly, but incompletely: this test's fixture *is* a real `.bml` page, so its `<?_ml?>`/`LJ::Lang::ml()` resolution is driven by `Apache::BML.pm:333-335`'s own per-page call, not by `RequestWrapper.pm:56` — this test would likely still pass if line 56 were removed, as long as *a* real `.bml` page exists to drive the per-page path. It also already documents (comment at `:102-104`) a **pre-existing, unrelated** quirk: a directory URL's `<?_ml?>` resolves its relative scope against the URL directory while native `LJ::Lang::ml()` resolves against the physical file scope — the two diverge today regardless of this shim |

No existing test drives `BML::ml()`/`%BML::ML` programmatically (outside a
real page dispatch) the way `LJ::Web::entry_form` did, nor exercises the
specific "first call in a fresh worker, before any `.bml` page has
rendered" ordering risk described above — a change to `RequestWrapper.pm:56`
would need a new test constructing that ordering explicitly (e.g. calling
`BML::ml()` directly in a test process before any `DW::BML->render` call),
which does not exist today.

## 9. User decisions / gates

Restating and narrowing `doc/BML-ENGINE-RETIREMENT.md`'s gates for this
shim family specifically, no new gates invented:

- **Resolved by the correction above, not an open gate**: this document
  originally held open whether some other `.bml` page's inline Perl might
  call `BML::ml()`/`%BML::ML` before its own dispatch runs. `git ls-tree` at
  both this audit's base (`4a3a24100`) and post-F2 root (`8d03595e9`)
  confirms no such page exists — the only `.bml` files in the tree are the
  three never-rendered `_config*.bml` files. Nothing is gated on this any
  longer.
- **Held, user decision required, no change proposed** (unchanged from
  `BML-ENGINE-RETIREMENT.md`): `LJ::Protocol.pm:562`. This audit adds the
  exact mechanism (`LJ::Message::can_send`'s native `LJ::Lang::ml` calls,
  via `DW::BML.pm:170-171`'s forwarding into `LJ::Lang::set_request_context`
  — §4) and a concrete smallest-native-equivalent sketch
  (`LJ::Lang::set_request_context(lang => 'en')` directly), but does not
  recommend making that change: confirming it is safe requires knowing
  whether any other code between this call and the end of the request
  relies on the `BML::*`-side effects (the `$apache_r->notes->{langpref}`
  write, or the global `*BML::ml` redefinition) rather than only on
  `LJ::Lang::ml`'s language.
- **Confirms, does not refine, `BML-ENGINE-RETIREMENT.md`'s step 2**: that
  document's proposed step 2 (`BML-ENGINE-RETIREMENT.md:124-127`) already
  said to re-grep and drop `RequestWrapper.pm:56` right after F2. This
  document's correction removes the one reservation an earlier draft of §8
  had added against that step (the now-resolved "other page" gate above);
  the only genuinely remaining consideration before making that change is
  the held `LJ::Protocol.pm:562` item just above, not a page-inventory
  question. `BML-ENGINE-RETIREMENT.md`'s own risk note (re-run the full
  suite; "language selection touches every page") still applies.
- **Out of this document's scope, unchanged**: the journal-adapter
  conversion (W7-B, `DW::BML::RequestAdapter` → plain `DW::Request` for
  `LJ::make_journal`) and its own held items
  (`s2_head_content_extra`/`data_handler:*` hook ABI, per
  `BML-JOURNAL-ADAPTER.md`'s "Held" section) do not depend on, or block,
  anything in this document — they are a separate shim family (request
  object shape, not translation).

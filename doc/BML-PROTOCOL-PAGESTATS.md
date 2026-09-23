# `LJ::Protocol.pm`/`LJ::PageStats.pm` held-ABI audit

Read-only audit; no code, test, or existing-doc changes, and the server was
not run. Audit base: root HEAD `b56a68575` ("Record W7-B integration and
W8/T4 review state"). Builds on `doc/BML-ENGINE-RETIREMENT.md` (W6),
`doc/BML-JOURNAL-ADAPTER.md` (W7-B, integrated at `7db93986c`/`372669ac9`),
the W8 commit `d886c0b7d` (HELD, not yet integrated — see §3), and
`doc/BML-TRANSLATION-SHIM.md` (T4, commits `cb9c10831`/`920cf07f8` on
`bml-sonnet-translation-shim-audit-20260923`, queued for review, not yet on
root — cited by content, not by root path, since it is not present here).
`doc/BML-REMAINING-NATIVE-CONSUMERS.md` (audit base `24fddcb82`) already
named both items in this document as deferred; this document characterizes
them fully rather than deferring further.

## 1. `LJ::Protocol.pm:2333-2338` — the `DISABLE_PROTOCOL{getevents}` callback

### 1.1 Every call site

```perl
# cgi-bin/LJ/Protocol.pm:2333-2338, inside sub getevents
my $reject_code = $LJ::DISABLE_PROTOCOL{getevents};
if ( ref $reject_code eq "CODE" ) {
    my $apache_r = eval { BML::get_request() };
    my $errmsg   = $reject_code->( $req, $flags, $apache_r );
    if ($errmsg) { return fail( $err, "311", $errmsg ); }
}
```

`grep -rn DISABLE_PROTOCOL cgi-bin ext` (whole tree): **exactly one match**,
this line. `%LJ::DISABLE_PROTOCOL` is never assigned anywhere in-tree either
(`grep -rn "DISABLE_PROTOCOL\s*=\|DISABLE_PROTOCOL{" cgi-bin ext etc` finds
only this same read) — it exists purely as a production/`ext/local`
extension point, matching `BML-ENGINE-RETIREMENT.md:35`'s finding. In this
tree, `$reject_code` is always `undef`, `ref $reject_code eq "CODE"` is
always false, and this whole block — including the `BML::get_request()`
call — never executes; there is no way to exercise it locally without a
`local $LJ::DISABLE_PROTOCOL{getevents} = sub {...}` test stub (§1.5).

Only `getevents` is checked; no other protocol mode has a
`$LJ::DISABLE_PROTOCOL{...}` guard anywhere in this codebase.

### 1.2 Callers of `getevents` (who could reach this code, and in what
context)

`grep -rn "do_request(\s*['\"]getevents\|mode\s*=>\s*['\"]getevents"
cgi-bin` finds four sites, all reached from an active web request:

| Caller | Context |
| --- | --- |
| `LJ::Protocol.pm:4329`, inside `sub getevents` (the flat-protocol wrapper, name collision with the mode string) | Reached from `LJ::do_request`, itself invoked by the flat/XML-RPC API controllers over HTTP — an active `DW::Request` exists |
| `DW::Controller::EntryPicker.pm:248` | Native web controller (`/editjournal` picker) — active `DW::Request` |
| `DW::Controller::Interface::AtomAPI.pm:349` | Atom feed API endpoint — active `DW::Request` |
| `DW::Widget::LatestNews.pm:39` | Widget rendered inside a page — active `DW::Request` |

A fifth, unrelated match, `DW::Worker::ContentImporter::LiveJournal::
Entries.pm:115,324`, was checked and ruled out: it passes the string
`'getevents'` to `$class->call_xmlrpc(...)`
(`DW::Worker::ContentImporter::LiveJournal.pm:489-499`), which builds an
`XMLRPC::Lite` client against a **remote** LiveJournal-based server's
`/interface/xmlrpc` — an outbound HTTP call to a third-party site, not a
local call into `LJ::Protocol::getevents`. This worker never reaches
`$LJ::DISABLE_PROTOCOL{getevents}`.

**Conclusion**: every current in-tree path that could reach this code runs
inside an active web request. The `BML::get_request()` call's "no request"
outcome (§1.3) is architecturally possible (a hypothetical future background
caller of local `getevents`) but not exercised by anything in this tree
today.

### 1.3 What the third argument is today

```perl
# cgi-bin/DW/BML.pm:231-236
*BML::get_request = sub {
    return $Apache::BML::r if $Apache::BML::r;
    my $r = DW::Request->get;
    return unless $r;
    return DW::BML::RequestAdapter->new($r);
};
```

**Correction (this commit):** an earlier version of this section claimed
`grep -rn '\$Apache::BML::r\b' cgi-bin` finds zero assignments; that is
false. `cgi-bin/DW/BML.pm:633` does `local $Apache::BML::r = $adapter`
inside `DW::BML::render` (reset at `:692`/`:711`), and `cgi-bin/Apache/
BML.pm:102` sets it too (reset at `:198`/`:239`/`:370`/`:386`/`:411`/`:450`).
The corrected reasoning: `DW::BML->render` is reached from `app.psgi:163`'s
BML fallback for any URI `DW::Routing`/`DW::Controller::Journal` didn't
claim, and is therefore still live in principle. But post-F2 the only
`.bml` files left are the three `_config*.bml` files, and `DW::BML::render`
explicitly forbids serving any `_config` file (`DW/BML.pm:623-628`) with an
early `return 0` **before** reaching the `:633` assignment — so every
reachable call to `render()` 403s before `$Apache::BML::r` is ever set.
`Apache::BML.pm`'s own handler (where `:102`'s assignment lives) is the
retired mod_perl request-dispatch entry point, unused under Plack
(`doc/PLACK.md:7`: the historical Apache/mod_perl path "was retired once
all web services moved to Starman"). So `$Apache::BML::r` is never set
during any live Plack request today — not because nothing in the tree ever
assigns it, but because every code path that does assign it is unreachable
from a real request post-F2. That leaves exactly two live outcomes, both
already characterized by `doc/BML-JOURNAL-ADAPTER.md`'s method table (same
adapter class):

- **Inside an active web request** (§1.2's only current case):
  `DW::BML::RequestAdapter->new(DW::Request->get)` — the same adapter class
  `LJ::S2.pm:2468` constructs for `s2_head_content_extra` (W8, §3).
- **No active `DW::Request`**: `undef`, which `getevents` then passes as
  the callback's third argument unchanged (line 2336 has no
  `defined`/fallback check).

### 1.4 Which methods a callback could plausibly call

The full `DW::BML::RequestAdapter` surface (`DW/BML.pm:971-1210`, same
inventory `doc/BML-JOURNAL-ADAPTER.md` already built for the journal
adapter's two construction sites): `uri`, `method`, `args`, `path_info`,
`hostname`, `header_only`, `status`, `content_type`, `print`, `no_cache`,
`headers_in`, `headers_out`, `err_headers_out`, `notes`, `connection`
(→ `client_ip`, `remote_host`, `user`), `document_root`, `pool`,
`dir_config`, `OK`/`NOT_FOUND`/`DECLINED`, `status_line`, `finfo`,
`filename` (always `undef` — see §2.2). Since this callback's contract is
"decide whether to reject this `getevents` call," the methods a
rejection-policy hook would plausibly call are `connection->client_ip`
(IP-based rate limiting/blocking), `headers_in` (User-Agent/bot detection),
`uri`/`method` (path-based rules), and `notes` (cross-hook state) — but, as
with `s2_head_content_extra` and `data_handler:*`
(`BML-ENGINE-RETIREMENT.md` §2), this is a held **external** ABI: any
production or `ext/dw-nonfree` hook could call any method on the object,
and there is no in-tree caller to check against (unlike §1.2's `getevents`
callers, which call `LJ::Protocol::getevents`, not the reject-callback
itself).

### 1.5 Compatibility proposal

Mirroring W8's decoupled form (`d886c0b7d`, §3): W8's pattern was to stop
threading one shared adapter through a general code path and instead
construct a fresh adapter **at the held hook's own call site**, so the held
external ABI keeps receiving the exact same object shape regardless of what
the general path does. `LJ::Protocol.pm:2333-2338` has no general-path reuse
to decouple from (the adapter here is constructed solely for this one
callback), but the same underlying idea applies: stop routing through
`BML::get_request()` — which depends on the `Apache::BML`/`DW::BML` global
machinery (the dead `$Apache::BML::r` check, the `BML::` namespace) for a
purely internal decision — and construct the adapter explicitly:

```perl
my $apache_r = do {
    my $r = eval { DW::Request->get };
    $r ? DW::BML::RequestAdapter->new($r) : undef;
};
```

This is behaviorally identical in every case characterized above (§1.3) —
same object shape inside a request, same `undef` outside one — while
removing this call site's dependency on the `BML::` symbol entirely. It
does **not** change what the held callback receives, so it does not by
itself resolve the "external ABI" concern; it only removes one more
`BML::*` call from the tree ahead of the engine's eventual retirement
(§3).

**User decision required** (not resolved by this audit, per assignment):

- **Keep adapter** (recommended by this audit, no proposed further
  narrowing): preserves the exact current object shape for any
  production/`ext/dw-nonfree` hook, with the smallest-diff change above.
  Safe regardless of what a held hook calls.
- **Pass `DW::Request` directly**: only safe if it's confirmed no
  production hook calls an adapter-only method (`headers_in` as a hash,
  `connection->client_ip` vs. `DW::Request`'s own `get_remote_ip`, etc.) —
  the same unresolved unknown `BML-ENGINE-RETIREMENT.md` §2 already flagged
  for `s2_head_content_extra`/`data_handler:*`. No in-tree evidence either
  way, since `%LJ::DISABLE_PROTOCOL` is never populated in-tree (§1.1).
- **Drop the argument**: changes the callback's arity; any production hook
  expecting three arguments would need updating. No in-tree evidence of
  whether such a hook exists at all, since (again) nothing in-tree
  populates `%LJ::DISABLE_PROTOCOL`.

### 1.6 Test plan for §1.5's smallest-diff change

No existing test exercises this code at all (`grep -rl DISABLE_PROTOCOL t/`
is empty). A new test would need: `local $LJ::DISABLE_PROTOCOL{getevents} =
sub { push @calls, [@_]; return; };` around a real `getevents` call (e.g.
via `DW::Controller::EntryPicker`'s picker flow, §1.2), asserting the
callback fires with `(  $req, $flags, isa('DW::BML::RequestAdapter') )` and
that `$calls[0][2]->connection->client_ip` matches the test request's IP —
proving the replacement construction preserves the exact object shape,
mirroring `t/journal-request-adapter.t`'s `s2_head_content_extra` subtest
pattern (`t/journal-request-adapter.t:216-244`, asserts the hook fires
exactly once with a real adapter). A second subtest with no `DW::Request`
active (calling `LJ::Protocol::getevents` directly, outside `test_psgi`)
would prove the `undef` branch.

## 2. `LJ::PageStats.pm:142-178` — `filename()`

### 2.1 The code

```perl
# cgi-bin/LJ/PageStats.pm:141-146
sub get_request {
    my ($self) = @_;
    return BML::get_request();
}
...
# cgi-bin/LJ/PageStats.pm:170-178
sub filename {
    my ($self) = @_;
    my $r = $self->get_request;

    my $filename = $r->filename;
    $filename =~ s!$LJ::HOME/(?:ssldocs|htdocs)!!;

    return $filename;
}
```

### 2.2 In-tree consumers

`find . -ipath '*PageStats*'` (excluding `.git`): `cgi-bin/LJ/PageStats.pm`
(this class) and exactly two plugins, `cgi-bin/DW/PageStats/
GoogleAnalytics.pm` and `cgi-bin/DW/PageStats/GoogleAnalytics4.pm` — the "GA
plugin(s)" `doc/BML-REMAINING-NATIVE-CONSUMERS.md:20` referred to.
`grep -n filename` on both plugin files: **zero matches in either**. A
broader `grep -rn '\->filename\b' cgi-bin ext` finds this method's own
definition, two unrelated `LJ::LangDatFile.pm` calls (a same-named method on
a completely different class), and `Apache::BML.pm`'s own internal
file-resolution calls (`decide_file_and_stat`, unrelated to `LJ::PageStats`)
— no caller of `LJ::PageStats::filename()` anywhere in this tree. It is
reachable only by a plugin's `_render`/`_render_head`/`campaign_track_html`
implementation choosing to call `$self->filename` — no in-tree plugin does.

### 2.3 What `filename()` actually returns today (both branches)

**Critical finding, not previously characterized**: `DW::BML::
RequestAdapter->new` never populates `_filename`:

```perl
# cgi-bin/DW/BML.pm:973-976
sub new {
    my ( $class, $dw_request ) = @_;
    return bless { r => $dw_request }, $class;
}
...
# cgi-bin/DW/BML.pm:1083-1086
sub filename {
    return $_[0]->{_filename};
}
```

So, inside an active web request (the only live case per §1.3's corrected
analysis — `$Apache::BML::r` is never set during any live Plack request):
`$r->filename` on the adapter **already returns `undef` today**, before any
change proposed here.
`$filename =~ s!...!!` on that `undef` value warns ("Use of uninitialized
value") and leaves it effectively empty/`undef`; `filename()` returns
nothing meaningful in production **right now**.

Outside an active request (`BML::get_request()` returns `undef`, §1.3):
`$self->get_request` returns `undef`, and `my $filename = $r->filename;`
**dies** — "Can't call method \"filename\" on an undefined value." This is
a latent crash in the current code, not something this audit introduces;
it is simply unreached because nothing calls `filename()` at all (§2.2).

### 2.4 `doc/BML-REMAINING-NATIVE-CONSUMERS.md`'s prohibition

`doc/BML-REMAINING-NATIVE-CONSUMERS.md:20,34-35`: *"`DW::Request` has no
physical filename and neither in-tree GA plugin consumes it. Do not
synthesize one from URI"* and *"Replacing `PageStats::get_request` would
require inventing a filename API; the source audit explicitly rejects
URI-to-filesystem synthesis."* This document does not propose synthesizing
one — `DW::Request` (`DW/Request/Plack.pm` and siblings) exposes `uri` and
`path_info`, both URL paths, never a resolved filesystem path (there is no
`htdocs/`-relative file for a native controller route, unlike a `.bml`
page); building one from `uri` would be exactly the prohibited synthesis.

### 2.5 Smallest safe change

Given §2.2 (zero in-tree callers) and §2.3 (already `undef` in every
reachable case, and already a latent crash in the unreachable one), the
smallest safe change is to make the existing de facto behavior explicit and
crash-free, without inventing any filename API:

```perl
sub filename {
    my ($self) = @_;
    return undef;    # DW::Request has no filesystem-path concept (see
                      # doc/BML-REMAINING-NATIVE-CONSUMERS.md); this was
                      # already the effective return value under Plack.
}
```

This removes `filename()`'s only remaining `BML::get_request()` dependency
(`get_request()`/`BML::get_request` itself would still exist for as long as
anything else needs it — nothing else in `LJ::PageStats.pm` calls
`get_request()` except `filename()`, so `get_request()` could be removed in
the same change once confirmed no production/`ext` plugin calls it
directly, which this audit cannot confirm — see §2.6's gate). Both branches
converge on the same result (`undef`) without a conditional, and the crash
in §2.3's unreachable branch is gone. No plugin behavior changes, since
neither in-tree plugin reads the value; a hypothetical production plugin
that *does* call `->filename` and checks `defined` would see no change
(already `undef` inside a request) or would stop crashing (outside one) —
strictly safer, never more restrictive.

### 2.6 User decision / gate

Whether `get_request()` itself (not just `filename()`) can also be removed
depends on whether any production-only `DW::PageStats::*` plugin (not in
this tree) calls `$self->get_request` directly for something other than
`filename()` — this audit found no such call in-tree, but per the standing
pattern for every other held item in this family (`BML-ENGINE-RETIREMENT.md`
§2), an out-of-tree plugin is exactly what cannot be characterized from
here. Recommended scope for now: change `filename()` only (§2.5), leave
`get_request()` in place.

### 2.7 Tests to write

No existing test exercises `LJ::PageStats::filename`/`get_request` at all
(`grep -rl PageStats t/` finds only `t/s2-make-journal-language.t`, which
stubs `LJ::PageStats::new` to suppress unrelated side effects in an S2
language test — not a test of `PageStats` itself). A new
`t/pagestats-filename.t` (or similar) should cover, directly against the
real class (no stubbing of `filename` itself):

1. **Inside an active request** (`test_psgi`, a real `DW::Request`):
   `LJ::PageStats->new->filename` returns `undef` (proving §2.3's
   already-true claim, both before and after §2.5's change — a regression
   guard that would have caught this audit's finding earlier).
2. **Outside a request** (`DW::Request->reset`, no `plack_env`):
   `LJ::PageStats->new->filename` returns `undef` **without dying** — this
   subtest fails today (§2.3), and is the one genuinely new behavior §2.5
   introduces.
3. **Both GA plugins' rendered output is unaffected**: call
   `GoogleAnalytics->new->_render`/`_render_head` and
   `GoogleAnalytics4->new`'s equivalents (with whatever minimal config each
   requires to render) before and after stubbing `LJ::PageStats::filename`
   to return a bogus non-`undef` string, and assert identical output —
   proving neither plugin's output depends on this method at all, not just
   today but as a durable regression guard against a future plugin
   silently starting to depend on it.

## 3. Combined BML engine removal sequence

Cross-referencing `BML-ENGINE-RETIREMENT.md`'s six-step sequence (§3 there)
and `BML-TRANSLATION-SHIM.md`'s findings (§8-§9 there, correction commit
`920cf07f8`):

| Step | Item | Status after this audit | Gate |
| --- | --- | --- | --- |
| 1 | `app.psgi` dead `__rpc_*`/`%LJ::AJAX_URI_MAP` fallback | Done (W7-A, `a6641ec27`) | Deploy gate: production `%LJ::AJAX_URI_MAP` population, per `BML-HANDOFF.md`'s W7-A entry |
| 2 | Re-grep `BML::ml`/`%ML`/`%BML::ML`, drop `RequestWrapper.pm:56` | Ready per `BML-TRANSLATION-SHIM.md`'s correction (`920cf07f8`): no `.bml` page exists post-F2 at all except the three never-rendered `_config*.bml` files, so the residual risk that document originally raised is moot. The one remaining consideration is `LJ::Protocol.pm:562` (held, translation family, **not** this document's scope) | User decision on `LJ::Protocol.pm:562` (§4 there) |
| 3 | `LJ::make_journal`'s adapter → plain `DW::Request` (`Journal.pm:317`) | **Done, but HELD** — W8 (`d886c0b7d`) implements exactly this, decoupling `s2_head_content_extra` (`LJ::S2.pm:2468`) into its own adapter construction. Per `BML-HANDOFF.md`'s W8 entry, HELD because `LJ::S2::Page` is also reached from native entry preview with a plain `DW::Request` — always wrapping an adapter at the hook site would change what a production hook sees on previews; fix in progress | Not this document's scope; tracked by W8 |
| 4 | User decision: `$LJ::DISABLE_PROTOCOL{*}` ABI, `data_handler:*`/`s2_head_content_extra` ABI | **This document (§1) covers `$LJ::DISABLE_PROTOCOL{getevents}`** with the same three-way decision (keep adapter / pass `DW::Request` / drop argument) `BML-ENGINE-RETIREMENT.md` posed generically. `data_handler:*`/`s2_head_content_extra` remain `BML-JOURNAL-ADAPTER.md`'s scope, unchanged by this document | **User decision required**, no default recommended beyond "keep adapter" as the zero-risk option (§1.5) |
| 5 | User decision: `LJ::PageStats::filename` contract | **This document (§2) proposes** a concrete, evidence-based answer (return `undef`, §2.5) rather than leaving it fully deferred — the "characterize before deciding" instruction `BML-REMAINING-NATIVE-CONSUMERS.md:47-49` asked for is now done | **User decision required** to approve §2.5's change itself (low risk: zero in-tree callers, already-`undef`/crashing today) |
| 6 | Delete `Apache::BML.pm`, `DW::BML.pm`, `lj-bml-blocks.pl`, `BMLInit.pm`, `.look` files, `_config*.bml`, retire `t/plack-bml.t` | Not reachable until steps 2-5 are individually resolved and actioned | Composite of every gate above |

**This document's net addition to the sequence**: steps 4 and 5 no longer
need a *characterization* package before a user decision — both are
characterized now, with concrete, evidence-backed proposals and test plans.
What remains before step 6 is: (a) the user decisions themselves (§1.5, §2.6,
and the already-open `LJ::Protocol.pm:562` and `s2_head_content_extra`/
`data_handler:*` decisions), and (b) actually implementing whichever option
is chosen, with the tests sketched in §1.6/§2.7 and
`BML-JOURNAL-ADAPTER.md`'s own test notes for the journal-adapter side.
No code, test, or ordering change is proposed by this document itself.

**Explicit user decisions this document surfaces or restates**, none
resolved:

1. `$LJ::DISABLE_PROTOCOL{getevents}`'s third argument: keep adapter (this
   document's recommendation, §1.5) / pass `DW::Request` / drop the
   argument.
2. `LJ::PageStats::filename()`: approve returning `undef` unconditionally
   (§2.5), removing the latent crash and the `BML::get_request()`
   dependency, with no behavior change for any in-tree caller (there are
   none).
3. Unchanged from prior audits, restated for completeness: `LJ::Protocol.pm:
   562`'s `BML::set_language('en')` (held, translation family — see
   `BML-TRANSLATION-SHIM.md` §4/§9); `s2_head_content_extra`/`data_handler:*`
   hook ABI (held, journal-adapter family — see `BML-JOURNAL-ADAPTER.md`
   "Held"); W8's own fix-in-progress for `LJ::S2::Page`'s preview-vs-journal
   adapter-wrapping distinction.

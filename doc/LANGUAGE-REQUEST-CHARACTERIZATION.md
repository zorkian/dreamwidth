# Native language/request characterization

This document preserves the original characterization below and records the accepted native implementation. The original findings and proposed design are historical, not descriptions of the current runtime.

## Original contract before conversion

- In web context, `LJ::Lang::ml` delegates to `BML::ml`. `RequestWrapper` installs the default language and `LJ::Lang::get_text` getter for every Plack request.
- Relative keys (`.key`) use `BML::ML_SCOPE` first, then `DW::Request` note `ml_scope`. Full `.bml` and `.tt` keys stay absolute. The getter receives substitution hashes unchanged.
- Debug language returns the key. Non-web callers bypass BML and use `get_effective_lang`, which falls back to `DEFAULT_LANG`.
- `get_text` reads source `.text` files in development and has request and process/DB-cache paths; cold and warm source-language lookups give equivalent substituted text.

## Original confirmed gap

`BML::ML_SCOPE` is process-global and wins over the request note. A BML request can therefore make a later TT request resolve a relative key against the prior `.bml` scope. `t/lang-request-characterization.t` records this as a TODO acceptance test. `DW::Template` also restores the previous note only when it was truthy, so nested/empty-scope restoration needs explicit design coverage.

## RequestWrapper and template evidence

A sequential PSGI test through `Plack::Middleware::DW::RequestWrapper` reproduces the same stale BML scope. Wrapper calls `start_request`, creates `DW::Request`, installs the default getter, and calls `end_request`; none of those steps clears `$BML::ML_SCOPE`. `DW::Template->template_string` saves the request note, but restores it only when the old value is truthy and has no exception-safe guard. Its `scoped_include`/nested render behavior therefore needs a scope stack, not ad-hoc save/restore. Legacy BML selects `HOOK-ml_getter` from its initialized request when no getter is supplied; the transition must keep that hook request-local.

## Proposed native design for review

Keep language, ML scope, and getter in one request-local context owned by `DW::Request` (or a narrowly scoped language service). Store the context hash with `DW::Request->pnote("language_context")`; expose `LJ::Lang::request_context`, `LJ::Lang::with_scope`, and `LJ::Lang::ml` rather than letting callers read global BML symbols. `LJ::Lang::ml` should query that context in web requests and call `get_text` directly in non-web requests. Scope push/pop must restore `undef` as well as nonempty values, and RequestWrapper setup/teardown must initialize and clear it. Preserve the BML bridge temporarily for live BML pages, but make it a consumer of the native context rather than a permanent shim.

Before implementation, add acceptance for database fallback/missing strings and cold/warm DB cache behavior, debug/default language selection, BML and TT mixed requests, nested template scopes, and worker/CLI callers.


## Accepted implementation, 2026-09-22

Sol independently cleared source `774925a26b8c71805235a381eec29fd4b308e9f0`
after reviewing the complete native range and rechecking each material finding.
The foreman integrated the range through local `f51de6ca4`.

`RequestWrapper` initializes `LJ::Lang` context in the current `DW::Request`
pnote. Native `ml` reads request-local language, getter and scope; it no longer
reads stale process-global BML scope. Live BML pages temporarily feed that
context through their language/scope setters. Changing the language preserves
an already-set scope. This bridge remains only until the BML pages and runtime
consumers are removed; it is not the final architecture.

Template scopes restore both context and request notes, including absent scopes
and exception paths. Direct native debug lookup retains the relative key while
the TT filter retains its historical expanded debug key. Effective language for
data lookups validates the code and falls back to the configured default.

Cache acceptance exposed two concrete inconsistencies: mixed-case writes did
not match normalized lookup keys, and all-language removal invalidated only an
optional named language. Set/child/remove invalidations now use normalized keys;
removal gathers every affected latest-row language before deleting it. Sol's
independent DB-only warm root/no-language and warm child-fallback removal probes
now pass, as does mixed-case source autoload with source mtime older than DB.

Required coverage is implemented in `t/lang-request-characterization.t`,
`t/plack-bml.t` and `t/ml.t`: sequential real middleware requests; custom getters;
scoped/full/substituted/default/debug keys; nested TT/BML and exceptional scope
restoration; actual BML explicit and directory routes; non-development database
fallback, missing-to-present and cold/warm cache behavior. The directory route
retains a characterized distinction: legacy BML ML uses URL-directory scope,
while native ML uses physical index.bml scope. This is not a claim that those
historical behaviors are identical.

The integrated foreman suite passed 229 assertions across ten files, formatting
passed 1,037 assertions, and compilation passed 1,599. A worker's earlier warm
source failure is explained by the corrected mixed-case bug. One earlier worker
compile segfault remains unexplained; repeated worker and independent Sol and
foreman compile runs passed. Remaining direct BML consumers still need separate
migration and acceptance before the engine can be removed.

## Update, 2026-09-24: the engine is removed

The BML rendering engine and the bridge described above are gone (package E3;
see `doc/BML-ENGINE-RETIREMENT.md`). `t/lang-request-characterization.t` was
replaced by `t/native-lang-request-context.t`, and `t/plack-bml.t` now asserts
router-only behavior instead of exercising the engine directly. The rest of
this document remains an accurate historical record of the transition.

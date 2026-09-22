# Native language/request characterization

This is a compatibility record for the language migration; it makes no production-path change.

## Current contract

- In web context, `LJ::Lang::ml` delegates to `BML::ml`. `RequestWrapper` installs the default language and `LJ::Lang::get_text` getter for every Plack request.
- Relative keys (`.key`) use `BML::ML_SCOPE` first, then `DW::Request` note `ml_scope`. Full `.bml` and `.tt` keys stay absolute. The getter receives substitution hashes unchanged.
- Debug language returns the key. Non-web callers bypass BML and use `get_effective_lang`, which falls back to `DEFAULT_LANG`.
- `get_text` reads source `.text` files in development and has request and process/DB-cache paths; cold and warm source-language lookups give equivalent substituted text.

## Confirmed gap

`BML::ML_SCOPE` is process-global and wins over the request note. A BML request can therefore make a later TT request resolve a relative key against the prior `.bml` scope. `t/lang-request-characterization.t` records this as a TODO acceptance test. `DW::Template` also restores the previous note only when it was truthy, so nested/empty-scope restoration needs explicit design coverage.

## RequestWrapper and template evidence

A sequential PSGI test through `Plack::Middleware::DW::RequestWrapper` reproduces the same stale BML scope. Wrapper calls `start_request`, creates `DW::Request`, installs the default getter, and calls `end_request`; none of those steps clears `$BML::ML_SCOPE`. `DW::Template->template_string` saves the request note, but restores it only when the old value is truthy and has no exception-safe guard. Its `scoped_include`/nested render behavior therefore needs a scope stack, not ad-hoc save/restore. Legacy BML selects `HOOK-ml_getter` from its initialized request when no getter is supplied; the transition must keep that hook request-local.

## Proposed native design for review

Keep language, ML scope, and getter in one request-local context owned by `DW::Request` (or a narrowly scoped language service). Store the context hash with `DW::Request->pnote("language_context")`; expose `LJ::Lang::request_context`, `LJ::Lang::with_scope`, and `LJ::Lang::ml` rather than letting callers read global BML symbols. `LJ::Lang::ml` should query that context in web requests and call `get_text` directly in non-web requests. Scope push/pop must restore `undef` as well as nonempty values, and RequestWrapper setup/teardown must initialize and clear it. Preserve the BML bridge temporarily for live BML pages, but make it a consumer of the native context rather than a permanent shim.

Before implementation, add acceptance for database fallback/missing strings and cold/warm DB cache behavior, debug/default language selection, BML and TT mixed requests, nested template scopes, and worker/CLI callers.

# Native language/request characterization

This is a compatibility record for the language migration; it makes no production-path change.

## Current contract

- In web context, `LJ::Lang::ml` delegates to `BML::ml`. `RequestWrapper` installs the default language and `LJ::Lang::get_text` getter for every Plack request.
- Relative keys (`.key`) use `BML::ML_SCOPE` first, then `DW::Request` note `ml_scope`. Full `.bml` and `.tt` keys stay absolute. The getter receives substitution hashes unchanged.
- Debug language returns the key. Non-web callers bypass BML and use `get_effective_lang`, which falls back to `DEFAULT_LANG`.
- `get_text` reads source `.text` files in development and has request and process/DB-cache paths; cold and warm source-language lookups give equivalent substituted text.

## Confirmed gap

`BML::ML_SCOPE` is process-global and wins over the request note. A BML request can therefore make a later TT request resolve a relative key against the prior `.bml` scope. `t/lang-request-characterization.t` records this as a TODO acceptance test. `DW::Template` also restores the previous note only when it was truthy, so nested/empty-scope restoration needs explicit design coverage.

## Proposed native design for review

Keep language, ML scope, and getter in one request-local context owned by `DW::Request` (or a narrowly scoped language service). `LJ::Lang::ml` should query that context in web requests and call `get_text` directly in non-web requests. Scope push/pop must restore `undef` as well as nonempty values, and RequestWrapper setup/teardown must initialize and clear it. Preserve the BML bridge temporarily for live BML pages, but make it a consumer of the native context rather than a permanent shim.

Before implementation, add acceptance for database fallback/missing strings and cold/warm DB cache behavior, debug/default language selection, BML and TT mixed requests, nested template scopes, and worker/CLI callers.

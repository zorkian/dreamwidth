## Accepted continuation supersedes the cache proposal

Callable range3197da9d6 (foremanca854f263) now owns every outcome after the first
password check and preserves the characterized flat failed-login continuation.
No request-local BML authentication cache/shim was added or is required. The
cache-transfer discussion below records the earlier source audit, not the current
implementation plan. Public routing remains separate pending its finite full-app
matrix and browser acceptance; only structural declines may reach BML.

# Anonymous `/update` POST public composition handoff

Source-only audit. No route change, request, or authentication execution was performed.

## Existing boundaries

- `DW::Controller::Entry` registers `/update` as an all-method, `no_redirects` route. GET calls `legacy_update_get_handler`; every other method currently calls `legacy_update_handler(include_transforms => 1)`. An `undef` result falls through to retained `htdocs/update.bml`. The router also supplies the `.bml` alias.
- `legacy_update_handler` is the authenticated/session path. It declines before transform or mutation work when there is no remote user.
- `legacy_anonymous_update_handler` is callable-only. It owns only structurally eligible, successful-password personal-owner POSTs. It declines missing credentials, targets in POST or GET, alternate login, challenge fields, named transforms, preview/spellcheck, read-only owners, failed password, and failed protocol login.
- The accepted callable path checks the password once in `_auth`, sets protocol `noauth`, performs the legacy login handshake, then prepares and saves through the reviewed native pipeline. Successful requests therefore do not need retained BML.

## Safe handler order

The eventual public composer should preserve this order:

1. GET: existing `legacy_update_get_handler` only.
2. Non-GET: existing authenticated `legacy_update_handler(include_transforms => 1)` first.
3. If that returns `undef`, classify the anonymous owner subset.
4. Claim an eligible anonymous attempt only through a composition path that also owns or faithfully transfers every post-authentication failure.
5. Structurally excluded requests fall through to retained BML unchanged.

Putting the authenticated handler first preserves all current session, community, transform, form-auth, and target behavior. The anonymous helper itself rejects a session remote, so reversing the two is unnecessary.

## Material failed-auth boundary

A simple `legacy_anonymous_update_handler() // BML fallback` composition is unsafe.

- `_auth` calls `LJ::auth_okay` for the supplied user/password (`DW::Controller::Entry`, accepted anonymous helper and `_auth`).
- On a wrong password, the helper returns `undef`.
- Retained `update.bml` then calls `LJ::auth_okay` again before its protocol work.
- With empty auth flags, retained protocol `login` authenticates again; the later `postevent` attempt authenticates again. Retained BML therefore makes three failed checks today, while a naïve callable-first fallback would make four.
- `LJ::auth_okay` calls `LJ::handle_bad_login` on each failed non-banned check (`cgi-bin/LJ/Auth.pm`). `handle_bad_login` records `failed_login` through `rate_log` and can write `loginstall` (`cgi-bin/LJ/User/Login.pm`). Once banned, later checks return early and can change protocol error selection.

This is an observable rate-limit/temporary-ban change, not merely duplicate CPU work. Wrong-password requests are structurally indistinguishable from successful-password requests before checking the password, so the public route cannot safely exclude them using form fields.

The same ownership rule applies after a successful password check if the callable protocol login fails. Falling through reruns password and login work and can duplicate request notes or other login behavior even though it does not record a bad password.

## Smallest compatible composition seam

Add a tri-state composition result: structural decline, claimed/rendered result, or attempted authentication/protocol result requiring retained continuation. Do not represent the last state as plain `undef`.

The smallest source-compatible continuation appears to be request-local transfer into retained BML:

- Cache the exact candidate identity and the result of the callable's first `auth_okay` check for this request.
- On auth failure, fall through to BML with an explicit request-local marker that lets BML consume that already-recorded first check instead of calling `auth_okay` a second time. BML must still execute its characterized login, decode, post-attempt, and spam-hook path once.
- If callable protocol login was attempted and failed, either transfer that response/flags so BML does not repeat the attempt, or render the characterized retained failure in the native composition. A plain fallback is insufficient.
- Bind any marker to the current request and submitted identity. Clear/request isolation must be proven; no process-global cache is suitable.

Checking with `check_password` directly before BML is not compatible: it bypasses `login_ip_banned` and `handle_bad_login`. Treating failed authentication as harmless fallback is also incompatible.

## Finite activation gate

Actual full-app tests should cover both `/update` and `/update.bml` and prove:

1. **Valid personal owner:** authenticated handler declines, anonymous path claims once, BML does not run; one password check, one login, one decoder/save attempt, exact hook reference/order, persisted editor/date/metadata, and the established legacy anonymous success housekeeping (formatting may change; remote-only drafts/editor writes remain absent).
2. **Wrong password:** exactly the retained count/order of `auth_okay`/`handle_bad_login`, retained exact error and blank-password retry, retained decode/post-attempt/spam-hook behavior once, and no entry or user-state mutation. Count with scoped delegates or inert counters rather than changing rate policy.
3. **Protocol login failure after valid password:** no repeated password/login attempt; retained failure response and the exact characterized continuation. The test-only bc021 baseline observes decode/postevent/spam and one persisted entry after a forced protocol-login error, while error-response housekeeping stays unchanged; its final order/reference and fresh-content assertions are still under review.
4. **Structural declines:** missing/empty credentials, challenge fields, POST or GET target, alternate login, transforms, preview, and spellcheck reach BML with zero anonymous authentication attempts. These remain excluded from the callable slice.
5. **Method/action fallback:** unsupported non-POST methods and actions retain existing BML behavior; successful claimed attempts never fall through after effects.
6. **Isolation:** sequential wrong-password then valid-password requests, and users A then B, cannot reuse the transferred auth state.
7. **Response and aliases:** both aliases preserve status, form action, raw query, escaping, and retry username/blank password. Browser proof should distinguish callable failure retry from a later native `/entry/new` submission and document their different draft housekeeping.

This gate does not authorize targets, missing credentials, challenge authentication, transforms, public routing, or a new authentication policy.

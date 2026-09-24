# Native anonymous failed-auth/login continuation

Source-only design audit using retained `htdocs/update.bml`, accepted callable anonymous posting, and the `bc021fbd0` retained sequence. No code, authentication request, or rate-policy change was made.

## Ownership rule

Structural classification must finish before the first password check. Once native code calls `LJ::auth_okay`, it must return a defined response for every later outcome. Falling through to BML after that point repeats authentication and can add a `failed_login` event.

Keep missing/empty credentials, challenge auth, targets, transforms, preview/spellcheck, session remotes, and unsupported identities outside this slice. They must decline before `auth_okay` and remain BML-owned.

The pre-auth classifier also needs to load and validate the candidate owner before checking the password. Unknown/non-person/nonposting/readonly candidates must decline before authentication if they remain outside the native slice. The accepted helper currently checks readonly only after `_auth`; public composition cannot use that ordering and then fall through, because a valid readonly request would check its password twice.

For a structurally eligible personal owner, invoke `update_fields` once with the original flat, NUL-joined GET reference before authentication. Retained POST does this before its first password check. Carry an explicit context object forward so neither the success nor failure path invokes it twice.

## Three distinct outcomes

### 1. Wrong password

Retained observed order is:

```text
update_fields
auth_okay                         # explicit form password check
protocol login -> auth_okay       # login seed has no password
decode_entry_form
protocol postevent -> auth_okay    # decoded seed has submitted password
spam_check
```

The native path must perform the first check once, retain the candidate user with empty auth flags, then continue rather than returning `undef`:

1. Run the legacy protocol login once with its exact `Web/2.0.0` seed.
2. Preserve the login error as the response error. Do not synthesize the final message from the initial `auth_okay` result; retained output uses the protocol login error.
3. Decode once into the original flat postevent request.
4. Call flat `LJ::do_request` once on that same request reference with the still-empty flags.
5. Run `spam_check` once afterward with the candidate user and that exact request reference.
6. Render the native anonymous retry with retained username, blank password, submitted fields, and the login error.

The postevent fails authentication and must not create an entry. No housekeeping, crosspost scheduling, success template, or `after_entry_post_*` hook may run.

### 2. Missing or empty password

These remain excluded. Decline before `update_fields`/authentication in the callable classifier and let retained BML keep its existing `update_fields` then `Enter Password` form behavior. The public composer must not partially enter the native continuation.

### 3. Password succeeds, protocol login returns an error

The initial `auth_okay` sets `noauth` and the candidate user. Call protocol login exactly once. If it returns an error, do not fall through and do not repeat auth/login.

Retained behavior still decodes, calls postevent, and spam-checks. Because flags already contain `noauth`, postevent can persist one entry even though the earlier login error remains. Native ownership must preserve that unusual result:

1. Store the pre-existing login error and optional login message.
2. Decode once and call postevent on the exact flat decoded request reference.
3. Run spam checking once after postevent on that same reference.
4. Ignore postevent success for response/housekeeping decisions while the login error exists.
5. Render the login error retry. Do not run formatting preference writes, draft/editor clearing, crossposts, success links/templates, or `after_entry_post_extra_options`/`after_entry_post_extra_html`, even if postevent persisted.

This is different from a normal postevent failure with a successful login, which remains handled by the accepted `_do_post` path.

## Reusable helper boundary

Keep `_do_post` and its default behavior unchanged. It currently owns normal native save, spam timing, successful housekeeping, success hooks, crossposts, and rendering. Adding a general pre-existing-error option would still use `_save_new_entry`'s copied canonical request and would not preserve the retained flat-reference contract.

Add a narrow private attempt helper at the controller compatibility boundary:

```perl
sub _legacy_flat_post_attempt {
    my ( $request, $flags, $poster ) = @_;
    my %response;
    LJ::do_request( $request, \%response, $flags );
    LJ::Hooks::run_hooks( 'spam_check', $poster, $request, 'entry' );
    return \%response;
}
```

Its contract is deliberately small: one already-decoded flat request in, one protocol attempt followed by one spam hook, same reference throughout, and no housekeeping/rendering/success hooks. It is reusable for retained compatibility continuations without changing `_do_post`.

The anonymous orchestrator should use a tri-state context:

- `declined`: no authentication attempted; public routing may fall through.
- `claimed_success_path`: password/login succeeded; continue through the accepted `_do_post` path unchanged.
- `claimed_login_error`: wrong password or later login error; prepare once, call `_legacy_flat_post_attempt`, then render the pre-existing login error without success processing.

The auth context must expose the loaded candidate and whether the first check was attempted/succeeded. Extend or wrap `_auth` so failure does not discard the candidate; do not reload and reauthenticate through BML. Keep flags exactly as produced by the first check.

For `claimed_login_error`, construct the error with the absolute retained `/update.bml.error.login` key/message plus the escaped protocol `errmsg`. Preserve an optional protocol login message as a warning. Use the accepted `legacy_new_rerender` anonymous username option so every password control stays blank.

## Finite internal callable tests

No public route is needed for this package.

1. **Wrong password:** real retained-form payload; exact sequence `update_fields, auth, login, auth, decode, postevent, auth, spam`; three total delegated `auth_okay` calls, no fourth; one decoder; protocol postevent and spam receive the identical flat request reference; exact visible login error, retained username/fields, blank password; fresh entry/user state unchanged; crosspost/housekeeping/success-hook counters zero.
2. **Successful auth plus forced login error:** one initial `auth_okay`, one login attempt, then decode/postevent/spam in order; postevent and spam share the decoded reference; force-fresh entry proves exact subject/body/private security persisted once; response still shows only the pre-existing login error; draft/editor/format/displaydate remain unchanged; crosspost, success housekeeping, and both success-hook families remain zero.
3. **Login error plus postevent error:** the earlier login error remains the rendered error, with no success processing and no entry.
4. **Normal password and login success control:** existing accepted `_do_post` behavior, persistence, housekeeping, hooks, and response remain unchanged. A source or spy assertion should prove `_do_post` is called only for this branch.
5. **Pre-auth declines:** missing/empty password, challenge, targets, transforms, unknown/ineligible/readonly owner, and session remote return `undef` with zero auth/login/decode/postevent/spam calls. Existing BML tests retain their later behavior.
6. **Reference and isolation:** hook-visible `update_fields` gets the original flat GET ref; decode/postevent/spam get one separate original flat POST request ref. Sequential wrong-password then valid-password and user A then B requests leak neither flags, candidate, error, nor request reference.
7. **No credential diagnostics:** assertion labels, errors, and captured diagnostics contain no submitted password.

After these internal tests pass, public composition can call authenticated handling first, then this anonymous tri-state handler. Only a structural decline may reach BML; every attempted password check must end in a defined native response.

This package does not authorize missing credentials, challenge authentication, targets, transforms, public routing, rate-limit policy changes, or modification of `_do_post` defaults.

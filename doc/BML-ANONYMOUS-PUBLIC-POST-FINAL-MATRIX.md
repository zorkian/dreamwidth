# Final anonymous `/update` public POST activation matrix

Source audit date: 2026-09-23. This refresh assumes the independently reviewed
callable continuation in `3197da9d6`: once it reaches the first password check,
it returns a defined native response for every auth/login outcome. The older
request-local cache continuation proposed in
`doc/BML-ANONYMOUS-PUBLIC-POST-COMPOSITION.md` is no longer needed.

This plan changes no route, authentication policy, target support, transform
support, or external interface.

## Minimal route composition

Keep the existing all-method `/update` registration and `no_redirects`; the
router continues to normalize `/update.bml` to the same handler and an `undef`
result continues to reach retained BML.

The non-GET branch should be exactly the following ownership order:

```perl
my $result = legacy_update_handler( include_transforms => 1 );
return $result if defined $result;
return legacy_anonymous_update_handler();
```

Use `defined`, not truthiness. A handler status may be false-valued while still
being a claimed response. Never call BML or another handler after a defined
result.

This ordering preserves the established authenticated/session behavior first:
form-auth, session actor, personal/community targets, transforms, preview,
spellcheck, and existing success callbacks remain owned by
`legacy_update_handler`. With no session remote it structurally declines, then
the anonymous handler receives the same request.

The anonymous handler may return `undef` only before authentication for its
existing exclusions:

- non-POST/non-text input;
- missing or empty `user`/`password`;
- POST or GET `usejournal` target;
- `altlogin`, challenge/response;
- transform, showform, more-options, preview, or spellcheck;
- session remote;
- absent/non-person/nonposting/readonly candidate.

Those structural declines remain BML-owned. A valid individual owner with a
nonempty password is claimed before the first `auth_okay`. Wrong password,
successful password plus protocol-login error, normal post error, and success
all return defined native responses. There is no auth cache, marker, or BML
continuation, and therefore no fourth wrong-password check or repeated login.

## Actual-app HTTP matrix

Use `app.psgi` without a routing overlay. Exercise both `/update` and
`/update.bml` with real retained forms, no Cookie, disposable individual users,
and inert scoped crosspost scheduling. Wrap/delegate the two controller
handlers and relevant hooks only to count calls; do not replace their logic.

### Claimed anonymous attempts

1. **Valid personal owner, both aliases**
   - Authenticated handler enters once and declines; anonymous handler enters
     once and returns defined; retained BML does not rerender.
   - Exactly one initial password check and one protocol login; one decode/save
     attempt; exact flat request reference reaches decoder, spam hook, and
     legacy success hooks in the established order.
   - Exactly one fresh entry with subject, body, security, tags, location,
     music, format, backdate/date, and supported legacy-schema userpic.
   - Anonymous legacy success updates poster formatting only. It leaves the
     remote-only draft/editor properties unchanged and schedules no xposts.
   - Native success status/body is meaningful and no retained `updateForm`
     appears after effects.

2. **Wrong password, both aliases**
   - Authenticated handler declines once; anonymous handler claims once.
   - Exact retained sequence is `update_fields, auth, login, auth, decode,
     postevent, auth, spam`: three delegated `auth_okay` calls, never four.
   - `update_fields` receives the original flat/NUL-joined GET reference;
     decode, postevent, and spam receive one identical flat POST request.
   - Native retry shows the exact localized login error, retained username,
     subject/body/date/security, and blank password. Submitted password is
     absent from body and diagnostics.
   - Fresh entry count and all draft/editor/format/display-date state remain
     unchanged; success hooks, housekeeping, and xpost counters remain zero.

3. **Valid password plus forced protocol-login error**
   - Scope only the login result; delegate the later flat postevent normally.
   - One initial `auth_okay`, one login, then decode/postevent/spam on the same
     flat request. No repeated auth/login and no BML fallback.
   - Fresh state proves the retained postevent may persist exactly one entry
     with exact subject/body/private security.
   - Response still shows only the earlier escaped login error. Formatting,
     drafts, editor and display-date housekeeping, crossposts, and both success
     hook families remain unchanged/zero.
   - A companion forced postevent error creates no entry and still renders the
     earlier login error.

4. **Normal native retry errors after successful login**
   - Empty body and invalid date stay claimed, invoke login/decode/save/spam
     once, create no entry, preserve sentinel user state, and render one useful
     native error with exact fields and blank password.

### Structural BML fallbacks

For each alias, assert the authenticated handler enters once, anonymous handler
enters once where applicable, anonymous authentication/decode/postevent/spam
counters remain zero, and the retained response is meaningful:

- truly missing password field and explicit empty password;
- missing user and unknown/ineligible/readonly user;
- POST target and GET target;
- `altlogin`, challenge/response;
- transform, showform, more-options, preview, spellcheck;
- unsupported method/action and non-text submission.

Use distinct before-state sentinels and force-fresh reads. For missing/empty
credentials, BML may run its own pre-auth `update_fields` and render the legacy
credential error; do not incorrectly require zero total BML hook activity.
For targets/transforms, retain their existing form/action behavior rather than
claiming anonymous native support.

### Authenticated-first and isolation controls

- A real two-cookie authenticated personal POST is handled only by
  `legacy_update_handler`; anonymous handler/auth counters stay zero.
- Existing authenticated community/transform controls remain unchanged.
- Sequential wrong-password then valid-password requests and user A then B
  prove no candidate, flags, error, request reference, or credentials leak.
- A successful claimed request followed by a structural decline proves effects
  are never replayed through BML.
- GET remains entirely with `legacy_update_get_handler`; HEAD/other methods keep
  their characterized retained fallback.
- Assert both public aliases explicitly in request URIs and verify no routing
  override or copied BML adapter is installed.

## Plain-app browser gate

Run built assets against a plain `app.psgi` server. A local disposable fixture
may provide username/password only in its startup line; subsequent state replies,
logs, assertions, and screenshots must exclude the password.

1. Load the actual retained anonymous `/update` form at desktop and 390px;
   verify visible credentials, active HTML/FCK modes, blank password, retained
   action, and usable controls.
2. Submit a wrong password through the real retained form. Verify a native
   retry, one visible localized error, retained username/subject/body/date,
   every password control blank, no entry, and force-fresh draft/editor/format/
   display-date state unchanged.
3. Correct the native retry credentials and submit to its canonical
   `/entry/new` action. Verify exact native success and one fresh entry. Document
   this second submission's established native housekeeping: drafts clear and
   display-date follows the native control. Do not present those effects as the
   callable legacy attempt's behavior.
4. Separately submit correct credentials from a freshly loaded retained form to
   prove the public anonymous callable path itself succeeds without BML
   navigation or duplicate entry creation.
5. Assert no page errors, failed resources, unexpected dialogs, or credential
   text in screenshots. Inspect desktop and 390px captures for credential,
   editor, retry-error, and action visibility.
6. Attach fixture/server completion promises immediately. Normal run exits 0;
   a named failure after mutation exits 1; clean early fixture EOF exits 1
   promptly. Nested cleanup closes browser/server, signals fixture, and leaves
   no owned fixture, server, or Chrome process.

## Explicit exclusions

This gate does not activate or redesign missing/empty credentials, targets,
alternate login, challenge auth, transforms, preview/spellcheck, community
anonymous posting, external crossposts, authentication rate policy, or any
deployment hook. Those cases remain retained BML unless separately reviewed.


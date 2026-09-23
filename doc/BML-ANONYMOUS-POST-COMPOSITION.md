# Anonymous retained `/update` POST composition handoff

## Bounded slice

Add a callable-only, owner-journal ordinary POST adapter. It should accept a real retained
`/update` form only when there is no session remote, a submitted legacy `user`, no `usejournal`
target, and the action is an ordinary update. Keep preview, spellcheck, showform, transforms,
alternate-login/challenge behavior, community posting, and public route registration outside this
slice. This is composition work, not a new authentication policy.

## Contracts to preserve

- Retained authentication uses POST `user` and `password` (`htdocs/update.bml:280-289`). Native
  `_auth` expects `username` and `password` (`DW::Controller::Entry:1732-1772`). Build a temporary
  native auth input with `username => legacy user`; do not rename the hook-visible legacy POST or
  invent challenge handling.
- Anonymous retained POST bypasses form-auth by design (`update.bml:271`) but still runs the legacy
  login protocol request before the post attempt (`311-336`). Reuse the existing `_auth` password
  check and existing login request/error rendering. Do not add CSRF/referer policy to this slice.
- The decoder seed is exactly `mode=postevent`, protocol `ver`, submitted `user`, submitted
  `password`, empty owner `usejournal`, `tz=guess`, and `xpost=0` (`342-351`). Feed this to
  `DW::Entry::Legacy::prepare_entry_form` so deployment hooks see the same decoded flat request
  reference while `_do_post` receives the separate canonical request.
- Retained calls the post protocol attempt and then `spam_check`, even for an empty body or failed
  protocol attempt (`351-361`). The reviewed `_do_post` preserves save-attempt then legacy-spam-hook
  ordering (`Entry.pm:1884-1889`) for an authenticated poster. Do not use the ordinary native
  pre-save spam hook at `Entry.pm:268-269`.
- Do not call `_do_post` with an undefined poster/journal after failed password authentication.
  The smallest first slice must return `undef` for both missing/empty credentials and failed
  `_auth`, before decode or native rendering, so retained BML remains the sole owner of both paths.
  This preserves their material asymmetry: `auth_missing` renders immediately without decode/login/
  spam hooks (`update.bml:122-125,138,273`), while a nonempty wrong password loads the candidate
  user, runs login, decodes the entry, attempts the post protocol request, and invokes `spam_check`
  with that loaded candidate even though `auth_okay` failed (`280-361`). A later native error-response
  slice must reproduce that full failed-attempt sequence; it cannot merely show an authentication
  error or call `_do_post` with missing auth objects.
- On success pass `legacy_success => { request => decoded flat request, poster => authenticated
  user, remote => undef, event_format => submitted value, switched_rte_on => submitted value,
  crosspost_master => ... }`. `_legacy_success_housekeeping` then updates the poster's
  `disable_auto_formatting` but does not clear a draft or change `entry_editor` because there is no
  session remote (`Entry.pm:2260-2271`), matching `update.bml:382-393`.
- Crossposting must remain disabled for this anonymous owner slice. Retained schedules only when
  journal equals session remote; session remote is absent. Do not reinterpret the submitted master
  control as permission to schedule.
- `_legacy_update_rerender` cannot be reused because it dereferences `$remote->user`
  (`Entry.pm:670-704`). Extend `legacy_new_rerender` narrowly or wrap it with explicit anonymous
  username state. Retain submitted username, subject, body, metadata, date, security, and editor;
  emit an empty password. The current `formdata_from_legacy` maps entry fields but has no username
  mapping (`DW::Entry::Legacy:267-342`).
- Use the native success response only after `_do_post` succeeds. A rejected native save must return
  the shared native retry and must never fall through to retained BML for a second attempt.

## Finite regression cases

Use a disposable individual and actual retained rendered form; invoke the callable helper directly,
without registering a route.

1. Correct username/password, owner-only ordinary post: exactly one entry; exact subject/body,
   security, date, tags/location/music/userpic/editor properties; decoded flat request identity and
   seed visible to spam/success hooks; save-attempt -> spam -> housekeeping -> success-hook order.
2. Success with `event_format` on and then off: fresh poster `disable_auto_formatting` becomes the
   submitted value. Seed `entry_draft`, `draft_properties`, `entry_editor`, and `entry_editor2` with
   distinct sentinels and prove all remain unchanged because session remote is absent. Prove no
   crosspost scheduler call.
3. Empty password and wrong password: callable returns `undef` before decoder/save/spam/success
   hooks and leaves all state unchanged. Retained full-app fallback characterization separately
   proves exact useful errors, username/subject/body retention, blank password, and the distinct
   wrong-password decode/post-attempt/spam-hook behavior. Use distinct pre-failure formatting/editor
   sentinels so a mistaken write cannot pass.
4. Empty body with valid credentials: no entry; exact `Must provide entry text.` once; decoder and
   legacy post-attempt spam hook each once with the same flat request; retained username/subject and
   metadata; blank password.
5. Backend validation failure after valid authentication (for example invalid date): no entry;
   decoder and post-attempt spam hook once; native retry retains username and raw invalid fields;
   no housekeeping/success hooks.
6. Unsupported action, nonempty `usejournal`, session remote, transform, preview, spellcheck,
   showform, and challenge-only credentials: return `undef` before decoder/auth/save/hook effects.
7. Sequential wrong-password then valid-password requests for different disposable users prove no
   request/auth/username leakage. Native handler without the opt-in remains unchanged.

## Explicitly deferred

Public `/update` dispatch, anonymous community posting, alternate-login/challenge authentication,
and any authentication-policy change remain separate gates.

## Callable browser and native retry boundary

The callable attempt and error rendering must preserve the nonempty draft and
editor sentinels described above. A subsequent corrected submission to the rendered
`/entry/new` action is a separate, ordinary native post: existing `_do_post` clears
`entry_draft` and `draft_properties`, and `_persist_props` stores displaydate behavior.
The browser must assert these stages separately with fresh reads. Do not require
unchanged drafts after native retry, seed empty drafts to make that assertion pass,
or change native housekeeping as part of this package. Username/password controls
and the modal submission should retain their existing native contract; submitted
passwords must not appear in logged evidence or error-page markup.

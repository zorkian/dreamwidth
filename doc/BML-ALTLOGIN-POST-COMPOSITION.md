# Retained alternate-login `/update` POST composition audit

Source-only handoff, 2026-09-23. No request, credential, authentication,
protocol, external-page, or deployment operation was performed.

## Scope and sources

This compares the retained alternate-login POST branch in `htdocs/update.bml`
with the callable native-form presentation in
`DW::Controller::Entry::legacy_update_altlogin_get_handler` and shared
`views/entry/form.tt`. It does not authorize public GET activation or any POST
adapter.

Primary source points: `htdocs/update.bml:98-185, 271-463, 604-660`,
`cgi-bin/DW/Controller/Entry.pm:_auth,_do_post,legacy_update_*`,
`cgi-bin/DW/Entry/Legacy.pm:decode_entry_form,prepare_entry_form`, and
`doc/BML-UPDATE-ALTLOGIN-GET.md`.

## Retained alternate-login POST behavior

The retained form posts legacy fields to `update?altlogin=1`. Its normal-save
guard is `did_post`, no transform/spellcheck/showform/preview/more-options,
and the retained form-auth condition. `action:update` is emitted but is not the
sole server-side save switch.

1. `remote` remains the session user. `user_is_remote` is true only when posted
   `user` equals `remote->user`.
2. With a nonempty posted `user` different from the session remote and GET
   `altlogin`, retained code loads that posted user and calls
   `LJ::auth_okay($u, $POST{password})`. A successful result supplies protocol
   `noauth` flags for that actor. If posted user equals remote, the referer path
   supplies remote/noauth flags instead.
3. A nonempty wrong password is not an early return: the code records an auth
   error, still runs protocol `login`, then builds/decode a `postevent` request,
   invokes protocol post, and invokes `spam_check`. Empty password is distinct:
   `auth_missing` causes the form rerender before this sequence. The existing
   test-only anonymous baseline confirms this family of retained sequencing but
   does not establish alternate-login actor/session differences.
4. The retained login seed is exactly `mode=login, ver, clientversion, user`.
   The post seed is `mode=postevent, ver, user, password, usejournal, tz=guess,
   xpost=0`; `LJ::entry_form_decode` mutates that same flat protocol hash once,
   then `LJ::do_request` and `spam_check($u, \%req, 'entry')` run.
5. Top-level `response` only suppresses the missing-password form predicate;
   neither it nor top-level `chal` is seeded into login/postevent by this page.
   Per-account `prop_xpost_chal_*`/`resp_*` are separate crosspost fields, not
   poster authentication. No challenge behavior should be invented.

## Actor, state, and crosspost distinction

| Concern | Retained source behavior | Consequence for a future adapter |
| --- | --- | --- |
| Protocol actor | Posted different `user` becomes `$u`/protocol `user`; session `remote` remains distinct. | Keep both identities explicitly; do not overwrite request remote with credential actor. |
| Target | `postevent.usejournal` comes from posted legacy `usejournal`. | Preserve this raw legacy value through target validation; do not infer `post_as`/`postas_usejournal`. |
| Session defaults | The form and `update_fields` context use the session remote. | Rendering and hooks must still receive remote-owned editor/draft/default state. |
| Success housekeeping | Successful update writes `disable_auto_formatting` on `$u`; clears draft and updates legacy editor preference on session `remote` (subject to `always_*`). | Test actor and remote properties independently when they differ. |
| Success format/hooks | Retained BML success uses protocol result, legacy links, and after-post hooks with the decoded flat `%req`. | The reviewed native legacy-success path may be reusable only when it is passed that same flat request/actor/target context. |
| Crosspost | Retained schedules only when resolved journal `$ju == $remote` and raw `prop_xpost_check` is set. For a different altlogin actor this is normally false. | The callable GET renderer correctly suppresses account enumeration/component. A POST continuation must retain the success-side predicate; it must not re-enable native crosspost merely because canonical data has selections. |

## Native-form boundary

The callable form deliberately has the visible legacy-auth `user` and blank
`password` fields plus `action:update`, but the rest is native schema:

| Retained POST surface | Callable native rendering | Required explicit conversion later |
| --- | --- | --- |
| `user` | `user` only in opt-in credential presentation | Map to credential actor deliberately; native `_auth` otherwise reads `username`. |
| `password` | blank legacy-visible password | Keep blank on every retry; do not trust GET/query values. |
| `usejournal` | native form target field | Preserve its legacy target semantics, not anonymous `post_as`/`postas_usejournal`. |
| `action:update`, `submit_value` | action:update buttons only | Run retained action classification first; do not direct-alias to `new_handler`. |
| old `richtext_default`, `switched_rte_on`, `event_format`, `prop_*` | native `editor`, nested controls, `taglist`, native component fields | These are different schemas. Only a retained old-schema continuation may prepare the original flat POST through `DW::Entry::Legacy::prepare_entry_form`; a native-form continuation needs its own explicit parsing/mapping contract. |
| raw `prop_xpost_*` | no crosspost module in altlogin callable render | Preserve raw callback/predicate only at a later success boundary; do not expose or synthesize selection UI. |

Therefore the current `action:update` form cannot be safely sent to retained BML
or a native handler unchanged: each expects a different combination of flat
legacy and native field names. There are two separate possible continuations:

1. **Retained old-schema continuation.** It accepts an actually retained legacy
   form POST, classifies retained actions, and may call
   `DW::Entry::Legacy::prepare_entry_form` once while retaining the original
   flat reference plus canonical decoded data.
2. **Callable native-form continuation.** It accepts the new native TT form
   produced by the GET seam. It must define an explicit native schema parser
   and map `user`/credential actor, action:update, target, editor, security,
   date and metadata deliberately. Feeding that native POST directly to the
   legacy decoder is not parity and is not established by this audit.

Neither path is registered. Both remain blocked on actor/session, failure
sequencing, and retry-schema characterization.

## Finite later characterization/implementation tests

Use both aliases, a disposable session remote A and disposable credential actor
B, local protocol/hook stubs, and no external transport. These are gates, not
new product decisions.

1. Parse a real retained alternate-login form and a callable native form; record
   all field names/values for action, user/password, target, editor/RTE,
   security/custom bits, metadata, dates, comments/adult, and raw xpost fields.
2. Session remote A posting as A versus B: assert exact `auth_okay`, protocol
   login/decode/postevent/spam order; ensure the same decoded request reference
   reaches protocol, spam, and legacy success hooks.
3. Successful B actor: force-fresh entry content/security/date and separately
   inspect A/B `disable_auto_formatting`, draft, `entry_editor`, and
   `entry_editor2` values. Assert no crosspost scheduling when journal resolves
   to a non-remote actor/target.
4. Empty password, wrong nonempty password, and protocol-login failure: record
   actual retained response/retry behavior, blank password, count/order, and
   state. Do not make fallback re-run auth/login/decode/spam.
5. Same/different posted target, readonly/denied target, transforms, preview,
   spellcheck, showform, more options, and invalid CSRF: retain BML until each
   classified branch is explicitly owned; no decoder/protocol/hook work for
   unsupported actions.
6. Error retry: prove the modern rerender has a native-accepted action/schema,
   retains submitted old fields, hides password, preserves raw encoded/repeated
   query context, and does not turn a correction POST into a duplicate entry.
7. Sequential A/B and request/no-request calls: no credential actor, target,
   raw request, or draft/editor state leaks.

## Known facts and unresolved source facts

- Established: password-based retained `auth_okay`; no retained top-level
  challenge forwarding; actor/session distinction; protocol and spam ordering;
  legacy success/draft/editor/crosspost branches above.
- Unresolved by source alone: exact rendered retry/success parity for different
  actor versus session remote, protocol-login failure body/state, and the
  full old-to-native retry schema. These require the narrow later tests above,
  not a policy choice and not a schema guess.
- Excluded: public routing/activation, credential submission, anonymous
  composition, alternate-login authorization changes, share fetches, inbox,
  reporting, and deployment hooks.

# Anonymous `/update` POST schema audit

Date: 2026-09-23

## Scope

Read-only source audit only. No request, credential, permission, protocol, share, or
message operation was executed. This is a design handoff, not authorization to activate
anonymous `/update` GET or POST handling.

Sources examined:

- `htdocs/update.bml:98-351, 430-666`
- `cgi-bin/LJ/Web.pm:1732-1843, 2144-2146` (`LJ::entry_form`, decoder forwarding API)
- `cgi-bin/DW/Entry/Legacy.pm:27-151, 202-218` (actual decoder and crosspost mapping)
- `cgi-bin/DW/Controller/Entry.pm:121-284, 1640-1705` (native form and `_auth`)
- `cgi-bin/LJ/Protocol.pm:3649-3700, 3442-3469` (protocol dispatch and challenge helper)
- `views/entry/form.tt`, `views/entry/login.tt`, `views/entry/module-journal.tt`

## Retained anonymous update contract

The retained form is `POST update[?altlogin=1]` (`htdocs/update.bml:187-265`). It
always emits `lj_form_auth`, but for an anonymous submission the retained guard is
`!$remote || check_form_auth`, so the token is not the sole anonymous authentication
mechanism (`:271`). Its visible login fields are:

| Purpose | Retained field/source | Retained behavior established by source |
|---|---|---|
| poster credential | `user` | visible `altlogin_username`; value is `POST user || GET user` (`:172-175`) |
| password | `password` | visible, deliberately never prefilled (`:176-184`) |
| target | `usejournal` | carried in the entry form and initial `postevent` seed (`:205-206`, `:342-349`) |
| top-level `response` | no visible base control established here | only suppresses the missing-password rerender predicate (`:122-125`) |
| form challenge | `lj_form_auth` | emitted with the form (`:262-265`) |
| crosspost challenge | `prop_xpost_chal_<id>`, `prop_xpost_resp_<id>` | emitted only for configured external accounts (`LJ::Web.pm:1737-1739`) |

The old submit surface has a hidden `action:update` for enter/JS submissions and a
`submit_value` shadow field (`LJ::Web.pm:1796-1807`); preview is a JavaScript button,
and spellcheck is `action:spellcheck` when configured (`:1809-1832`). The BML handler
classifies `action:preview`, `action:spellcheck`, `showform`, `moreoptsbtn`, and
transforms before save (`update.bml:119-155, 271-351`).

Before its protocol post, retained anonymous update:

1. resolves submitted `user` and `password`, with `altlogin` affecting whether a
   remote identity may be used (`update.bml:120-134, 280-295`);
2. creates the login seed with only `mode`, `ver`, `clientversion`, and `user`
   (`:313-323`);
3. creates the `postevent` seed with `mode`, `ver`, `user`, `password`,
   `usejournal`, `tz`, and `xpost`, then calls `LJ::entry_form_decode`
   (`:342-351`);
4. invokes `LJ::do_request`, then the legacy `spam_check` hook, including the
   empty-body error path (`:352-361`);
5. renders retained BML login/protocol/success content, including legacy success
   links and optional crosspost results (`:363-463`).

## Authentication-field evidence

This table distinguishes fields that are merely read somewhere from fields actually
forwarded by this retained handler. `response` suppressing a rerender is not evidence
of challenge authentication support.

| Field | Retained update handler evidence | Decoder / seed evidence | Native `_auth` evidence |
|---|---|---|---|
| `user` | read for login identity and `auth_okay` branch | copied into both login and `postevent` seeds | native equivalent name is `username` |
| `password` | passed to `LJ::auth_okay` and the `postevent` seed | not added by the decoder; explicitly present in the seed | passed to `LJ::auth_okay` |
| top-level `response` | used only in `auth_missing` (`!$POST{response}`) | absent from login and `postevent` seeds; `decode_entry_form` does not copy it | copied into a local `%auth`, but not used by the shown authorization condition |
| top-level `chal` | no retained update field, seed, or decoder mapping found | absent from both seeds; `decode_entry_form` does not copy it | copied into local `%auth`, but not used by the shown authorization condition |
| `prop_xpost_chal_*` / `prop_xpost_resp_*` | distinct external-account controls/results | deliberately retained by the legacy canonical crosspost map | consumed by crosspost queueing, not anonymous poster authentication |

`LJ::Protocol` has a deprecated challenge validator for request fields named
`auth_challenge` / `auth_response` (`LJ::Protocol.pm:3442-3469`). That does not alter
the retained update conclusion: this handler seeds neither top-level `chal`/`response`
nor protocol `auth_challenge`/`auth_response` into its login or `postevent` requests.
The decoder’s only challenge-like mapping is the separate per-external-account
crosspost data above.

Therefore the observed retained path is password-based `auth_okay` plus its protocol
request seeds. Whether any upstream client, middleware, or an unexamined retained
branch produces another authentication shape is a characterization gap, not an
adapter requirement or product decision.

## Native `/entry/new` schema and response differences

Native `new_handler` receives a `Hash::MultiValue` POST and uses:

| Purpose | Native field/source | Difference from retained |
|---|---|---|
| poster credential | `username` | `_auth` authenticates its shown anonymous branch with `username` and `password`; it only copies `chal`/`response` into a local hash (`Entry.pm:1664-1705`) |
| password | `password` | native login modal has a password control; still blank on initial render |
| target | `usejournal` | native `_auth` selects the journal from it after successful identity handling |
| alternate target field | `postas_usejournal` | rendered by `module-journal.tt` only when there is no resolved journal; it is not the anonymous retained-form target contract |
| posting selector | `post_as` | native anonymous journal module emits hidden `post_as=other`; retained update does not use it for anonymous protocol selection |
| form challenge | `lj_form_auth` | native accepts the posted value, but uses the same `!$remote || check_form_auth` condition (`Entry.pm:203-219`) |
| editor | `editor` (`rte0`, `html_raw0`, `html_casual1`) | retained uses `richtext_default`, `switched_rte_on`, and `event_format` as part of its old form/decoder behavior |
| save/preview/spellcheck | `action:post`, `action:preview`, `action:spellcheck` | differs from retained `action:update`/`submit_value` surface |

The native anonymous login controls live in `views/entry/login.tt`: hidden empty
`username/password` fields plus a closed modal with the visible fields. `formdata`
can prefill the native visible `username`; it must not prefill the password. The
existing callable renderer proves retained GET `user` is read *after* `update_fields`,
while subject/event/tag are pre-hook snapshots. That is render parity only, not an
authorization decision.

The native renderer sets `#js-post-entry` to a caller-supplied action and emits
Foundation/TT errors. Retained update returns BML form/error/success markup. A future
adapter must not claim response equivalence merely because it can reuse the native
form renderer.

## Finite source action-classification contract

This is a source contract for a later adapter; it neither invokes actions nor chooses
authentication behavior.

| Retained condition/order | Source result to preserve or characterize |
|---|---|
| `transform` truthy | `did_post` is false before normal save classification; the transform hook path rerenders rather than enters the decoder/post pipeline |
| `showform` truthy or `auth_missing` | form rerender path; `auth_missing` is the password/remote/`response` predicate only, not challenge authentication |
| `action:preview` truthy | marks preview and excludes normal save in the final guard |
| `action:spellcheck` with configured `$LJ::SPELLER` | checker branch marks `did_spellcheck` and excludes normal save; configured/unavailable behavior must be characterized separately |
| `moreoptsbtn` truthy | excludes normal save in the final guard |
| normal post | requires `did_post`, no transform/spellcheck/showform/preview, valid form-auth condition, and no `moreoptsbtn`; `action:update` is emitted by the form but is not itself the final save predicate |
| `submit_value` | form shadow control; source audit does not establish a generic server-side action interpretation, so a future adapter must whitelist any synthetic mapping rather than treat arbitrary values as actions |

The finite later tests should parse real old controls and cover each row’s
classification, retained field preservation, and zero decoder/protocol/hook work on
nonpersisting rows. They should not infer any top-level challenge behavior from
`response` or crosspost challenge fields.

## Exact adapter boundary proposed for later review

A future anonymous POST adapter should be a distinct, explicit boundary, not an alias
from `/update` to `new_handler`:

```
legacy flat POST/GET
  -> legacy scalar/repeated-value conversion (NUL join preserved)
  -> explicit anonymous schema adapter
       user -> username
       password -> password
       submitted usejournal -> usejournal
       preserve lj_form_auth separately
       do not synthesize top-level chal/response
  -> legacy decoder/preparation once where the classified path actually uses it
  -> native Hash::MultiValue only after action/auth classification
```

Required constraints for that adapter:

- Preserve the flat original request for legacy hook/reference consumers; do not
  mutate it to native keys in place.
- Treat `user -> username` as an explicit one-way field map. Do **not** infer an
  `altlogin`, `post_as`, or `postas_usejournal` conversion from a missing field.
- Preserve `submit_value`/`action:update` classification before deciding whether to
  invoke a save, preview, spellcheck, or rerender pipeline.
- Preserve submitted `usejournal` exactly for the post/auth boundary; target choice
  must not silently fall back to a GET value or a posting owner.
- Preserve the legacy decoder’s rich-text, date/time, metadata, security, and
  crosspost input semantics through reviewed `DW::Entry::Legacy` preparation helpers.
  `formdata_from_legacy` is a retry renderer mapper, not an anonymous authentication
  adapter.
- Leave password blank in every GET/error rerender. No draft contract is established
  for an unauthenticated user: retained draft persistence is remote-only
  (`update.bml:604-660`), and native anonymous rendering likewise has no authenticated
  draft owner.
- Keep a caller-selected native action URL. The current anonymous renderer’s action is
  deliberately an unresolved activation parameter, not `/update` registration.

## Finite gates before any activation

1. **Action equivalence:** parse a retained anonymous form and establish the finite
   source table above with real controls and no generic `submit_value` interpretation.
2. **Authentication data-flow characterization:** if a future assignment needs it,
   trace only actual producers/consumers of retained anonymous credentials and the
   permitted test strategy. Current source establishes password `auth_okay` and no
   top-level `chal`/`response` forwarding; it does not establish additional support.
3. **Target mapping:** establish how a retained anonymous `usejournal` maps to native
   target rendering and whether a target is allowed without a remote user. Do not infer
   `post_as`/`postas_usejournal` behavior.
4. **Form-token behavior:** characterize retained `lj_form_auth` versus native
   validation using approved product ownership/security review; field-name similarity
   is insufficient.
5. **Response parity:** characterize login failures, protocol failures, empty body,
   preview/spellcheck, successful post response, moderation, crosspost scheduling,
   and legacy after-post hooks.
6. **Round-trip fields:** establish a parsed-form matrix for user, blank password,
   usejournal, editor/RTE, date/backdate, security/custom bits, metadata, comments,
   adult flags, and crosspost challenge fields. Include repeated raw POST values.
7. **Draft/editor:** demonstrate intended anonymous behavior explicitly. Existing
   remote-only draft/editor tests cannot establish anonymous persistence parity.

Items 2-7 are evidence/compatibility gates. Unknowns stay unknown until a bounded
assignment characterizes them; this audit does not request a new product choice.

## Existing test coverage and gaps

Already useful, but not anonymous POST authorization coverage:

- `t/legacy-update-anonymous-get.t` and
  `t/browser/update-anonymous-get.js`: callable anonymous **GET** rendering only;
  title, escaping, target display, RTE, sequential request scope, and nonmutation.
- `t/legacy-update-get-render.t`, `t/legacy-update-get-handler.t`, and
  `t/plack-update-get-activation.t`: authenticated/readonly/terminal GET seams.
- `t/plack-entry-legacy-update-adapter.t`, `t/plack-entry-legacy-update.t`, and
  `t/plack-entry-update-activation.t`: reviewed owner/community legacy POST subsets;
  these deliberately exclude anonymous credentials.
- `t/plack-editor-spellcheck-baseline.t`: retained form spellcheck rendering contract,
  not anonymous authentication.
- `t/captcha-trusted-anon.t` and `t/post.t`: general anonymous/protocol-related
  behavior, not a retained `/update` form-to-native adapter.

No current test in this inventory proves an anonymous retained `/update` POST can be
safely authenticated, posted, or receive a response through native `/entry/new`.

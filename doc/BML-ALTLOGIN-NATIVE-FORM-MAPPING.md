# Native alternate-login TT POST mapping prerequisite

Audit date: 2026-09-23.  This is source-only design work.  It changes no
route, controller, authentication behavior, request, hook, or production
template.

## Scope and sources

This records the missing mapping boundary between the already-reviewed
callable alternate-login GET renderer and any eventual POST continuation.
Sources inspected:

- `views/entry/form.tt`, `views/entry/login.tt`, and the included entry modules
- `DW::Controller::Entry::legacy_update_altlogin_get_handler`, `_render_new_form`,
  `_auth`, and `_do_post`
- `DW::Entry::_form_to_backend`
- `DW::Entry::Legacy::{legacy_post_hash,decode_entry_form,prepare_entry_form}`
- retained `htdocs/update.bml` behavior as characterized by
  `t/plack-update-altlogin-post-baseline.t` (accepted baseline `9718f68c`)
- `/tmp/bml-altlogin-post-composition.md`

The callable GET form has an explicit action of `/update?altlogin=1`, two
`action:update` submit controls, and the opt-in `legacy_altlogin` presentation.
It is not a retained-schema form merely because its action and submit name are
legacy-compatible.

## Actual callable TT submission surface

The following names are emitted by the shared native form when the callable
alternate-login renderer is used.  Module fields are conditional on the normal
remote/journal feature and panel rules; they are not invented alternate-login
controls.

| Native TT name | Meaning / source | Canonical destination already defined by native parser |
| --- | --- | --- |
| `lj_form_auth`, `nojs` | native form token and JS capability | token must be checked before any future actor authentication or preparation; `nojs` participates in date trust |
| `user`, `password` | `entry/login.tt` legacy-altlogin presentation | **not consumed by native `_auth`**; `user` is the credential-actor name, password is credential material and is deliberately blank on all GET/retry renders |
| `subject`, `event`, `editor` | shared subject/body/editor controls | canonical `subject`, `event`; `props.editor` and `props.opt_preformatted=0` through native `_form_to_backend` |
| `action:update` (two), `action:preview`, conditionally `action:spellcheck` | submit buttons in `entry/form.tt` | only `action:update` belongs to the eventual save slice; preview/spellcheck remain independently classified/nonpersisting seams |
| `security`, repeated `custom_bit` | quick selector and access component | `security` plus `allowmask`; native custom bits are repeated values (`Hash::MultiValue->get_all`) |
| `usejournal`, hidden `poster_remote` | native journal selector / session marker | submitted target is `usejournal`; `poster_remote` is presentation state for session remote A, never authority for credential actor B |
| `taglist` | tags component | `props.taglist` |
| `prop_picture_keyword` | icon component | `props.picture_keyword` |
| `current_mood`, `current_mood_other`, `current_music`, `current_location` | currents component | `current_moodid`/`current_mood`, `current_music`, `current_location` respectively |
| `entrytime_date`, `entrytime_time`, `trust_datetime`, `update_displaydate`, `entrytime_outoforder` | display-date component | protocol date fields only when trusted/no-JS; `update_displaydate`; `props.opt_backdated` |
| `comment_settings`, `opt_screening` | comments component | `opt_nocomments`, `opt_noemail`, `opt_screening` props |
| `age_restriction`, `age_restriction_reason` | adult-content component | `adult_content`, `adult_content_reason` props when enabled |
| `entry_slug` | slug component | canonical `slug` |
| `sticky_entry`, `sticky_select`, `flags_adminpost` | journal-management components when eligible | canonical sticky/admin-post fields |

Not emitted in this callable alternate-login presentation:

- normal native `username`, `post_as`, and `postas_usejournal` controls;
- native crosspost controls (`crosspost_entry`, repeated `crosspost`, and
  `crosspost_password_*`/`chal`/`resp`), because `legacy_altlogin` suppresses
  the crosspost component and account enumeration;
- retained old names such as `event_format`, `richtext_default`,
  `switched_rte_on`, `date_ymd`, `hour`, `min`, `prop_taglist`,
  `prop_current_*`, and `custom_bit_1` through `custom_bit_60`.

`draft_properties` and the draft body are RPC/autosave state, not ordinary
form fields.  A future POST adapter must not infer a draft mutation from their
absence in this form.

## Required two-representation mapper

The smallest safe implementation seam is a private pure helper in
`DW::Entry::Legacy` (or a narrowly named sibling) with an API equivalent to:

```
prepare_altlogin_native_form($native_hmv, legacy_seed => \%seed)
  -> {
       action           => 'update' | undef,
       credential       => { username => $native_hmv->{user}, password => ... },
       canonical        => $native_form_req,
       native_post      => $native_hmv,
       legacy_request => $flat_legacy_request,
     }
```

This helper is intentionally pure: it does not call `auth_okay`, load a user,
resolve a journal, run protocol, run hooks, save, clear drafts, or register a
route. Its caller supplies the already-authorized protocol seed (including the
credential actor and resolved target). An eventual handler owns token/referer
ordering, actor authentication, target authorization, hook ordering, and
error/retry rendering.

### Output A: canonical native request

Build this using the native web mapping (`DW::Entry::_form_to_backend(0, ...)`)
against a new request hash and the original `Hash::MultiValue` object. This
preserves repeated `custom_bit` via `get_all`, applies the native editor/date/
adult/comment/mood rules, and keeps native `prop_picture_keyword` intentionally
native. In particular, `props.editor` remains canonical; it is not translated
to retained `prop_used_rte`, `prop_opt_preformatted`, `event_format`, or
`switched_rte_on`. Those raw legacy display/housekeeping inputs are needed only
where a separately reviewed compatibility caller explicitly uses them.

This path must not call `DW::Entry::Legacy::prepare_entry_form`: that decoder
expects the old names listed above and would silently default or misread this
form.

The action classifier must accept an actual `action:update` only.  Preview,
spellcheck, save-draft, delete, empty/no action, and unknown actions return a
non-save classification without invoking any mapper with persistence meaning.

### Output B: retained hook-compatible flat snapshot

The future compatibility hook path needs a flat snapshot distinct from output A.
This is not the native save request: existing `_save_new_entry` consumes canonical
data, including the native editor property. No flat save path is introduced. Start with
the explicit caller seed only after the caller has established the credential
actor and target. Its known retained fields are:

```
mode=postevent, ver=$LJ::PROTOCOL_VER,
user=<credential actor B>, password=<submitted password>,
usejournal=<validated submitted target>, tz=guess, xpost=0
```

Then explicitly flatten the known canonical result into that new hash:

| Canonical result | Flat protocol request field |
| --- | --- |
| `subject`, `event`, `security`, `allowmask`, `year`, `mon`, `day`, `hour`, `min`, `slug` | same field name |
| `props.taglist`, `picture_keyword`, `current_moodid`, `current_mood`, `current_music`, `current_location` | `prop_taglist`, `prop_picture_keyword`, `prop_current_moodid`, `prop_current_mood`, `prop_current_music`, `prop_current_location` |
| `props.opt_backdated`, `opt_screening`, `opt_nocomments`, `opt_noemail`, `adult_content`, `adult_content_reason`, `admin_post` | corresponding `prop_opt_backdated`, `prop_opt_screening`, `prop_opt_nocomments`, `prop_opt_noemail`, `prop_adult_content`, `prop_adult_content_reason`, `prop_admin_post` |
| native display-date and sticky output | same protocol request fields where `_form_to_backend` produced them (`update_displaydate`, `sticky_entry`, `sticky_select`) |

This is an explicit field table, not a generic `props` flattener. It excludes
`props.editor`: native editor selection is canonical-only. It also excludes
raw `custom_bit_N`: old decoded request uses `security`/`allowmask`; numbered
custom bits exist only in the **first raw POST argument** delivered to
`decode_entry_form` hooks. The mapper must never invent numbered fields in the
decoded/protocol request.

The flat protocol hash is separate from canonical data and the original native
HMV. Mutating any one must not alter either of the others.

## Decode-hook synchronization remains unresolved

Retained `decode_entry_form` hooks receive `( $raw_post, $decoded_request )`:
the first argument is the old raw flat POST (and is where `custom_bit_N` is
visible), while the second is the request that subsequently reaches protocol,
spam, and success hooks. A native-form continuation cannot claim that ABI by
passing the native HMV directly, nor by copying canonical data only after a
hook has run.

The smallest mapper above deliberately does **not** run that hook. A later
separate design must decide, with characterization, whether to provide a
purpose-built legacy-shaped raw hook POST plus the same mutable
`legacy_request`, and exactly when mutations synchronize into canonical data
before save. Until that contract is tested, a native alternate-login handler
must not invoke `decode_entry_form` hooks or claim legacy success-hook parity.

## Identity and housekeeping boundary

The retained successful alternate-login baseline establishes session remote A
and credential actor B as independent identities:

- A remains the request remote and owns GET defaults, form/editor state,
  `update_fields` context, and the hidden `poster_remote` marker.
- `user`/`password` identify B for retained authentication and protocol actor
  selection.  A future native continuation cannot hand `user` to `_auth`,
  because `_auth` reads `username` and treats a present remote as its referer
  branch.
- The successful retained path clears A's `entry_draft`; it leaves A's frozen
  `draft_properties` and legacy editor props intact in the characterized case.
  B receives the posted entry and formatting side effect.  Those observed
  housekeeping effects must remain handler-level tests, not mapper side
  effects.
- Crosspost remains suppressed for this alternate-login native presentation;
  no account enumeration or synthetic native selection is permitted.

## Finite pure-mapper tests required before any POST continuation

1. Parse an actual callable TT form and assert this complete emitted-name set,
   including two `action:update` controls, blank `password`, `user`, native
   `usejournal`, native `editor`, and absence of normal-login/crosspost names.
2. Given a synthetic `Hash::MultiValue`, prove native canonical conversion for
   subject/body/editor, private/access/custom security with repeated custom
   bits, tags, icon/currents, dates/backdating, comments, adult content, slug,
   and sticky fields.  Assert the HMV remains byte/value-identical afterward.
3. Classify only `action:update` as a save candidate; direct preview,
   spellcheck, missing/empty/unknown action must not create a canonical or hook
   preparation result.
4. Build canonical and protocol outputs with distinct references: modifying
   canonical props cannot alter the flat protocol request, and vice versa.
   Preserve session remote A separately from credential name B without calling
   auth.
5. Cover explicit-empty versus absent native fields exactly where the existing
   native parser distinguishes them. Repeated `custom_bit` must retain every
   value; no scalar-HMV shortcut is parity.
6. Assert the explicit flattening table above, including that canonical editor
   stays out of the flat legacy request and that no raw `custom_bit_N` is
   synthesized. The decode-hook synchronization decision is a separate
   characterization gate, not a generic unsupported-controls framework.

## Explicit unhandled controls / activation gates

Before public alternate-login GET or POST activation, review must resolve:

1. decode-hook raw-POST and decoded-request synchronization before save;
2. a native retry contract for credential errors that preserves native controls
   yet keeps password blank and never routes the form into retained BML;
3. token/referer/auth ordering for B versus session A, including wrong and
   empty password behavior already characterized in the retained baseline;
4. the deliberately absent crosspost schema and retained success predicate.

These are compatibility characterization gaps, not new product decisions.
No public route, authentication implementation, or shared `_do_post` change is
recommended by this audit.

## Foreman implementation boundary

The assigned prerequisite is unused and side-effect-free: no decoder, external
hook, authentication, user lookup, save, or route registration. Its flat output
is named `legacy_request` to avoid implying it can replace the canonical native
save request. Trusted native date conversion must preserve removal of seed `tz`,
not restore `guess` when copying the flat snapshot. Native editor remains in
canonical data without invented legacy RTE/preformat flags. Crosspost controls
remain unsupported in this alternate-login-only mapping. Raw hook input and
hook-mutation synchronization remain a separate gate before any handler use.

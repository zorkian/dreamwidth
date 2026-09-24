# Native altlogin decode-hook synchronization handoff

Source checkpoint: `03fb92456`. This is a source-only design. It adds no route, auth, request, hook execution, save, or deployment-interface decision.

## Current disposition after characterization and pure delta review

The known-field-only synchronization proposal below is historical and is not
an implementation contract. Accepted characterization `37e6fb87` proves that
arbitrary second-argument top-level and `prop_*` additions, changes, and deletions
reach canonical data. Accepted unused helper `05d595f1` preserves those observed
deltas while retaining canonical-only properties absent from both snapshots.
Do not add a known-field filter that silently discards extension mutations.

A future caller must capture deeply independent, serializable before/after
snapshots to use that helper. Scalar-only or shared-reference snapshots cannot
prove nested mutation history. Native editor/date trust reconciliation and the
purpose-shaped raw first argument remain separate composition prerequisites;
the unused mapper and delta helper do not themselves invoke a hook or authorize
public activation. The earlier field table remains useful as an inventory only.

## Existing ABI and invariant

`DW::Entry::Legacy::decode_entry_form` runs `decode_entry_form($raw_post, $decoded_request)` only after it has decoded the retained form. The first argument is the old form-shaped input. The second argument is the mutable flat protocol request; that same flat reference later reaches retained spam and success hooks. Mutating the first argument after decode has no automatic persistence effect.

The native TT mapper must continue to call `DW::Entry::_form_to_backend(0, ...)` on the original `Hash::MultiValue`. It must not feed native fields to `decode_entry_form`. Native repeated `custom_bit`, editor validation, property construction, date trust, and `tz` deletion remain authoritative.

## Smallest later seam

Add one private known-field preparation step after the existing pure native mapper and before any save:

```
apply_altlogin_decode_hook($prepared)
  # prepared contains native_post, canonical, legacy_request
```

The helper would:

1. Build a new purpose-shaped legacy raw hash from `native_post`. Do not mutate or flatten the HMV in place.
2. Snapshot existence and scalar values in `legacy_request`.
3. Invoke `decode_entry_form($legacy_raw, $legacy_request)` exactly once. The second argument is the existing mutable flat object, not a clone.
4. Apply the supported post-hook delta from that flat object into `canonical` using the explicit table below.
5. Return the same prepared structure. The mutated flat reference remains available to later spam/success hooks; native save consumes only synchronized canonical data.

This helper does not authenticate, load users, resolve journals, check tokens, save, rerender, or run any hook other than the explicitly requested decode hook.

## First argument: legacy raw input shape

Copy/map only fields whose raw retained equivalents are defined:

- Transport/context: `lj_form_auth`, `nojs`, `user`, `password`, `usejournal`, `subject`, `event`, and actual `action:update`.
- Security: native `private`/`public` remain the same; native `access` becomes retained raw `friends`; native `custom` becomes raw `custom` plus one `custom_bit_N=1` for every repeated native `custom_bit=N`.
- Metadata: `taglist -> prop_taglist`; `prop_picture_keyword` unchanged; native mood/music/location fields become `prop_current_moodid`, `prop_current_mood`, `prop_current_music`, and `prop_current_location`.
- Comments/adult/admin: preserve `comment_settings`; map `opt_screening -> prop_opt_screening`, `entrytime_outoforder -> prop_opt_backdated`, `flags_adminpost -> prop_admin_post`; map native adult values `none/discretion/restricted` to retained `none/concepts/explicit` plus `prop_adult_content_reason`.
- Date observation only: split `entrytime_date` into `date_ymd_yyyy/mm/dd` and `entrytime_time` into `hour/min`; expose `date_diff_nojs` for native `nojs` and `date_diff` for native `trust_datetime`. These raw values do not drive native date decoding.
- Slug/sticky/display fields may be copied under their protocol-equivalent names when the retained raw form had that name.

Do not pass the native HMV itself. Do not synthesize raw `event_format`, `switched_rte_on`, `prop_used_rte`, or `prop_opt_preformatted` from native `editor`: modern formats have no faithful retained encoding. Do not synthesize native crosspost controls, which are absent from altlogin presentation.

Mutations to this raw first argument are not reapplied. That matches retained ordering: the decoder had already consumed raw input before the hook ran.

## Second argument and canonical synchronization

The mapper's pre-hook `legacy_request` already contains the explicit flat projection. Preserve its object identity. Detect hook changes by both existence and value, including deletion and explicit empty string.

For changed supported keys only:

- Direct canonical keys: `subject`, `event`, `security`, `allowmask`, `slug`, `update_displaydate`, `sticky_entry`, `sticky_select`.
- Flat property mapping into the existing `canonical->{props}` hash:
  - `prop_taglist -> taglist`
  - `prop_picture_keyword -> picture_keyword`
  - `prop_current_moodid -> current_moodid`
  - `prop_current_mood -> current_mood`
  - `prop_current_music -> current_music`
  - `prop_current_location -> current_location`
  - `prop_opt_backdated -> opt_backdated`
  - `prop_opt_screening -> opt_screening`
  - `prop_opt_nocomments -> opt_nocomments`
  - `prop_opt_noemail -> opt_noemail`
  - `prop_adult_content -> adult_content`
  - `prop_adult_content_reason -> adult_content_reason`
  - `prop_admin_post -> admin_post`

Never replace the whole props hash. Preserve `props.editor`, `props.opt_preformatted`, and every canonical-only property. Ignore hook changes to retained editor fields for canonical persistence; leave them in the flat request for later hook observation.

Treat native date trust as a structural invariant:

- If canonical mapping trusted the date, it already has `year/mon/day/hour/min` and lacks `tz`. Apply hook deltas for those five date values, but keep `tz` absent even if the hook adds it.
- If canonical mapping did not trust the submitted date, do not promote hook-added date fields into canonical and preserve its existing `tz` value.
- Never restore the mapper seed `tz=guess` merely because the flat request originally contained it.

Unknown hook-added flat keys remain in `legacy_request` for later compatibility hooks but are not copied generically into canonical save data. This does **not** preserve the full retained mutation ABI: retained protocol submission honored arbitrary hook-added top-level and `prop_*` fields because the mutated flat request itself was submitted. The native pipeline submits canonical data instead, so an unknown mutation retained only in the flat snapshot has no persistence effect.

This known-field table is therefore a bounded implementation aid, not a compatibility-complete hook seam. Public handler use remains blocked until a separate characterization and interface decision establishes which extension-added fields must persist and how they map into canonical data. Options such as expanding an evidence-backed table or adding an explicit canonical extension channel require that later decision. Generic copying is not safe because it would collapse the native property shape and could override intentional editor and date-trust ownership. No external hook contract is approved by this handoff.

## Finite tests

1. Real callable native HMV: raw first argument has old names, numbered custom bits, credential actor B, and no synthesized editor/crosspost fields; original HMV remains value-identical.
2. Hook sees two distinct references: purpose-shaped raw first argument and the exact `legacy_request` second argument returned by the mapper.
3. Mutate/direct/delete supported flat scalar fields and assert only their canonical counterparts change.
4. Mutate/delete mapped `prop_*` values and assert canonical props update without losing `props.editor`, `opt_preformatted`, or unrelated native props.
5. Mutate the raw first argument and assert neither flat nor canonical changes from that mutation.
6. Trusted date case: hook date deltas synchronize while canonical `tz` stays absent even if hook adds `tz`. Untrusted case: hook-added date fields do not override native trust and canonical `tz` remains.
7. Attempt changes to `prop_used_rte`, `prop_opt_preformatted`, and an unknown field: canonical editor/body formatting stays native; flat request retains the mutations for later hooks.
8. Assert decode hook runs once; the same mutated flat ref is subsequently supplied to spam/success hook plumbing, while the canonical backend request remains a separate object.

Activation remains gated on the caller's token/auth/order/retry work and on resolving the retained arbitrary hook-mutation ABI described above. This handoff does not approve a public route.

## Foreman disposition

This audit establishes a design gap, not a request for new authorization or
permission to narrow the existing hook ABI. The next prerequisite is pure
characterization of existing arbitrary property and top-level mutations, followed
by a mapping that preserves the observed behavior. No deployed interface change
is accepted here. The unused mapper remains independently reviewable without
invoking hooks or claiming complete compatibility.

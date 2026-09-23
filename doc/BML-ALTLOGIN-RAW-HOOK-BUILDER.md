# Native altlogin purpose-shaped raw decode-hook argument

Source checkpoints: pure mapper `de55cfe7c`, raw/decoded mutation characterization `37e6fb87c`, and delta helper `05d595f1b`. This is source-only design. It invokes no hook, authentication, protocol, save, request, or route.

## Existing two-argument contract

`DW::Entry::Legacy::decode_entry_form` invokes `decode_entry_form($raw_post, $decoded_request)` after all built-in decoding. The retained `/update` path supplies its original plain `%POST` as the first argument and the seeded, decoded protocol hash as the second.

The first argument is observational at that point. Mutating it does not change the already-decoded request. The second argument is the mutable compatibility object: the same reference subsequently reaches protocol, spam, and success plumbing. Characterization `37e6fb87c` establishes arbitrary additions, replacements, and deletions at both top level and `prop_*`, with the original flat reference preserved.

The accepted `05d595f1b` helper preserves that second-argument behavior when native canonical data is used: callers take deeply independent prehook and posthook snapshots, then apply every observed top-level and normalized per-property delta. Flat `prop_x` has the same precedence over nested `props->{x}` as retained canonicalization; `prop_xpost_*` stays top level; canonical-only properties survive unless an observed hook delta changes or deletes the corresponding property. This supersedes any earlier proposal to filter hook mutations through a known-field allowlist.

A shared reference captured before an in-place nested mutation is insufficient. The caller must deep-clone the second argument before the hook and again afterward. The pure raw builder described here does not perform those snapshots or apply deltas.

## Raw controls consumed by the retained decoder before the hook

The old decoder reads these raw names before invoking the hook:

- Security: `security`; literal `custom_bit_1` through `custom_bit_60` when security is `custom`.
- Date: `date_ymd_yyyy`, `date_ymd_mm`, `date_ymd_dd`, `hour`, `min`; comparison controls `date_ymd_old_yyyy`, `date_ymd_old_mm`, `date_ymd_old_dd`, `hour_old`, `min_old`; trust signals `date_diff` and `date_diff_nojs`.
- Content and metadata copied directly: `subject`, `event`, `prop_picture_keyword`, `prop_current_moodid`, `prop_current_mood`, `prop_current_music`, `prop_current_location`, `prop_current_coords`, `prop_taglist`, `prop_opt_screening`, `prop_opt_noemail`, `prop_opt_preformatted`, and `prop_opt_nocomments`.
- Derived controls: `event_format` and `switched_rte_on`; `comment_settings`; `prop_opt_backdated`; `prop_adult_content` and `prop_adult_content_reason`.

Before the hook, the decoder also clears the old subject placeholder, normalizes blank tags, converts old rich-text body details, resolves a typed mood to a mood ID, translates comment settings, validates adult-content values, produces `security` and `allowmask`, and conditionally removes seeded `tz` while installing date components.

The hook can inspect every other submitted raw key even though the decoder does not consume it. A builder must therefore avoid an allowlist that silently discards extension-added form controls.

## Smallest pure builder

Add a private pure helper with an interface equivalent to:

```
build_altlogin_legacy_raw_post(
    native_post => $prepared->{native_post},
    canonical   => $prepared->{canonical},
) -> $plain_legacy_raw_hash
```

Requirements:

1. Require the original `Hash::MultiValue` and already-prepared canonical result. Do not rerun `_form_to_backend` or `decode_entry_form`.
2. Start from an independent plain snapshot of all submitted fields, using the same repeated-value convention as `legacy_post_hash`. This preserves unrelated extension controls. Then replace the known native entry-control names with their retained raw equivalents. Do not mutate the HMV, canonical hash, or `legacy_request`.
3. Preserve same-name transport and form fields such as `lj_form_auth`, `nojs`, `user`, `password`, `usejournal`, `subject`, `event`, `security`, `comment_settings`, `prop_picture_keyword`, and the actual `action:update` value.
4. Convert known renamed controls:
   - `taglist` to `prop_taglist`;
   - `current_mood` to `prop_current_moodid`, `current_mood_other` to `prop_current_mood`, and music/location to their `prop_current_*` names;
   - `opt_screening` to `prop_opt_screening`;
   - `entrytime_outoforder` to `prop_opt_backdated`;
   - `age_restriction` values `none`, `discretion`, and `restricted` to retained `prop_adult_content` values `none`, `concepts`, and `explicit`, plus `prop_adult_content_reason`;
   - `flags_adminpost` to `prop_admin_post` if that control is present.
5. Shape security from the accepted canonical result so the raw hook view cannot disagree with the native save request: public/private remain literal; access becomes raw `friends`; custom becomes raw `custom` plus exact numbered `custom_bit_N=1` entries for canonical selected bits 1 through 60. Remove the repeated native `custom_bit` control from the shaped result. This handles duplicates, zero-padded values, and invalid values according to the already-reviewed native parser rather than a second parser.
6. Split native `entrytime_date` and `entrytime_time` into the current old component names. Map native `trust_datetime` to a truthy `date_diff` and native `nojs` to `date_diff_nojs`. Do not invent old comparison fields because the native form has no prior-date equivalents.
7. Remove known native-only schema controls after mapping so the first argument is purpose-shaped rather than a mixture of two schemas. In particular, do not expose `editor`, `entrytime_date`, `entrytime_time`, `trust_datetime`, `entrytime_outoforder`, `taglist`, native mood names, `age_restriction`, or repeated `custom_bit` as retained controls.
8. Do not synthesize `event_format`, `richtext_default`, `switched_rte_on`, `prop_used_rte`, or `prop_opt_preformatted` from native `editor`. Do not synthesize crosspost fields. The altlogin presentation deliberately has no crosspost component; reserved injected native crosspost names remain excluded just as the accepted mapper suppresses them.
9. Preserve every unrelated field from the original HMV, including extension-added repeated controls under the established flat repeated-value convention. Reserved native controls are removed only where this document defines their old-schema mapping or explicit exclusion.
10. Return a new plain hash. Nested or reference-valued test fixtures must be independently cloned so mutations to the returned raw object cannot alter the HMV, canonical data, or flat second argument.

This helper does not build or change `legacy_request`. The accepted mapper remains the only source of that second flat argument.

## Concrete unresolved reconciliation

### Native editor

Native `props.editor` and `props.opt_preformatted` are authoritative canonical parsing results. There is no lossless conversion from every modern editor to old `event_format`/`switched_rte_on`/`prop_used_rte`. The raw builder must omit those invented flags.

The mutable second argument still has the existing arbitrary mutation ABI. If a hook adds or changes `prop_opt_preformatted`, `prop_used_rte`, `prop_editor`, or another format property, `apply_legacy_request_delta` must not silently discard it. Before a public caller exists, composition tests must define how those observed legacy property deltas coexist with native `props.editor`, including Markdown and RTE body semantics. This is a save-composition gate, not a reason to narrow the raw builder or delta helper.

### Date trust

The builder can accurately expose current date components and trust signals, but it cannot invent the old previous-date comparison controls. Native canonical mapping owns whether `tz` was removed. The second-argument hook ABI historically permits arbitrary changes to `tz` and date fields. A future caller must explicitly characterize and preserve that behavior or define a reviewed reconciliation with native trust; it must not quietly filter a hook-added `tz` or quietly restore `guess`. The raw builder itself performs no reconciliation.

### Custom bits and metadata

Native custom security uses repeated `custom_bit`; the retained raw hook saw numbered flags. Deriving numbered flags from canonical `allowmask` keeps the raw view aligned with the native result, including bit 60.

`prop_current_coords` has no current native form counterpart and is absent unless an extension actually submits it. Old editor-only fields likewise remain absent. Slug, sticky, and display-date values are canonical/protocol fields but are not consumed by the old decoder section; the builder must not invent old aliases without actual retained-form evidence. Unrelated submitted extension controls remain present under their original names.

## Finite pure tests

1. Build from a real-shaped HMV containing credentials, token, subject/body, native editor, access/custom security, repeated bits 1 and 60, tags, icon, moods, music/location, comments, adult values, backdate, trusted date, admin flag, and an arbitrary repeated extension control. Assert the exact returned plain hash and that no hook/auth/protocol/save/request/route function runs.
2. Prove public, private, access, and custom mappings. Include duplicate, zero-padded, out-of-range, and malformed custom values; numbered output must match canonical `security`/`allowmask`, not a second interpretation of raw values.
3. Prove trusted, no-JS, and untrusted dates. Assert current components and trust flags, absence of invented old comparison fields, and no mutation of canonical `tz`.
4. Cover absent versus explicit-empty tag, metadata, comments, adult reason, and backdate values. Raw values should remain raw where the retained decoder historically performed the normalization later.
5. Cover each active editor mode. Assert canonical editor/body remain untouched and the raw result contains none of the invented retained RTE/preformat flags.
6. Assert injected crosspost controls are excluded, while unrelated scalar and repeated extension controls survive with the established flat encoding.
7. Assert the raw result, original HMV, canonical output, and `legacy_request` are distinct and value-stable when each result is mutated in turn.
8. Pair the builder output with an independently deep-cloned before/after `legacy_request` fixture, without invoking a hook. Demonstrate that arbitrary top-level and `prop_*` additions, changes, deletions, nested values, and explicit `undef` remain representable by `apply_legacy_request_delta`; native-only canonical props survive unless an observed delta addresses them.

These tests approve only an unused pure raw-argument builder. Hook invocation, arbitrary-delta/editor/date reconciliation, authentication, saving, retries, and routing remain separate gates.

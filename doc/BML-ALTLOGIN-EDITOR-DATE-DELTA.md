# Altlogin editor/date hook-delta composition audit

Scope: source-only composition of the accepted native altlogin mapper, the accepted
`apply_legacy_request_delta` helper, and the retained `decode_entry_form` hook ABI.
No hook, authentication, protocol, save, or route is invoked here.

## Established contracts

### Retained hook shapes

`DW::Entry::Legacy::decode_entry_form` constructs the flat protocol request before
calling `decode_entry_form($raw_post, $flat_request)`. The hook may mutate the exact
second hash reference in place. Characterization in `37e6fb87c` establishes that
arbitrary top-level and `prop_*` additions, changes, deletions, and explicit undef
values are observable after the hook. Raw first-argument mutations occur too late to
alter the already-decoded request.

The relevant pre-hook legacy behavior is:

* `event_format` and `switched_rte_on` derive `prop_opt_preformatted`.
* `switched_rte_on` derives `prop_used_rte` and may normalize `event` from RTE HTML.
* Trusted date controls delete `tz` and set `year`, `mon`, `day`, `hour`, and `min`.
* Otherwise the seed `tz` survives.

The hook can subsequently add/change/delete/undef any of `event`, `tz`, the five
date fields, `prop_editor`, `prop_opt_preformatted`, and `prop_used_rte`.

### Generic delta behavior

The accepted `apply_legacy_request_delta` implementation in `05d595f1b` is the
correct generic mechanism after the hook:

1. Deep-snapshot the mutable flat request immediately before the hook.
2. Deep-snapshot it again immediately after the hook.
3. Apply observed per-field and per-property changes to a deep clone of the native
   canonical request.
4. Preserve native-only canonical fields and properties unless an observed hook
   delta addresses that exact namespace.
5. Preserve arbitrary extension deltas; do not use a known-field allowlist.
6. Keep the pre-hook canonical and raw form independently available for retry
   rendering. The retained error renderer used submitted raw controls rather than
   the hook-mutated protocol request.

The save-side result, the retry-side snapshot, both flat snapshots, and the original
native HMV input must not share nested references.

### Event and date effects

Applying the generic delta to `event`, `tz`, and `year/mon/day/hour/min` preserves
the direct protocol contract:

* `event` change/delete/undef is presented to the backend exactly as observed.
* `tz => guess` with all five date fields absent lets the protocol fill current local
  time.
* A defined `tz` plus any partial explicit date does not fill the missing fields;
  ordinary validation decides the result.
* Deleting `tz` leaves the five submitted date fields authoritative.
* Invalid `tz` and invalid or incomplete date values retain their normal protocol
  error behavior.
* Explicit undef and deletion remain distinct deltas.

No composition layer should parse, repair, default, or filter these hook results.
The retry form should continue using the independent raw/pre-hook representation so
that a failed attempt does not rewrite visible controls from hook-internal values.

## Editor representation difference

The native form mapper always places validated `props.editor` in canonical state and
sets `props.opt_preformatted` to zero. The retained flat request normally has no
`prop_editor`; its format was historically represented by `prop_used_rte` and
`prop_opt_preformatted`, unless a hook explicitly added `prop_editor`.

The generic delta gives exact, established results when the hook explicitly changes
an editor property:

* `prop_editor` maps to `props.editor`, including change, deletion, empty, and undef.
* `prop_opt_preformatted` maps to `props.opt_preformatted`.
* `prop_used_rte` maps to `props.used_rte`.
* Arbitrary related or unrelated properties remain preserved by the same rule.

There is an unresolved product difference when the hook changes only legacy format
flags. Native `props.editor` remains present and later entry rendering gives it
precedence over `used_rte` and `opt_preformatted`. The direct post protocol currently
stores these truthy properties but its post cleaner has a TODO and does not pass the
editor property to `LJ::CleanHTML::clean_event`; consequently the conflict can affect
persisted metadata and later editor selection even when it does not affect that
cleaning call.

Do not silently delete native `editor`, ignore the hook's legacy flags, or derive a
new editor value. Until parity is characterized, the composition result should expose
an explicit conflict state when the hook changes/deletes `prop_opt_preformatted` or
`prop_used_rte` without also addressing `prop_editor`. A future caller must resolve
that state before saving. This preserves the hook mutation ABI without choosing a new
editor policy.

When the hook explicitly addresses `prop_editor`, generic property delta semantics
are sufficient; all resulting properties should still be retained exactly for normal
protocol validation/persistence.

## Smallest pure composition boundary

A pure helper can accept:

* the native canonical request from the accepted mapper;
* a deep pre-hook flat snapshot; and
* a deep post-hook flat snapshot.

It should return:

* `canonical_for_attempt`: the generic delta result;
* `canonical_for_retry`: an unchanged deep clone of the pre-hook native canonical;
* the unchanged independent snapshots; and
* editor conflict metadata containing the exact changed legacy format keys.

It must not call the hook, authenticate, validate, invoke the protocol, save, render,
or mutate any input. It must not narrow arbitrary deltas.

## Finite pure/no-save characterization

1. For each of `event`, `tz`, `year`, `mon`, `day`, `hour`, and `min`, test add,
   change, delete, and explicit undef; assert the attempt changes and retry does not.
2. Cover date combinations: `tz=guess` with no date, deleted `tz` plus all five
   fields, partial fields, invalid strings, and mixed delete/undef. Assert exact hash
   shape only; do not simulate protocol validation.
3. For `prop_editor`, `prop_opt_preformatted`, and `prop_used_rte`, cover add, change,
   delete, empty, zero, and undef. Assert exact canonical property shape.
4. Assert no conflict for an explicit `prop_editor` delta; assert a conflict for each
   legacy-format-only delta and their combinations. Assert no conflict when those
   values are unchanged.
5. Combine editor/date/event deltas with arbitrary top-level and `prop_extension`
   additions, changes, deletions, and nested values. Assert every observed delta is
   retained and native-only properties survive.
6. Mutate nested values in every returned structure and prove the original native
   HMV, canonical input, pre-hook snapshot, post-hook snapshot, attempt result, and
   retry result are mutually independent.
7. Repeat under varied Perl hash seeds to prove no namespace/order dependence.

These tests establish composition only. They do not approve hook invocation, native
editor reconciliation, authentication, protocol/save integration, or a public route.

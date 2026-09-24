# Legacy entry decoder normalization boundary

This is a narrow preparatory seam for the retained `update` and
`editjournal` POST contracts. It does not register routes, select actions,
authenticate a user, validate CSRF, save an entry, or change the
`decode_entry_form` deployment hook.

## API

`DW::Entry::Legacy::normalize_entry_form( $seed_req, $post )`

- Calls `decode_entry_form( $seed_req, $post )` exactly once and returns that
  same request hash reference.
- Leaves all ordinary decoded fields in place, including any field injected by
  a `decode_entry_form` hook.
- Moves every decoded entry-property key named `prop_<name>` into
  `$seed_req->{props}{<name>}`. Existing seed properties are retained. The
  `prop_xpost_*` controls are transport fields, not entry properties, and are
  represented only by the explicit `crosspost` mapping below.
- Sets `crosspost_entry` from `prop_xpost_check`, and creates a
  `crosspost->{acctid}` record for every selected or credential-bearing legacy
  account field. A record contains `id` only when `prop_xpost_<acctid>` is
  selected, plus `password`, `chal`, and `resp` from the matching legacy
  fields. This keeps the selected and unselected callback values consumed by
  `DW::Controller::Entry::_queue_crosspost` distinct.
- Does not rebuild the decoded hash. In particular, a seed `tz` remains when
  the old decoder does not trust a submitted date, while changed/no-JavaScript
  dates continue to delete `tz` and set `year`, `mon`, `day`, `hour`, and
  `min`.

The implementation accepts legacy-shaped plain hashes unchanged. For a
`Hash::MultiValue` boundary, `legacy_post_hash` creates a separate plain hash
with `each` values joined by NUL exactly as `DW::BML` does; it never mutates the
multivalue input. Canonical property-to-backend mapping and route cutover are
deliberately later work.

## Success-hook preparation API

`DW::Entry::Legacy::prepare_entry_form( $seed_req, $post )` decodes exactly
once and returns a hash with `request`, `canonical`, and `post` keys.

- `request` is the original `$seed_req` reference after the decoder and its
  hook ran. It retains the old flat `prop_*` fields for retained success hooks,
  including `after_entry_post_extra_html`.
- `canonical` is a separate hash built by the same canonicalization stage.
  Its `props` hash is separate from the seed request's `props`, so moving
  `prop_*` fields cannot alter the success-hook request. It can be passed with
  `post` to `formdata_from_legacy` for a native error retry without decoding or
  invoking hooks again.
- `post` is the original plain legacy post, or the one BML-compatible NUL-joined
  plain hash produced from a `Hash::MultiValue` input.

`normalize_entry_form` remains the retained in-place API: it invokes the same
stage with `in_place => 1`, returning and mutating its original request hash as
before.

## Finite tests

1. The preserved decoder is called once, receives the original seed/plain-post
   references, and hook-added ordinary fields survive normalization.
2. Decoder-produced and hook-produced `prop_*` fields become `props`, while
   `subject`, `event`, security, mask, and unrelated hook values stay top-level.
3. Seed timezone/old edit date survives a trusted old date; a changed and a
   no-JavaScript date replace it using the legacy decoder values.
4. Master-enabled selected and unselected accounts retain each account's
   selected state and password/challenge/response values; a disabled master
   stays disabled without discarding the rendered account records.
5. A `Hash::MultiValue` boundary conversion preserves empty-first repeated
   values with NUL joining, does not mutate input, and gives the hook its
   converted legacy scalar.
6. `prepare_entry_form` decodes once, keeps the same flat request reference for
   a simulated success hook, and supplies an isolated canonical copy for a
   retry mapper; it does not alter seed properties, opaque hook values, or raw
   multivalue input.
7. Existing direct decoder tests continue to cover masks through bit 60,
   metadata/adult/comment precedence, RTE conversion, mood normalization, and
   hook ordering.

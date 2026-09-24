# Legacy entry error-rerender form data

This is a pure data boundary for the future old-schema POST adapter. It does
not register an old route, choose an action, authenticate, validate CSRF,
persist an entry, manage drafts, or alter the `decode_entry_form` hook.
Draft-property and display-date housekeeping remain separate work.

## API

`DW::Entry::Legacy::formdata_from_legacy( $canonical, $legacy_post )`

`$canonical` is the result of `normalize_entry_form`; `$legacy_post` is the
original old-schema plain hash or `Hash::MultiValue`. The helper must not call
the decoder or hooks again. It returns a new `Hash::MultiValue` using only the
native form's field names, so a native error form can retry to its native
action without sending the old schema back to a legacy-only decoder.

| Legacy/canonical input | Native rerender field |
| --- | --- |
| canonical `subject`, original `event` | placeholder-normalized subject plus unchanged RTE/raw event source |
| canonical `props.used_rte`, `props.opt_preformatted` | `editor`: `rte0`, `html_raw0`, or `html_casual1` |
| canonical security/allowmask | `security`: `public`, `private`, `access`, or `custom` |
| literal old `custom_bit_N` keys for `N` 1–60 | repeated `custom_bit=N` |
| canonical date components | `entrytime_date`, `entrytime_time`; decoder trust state maps to `trust_datetime`/`nojs` |
| canonical `props.opt_backdated` | `entrytime_outoforder` |
| canonical metadata | `taglist`, `prop_picture_keyword`, `current_mood`, `current_mood_other`, `current_music`, `current_location` |
| canonical comment fields | `comment_settings`, `opt_screening` |
| canonical adult content | `age_restriction` (`concepts` → `discretion`, `explicit` → `restricted`) and reason |
| canonical crosspost records | `crosspost_entry`, repeated selected `crosspost`, and per-account `crosspost_password/chal/resp` |

`prop_current_coords` has no modern rendered form control. The helper leaves
it in canonical data for the later adapter rather than inventing an unrelated
modern control.

## Finite tests

1. Raw RTE and raw/preformatted bodies remain byte-for-byte form input while
   canonical format state selects the correct native editor.
2. Public/private/friends/custom security maps to native values; selected
   custom bits remain repeated fields, including more than one bit; only literal keys `custom_bit_1` through `custom_bit_60` are emitted, so zero-padded and out-of-range names remain ignored like the decoder.
3. Seed-derived old edit dates and changed/no-JavaScript dates retain exact
   native date/time fields and retry trust controls; backdating survives.
4. Userpic, tag, mood ID/other mood, music, location, comments, and adult
   values map to actual native controls, including adult value conversion.
5. Crosspost master, selected and unselected credentials become native field
   names without losing credentials. The helper emits repeated selected account
   values and does not mutate the original legacy post.
6. The result contains no legacy `prop_*` names other than native
   `prop_picture_keyword`, and no `event_format`, `switched_rte_on`, or
   `date_ymd_*` form names; an immediate retry is therefore native schema.
7. A localized legacy subject placeholder remains canonical empty through a
   native retry, while ordinary raw subject/body values remain intact.

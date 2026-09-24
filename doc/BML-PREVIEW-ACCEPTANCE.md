# Native legacy-preview compatibility

Independent Sol source audit at `42b80ed08`. Disposition: replace the legacy
preview endpoint with a legacy-schema wrapper around a shared native preview
renderer. Preserve both old URLs; do not directly alias their incompatible
POST schema to the modern handler or build a third rendering pipeline.

## Required compatibility

- Legacy user/username/post_as_other/postas_usejournal/usejournal plus altlogin
  context versus modern remote/username/usejournal.
- friends and custom_bit_1..60 versus access and repeated custom_bit.
- prop_taglist, prop_current_*, prop_adult_content* versus native taglist,
  current_*, age_restriction*. Both retain prop_picture_keyword.
- date_ymd/hour/min/old-comparison/date_diff versus native entrytime_date,
  entrytime_time and trust_datetime/nojs.
- event_format=preformatted and switched_rte_on, including lj-cut/lj-raw RTE
  normalization, versus native editor and cleared opt_preformatted.
- Remove the localized legacy entryform.subject.hint2 placeholder.
- Legacy stylesys==2 and force_s1 hook plus journal-entry styling determine
  site skin versus S2. Native styling decision alone is not equivalent.
- Legacy popup sends the full form, retains altlogin and resets target to _self;
  modern popup temporarily disables password fields and restores prior target.

Poll/embed pipelines are equivalent after decoding: parse new polls in order,
expand existing polls, transform/extract embeds, clean and expand preview.
Both preview handlers render without normal posting validation; do not invent
empty-body or malformed-date posting errors in preview.

## Finite three-test acceptance package

1. Actual legacy form fields to both old URLs: poster/journal, access markers,
   timestamp, tags/currents/userpic/adult marking, localized subject placeholder
   and warning. One site-skinned and one S2 journal, including legacy stylesys
   choice. Fresh entry count unchanged.
2. Legacy preformatted/RTE and native raw/casual formatting; two distinct polls
   and a genuine embed in one preview. Assert order, controls, expanded embed,
   no raw placeholders and unchanged entry/poll/embed persistence counts.
   Existing cleaner tests remain the detailed cleaning oracle.
3. Click real old and modern popup controls. Assert route, visible content and
   warning, original form action/target restoration, re-enabled modern password
   controls, and no created entry. Characterize one empty-body or invalid-date
   input without requiring normal posting validation.

No editor posting cutover or external Journal-hook interface change is included.

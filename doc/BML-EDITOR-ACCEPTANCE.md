# Ordinary editor retirement acceptance

Source audit: independent Sol at immutable `0838d1028`. This finite ordinary
form matrix is separate from cleared picker/maintainer behavior, active draft
and preview characterization, moderation/crosspost boundaries, and any held
work. Passing helper or protocol tests alone does not prove web-form parity.

## Finite form gates

1. Actual modern edit GET/save/fresh-reload for subject, body, tags, location,
   music and userpic, including clearing existing values.
2. Visible general validation errors, exact submitted input retention and
   forced-fresh unchanged entry after failure. The independent actual HTTP probe
   confirms the outer wrapper already renders general errors; the initial
   source-only claim of invisible errors was incorrect. Empty-body localization
   is broken, while invalid-date text, retention and nonmutation pass. Fix the
   full translation key without adding a duplicate error block.
3. Location/music maxlength reflects the existing native std_max_length80/100
   language mapping. Current modern module hardcodes80; legacy form is dynamic.
4. Existing timestamp load, changed timestamp persistence, backdated on/off,
   invalid-date retention, and accessible names for date/time text inputs.
5. No-op and changed-content roundtrips for casual HTML, raw HTML, Markdown,
   legacy Markdown detection and RTE, preserving exact body/editor properties.

## Existing evidence and boundaries

- t/post.t covers helper-level new-post decoding/persistence, not actual edit UI.
- t/proto-post-edit-roundtrip.t covers protocol edits, not web forms.
- fck-poll browser covers RTE insertion but not complete edit/reload parity.
- web-stdmaxlength-language.t proves legacy rendered80/100 attributes.
- plack-entry-maintainer.t proves the separate manager form, not ordinary edits.
- Draft/preview source `f7c7b285a` is queued for independent review; it does not
  authorize deleting legacy update/edit/preview/draft endpoints.

The bounded rendering range through `f36190dd1` is independently clear and
integrated as `0aad3e37f`: existing full empty-body key, native maxlength and
translated date/time labels. No extra general-error block remains. Independent
17 committed assertions and16 temporary probe assertions pass; the committed
unchanged-entry check now resets singletons. Browser names remain in gate4.

Gate1 source `afbbfa240` is independently clear (35 assertions), integrated as
`f07bac73b`. Gate5 HTTP source `54553b668` is independently clear (61 assertions),
integrated as `558ba0609`; this does not replace actual browser mode evidence.
The remaining roundtrip gates follow using disposable owned entries and fresh
reads; no public editor cutover is approved by this document.

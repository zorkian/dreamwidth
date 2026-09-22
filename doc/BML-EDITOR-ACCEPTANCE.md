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
   source-only claim of invisible errors was incorrect. At the audit baseline empty-body localization
   was broken; the integrated full-key correction fixes it without a duplicate
   error block. Invalid-date text, retention and nonmutation pass.
3. Location/music maxlength reflects the existing native std_max_length80/100
   language mapping. The baseline hardcoded80; the integrated module now uses the native limit.
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
- Draft/preview through `1929db445` is independently clear and integrated as
  `f86d593dd`; it does not authorize deleting legacy update/edit/preview/draft
  endpoints. Legacy-format restoration remains separate.

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

Gate4 through `013cc57da` is independently clear and integrated as `8823c34c1`.
Parsed checkbox states after both reloads and visible desktop/narrow panel
labels pass. Foreman timestamp/rendering34 assertions and actual browser pass;
captures are in entry-displaydate-native. Gate5 browser through `d3ad7add3` is independently clear and integrated as
`e9281a322`: actual initial state, no-op and changed saves, exact fresh bodies,
legacy Markdown detection and intentional failure cleanup all pass. The
foreman combined-branch replay is running. The finite ordinary edit-form
matrix is independently clear; other retirement gates remain separate.

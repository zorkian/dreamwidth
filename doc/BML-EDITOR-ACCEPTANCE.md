# Ordinary editor retirement acceptance

Source audit: independent Sol at immutable `0838d1028`. This finite ordinary
form matrix is separate from cleared picker/maintainer behavior, active draft
and preview characterization, moderation/crosspost boundaries, and any held
work. Passing helper or protocol tests alone does not prove web-form parity.

## Finite form gates

1. Actual modern edit GET/save/fresh-reload for subject, body, tags, location,
   music and userpic, including clearing existing values.
2. Visible general validation errors, exact submitted input retention and
   forced-fresh unchanged entry after failure. Source currently collects unnamed
   errors but entry/form.tt renders warnings and field-specific errors only.
   Reproduce empty-body/invalid-date before fixing; do not weaken validation.
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

Next bounded implementation fixes the three source-backed rendering gaps
(general errors, maxlength, accessible names) with actual HTTP/browser evidence.
The remaining roundtrip gates follow using disposable owned entries and fresh
reads; no public editor cutover is approved by this document.

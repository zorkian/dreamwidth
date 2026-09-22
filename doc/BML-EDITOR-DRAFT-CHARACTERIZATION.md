# Entry draft and preview characterization

This is a preservation baseline for the modern `/entry/new` editor. It makes no
route or production behavior change.

## Observed modern contract

- `htdocs/js/pages/entry/drafts.js` saves the editable body to
  `/__rpc_draft` and saves title/editor and other metadata as
  `draft_properties`.
- A saved draft with a subject prompts using the subject-bearing restore message;
  accepting restores title, body, and the selected editor mode. Clearing removes
  both the body and all saved properties. A never-created draft returns JSON
  `null`; an explicitly cleared draft returns the empty string.
- HTML editor content survives a switch to FCK/RTE. RTE serialization is then
  saved through the same RPC.
- The Preview button posts to `/entry/preview`; it renders the title/body and a
  preview-only warning without creating an entry. The handler applies
  `LJ::CleanHTML::clean_subject` and `clean_event`, so legacy preview is a
  sanitized rendering rather than a byte-for-byte form echo.

`t/browser/entry-draft-preview.js` exercises those calls with a disposable
account, captures `restored-rte.png` and `preview.png`, and tears its account
back down in `finally`.

## Legacy-retirement gates still required

Do not remove `update.bml`, `preview/entry.bml`, `tools/endpoints/draft.bml`, or
the legacy item editor until the following are independently characterized and
accepted:

1. old `update.bml` POST field and alias compatibility against the modern
   editor/posting path;
2. legacy `preview/entry.bml` caller behavior versus `/entry/preview`, including
   validation and popup error states;
3. old/new draft property formats, restore decline behavior, and sequential
   request isolation;
4. edit/delete, community/maintainer, metadata/security, and publication
   round-trips.

## Remaining format seam from source audit

Both implementations store the same body and Storable property hash. The legacy
endpoint writes subject/userpic/tags/mood/location/music/comment/adult fields but
never writes an editor property. The modern endpoint adds saveEditor/editor.
The modern template currently emits draft_properties.editor directly as
restoredEditor, and restore assigns that value to the mode selector. A legacy
draft with no editor property therefore needs an actual restore test; the
modern-format browser baseline alone does not establish its fallback behavior.
This is a source-observed test gap, not a reproduced data-loss claim.

Next bounded interoperability evidence should seed a genuine legacy-format
body/property hash, accept restoration, inspect mode and all retained fields,
then save/reload through the modern UI. Separately decline restoration and
verify the stored draft is retained or characterize the established behavior.
No replacement draft implementation or endpoint deletion is authorized by this
audit alone.

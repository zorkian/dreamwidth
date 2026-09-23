# `imgupload.bml` bounded audit

## Existing contract

- `htdocs/imgupload.bml` currently performs no file upload. Its usable initial form contains `method=url`, `url`, and optional `alt` fields.
- A POST returns a callback document that invokes `InOb.onInsURL(url, 0, 0, alt)` and closes the framed popup.
- A retained `upload_count` GET path invokes `InOb.onUpload` for each numbered `su_N`, `pp_N`, `sw_N`, and `sh_N` result in order, then closes. No in-repository producer for this path remains.
- `htdocs/js/entry.js` opens the popup only from the legacy `updateForm` toolbar and appends generated image markup to the legacy `event` textarea. The modern Entry template does not load this caller.
- `/imguploadrte` is tied to FCK and `InObFCK`. `/file/new` and `/api/v1/file/new` perform real media uploads but provide no editor insertion callback. Neither is a drop-in replacement.
- The native editor has no equivalent URL-insertion control in its plain HTML modes. Its RTE uses the separate FCK image dialog.

## Smallest safe package

1. Add a native plain-mode “Insert Image” URL/description control that inserts the same `<img src="..." alt="...">` text into `entry-body`; retain the existing FCK dialog for `rte0`. No media upload work is required.
2. Characterize the retained legacy dialog until legacy update/edit retirement:
   - both `/imgupload` spellings render the URL/alt form and `faqlink` hook;
   - POST returns the URL/alt callback and closes;
   - numbered `upload_count` callbacks preserve order and integer dimensions;
   - a real legacy browser opens the framed dialog, shows URL/description/Insert/close at desktop and narrow widths, inserts into the textarea, closes without navigation, and leaves entries unchanged.
3. Browser-test the new plain-mode control in both new and owned-edit forms, including caret insertion, optional alt text, cancellation, and no persistence before Save.
4. Retire `imgupload.bml` only with its legacy update/edit callers. Move `/imgupload.bml.insertimage.alt.body` and `.faqlink` first because the migrated FCK dialog still consumes them; then retire the remaining companion translation keys.
5. Keep `/file/new` and `/api/v1/file/new` outside this package. Uploaded-media selection is a separate product feature.

## Source references

- Legacy callback generation: `htdocs/imgupload.bml:39-73`
- Legacy form and hook: `htdocs/imgupload.bml:98-156`
- Textarea callbacks and popup caller: `htdocs/js/entry.js:491-590`
- Parent form validation/submit: `htdocs/js/entry.js:599-713`
- FCK-only native dialog: `cgi-bin/DW/Controller/ImageDialog.pm:24-62`
- Standalone media page: `cgi-bin/DW/Controller/Media.pm:306-326`
- Actual upload API: `cgi-bin/DW/Controller/API/Media.pm:48-99`

No upload request, external delivery, or data mutation was performed during this audit.

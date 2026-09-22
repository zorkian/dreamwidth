# Remaining static-tree image dialog

Disposition: consolidate the duplicate into the already migrated native image
dialog, preserving its old URL and ImageButton query contract. This is an
implementation proposal; no file or route has been removed yet.

At foreman `9287d7e72`, the ordinary editor selects toolbar Update. That toolbar
does not expose ImageButton. The default toolbar and context menu still contain
it. Current fckeditor.html loads the unsuffixed Gecko/IE bundles, whose Image
and ImageButton commands already target the root /imguploadrte.bml native alias.
Both split *_2.js bundles still target dialog/imguploadrte.bml?ImageButton.
The *_1.js bundles load *_2.js, and fckeditor.js/fck_startup.js retain references
to those split loaders. Absence from Update is insufficient to declare them dead.

app.psgi serves existing /stc files through Static middleware before dynamic
routing, with pass_through for missing files. Therefore registering a native
alias while retaining the duplicate physical file cannot establish native
dispatch for that URL. Consolidation must remove the physical duplicate and
verify full-app dispatch at the exact old URL, including POST redisplay.

The shared fck_image.js checks whether the entire query is exactly ImageButton
to select input-image behavior. Preserve that query literally in bundle
command URLs; adding unrelated query parameters changes its mode.

Required bounded evidence before deletion:

- Full-app old-path GET and render-only POST reach the native standalone dialog.
- Both split command definitions point to the supported native root route.
- Actual editor ImageButton command preserves query mode, inserts/edits the
  expected input-image element, and normal Image flow still passes.
- Disposable browser fixture cleanup, no JS/resource failures, and captures.
- Independent review of exact route/template/bundle and deletion diff.

The root dialog's existing fields, callback, preview iframe and legacy
/imgupload.bml translation keys remain the reference behavior. This package
does not authorize deleting those shared translation keys or replacing FCK.

## Completed consolidation

Sol cleared `dd207c99c` plus corrected legacy alias `d85f96d33`. Integrated
locally as `6dca2d923`; both split bundles now use the root native route and the
physical duplicate is removed. Direct root/nested GET and render-only POST
coverage plus actual Image/ImageButton insert/edit and fixture cleanup pass.
Foreman exact-assets browser and3 files /95 HTTP assertions pass. Captures are
in fck-consolidated. Eight executable BML page files remain.

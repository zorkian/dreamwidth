# Alternate FCK image dialog: bounded source and runtime audit

At foreman `fde6becf8`, a read-only request to the isolated server returned:

```
GET /stc/fck/editor/dialog/imguploadrte.bml?ImageButton
HTTP 200, Content-Type: text/plain; charset=utf-8
13614 bytes, literal <?_code and LJ::User->remote source present
```

`app.psgi` static middleware serves existing `/stc/` files before controller/BML
dispatch. Therefore a current HTTP 200 does not establish that the dialog runs.
This is public repository source, not evidence of exposed deployment secrets.
Production overlay/static-server behavior was not inspected.

Both distributed gecko and IE command bundles still register ImageButton using
`dialog/imguploadrte.bml?ImageButton`. The normal Image command uses the migrated
root dialog. Although the Update toolbar omits ImageButton, `FCKConfig.ContextMenu`
includes it, and the context-menu implementation displays it for an INPUT whose
type is image. Toolbar absence alone is insufficient dead-code evidence.
`fck_image.js` distinguishes ImageButton by the exact raw query `ImageButton`
and creates/edits INPUT versus IMG accordingly. Preserve that raw-query contract
if redirecting or consolidating routes; a conventional named flag is not equal.

The alternate BML source also contains legacy file-upload controls absent from
the root TT shell: fb_account/fb_can_upload capability checks, FB_SITEROOT upload
action, FB_DOMAIN bridge, update_insobj_fb hook, and upload-return callbacks.
No upload service or capability deployment was available for acceptance.

A bounded next package can establish real browser ImageButton reachability and
compare supported insert/edit/preview callbacks, while characterizing the upload
shell without making external requests. If migrating the alternate shell, keep
its route and raw query, field IDs and callback contract, license notices and
legacy capability behavior until a disposition is approved. Removing the physical
static BML file lets pass-through static middleware reach a registered modern
route; test that old URL returns rendered HTML rather than source afterward.

Do not delete the endpoint solely on current broken static dispatch or toolbar
absence. Consolidation must explicitly account for ImageButton and the legacy
upload shell. This audit does not authorize enabling, changing or certifying an
external upload service, nor claim production traffic is absent.

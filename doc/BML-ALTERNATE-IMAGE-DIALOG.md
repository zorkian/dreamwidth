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

## Active bundle correction and real browser evidence (2026-09-22)

The earlier reference to both distributed bundles was incomplete: the `_2.js`
files contain alternate relative URLs, but the active `editor/fckeditor.html`
loads `js/fckeditorcode_gecko.js` or `js/fckeditorcode_ie.js` without the numeric
suffix. Both active bundles already route ImageButton to the root
`/imguploadrte.bml?ImageButton`. The legacy fck_startup.js references `_1.js`
(which loads `_2.js`); no current HTML loader reference to fck_startup.js was
found. The fcksource=true debug path chooses fckeditor.original.html and separate
_source scripts, not this old split-bundle loader. This is source reachability
evidence, not deployed overlay or external-client traffic evidence.

A real modern-editor browser probe at foreman `0f98984fc` confirmed that
`Commands.GetCommand('ImageButton').Execute()` opens the migrated root dialog.
Entering a local image URL and alt text inserted an actual INPUT type=image
with the expected src/alt, with no JS exceptions. The probe used the reviewed
disposable image fixture and awaited cleanup; no upload or external service
request occurred. Evidence in foreman container `8d7783a043d8`:
`/tmp/bml-imagebutton-root.log`; host/container script
`/tmp/bml-alternate-image-browser.js`.

The initial probe expected the alternate frame and failed; its diagnostic
frame list established the root URL. Those logs are retained as
`/tmp/bml-alternate-image-browser{,-diagnostic}.log`. They are corrected audit
assumptions, not product failures. Do not claim that the active ImageButton
currently displays source. Direct alternate-URL source delivery and its extra
upload shell remain separate, previously documented disposition concerns.

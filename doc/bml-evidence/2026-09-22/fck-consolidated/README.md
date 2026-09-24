# Consolidated native FCK image dialogs

Foreman replay after `6dca2d923`, exact static build and server restart, passed
normal Image plus ImageButton insertion/editing, exact ImageButton query,
preview callbacks, sizing, HTML roundtrip and modal detachment. No unexpected
dialogs or JS/resource errors occurred; disposable helper completed.
Foreman visual inspection confirms the standalone ImageButton modal retains
URL, short description, dimensions, preview and OK/Cancel controls.

Root and nested old URLs pass direct GET/render-only POST coverage. Combined
image/poll HTTP tests pass3 files /95 assertions. The removed physical
static-tree BML file no longer masks the native compatibility route.
Logs: host `/tmp/bml-fck-integrated-browser.log`, container
`/tmp/bml-fck-integrated-{build,prove}.log`.

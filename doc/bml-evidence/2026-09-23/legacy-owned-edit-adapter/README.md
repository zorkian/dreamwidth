# Retained owned-edit adapter browser evidence

Captured in the foreman devcontainer from the combined tree at `30b7d90f4`, after
an exact static build, using the disposable `t/browser/entry-legacy-edit.js`
fixture and its isolated callable-adapter test server. This is callable adapter
acceptance, not evidence of public route activation.

- `legacy-desktop.png`: actual retained edit form before submission. Its known
  extensionless `/editjournal.title` missing-string heading remains visible;
  this baseline capture does not claim the legacy GET page was migrated.
- `native-retry-desktop.png` and `native-retry-narrow.png`: native Foundation
  correction form after an invalid legacy year. The visible error is singular;
  the submitted subject/body and private security remain. The separate beta
  information panel is not a duplicate error. The narrow form fits the viewport.

The same run then corrects the date and submits distinct retry subject/body,
asserts native success and force-fresh persistence, and deletes only the target
entry. Browser log: `/tmp/bml-owned-edit-browser-integrated.log` in container
`8d7783a043d8`. Normal exit was zero; no fixture or adapter-server process
remained. Independent Sol exact `b79d7332b` replay also passed; prior unchanged
lifecycle named failure reached its intentional marker and exited one cleanly.

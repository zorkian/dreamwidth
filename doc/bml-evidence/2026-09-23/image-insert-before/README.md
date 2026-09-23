# Legacy image URL insertion baseline

Captured in the isolated Widgets container at immutable 3998819c17a224e7c874fb9f8a047c316bbad766
using disposable authenticated users and the real legacy editor popup. No image
upload or external checker runs. The normal browser test inserts URL/alt markup,
closes the popup without navigation, and checks fresh entry count unchanged.

- `desktop-dialog.png`: 1280px viewport, popup open before insertion.
- `narrow-dialog.png`: 390px viewport, full-page capture. This records existing
  horizontal overflow and left-clipped popup labels; it does not establish narrow
  usability. The replacement control must fit the narrow viewport.

The legacy popup also retains a resize handler after closing; resizing then can
throw against a removed node. The baseline uses a fresh page per viewport and
records that defect rather than suppressing page errors. Normal and intentional
failure cleanup evidence is recorded with the characterization package.

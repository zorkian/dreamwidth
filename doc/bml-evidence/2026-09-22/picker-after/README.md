# Native entry picker acceptance

Captured in the foreman isolated devcontainer at integrated `e83cddf0e`,
from independently reviewed source through `e4e3958b7`.

`node t/browser/entry-picker.js` passed default, recent, date, community,
keyboard, security icon accessible labels, and narrow states with no JS or
network failures. Disposable fixture completion was awaited. Log:
`/tmp/bml-picker-integrated-browser.log` in container `8d7783a043d8`.

Images: default.png, recent.png, empty.png, community.png, narrow.png.
This evidence covers the native picker only; itemid editing remains legacy.

# Exact editor-mode browser roundtrips

Foreman integrated replay at `e9281a322` passed five cases: casual HTML, raw
HTML, Markdown, legacy Markdown marker detection and RTE. It observes initial
rendering without forcing mode, saves unchanged then changed content, and
checks exact fresh persisted body/editor values and fresh UI rendering.
No JS/resource failures occurred; disposable helper completion was awaited.
The four captures are keyed by selected mode; the legacy case shares
markdown0.png with modern Markdown. Log: host
`/tmp/bml-entry-modes-integrated.log`.

# Legacy `/update` editor contract

`htdocs/update.bml` remains the legacy owned-entry posting surface while the
`updatepage` beta is enabled.  This document records its live form contract so
that a future route retirement can preserve callers and distinguish legacy-only
names from the native `DW::Controller::Entry` form at `/entry/new`.

## Routing and beta behavior

- `/update` resolves through the BML fallback to `htdocs/update.bml`; `/update.bml`
  is its direct spelling.  The ordinary authenticated, non-beta fixture in
  `t/plack-entry-legacy-update.t` renders and posts through both spellings.
- For an authenticated user in `updatepage`, `update.bml` redirects a GET that
  is not a form post to `/entry/new`, retaining GET arguments.  The conditional
  is deliberately `!LJ::did_post()`: a direct legacy POST remains handled by
  the BML page while it is retained.
- `usejournal` is accepted from GET/POST by legacy BML.  It is the legacy
  target-journal selector and maps to modern `usejournal`; this baseline only
  posts to the authenticated owner’s private journal.

## Rendered posting fields

| Legacy `update.bml` field | Protocol field / persisted result | Modern `/entry/new` counterpart |
| --- | --- | --- |
| `subject` | entry subject | `subject` |
| `event` | entry body | `event` |
| `security=private` | private security | `security=private` |
| `prop_taglist` | entry tag set | `taglist` |
| `prop_current_location` | `current_location` entry property | `current_location` |
| `prop_current_music` | `current_music` entry property | `current_music` |
| `prop_picture_keyword` | selected userpic keyword | `prop_picture_keyword` |
| `event_format`, `switched_rte_on` | legacy formatting / preformatted decoder behavior | `editor` |
| `date_ymd`, `hour`, `min`, `date_diff` | posting timestamp decoder | `entrytime_date`, `entrytime_time` |
| `action:update` | the normal legacy submit action | `action:post` |
| `lj_form_auth` | required CSRF token | `lj_form_auth` |

`LJ::entry_form_decode` copies the legacy `prop_*` metadata fields into the
protocol `postevent` request and maps `security` to the protocol security and
allowmask pair.  The native editor performs equivalent persistence through its
own field names; the names are not interchangeable at the rendered-form layer.

## Evidence

`t/plack-entry-legacy-update.t` uses a disposable authenticated user, parses the
actual legacy form and its CSRF token, then posts distinct private subject/body,
tags, location and music through both old URL spellings.  It force-loads the
created entry and verifies exactly one new row and every persisted value.

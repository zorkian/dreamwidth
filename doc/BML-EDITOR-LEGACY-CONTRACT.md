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
  is not a form post to `/entry/new`, retaining encoded GET arguments and the
  legacy NUL-delimited representation of repeated values through
  `LJ::create_url`.  The conditional is deliberately
  `!LJ::did_post()`: a direct legacy POST remains handled by the BML page while
  it is retained.
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

## Remaining configured-feature boundary

Source audit at `4d72caddd`: when `$LJ::SPELLER` is configured, the shared
legacy form renders `action:spellcheck` (LJ::Web), and update/editjournal invoke
`LJ::SpellCheck->check_html` before posting or saving. This preserves the form
and shows suggestions or the existing no-errors message. No equivalent action
was found in the native Entry controller or entry templates/scripts. This is
an uncharacterized existing beta parity gap, not a regression introduced by
these tests and not evidence that any deployment enables the setting.

Before removing those forms, characterize configured and disabled behavior
with a stubbed spellchecker (no external process required), then preserve the
configured action in the native editor or obtain an explicit retirement
choice. Do not silently infer that the commented example setting is unused.
Moderated posting and selected crossposting also remain distinct from the
private owned-entry baseline above; external crosspost delivery must be
stubbed during acceptance.

# Legacy owned-entry edit contract

`htdocs/editjournal.bml` remains the legacy ordinary edit form while editor
routes are being migrated.  This document records its form and query contract.

## URLs and actions

- Both `/editjournal?itemid=<ditemid>` and
  `/editjournal.bml?itemid=<ditemid>` render the ordinary owned-entry form.
  `itemid` is the composite ditemid (`jitemid * 256 + anum`), retained as a
  hidden form field.
- The form posts back to `editjournal` and uses `action:save`.  A valid
  `lj_form_auth` token is part of the rendered form.
- `action:delete` is the separate delete action documented in
  `BML-EDITOR-DELETE-CONTRACT.md`.  Community maintainer behavior remains a
  separate compatibility surface.

## Legacy-to-native field mapping

| Legacy `editjournal.bml` field | Persisted result | Native `/entry/<owner>/<ditemid>/edit` field |
| --- | --- | --- |
| `subject` | entry subject | `subject` |
| `event` | entry body | `event` |
| `security` | security / allowmask | `security` |
| `prop_taglist` | entry tags | `taglist` |
| `prop_current_location` | `current_location` property | `current_location` |
| `prop_current_music` | `current_music` property | `current_music` |
| `prop_picture_keyword` | selected userpic keyword | `prop_picture_keyword` |
| `date_ymd_mm`, `date_ymd_dd`, `date_ymd_yyyy`, `hour`, `min`, `date_diff` | entry timestamp | `entrytime_date`, `entrytime_time` |
| `action:save` | normal edit submit | `action:post` |
| `lj_form_auth` | CSRF validation | `lj_form_auth` |

## Evidence

`t/plack-entry-legacy-edit.t` uses an owned disposable private entry and a real
rendered form for each old spelling.  It verifies no-op preservation, then a
changed normal save with exact subject/body/tags/music/location/userpic and
timestamp persistence, fresh form rendering, and an unrelated fixture left
untouched.

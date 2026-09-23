# Update GET editor-selection compatibility audit

Scope: read-only source audit for the upcoming retained `/update` GET renderer.
No route, adapter, or preference code was changed.

## Legacy `/update.bml` selection

`htdocs/update.bml` supplies `richtext_default` to `LJ::entry_form`:

| Input | Legacy result |
| --- | --- |
| authenticated user | `$remote->new_entry_editor eq 'rich'` |
| anonymous user | `$LJ::DEFAULT_EDITOR eq 'rich'` |
| `entry_editor=always_rich` | rich |
| `entry_editor=always_plain` | plain |
| `entry_editor=rich` or `plain` | last-used value |
| missing/other `entry_editor` | `$LJ::DEFAULT_EDITOR` (default configured as `rich`) |
| browser without `rte_support` | `LJ::entry_form` forces `richtext_default` false |
| POST/re-render with `switched_rte_on` | forces rich for that rendering |

`LJ::User::Journal::new_entry_editor` owns the first five rows.  It is a
two-state preference, not a DW format ID preference.  `entry_editor` is also
updated after a successful old update: `switched_rte_on` writes `rich`, absence
writes `plain`, except when the stored preference begins `always_`.

The legacy line-break/autoformat checkbox is independent of rich/plain:

* `LJ::Web::entry_form` checks it for an update when the remote user's
  `disable_auto_formatting` is true, or when submitted `prop_opt_preformatted`
  or `event_format` is true.
* `update_fields` may provide `prop_opt_preformatted`; old `/update` uses that
  before rendering the initial form.
* a successful old update stores `disable_auto_formatting` from POST
  `event_format`, regardless of the rich/plain preference.
* the legacy decoder treats `switched_rte_on` or `event_format=preformatted` as
  `prop_opt_preformatted` when it was otherwise false.

Thus a GET implementation must not collapse the old `entry_editor` and
`disable_auto_formatting` properties into one modern format preference.

## Native `/entry/new` and `/entry/edit` selection

`DW::Controller::Entry::_render_new_form` and the edit renderer pass:

```
DW::Formats::select_items(
    current   => formdata.editor,
    preferred => $remote->prop('entry_editor2'),
)
```

`DW::Formats::select_items` has this precedence:

1. a valid current entry/form format (including an inactive retained format);
2. a valid active preferred `entry_editor2` format;
3. an upgrade of a valid obsolete preferred format;
4. `DW::Formats::$default_format`, currently `html_casual1`.

Active choices are `html_casual1`, `markdown0`, `html_raw0`, and `rte0`.
`LJ::User::Journal::entry_editor2` validates persisted choices and upgrades an
obsolete stored choice when its getter is used; the renderer's `select_items`
also validates/upgrades for display.  There is no native use of
`$LJ::DEFAULT_EDITOR` or the old `entry_editor` preference.

For existing entries, `DW::Entry::_backend_to_form` uses stored `editor`
first.  If absent it detects, in order: legacy `!markdown` (and mutates the
body while detecting), `used_rte` -> `rte0`, `opt_preformatted` ->
`html_raw0`, imported/pre-2019 content -> `html_casual0`, otherwise
`html_casual1`.  Existing-entry format must therefore win over either user
preference.

Native regular form posts store `props.editor` and explicitly clear
`opt_preformatted`; `DW::Entry::_form_to_backend` / cleaning uses the named
format rather than the old checkbox.

## Legacy-to-native compatibility cases for a GET wrapper

| Legacy state / input | Required visible native editor state | Separate retained state |
| --- | --- | --- |
| `always_rich`, `rich`, or default rich | `rte0` only if the retained old rich-editor capability test allows it; otherwise a plain compatible form, not a forced unsupported editor | do not rewrite `entry_editor` on GET |
| `always_plain`, `plain`, or default plain | a plain native choice; exact target requires an explicit policy (`html_casual1` is the closest normal form, `html_raw0` is not equivalent) | retain old preference unchanged |
| old `disable_auto_formatting=1` | preserve checked old `event_format` / legacy raw behavior; do not silently treat it as `entry_editor2=html_raw0` without a compatibility decision | checkbox/property remains independent |
| `update_fields.prop_opt_preformatted=1` | preserve the supplied override ahead of normal initial state | same override must survive GET rendering |
| old POST retry `switched_rte_on` | selected RTE-compatible state for that retry; it is a request value, not a durable GET migration | post-success old housekeeping owns old `entry_editor` update |
| explicit legacy `event_format=preformatted` | preserve raw/preformatted retry behavior | do not replace with `entry_editor2` unless the canonical retry mapper does so explicitly |
| existing entry with `editor` or legacy markers | stored/detected entry format wins | preserve detection, including `!markdown` body mutation |

## Recommended GET-renderer boundary

1. Keep old `new_entry_editor`, `$LJ::DEFAULT_EDITOR`, browser RTE support,
   `disable_auto_formatting`, and `update_fields.prop_opt_preformatted` as
   inputs to a small legacy-to-formdata selection adapter.
2. Make the adapter return both native `formdata.editor` and a distinct legacy
   autoformat/checkbox value.  Do not write either `entry_editor` or
   `entry_editor2` while serving GET.
3. Preserve current-entry format detection unchanged for edit GET; only use
   the preference adapter when no current entry format controls selection.
4. Characterization tests should cover every legacy row above, capability
   fallback, `update_fields` override, and unchanged preference props after a
   GET.  A deliberate mapping from old plain to a named native format needs
   product/renderer review before implementation; source alone does not make
   `html_raw0` equivalent to old plain.

## Sources

* `htdocs/update.bml`: 108-116, 208-240, 382-393
* `cgi-bin/LJ/User/Journal.pm`: 468-503, 728-735
* `cgi-bin/LJ/Web.pm`: 996-1002, 1266-1274, 1336-1338
* `cgi-bin/DW/Formats.pm`: active/default formats and `select_items`
* `cgi-bin/DW/Controller/Entry.pm`: 453-472, 1029-1043, 1594-1604, 1616-1642
* `cgi-bin/DW/Entry.pm`: existing-entry legacy detection and form backend
* `cgi-bin/DW/Entry/Legacy.pm`: decoder/legacy retry format mapping

## Foreman implementation disposition

The potential mapping question above is resolved within the authorized migration
scope by reusing the already-reviewed `DW::Entry::Legacy::formdata_from_legacy`
precedence: supported effective rich mode selects `rte0`; otherwise effective
preformatted/no-autoformat mode selects `html_raw0`; otherwise `html_casual1`.
This is the same mapping already accepted for old-schema native retries. It is
not a new persisted preference or a reason to pause for product approval.

The GET adapter must first calculate legacy inputs with `new_entry_editor`,
`rte_support`, and the old user/hook preformat values. It must not update either
editor preference on GET. Explicit combination tests and any concrete rendered
formatting differences remain implementation evidence requirements. The external
Journal adapter questions are separate and remain unanswered.

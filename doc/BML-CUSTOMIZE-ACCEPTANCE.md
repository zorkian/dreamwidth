# Customization migration acceptance

Disposition: migrate both customization pages. Navigation still links to them;
the existing Customize controller implements preview/view-user helpers, not the
theme browser or options editor. See BML-REMOVAL-PLAN.md for the wider inventory.

The controller/template migration follows the independently reviewed widget
resource and ThemeNav request/redirect packages. A rendering baseline is not
evidence that theme or option mutations work.

## Required contracts

| Area | Acceptance evidence required before deleting the BML pages |
|---|---|
| Entry points | `/customize/`, index and `.bml` aliases, `/customize/options` and its `.bml` alias; preserve queries and POST bodies |
| Actors | Logged out, personal account, maintained community, unauthorized authas; denied submissions leave target data unchanged |
| Initialization | S1-to-S2 transition, missing style initialization, current-style name migration; style and user-layer ownership |
| Theme browser | Category, designer, search, layout filter, page and show controls; encoded query values and community context survive navigation |
| Theme actions | Preview resolves the intended style without applying it; apply changes the saved theme and survives a fresh page load |
| Layout | Apply a layout and verify saved layout properties, resulting theme display, and options after reload |
| Titles | Personal and community title/subtitle saves; one RPC per click, request-local tokens and no accumulated initialization |
| Property groups | Save and reload representative editable values in presentation, colors, fonts, images, text, modules and custom CSS; cover distinct property control types |
| Custom text | Save and reset custom text modules and verify user properties after reload |
| Links | Include `linkslist`, omitted from the earlier eight-group rendering baseline; save ordering/content, reload and reset |
| Display | Mood theme and navigation strip controls; save/reload/reset and current selection |
| Reset | Reset the current group's supported values to defaults while preserving unrelated settings and layout properties |
| Validation | Missing/invalid CSRF, unauthorized target and invalid values; errors preserve useful input and no denied mutation occurs |
| JavaScript | Foundation jQuery remains available; explicit legacy DOM helpers, ordered resources, nested initialization and actual AJAX refresh |
| Browser UI | Desktop and narrow screenshots, keyboard controls, unsaved-change navigation and reset confirmation; no unexpected JS/network failures |
| Strings | Preserve moved translation keys and cross-page references; no raw BML blocks or missing translation keys |

Use an isolated seeded development database with compiled public themes. Assert
persisted values using fresh user/style loads as well as browser reloads. Capture
the same old/new page states before deleting the old pages. Keep fixtures and
screenshots local until publishing is explicitly authorized.

The existing `t/plack-customize.t`, `t/browser/widget-titles.js` and
`t/browser/customize-baseline.js` are starting points. The last script captures
rendering states and records exceptions; it does not assert option persistence
or certify complete browser acceptance.


## Final independent proof checklist (2026-09-22)

Sol audited the fixed range through `4c220b920`, reusing independently passed
169 mutation assertions, 118 controller assertions, full browser/resource flows,
aliases and narrow correction. No migration-introduced material defect was found.
The following finite proof gates remain before integrating the two BML deletions:

1. Nonzero user-layer ownership belongs to the effective journal, with a real
   nonzero foreign layer unchanged.
2. Category, designer and layout filter actions retain query and community context.
3. Personal/community subtitles save and reload with exactly one RPC per click.
4. Explicit control-type inventory proves distinct select, checkbox/radio and
   text/textarea/color paths were exercised, not just generic value/checked code.
5. Display mood/nav controls show saved selection and reset to defaults while
   preserving theme/layout.
6. **Closed as not applicable after independent source audit.** Legacy and
   migrated pages dispatch the same option widgets, which have no semantic
   invalid-value rejection/input-retention contract: S2 int/bool values coerce,
   Color/string/select values quote, unknown properties are ignored; invalid
   mood choices normalize to zero, invalid layouts do nothing, links canonicalize
   and text/title values accept or trim. Preserve these behaviors. Terra's
   integer/Color probes confirmed coercion rather than a migration regression.
   This disposition does not waive CSRF or unauthorized-target nonmutation.
   Adding semantic validation would be a separate product change.

Widgets Terra owns 1/4 in existing tests; gate 6 has the disposition above. The second Terra, after committing its
Mobile settings increment, owns 2/3/5 on an isolated acceptance branch using new
test files. Sol reviews fixed commits; one combined final run follows. Previously
cleared rows must not be reopened without new evidence. Pre-existing debug
`warn %opts` in ThemeChooser is removed by separate `853d7bde8` (Sol cleared).

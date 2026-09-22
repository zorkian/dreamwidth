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
The following finite proof gates were required before integrating the two BML deletions.
All are now resolved; final status and exact evidence follow the checklist:

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

Final independent disposition:

| Gate | Reviewed source | Evidence |
|---|---|---|
| 1 and 4 | `9cd353e17` | 124 HTTP assertions; real nonzero ownership repair and foreign preservation; browser explicit control types save/reload/reset |
| 2 | `03ff0a8b` atop `2348d4da9` | 56 assertions; distinct rendered category plus designer/layout criteria and community/query context |
| 3 | `3dae19752` atop `718a2d5a5` | Personal/community subtitle, one RPC each, reload; intentional failure exits1 and removes helper |
| 5 | `fed30ca8e` atop `5a7259b3` | Real replacement dropdown identity, alternate mood/nav/force save, fresh reload, reset defaults, unchanged theme/layout |
| 6 | Independent source audit | Not applicable as explained above; shared legacy coercion contract retained |

Sol's finite integration gate is clear. Pre-existing ThemeChooser `warn %opts`
was removed separately by `853d7bde8` and independently cleared. Final production,
translation and acceptance content is integrated locally as `bcdced59f`.
Foreman combined validation passes 17 files / 714 tests, both customization
browser suites, static build, tidy1047 and compile1601. Durable after images are
under `doc/bml-evidence/2026-09-22/customize-after/`. This closes customization;
editor, settings and whole-runtime retirement retain their separate gates.

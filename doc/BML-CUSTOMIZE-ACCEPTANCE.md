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

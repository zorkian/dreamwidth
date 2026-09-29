# S2 JavaScript Journal Server

## Goal

A read-only web server that renders Dreamwidth journal pages from S2 without
running Perl at request time. Send it a journal URL; it returns the same page
the Perl site would.

"The same page" means what a reader sees and uses: content, layout and style,
links, navigation and forms, and no-JS reading. Attribute order, insignificant
whitespace and other serialization details may differ. Matching Perl's
internal behavior (scalar coercion quirks, error text, cache timing) is not a
goal unless it changes a rendered page.

Every journal renders with its own style: system layouts, themes, and user
layers. There is no allowlist of supported styles.

## Non-goals

- Writes of any kind. The server holds read-only database credentials.
- Memcache. All data comes from MySQL.
- Request defenses: captcha, bans, rate limits, image proxying.
- Logged-in viewers. Pages render as an anonymous visitor sees them.
- Recovering or reading stored compiled Perl. Everything compiles from S2
  source.

## How a request is served

1. **Route.** Map the URL to a journal and a view as
   `DW::Controller::Journal::determine_view` does, including its redirects.
2. **Load.** Look up the journal and the data the view needs from MySQL, using
   Dreamwidth's cluster configuration to find the right database.
3. **Authorize.** Drop anything an anonymous visitor may not see: non-public
   entries, screened or deleted comments, suspended or deleted journals.
4. **Compile.** Find the journal's layer stack (core, layout, i18n, theme,
   user) from `s2styles`/`s2stylelayers2`, read each layer's source from
   `s2source_inno`, and compile it with the existing S2 compiler's JavaScript
   backend. Compiled layers are cached by a hash of their source.
5. **Render.** Build the S2 objects (`Page`, `Entry`, `Comment`, ...) from the
   loaded data, run the layers' `prop_init`/`print` in the JS runtime with the
   host builtins, and return the HTML.

Entry and comment bodies pass through the content cleaner before S2 sees them,
exactly where Perl calls `LJ::CleanHTML`.

The views are those `LJ::S2::make_journal` renders with the journal's style:
recent entries (with tag, security and poster filters), entries (with their
polls and embedded media), the year,
month and day archives, tags, icons, reading and network pages, and
stylesheets, and reply pages. Every other response under a journal URL is
one Perl renders in the site's own style: the siteviews style, adult content
warnings, and its error pages for missing, hidden or suspended pages. Those,
and reply pages on a site that requires captchas, get a 501, so a proxy can
send them to Perl.

## Components

| Component | Responsibility |
|---|---|
| `server/` | Fastify app, config loading, URL routing. |
| `data/` | Entity classes (`User`, `Entry`, `Comment`, `Userpic`, ...) that mirror their Perl counterparts and own their SQL. |
| `compile/` | Layer-stack lookup, invoking the S2 compiler, compiled-layer cache. |
| `render/` | S2 object construction, host builtins, running a page. |
| `runtime/` | The S2 JavaScript runtime that compiled layers call into. |
| `src/content` | HTML/CSS cleaner. Independent of S2; usable elsewhere in the site. |

Configuration comes from a Perl shim that dumps the site's configuration as a
JSON file the server reads at startup.

The compiler stays in Perl for now (`src/s2/S2/BackendJS*`). It runs when a
layer is first needed or changes, not per request.

S2 cannot make network calls or touch the filesystem; compiled layers reach
only the runtime and builtins they are given, and the server runs inside a
container. A render therefore needs no sandbox beyond a worker with a time and
output limit, which stops a user layer that loops forever or prints without
end.

## Tests

Tests must catch real regressions. Each one should fail if a reader would see
a wrong page, private data would leak, or unsafe HTML would get through.

- **Page comparisons** (`tests/pages.test.ts`). Fixture journals from
  `tools/seed-fixtures.pl`, rendered by both Perl and this server, compared as
  normalized DOM. They cover the site default style, a theme, a user layer,
  entries with rich HTML, comments, pagination, filters, the archive views
  and stylesheets.
  `tools/compare-pages.mjs` runs the same comparison for any page.
- **Privacy** (`tests/privacy.test.ts`). Non-public entries, screened comments
  and suspended journals never appear.
- **Render limits** (`tests/pool.test.ts`). A style that never finishes is
  stopped.
- **Cleaner** (`src/content/src/tests`). Ported from the Perl cleaner tests in
  `t/`, each stating its expected output, and extended as bugs are found.
- **Compiler** (`tests/compiler.test.ts`). The programs in `src/s2/tests`,
  compiled to JavaScript and run, give their expected output.

Tests state their expected output directly. They do not replay recorded Perl
output, compare internal helpers against Perl, or carry evidence and
provenance tooling. Page comparisons are the one place Perl is run, and only
to render a whole page.

## Running it

```bash
cd src/s2/target/javascript
npm ci && npm run build
perl tools/export-config.pl > config.json
npm start -- --config config.json

perl tools/seed-fixtures.pl          # once, in the devcontainer
npm test
(cd ../../../content && npm ci && npm run build && npm test)
```

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
- Request defenses: captcha checks on visitors, bans, rate limits, image
  proxying.
- Pages for logged-in viewers, for now. The server tells who a logged-in
  viewer is and what they may see (see "Viewers and access"), but leaves
  their pages to Perl.
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

The views are those `LJ::S2::make_journal` renders: recent entries (with
tag, security and poster filters), entries (with their polls and embedded
media), the year, month and day archives, tags, icons, reading and network
pages, stylesheets, and reply pages. Each runs in the journal's style, or in
the site's own siteviews style when asked for (`?style=site`, or
`?style=light` with the text-only scheme) or when the journal's style does
not show entries or icons; siteviews output is then wrapped in the visitor's
site scheme. The journal errors Perl shows in the site's style (unknown,
deleted, suspended, purged and OpenID accounts, suspended entries, bad tag
and security filters, network pages without the feature, and pages that do
not exist) are rendered with the site's Template Toolkit views in the same
way. Locked, memorial and read-only journals render as usual; renamed ones
redirect.

An entry or comment the visitor cannot see gets the same response as one
that does not exist, as on the Perl site: a 404 (which RFC 9110 allows for
hiding a forbidden resource) with the site's `error/unavailable.tt` page, so
no response reveals that something private exists. That covers private and
locked entries, entries and comments by suspended users, screened and
deleted comments, and entry URLs with the wrong anum or date, which name no
entry. A thread link to a hidden comment shows the whole entry, as a link to
a comment that does not exist does. A suspended public entry, whose existence
was already public, still gets the suspension notice.

Adult content is a deliberate difference from Perl. Perl asks a visitor to
confirm before showing a journal or entry flagged for discretion or as 18+,
and remembers the answer. This server serves only anonymous visitors, and an
anonymous visitor must log in to see adult content: every page Perl would put
behind that confirmation gets a 403 with the site's login page, returning to
the page asked for, and nothing to click through. On lists of entries, an
adult entry in a journal that is not flagged shows only a link to its own
page.

Reply forms show a captcha where Perl's would: when the site has one, and
the journal asks it of anonymous commenters (unless the browser's ljtrust
cookie vouches for a recent login to an account in good standing), of
everyone but those it trusts, or of everyone, or when an entry over 30 days
old has reached the comment count that requires one. Perl also asks
commenters past a posting rate or from a banned address; those checks need
its request state, so this server leaves them to Perl, which repeats the
whole test when the comment is posted and shows the captcha then if needed.
The captcha is rendered as DW::Captcha renders hCaptcha's widget.

Journal paths that Perl's own controllers serve, reply forms needing a
captcha type other than hCaptcha, and every request with a logged-in
session get a 501, so a proxy can send them to Perl.

## Viewers and access

Who the viewer is and what they may see are ported, read-only, ahead of
pages for logged-in viewers, which are not built yet:

- `data/session.ts` (`Session`, LJ::Session) finds the viewer's session
  from the master cookie on the main site, or from the journal's signed
  domain cookie on a journal subdomain, checking its expiry, any IP address
  it is bound to, the cookie generation, a second factor where the account
  has one, and the account. Renewing sessions, and sending a visitor without
  a domain cookie to get one, stay with Perl. Where the site names its
  trusted proxies with Perl code, the client's address cannot be told, and a
  session bound to an address is treated as logged in but not acted on.
- `User` (LJ::User and DW::User: trust masks and groups, community
  membership, management, privileges, age and account state), `Entry`
  (`visibleTo`, `visibleComment`), `Comment` (`visibleTo`) and
  `data/adult-content.ts` (DW::Logic::AdultContent) decide what a viewer may
  see, reading the database where Perl reads memcached. The adult content
  pages a viewer has confirmed live only in memcached, so they are not seen.

## Components

| Component | Responsibility |
|---|---|
| `server/` | Fastify app, config loading, URL routing. |
| `data/` | Entity classes (`User`, `Entry`, `Comment`, `Userpic`, ...) that mirror their Perl counterparts and own their SQL. |
| `compile/` | Layer-stack lookup, invoking the S2 compiler, compiled-layer cache. |
| `render/` | S2 object construction, host builtins, running a page; pages in the site's own style (`site-page.ts`). |
| `runtime/` | The S2 JavaScript runtime that compiled layers call into. |
| `template/` | A Template Toolkit engine for the site's own templates (site schemes, error pages), as Perl's Template runs them. |
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
  entries with rich HTML, comments, pagination, filters, the archive views,
  stylesheets, siteviews pages, memorial and renamed journals, and error
  pages in the site scheme.
  `tools/compare-pages.mjs` runs the same comparison for any page.
- **Access** (`tests/access.test.ts`). Each kind of viewer against entries
  at each security level and hidden comments, and sessions from each kind
  of cookie. A request with a logged-in session is left to Perl.
- **Privacy** (`tests/privacy.test.ts`). Non-public entries, screened comments,
  and suspended journals and entries never appear, hidden entries and
  comments answer exactly as missing ones, and adult content needs a login.
- **Render limits** (`tests/pool.test.ts`). A style that never finishes is
  stopped.
- **Cleaner** (`src/content/src/tests`). Ported from the Perl cleaner tests in
  `t/`, each stating its expected output, and extended as bugs are found.
- **Templates** (`tests/template.test.ts`). The Template Toolkit constructs
  the site's templates use give what Perl's Template gives, and every
  template in the repository parses.
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

`tools/bench.mjs` times pages on both servers; `BENCHMARKS.md` has the method
and the latest devcontainer results.

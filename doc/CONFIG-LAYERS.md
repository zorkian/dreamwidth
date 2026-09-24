# Config layering redesign — design spec

*Status: draft for review. Approach A (layered Perl). No code yet.*

## 1. Problem

Configuration lives in three example files plus a code-level defaults module, and
two independent concerns are smeared across the same files with no enforcement:

- **Distribution/profile** (generic open-source ↔ Dreamwidth-branded ↔ some other
  site): sitename, styles, languages, the `ext/dw-nonfree` pointer, feature flags.
- **Environment** (dev ↔ prod ↔ …): DB endpoints, hosts/CDN, debug, `%AUTOSCALER`,
  the dev-container domain blanking.

Three specific pain points fall out of that tangle:

1. **Precedence is by-convention, not enforced.** `LJ::Config` loads
   `config-private.pl → config-local.pl → config.pl → Global/Defaults.pm` with plain
   `do`, so it's **last-wins by load order**. It only behaves like "most-specific
   wins" because lower-priority files use `||=` and the files keep *disjoint key
   ownership* by hand. Two layers touching the same key clobber silently, and there
   is no schema or validation to catch it.
2. **The environment axis leaks into the open-source baseline.** `Global/Defaults.pm`
   — the generic OSS floor — contains `if ($IS_DEV_SERVER && $IS_DEV_CONTAINER)`
   blocks that blank `$DOMAIN`/`$SITEROOT` and rewrite `$SUBDOMAIN_RULES`. Dev-vs-prod
   logic does not belong in the generic defaults.
3. **The "Dreamwidth-flavored" layer barely exists as a concept.** The entire nonfree
   hook is `@LANGS = qw(en_DW) if -d "$HOME/ext/dw-nonfree"`. There's no first-class
   "this is the Dreamwidth profile" selector — just a directory-existence check.

## 2. Goals / non-goals

**Goals**
- Make **Profile** and **Environment** first-class layers, selected explicitly, so the
  three use cases are just coordinates:
  - OSS developer → `generic × dev`, no nonfree
  - someone running DW code without our assets → `their-profile × their-env`, no nonfree
  - Dreamwidth → `dreamwidth × {dev,prod}`, nonfree + secrets
- **Deterministic precedence** with an explicit merge order — kill silent clobbers.
- Pull all environment logic **out of** `Global/Defaults.pm`.
- **Every layer registered and watched** for reload (close the reload blind spot).
- **Prod stays bootable at every step** — phased migration, no big-bang.

**Non-goals (explicitly deferred)**
- YAML/TOML + schema validation (that's approach C; revisit opportunistically once the
  layers are clean).
- Restructuring `%CAP`/`%CAP_PAID`/`%CAP_PREMIUM` composition or `%DBINFO` cluster
  routing — these stay Perl.
- Changing the secret-storage backend. Secrets stay `package DW::PRIVATE;`, never in VCS.

## 3. Current state (verified, for reference)

- `@LJ::CONFIG_FILES` is a fixed list; `load_config` does `do $fn` for each; `reload`
  re-runs it and re-seeds `$LJ::DBIRole->set_sources(\%LJ::DBINFO)` + memcache.
- `start_request_reload` already watches **all** files in `@LJ::CONFIG_FILES` by max
  mtime every 10s — so the reload risk is specifically *files loaded outside that list*.
- Secrets are already namespaced (`package DW::PRIVATE;`) and referenced as
  `$DW::PRIVATE::RECAPTCHA{...}` from public config.
- ~75–80% of config is plain data; the computed ~20% is concentrated: URL derivation
  (`SITEROOT` ← `PROTOCOL`+`DOMAIN` → `IMGPREFIX`/`STATPREFIX`/…), the dev-container
  conditionals, `%CAP` composition, `%DBINFO`.

## 4. Target model

Five layers, lowest → highest precedence, selected by two knobs `DW_PROFILE` and
`DW_ENV`, with a **derive phase** that runs once after merging:

```
  selectors:  DW_PROFILE ∈ {generic, dreamwidth, <site>}      (default: generic*)
              DW_ENV     ∈ {dev, dev-container, prod, test}    (default: dev)

  merge order (each layer plain-assigns; later layer wins):
    1  code defaults      cgi-bin/LJ/Global/Defaults.pm     generic OSS floor, NO env logic
    2  profile/<name>.pl  etc/profile/<DW_PROFILE>.pl       branding, langs, nonfree pointer
    3  env/<name>.pl      etc/env/<DW_ENV>.pl               DB/hosts/debug/autoscaler/blanking
    4  instance           ext/local/etc/config-local.pl     per-install overrides (gitignored)
    5  secrets            ext/local/etc/config-private.pl    DW::PRIVATE, never in VCS
         │
         ▼
  DERIVE PHASE (post-merge, idempotent, re-run on reload):
    - URL chain: SITEROOT ←PROTOCOL+DOMAIN→ IMGPREFIX/STATPREFIX/JSPREFIX/…
    - COOKIE_DOMAIN, SUBDOMAIN_RULES (from env), OPENID_SERVER
    - %CAP composition (spread %CAP_PAID/%CAP_PREMIUM)
    - back-compat shims (EMAIL_VIA_SES → SMTP_SERVER)
    - dev-container short-circuit (empty DOMAIN ⇒ skip URL derivation)

  * default profile: see §13 open question (auto-detect dreamwidth vs explicit)
```

The inversion from today: **lowest precedence loads first** (`Defaults.pm`), **highest
loads last** (secrets), each layer plain-assigns, last-wins is the *intended* semantics
rather than an accident avoided by `||=`.

## 5. File layout

| Layer | Path | In VCS? | Who owns it |
|------|------|---------|-------------|
| 1 defaults | `cgi-bin/LJ/Global/Defaults.pm` | yes (dw-free) | OSS baseline |
| 2 profile | `etc/profile/generic.pl`, `etc/profile/dreamwidth.pl` | yes | profile maintainer; `dreamwidth.pl` may point into `ext/dw-nonfree` |
| 3 env | `etc/env/dev.pl`, `etc/env/dev-container.pl`, `etc/env/prod.pl` | structure in VCS; **real prod values on the config-EFS** | ops |
| 4 instance | `ext/local/etc/config-local.pl` | no (gitignored) | site operator |
| 5 secrets | `ext/local/etc/config-private.pl` | no | site operator |

Notes:
- Layers 1–3 are version-controlled *shape*; layers 4–5 are per-install and never
  clobbered on upgrade (same protection the current `ext/local/etc` split gives).
- For Dreamwidth specifically, the **prod env file with real hostnames/topology** lives
  on the config-EFS (instance-side), not in the public repo — the repo's `env/prod.pl`
  carries only non-sensitive structure/defaults. (See §13.)

## 6. Load & merge semantics

- The loader computes the layer list from `DW_PROFILE`/`DW_ENV`, in fixed
  low→high order, and assigns it to `@LJ::CONFIG_FILES` (so existing reload machinery
  keeps working unchanged).
- Each layer uses **plain assignment** (`$LJ::FOO = …`). No more `||=`-as-precedence.
  A layer that only wants to provide a baseline simply assigns it; any higher layer
  that re-assigns wins.
- **Derived** values are *not* set by layers; they're computed in the derive phase using
  `||=` semantics so a layer can still force an explicit override (e.g. a custom
  `$SITEROOT`).
- **Anti-clobber tripwire (dev only):** an optional debug mode records, per key, which
  layer last set it; when a higher layer overrides a lower layer's value it's allowed
  (that's the point) but a same-layer or unexpected override can be logged. This is a
  lightweight guard, not full schema validation.

## 7. The derive phase

Today the computed values are scattered through `Defaults.pm` interleaved with `||=`
fallbacks and `if dev-container` branches. We extract them into one ordered, idempotent
`LJ::Config::derive()` called at the end of `load_config` **and** from `reload`:

1. If env signals dev-container (`$DOMAIN eq ""`), set the path-based dev values and
   **skip** URL derivation (mirrors current behavior).
2. Else derive the URL chain: `DOMAIN_WEB`, `SITEROOT`, `SHOPROOT`, `RELATIVE_SITEROOT`,
   then `IMGPREFIX`/`STATPREFIX`/`WSTATPREFIX`/`USERPIC_ROOT`/`PALIMGROOT`/`JSPREFIX`,
   `COOKIE_DOMAIN`, `OPENID_SERVER`, `SUBDOMAIN_RULES`.
3. `%CAP` composition and `%CAP_DEF` defaults fill.
4. Back-compat shims (`EMAIL_VIA_SES → SMTP_SERVER`).

Idempotence matters because reload re-runs it; each step is `||=`/guarded so re-running
on already-derived state is a no-op.

## 8. Profile layer & nonfree

- `etc/profile/generic.pl` — neutral defaults (placeholder sitename, `@LANGS = qw(en)`),
  no nonfree.
- `etc/profile/dreamwidth.pl` — Dreamwidth branding, `@LANGS = qw(en_DW)`, and the
  pointer/loads into `ext/dw-nonfree`. This is the *only* layer that knows about nonfree.
- The current `@LANGS = qw(en_DW) if -d ext/dw-nonfree` heuristic is replaced by explicit
  profile selection; a back-compat default can still auto-pick `dreamwidth` when the
  nonfree dir is present (§13).

## 9. Environment layer (fixes the Defaults leak)

All `if ($IS_DEV_SERVER && $IS_DEV_CONTAINER)` logic moves **out of** `Defaults.pm` into:

- `etc/env/dev.pl` — generic dev server (debug on, local services).
- `etc/env/dev-container.pl` — the devcontainer specifics: `$IS_DEV_CONTAINER=1`,
  blank `$DOMAIN`/`$SITEROOT`/`$COOKIE_DOMAIN`, path-based journals. (The derive phase
  reads these and short-circuits URL derivation.)
- `etc/env/prod.pl` — production shape (real `%DBINFO`, hosts, `%AUTOSCALER`, SQS, etc.;
  real values on config-EFS for the DW install).
- `etc/env/test.pl` — replaces the `$LJ::_T_CONFIG` special-case list with a normal env.

`Defaults.pm` ends up purely generic: numeric caps, flag hashes, type lists, baseline
fallbacks — runnable with nothing selected.

## 10. Secrets layer

Unchanged in spirit: `package DW::PRIVATE;`, never in VCS, loaded last so it can fill
secret-bridged values. The `$ENV` bridge (`$LJ::HOME ||= $ENV{LJHOME}`, and prod's
credential injection) is documented as part of this layer so it's a known, registered
input rather than an invisible one.

## 11. Reload correctness

- Because the loader assigns the full selected layer set to `@LJ::CONFIG_FILES`, the
  existing mtime watcher covers **every** layer including profile/env/secrets.
- `derive()` is invoked from `reload()` so recomputation happens on every reload.
- Rule going forward: **nothing loads config outside `@LJ::CONFIG_FILES`.** Anything a
  deployment used to `do` from inside a config file becomes a registered layer instead,
  so it's watched.

## 12. Validation (light, in-scope for A)

Not a schema — just cheap correctness gates:
- **Required-in-prod checks:** when `DW_ENV=prod`, assert presence of pepper keys,
  `%DBINFO`, mail, and required secrets; die loudly at boot if missing (today a missing
  pepper key in prod is only caught by a comment).
- **Selector validity:** unknown `DW_PROFILE`/`DW_ENV` → hard error listing valid values.
- Full schema/type validation is deferred to approach C.

## 13. Backward compatibility & migration (prod stays bootable)

Phased; each phase independently shippable and reversible.

- **Phase 0 — compat shim, zero behavior change.** Introduce the layered loader, but if
  `DW_PROFILE`/`DW_ENV` are unset, fall back to *exactly* today's
  `@LJ::CONFIG_FILES`. Ship; nothing changes in prod.
- **Phase 1 — extract env.** Move the dev-container/env logic from `Defaults.pm` into
  `etc/env/*.pl`; loader includes them by `DW_ENV`. Dev container flips to
  `DW_ENV=dev-container`. Prod still on the compat path.
- **Phase 2 — extract profile.** Split branding into `etc/profile/dreamwidth.pl`;
  `generic.pl` is minimal. Nonfree pointer moves here.
- **Phase 3 — add the derive phase.** Replace scattered computed lines with
  `LJ::Config::derive()`; verify byte-identical resulting `%LJ` on dev + a prod dry-run.
- **Phase 4 — prod cutover (operator-run).** Trim the config-EFS files down to instance
  overrides + secrets; set `DW_PROFILE=dreamwidth DW_ENV=prod`; the env/profile content
  now comes from the (version-controlled) repo layers. Coordinated, reversible by
  unsetting the selectors (back to Phase-0 compat path).

A correctness harness for phases 1–4: dump the fully-resolved `%LJ`/`%DW::PRIVATE`
before and after and diff — the migration is "done" for a phase when the diff is empty.

## 14. Selection & defaults

- `DW_ENV` default `dev`; prod and CI set it explicitly. `test` replaces `$LJ::_T_CONFIG`.
- `DW_PROFILE` default: **open question** (§13 below) — either `generic`, or auto-detect
  `dreamwidth` when `ext/dw-nonfree` exists (back-compat with today's heuristic).
- Both read once at config-load; changing them is a process restart, not a reload.

## 15. Implementation phases (work breakdown)

1. Loader: `DW_PROFILE`/`DW_ENV` → dynamic `@LJ::CONFIG_FILES` + Phase-0 compat fallback.
2. `LJ::Config::derive()` extracted from `Defaults.pm`, called from load + reload.
3. `etc/env/{dev,dev-container,prod,test}.pl` + migrate dev container.
4. `etc/profile/{generic,dreamwidth}.pl` + nonfree pointer.
5. Light validation (required-in-prod, selector validity).
6. Resolved-`%LJ` diff harness for migration verification.
7. Docs: update `config-*.pl.example`, this file, and CLAUDE.md's dev-container notes.

## 16. Risks & open questions

- **Default profile selection.** Auto-detect `dreamwidth` from the nonfree dir (zero-touch
  back-compat) vs require explicit `DW_PROFILE` (cleaner, but a flag day for every
  install). *Recommendation: auto-detect, with an explicit override winning.*
- **Where the real Dreamwidth prod env lives.** `env/prod.pl` in the public repo can only
  hold non-sensitive shape; real hosts/`%DBINFO` stay on the config-EFS. Need to decide
  the split between "repo prod shape" and "config-EFS prod values."
- **`reload` vs selectors.** Selectors are fixed per process; only layer *contents*
  reload. Confirm nothing expects to switch profile/env at runtime (nothing should).
- **Hidden out-of-band loads.** Audit prod's config-EFS for any `do`/`require` of files
  not in `@LJ::CONFIG_FILES` before Phase 4, or they'll silently stop being watched.
- **`%CAP` composition stays Perl.** Fine for A; flag it as the main thing approach C
  would have to handle (YAML merge keys / anchors) if we ever go there.

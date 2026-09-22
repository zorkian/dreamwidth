# Remaining rendering seams

Read-only inventory at foreman `e0a505fe1`. These bounded packages can proceed
independently of held inbox security work and the unapproved UniqCookie package.
No engine deletion or public editor/inbox cutover is implied.

| Consumer | Native disposition | Required ordinary rendering evidence |
|---|---|---|
| Admin FAQ readcat callback | Remove controller callback and TT call to BML note_mod_time; do not invent HTTP cache headers | Actual handler/template content with FAQ time greater than seeded BML base_recent_mod; global unchanged and no new Last-Modified; existing category/order/summary output |
| S2 journal-note consumers | Read current DW request note directly; remove genuinely unused request locals | Sequential journals A/B, missing/no request, ordinary userpic hook arguments and return bytes, frozen-time DateTime output, actual cleaner embed callback |
| OPML default-user redirect | Use current request redirect with same destination/status contract | Actual logged-in no-user GET Location; explicit user output unchanged; no BML request environment dependency |
| Shared authas labels | Replace two global BML ML lookups with native full-key lookup | Actual selector labels through request getter and no-request fallback; existing selection and output escaping unchanged |
| std_max_length language selection | Use raw native request-context language with preserved language-code mapping | English/default80, listed languages100, other80, successive request languages, background fallback; actual JournalTitles truncation boundary |
| Control strip global labels | Native full-key lookups without changing selection/hook/link behavior | Actual personal/community/logged-out strip, custom getter/substitution and userpic labels, identical selected links and default output |

## Deliberate separations

- LJ::Web entry_form and entry_form_decode still serve the retained legacy
  editor. Most remaining translation calls are inside these functions; remove
  them with their callers after full editor parity, rather than mechanically
  migrating doomed form-building code.
- LJ::Web bad_input/error_list/warning_list still emit BML wrapper tokens.
  Changing just their label lookup does not make returned output native. Audit
  consumers and choose native markup or a distinct native caller path while
  legacy callers remain; do not retain a permanent BML shim.
- PageStats get_request is only used by its filename method in-tree. Neither GA
  plugin uses these APIs. DW::Request has no physical filename; the existing
  Plack BML adapter returns an unset _filename. Do not synthesize filesystem
  paths from URI. Characterize plugin output and disposition external filename
  API before conversion/removal.
- Journal/feed rendering still passes an Apache-style adapter explicitly.
  Replacing private request-note reads does not resolve that separate interface
  or the S2 BML language initialization consumer.
- Scope, hooks, substitutions and old translation identifiers are compatibility
  contracts. Tests should invoke actual functions/handlers, not assert source
  grep removal as a substitute for behavior.

## Text-length audit follow-up

Sol read-only audit confirms three active effects of `std_max_length`: legacy
entry-form current_location and current_music maxlength attributes, and trimming
of all four JournalTitles properties. Read raw `LJ::Lang::request_context` language;
do not use effective/default language, which would change no-request behavior
when the configured default is one of the 100-character languages. Preserve the
existing mapping: absent context/language, debug, English and unlisted codes80;
listed codes100. Sequential en/ru/reset/debug coverage must prove isolation.

Required concrete acceptance: render both entry-form maxlength values, and save
105-character JournalTitles values under English and Russian, verifying exact
80/100-character forced-fresh stored values. This package is not implemented yet.

## Remaining setting-language/theme consumers

- Birthday error_check still localizes BML::ML_SCOPE while calling native relative
  ML keys. Current messages live in views/manage/profile.tt.text. A bounded
  explicit-key conversion must preserve the existing date rules and error fields;
  it is assigned to Terra, not yet integrated.
- SiteScheme save already persists user/cookie choice through DW::SiteScheme,
  then calls BML::set_scheme. The native request selector is set_for_request;
  verify same-response and fresh-response wrapper selection before substitution.
  Keep BMLschemepref cookie name, default-cookie deletion, user choice persistence
  and invalid-choice behavior. Login reset of BML scheme is a separate caller.

# Settings hub migration acceptance

The hub is now native (`DW::Controller::SettingsHub`, `views/settings/index.tt`),
integrated as `035e27196` after independent Sol review through worker
`0d8fd5ff6`. All specified finite acceptance gates below are closed. The legacy
source/behavior descriptions are the preserved migration baseline.

Final review includes aliases and real POST dispatch, actor permissions, cookie
settings, hooks/account statistics, notification add/edit/delete/page context,
receiver return URLs, translation scopes, native validation markup, localized
unsaved navigation, Other Sites resource compatibility and narrow layout.
Foreman integrated validation passes17 files /501 tests, static build,1058 tidy,
1605 compile and the disposable browser flow. Matching15-state captures and two
additional narrow states are in `doc/bml-evidence/2026-09-22/settings-after`.
All captured routes return200 with no JS or resource errors. The default local
notification configuration has no available methods in both before and after
screenshots; configured-method persistence is exercised by the HTTP fixtures.

## Routes, actors and categories

Preserve `/manage/settings/`, index and BML aliases, `cat`, `authas`, notification
`user`/`page` queries, POST field names and moved translation scope. Invalid or
disabled categories fall back to account for authenticated actors and display
for anonymous visitors. Community navigation and authas switching retain category.

| Actor | Required behavior |
|---|---|
| Anonymous | Display settings only; supported cookie settings save and reload |
| Personal | Account, display, notifications, mobile, shortcuts, privacy, history, other sites |
| Community maintainer | Account, display, community and privacy with community-specific visibility |
| Unauthorized authas | GET and valid-token POST denied; target unchanged |
| `canview/subscriptions` | Notification inspection of another user is read-only; forged POST cannot mutate |

The nine built-in categories are augmented by `settings_extra_cats`. Preserve
category ordering, visibility/disabled flags, `should_render`, conditional rows,
setting links/help, and `settings_account_stats`. A test hook must demonstrate
that extension-provided settings still render and save with the same rules.

## Mutations and failures

Use the actual rendered field contracts. Exercise representative settings from
every editable family with fresh user/cookie reads after save: display choices,
privacy permissions, community membership/posting/moderation, shortcuts, mobile
keys and other-sites accounts. Keep destructive fixture actions on disposable
users and stub external services; do not contact real crossposting accounts.
Account/history categories retain their existing links and read-only displays.

For each distinct save path test valid, missing and invalid form tokens, useful
validation text and preserved submitted input. Invalid authorization must be
tested with an otherwise valid token. Check unrelated values remain unchanged.
Retain `LJ::Setting->save_all`, `errors_from_save` and `args_from_save` semantics.

Notifications have separate paths: save subscriptions; `deleteinactive`;
`post_to_settings_page` from tracking/manage; and successful `ret_url` return.
Cover add/change/delete, inactive cleanup, paging and subscribed-state persistence.
Review redirect validation and all callers rather than blindly forwarding input.
Legacy `deletesub_<id>` GET mutates without CSRF; migration must retain the old
link entry point safely (for example confirmation followed by authenticated POST),
update generated links/forms, and prove GET alone cannot delete a subscription.
Privileged read-only inspection must not expose working mutation controls.

## Browser and resource acceptance

The settings page currently activates the jquery resource group, whereas the
replacement uses Foundation. Verify settings/notification controls against actual
rendered runtime ordering; do not assume the widget adapter fixes every setting's
inline JavaScript. Cover unsaved-change navigation, conditional fields, validation,
notification controls, community switching, keyboard access and narrow layout.

Foreman baseline: 15 captured states in host `/tmp/bml-astra-settings-before`,
container `/tmp/bml-settings-before`; script `/tmp/bml-settings-baseline.js`.
All requests were HTTP 200 without resource failures. Personal Other Sites has
an existing `Cannot set properties of undefined (setting 'display')` exception;
source inspection points to legacy DOM lookup in XPostAccounts. Other captured
states had no exceptions. These screenshots do not prove saves work. Capture
matching migrated states and inspect them before deleting the BML source.

`t/settings.t` covers only Gender/Name helpers and is insufficient hub coverage.
Add HTTP integration tests and actual browser mutations, retain inherited GPL
notices when moving the legacy controller logic, and review fixed commits
independently before foreman integration.

Receiver return-URL baseline: `t/plack-settings-return.t` proves the real tracking
form adds an Inbox subscription and returns to a validated same-origin Referer,
while CSRF/quota failures stay on settings. Separate valid-token direct receiver
POSTs with absolute and scheme-relative offsite ret_url currently fail explicit
TODO safety assertions. These become required automatically when the legacy BML
hub is removed. Validate at the receiving controller; do not trust hidden fields.

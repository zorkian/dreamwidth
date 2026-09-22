# Settings hub controller conversion plan

This plan follows the legacy characterization in `t/plack-settings.t`. It does
not migrate `htdocs/manage/settings/index.bml` yet.

## Compatibility boundary

The controller must serve `/manage/settings/`, `/manage/settings/index`, and
`/manage/settings/index.bml`, preserving `cat`, `authas`, notification `user`
and `page`, and every rendered field name. Invalid/disabled categories select
account for authenticated targets and display for anonymous visitors.

Keep `LJ::Setting->save_all`, each setting class's `should_render`,
`errors_from_save`, and `args_from_save` contracts. Invoke
`settings_extra_cats` before validation and `settings_account_stats` while
rendering account. The template receives prepared categories, rows, errors,
and submitted values; it must not duplicate authorization or save decisions.

## Request flow

1. Resolve remote, `authas`, and the privileged notification-inspection
   `user` target. Only `canview/subscriptions` may inspect another user.
2. Resolve category visibility before rendering or mutation. Inspection is
   read-only and has no working mutation form.
3. On POST, check CSRF before any settings/subscription action. Authorize the
   selected target before invoking `save_all`, `save_subscriptions`, or
   inactive cleanup. Preserve submitted invalid values and useful validation.
4. For successful notification posts, retain the existing validated `ret_url`
   caller contract. Review each caller rather than forwarding arbitrary URLs.
5. Render Foundation resources in the replacement while keeping the legacy
   form names/actions until all callers migrate.

## Legacy deletion transition

`deletesub_<id>` currently mutates on GET and is characterized only to prevent
silent loss of the entry point. The replacement must make GET render a
confirmation for the requested owned subscription, then perform deletion only
through an authenticated CSRF POST. Generated links and tracking callers move
to that confirmation/POST flow. A bare GET must have no mutation test.

## Evidence and gates

Legacy screenshots and forms are captured in `/tmp/bml-settings-current`; the
matching baseline is `/tmp/bml-astra-settings-before`. The current capture has
HTTP 200/no resource failures for all matrix states and reproduces the known
Other Sites `XPostAccounts` JavaScript exception.

Before source deletion, require real-session tests for anonymous cookie saves,
all editable categories, hook-added rows, invalid-input preservation,
notification `ret_url`, read-only inspection, and the safe deletion flow, plus
browser tabs/unsaved-change/narrow-layout checks.

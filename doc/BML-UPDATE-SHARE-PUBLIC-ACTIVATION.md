# Authenticated share GET public activation handoff

Source-only audit at callable tip `d7784f3f8` plus formatting-only `bbb0a2970`. No route change or external URL fetch was performed.

## Exact insertion point

The public `/update` route already sends GET to `legacy_update_get_handler` and preserves `.bml`, non-GET, and BML fallback behavior (`DW::Controller::Entry.pm` registration around lines 93-106).

Within `legacy_update_get_handler`, keep the accepted order unchanged:

1. Convert request GET args once to the flat legacy hash.
2. Invalid nonempty `usejournal` native terminal.
3. Load the session remote; anonymous requests fall through to BML.
4. Beta 302 with retained query behavior.
5. Identity and cannot-post native terminals.
6. Alternate-login fallback.
7. Share dispatch.
8. Ordinary readonly native warning form.
9. Ordinary authenticated native editor.

The smallest activation is to split the current combined exclusion at lines 1238-1240:

```perl
return undef if $get->{altlogin};
return legacy_update_share_get_handler( remote => $remote, get => $get )
    if $get->{share};
```

This must remain before the ordinary readonly branch. Passing the already-converted `$get` preserves the exact flat hash reference for `update_fields` and avoids query reconstruction.

The callable returns `undef` for readonly. Returning that result directly from `legacy_update_get_handler` intentionally falls through to retained BML, where share prefill and the readonly warning are composed together. Do not continue from a declined share call into `legacy_update_readonly_get_handler`: that helper does not perform share page construction and would lose the share prefill.

The same direct-return rule preserves fallback for any callable decline or future classified failure. A defined rendered result claims the request; `undef` reaches BML without a second native renderer.

## Preserved precedence

- Invalid target, beta, identity, and cannot-post remain before share construction, matching retained `update.bml` lines 39-70. Their responses must not call the page factory or `update_fields`.
- `altlogin+share` remains wholly BML-owned. Retained BML does construct the page and renders its credential UI; the callable deliberately excludes this schema.
- `readonly+share` remains wholly BML-owned because the accepted callable excludes readonly and the ordinary native readonly helper lacks share transformation.
- Anonymous share remains BML-owned because remote resolution precedes share dispatch.
- Normal authenticated share uses the accepted callable: page construction precedes `update_fields`, hook target mutation is read afterward, and the native correction action is `/entry/new` with the raw query preserved.
- A false page factory result is still a claimed normal authenticated share and renders the native form with original GET prefill. A factory exception remains a framework error rather than falling through and constructing twice.
- Non-share GET, HEAD, and non-GET dispatch remain unchanged.

The callable repeats pure eligibility checks already performed by the wrapper (target/beta/identity/can-post). That is redundant but does not alter the required ordering because the external page factory and hook remain after every guard. If these checks are later deduplicated, use an explicit already-classified internal option rather than moving share before the public terminal branches.

## Finite public HTTP matrix

Use the real application route and a scoped local `DW::External::Page::new` stub. Do not perform a network fetch. Cover both `/update` and `/update.bml` where alias behavior matters.

1. **Normal authenticated share:** 200 native `js-post-entry` form; exact localized legacy title; exact parsed subject, event href/description/newlines, and tags; canonical `/entry/new` action retains encoded and repeated query; factory once; `update_fields` once with the original flat/NUL request reference; post-hook target mutation selected; force-fresh entry, draft, editor, and preference state unchanged.
2. **Alias and isolation:** both aliases reach the callable without redirect; share followed by ordinary GET and user A followed by user B do not leak page, hook, target, editor, or query state.
3. **Invalid target plus share:** exact native invalid-target title/message, no form or Location, factory zero, hook zero.
4. **Beta plus share:** exact retained 302 and Location/query, factory zero, hook zero.
5. **Identity plus share and cannot-post plus share:** exact native terminal title/message, no form, factory zero, hook zero.
6. **Readonly plus share:** retained BML `updateForm`, visible readonly warning, retained share subject/event, factory exactly once, and no native `js-post-entry` form.
7. **Altlogin plus share:** retained BML form and credential controls, retained share prefill, factory exactly once, no native form.
8. **Anonymous plus share:** retained anonymous BML form, retained share prefill, factory exactly once, no native form. This is rendering fallback only and makes no anonymous POST/authentication claim.
9. **False factory and exception:** false return gives a native form with original GET subject/event/tag and one hook call; exception produces the existing framework error and does not fall through or invoke the factory twice.
10. **Unaffected dispatch:** ordinary authenticated GET remains native; HEAD and unsupported methods retain existing fallback; POST handler counters and behavior are unchanged.

Use inert counters for BML/native selection and factory/hook calls. Assertions should identify `updateForm` versus `js-post-entry`, not infer the renderer only from status 200.

## Finite browser proof

Run a plain `app.psgi` server with only a process-local page-factory stub; do not register a test route and do not fetch a URL.

- Log in with the disposable fixture, visit the actual `/update?share=...` alias, and assert the native form, localized title, page-derived subject/event, tags, editor, exact canonical action/query, no dialogs/page errors/request failures, and usable subject/body controls at desktop and 390px.
- Force-fresh fixture state before/after must show no entry, draft, editor, or preference mutation.
- Include normal, named intentional failure, and clean startup/fixture failure paths with no remaining fixture, Starman, or Chrome process.

This gate activates only authenticated, non-altlogin, nonreadonly share GET rendering. It does not authorize an external live fetch in tests, anonymous/alternate-login schema changes, readonly native share composition, POST changes, or BML deletion.

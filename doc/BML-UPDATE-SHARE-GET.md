# Callable `/update` authenticated share GET rendering audit

Scope: source-only, rooted at foreman `a88bb4e97` / current public manager worktree. This excludes
anonymous and alternate-login POST/authentication, public routing, URL/network fetches, deployment hooks,
and all held work.

## Retained source contract

`htdocs/update.bml` performs the following order for `GET share`:

1. `LJ::text_in` and nonempty invalid `GET usejournal` guard run before remote lookup.
2. The session remote is loaded; beta redirect then identity/cannot-post terminal branches happen before
   form construction. A remote identity/cannot-post request with `share` therefore remains a terminal page.
3. The retained code computes GET prefill (`subject`, `event`, `prop_taglist`) and then, when `GET{share}`
   is truthy, calls `DW::External::Page->new(url => $GET{share})` exactly once. `altlogin` does **not**
   suppress that retained code; it is a separate public-activation/auth schema gate.
4. When a page object is returned, retained output replaces subject with `LJ::ehtml($page->title)` and
   event with literal legacy markup:
   `<a href="` + raw `$page->url` + `">` + (`LJ::ehtml($page->description)` or escaped title or raw URL)
   + `</a>\n\n`.
   A false/undef factory result leaves the earlier GET prefill intact. This is the exact legacy escaping
   behavior: title/description are ehtml'd; URL is not. A migration must not silently strengthen or weaken
   it without a separate behavior decision.
5. Only after optional share replacement, `LJ::Hooks::run_hook('update_fields', \%GET)` is invoked once
   with the original flat legacy hash reference (repeated values NUL-joined). Hook `subject`, `event`,
   `tags`, and `prop_opt_preformatted` override the share/default values. The hook can mutate `usejournal`;
   retained target resolution happens after the hook. Prefill snapshot semantics for ordinary fields do not
   erase this share-before-hook ordering.
6. Retained remote editor uses `remote->new_entry_editor`; hook `prop_opt_preformatted` controls raw mode.
   It builds remote crosspost account defaults and normal date/time/default-security state. No entry, draft,
   or preference write occurs on GET.
7. Retained BML title is `.title2` under `/update.bml` scope. Its form action is legacy `update` (plus
   `altlogin=1` only); current native renderers deliberately use `/entry/new` with
   `keep_query_string => 1`. A share migration must make this action/query decision explicit rather than
   treating native action/query behavior as byte parity.

## Current native seam and smallest implementation

`DW::Controller::Entry::legacy_update_get_handler` correctly returns `undef` for `altlogin || share`
before `update_fields`, external-account enumeration, or form rendering. `legacy_update_get_render` is a
render-only composition helper; it does not call `update_fields` or fetch a page. `_prepopulate` has a
similar share transformation but currently is not used by the legacy GET handler and has no hook/order
contract of its own.

Smallest callable-only follow-up:

- Add a private `legacy_update_share_get_handler` (or an explicitly named private helper) called only after
  retained invalid-target/beta/identity/cannot-post gates and only for an authenticated, posting,
  non-readonly, non-altlogin `GET share` request.
- Convert request args once with `DW::Entry::Legacy::legacy_post_hash`; preserve that exact original flat
  hash for `update_fields`. Call a caller-supplied/factory-injected `DW::External::Page->new` once, with no
  networking introduced by the adapter itself.
- Compute retained subject/event/tag defaults; apply the page replacement exactly above if present; invoke
  `update_fields` once; resolve `usejournal` after the hook; calculate existing remote crosspost/default
  data; call the existing `legacy_update_get_render` once with a precomputed form payload (or a narrowly
  extended render input) and explicit `/update.bml.title2` title scope.
- Preserve raw encoded/repeated query in the native correction action as the current migrated GET slices
  do. This is a deliberate native retry behavior that must be documented/tested beside the retained BML
  action difference. Do not change `new_handler` defaults or `_prepopulate` globally.
- Factory exceptions currently propagate through retained BML because construction is not eval-wrapped;
  preserve that failure behavior unless a later source characterization establishes a framework error page.

## Finite tests before any public activation

Use a local `DW::External::Page::new` stub returning an object with `title`, `url`, `description`; it must
not fetch a URL. Tests should run a callable/test-only route only, never public `/update` registration.

1. Normal share, distinct legacy getter markers, and both S2/plain editor conditions:
   - page factory receives raw requested share URL once;
   - parsed native subject/event/tag fields preserve title, href/description/newlines according to the
     exact legacy transformation; assert source HTML/parsed values where form escaping necessarily occurs;
   - `.title2` marker is retained under `/update.bml` scope;
   - raw/casual/RTE selection matches remote legacy editor plus hook preformat override;
   - action is canonical `/entry/new` and retains exact encoded/repeated raw query, including `share`.
2. Hook order/reference:
   - record one hook call, the same flat hash reference and NUL-joined repeat values;
   - hook sees page-derived state only through its return override semantics, overrides subject/event/tags,
     mutates `usejournal` to a valid target, and parsed form target follows that mutation;
   - prove ordinary pre-hook fields and share replacement do not leak to a sequential non-share request.
3. Failure/no-page and boundaries:
   - false factory preserves original GET subject/event/tag and invokes hook once;
   - identity/cannot-post/beta/invalid-usejournal/readonly/altlogin requests do not construct a page in the
     callable wrapper and retain their already-reviewed terminal/fallback contracts;
   - force-fresh entry count, draft body/properties, editor preferences, and external-account state remain
     unchanged. No scheduler/transport stub is needed because GET rendering has no delivery path.

Existing evidence to reuse: `t/legacy-update-get-handler.t` lines 112/244 proves the current share
fallthrough and zero factory calls; `t/plack-update-get-activation.t` lines 66-155 stubs a page and proves
retained BML title/event behavior on the actual app. Those tests establish baseline/fallback, not the
native share rendering contract above.

## Deferred questions (characterization, not a product decision)

- Confirm framework-visible handling of a `DW::External::Page->new` exception with a stub before changing
  exception behavior.
- Compare exact source/DOM representation of raw URL attribute escaping under BML versus TT/form escaping;
  preserve the source contract unless a documented safety migration is separately approved.
- Public activation remains gated on explicit action/schema acceptance: native retry form (`/entry/new`,
  native fields) differs from retained BML `update` action and legacy anonymous/altlogin credentials.

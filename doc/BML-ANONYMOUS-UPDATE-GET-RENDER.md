# Anonymous `/update` GET render audit

Audited source checkpoint: `c9fb04a1f380d2c75116f49c07d2a11225348cc5`.
Scope is anonymous GET rendering only. Authentication, POST dispatch, alternate login,
share fetching, permission changes, inbox work, and deployment interfaces are excluded.

## Retained contract

- `htdocs/update.bml:37` sets the page title from `/update.bml.title2` (`Post an Entry`).
- `htdocs/update.bml:81-100` uses server time when there is no remote and snapshots
  `subject`, `event`, and `prop_taglist` from POST-or-GET. On a GET this is the GET value.
- `htdocs/update.bml:108-116` invokes `update_fields` once with the original flat GET hash.
  Returned `subject`, `event`, `tags`, and `prop_opt_preformatted` override the snapshot by
  key existence. Repeated query values therefore remain the retained NUL-joined scalars.
- `htdocs/update.bml:127-185` displays the credential controls for an anonymous request.
  Their submitted names are `user` and `password`; `user` is prefilled from POST-or-GET.
- `htdocs/update.bml:199-219` supplies the legacy entry form with canonical GET
  `usejournal`, the site `$LJ::DEFAULT_EDITOR` choice, RTE capability, server datetime,
  hook formatting override, and no authenticated-user defaults.
- `htdocs/update.bml:262-266` renders `id=updateForm` with relative action `update` for the
  ordinary anonymous GET. It includes `LJ::form_auth`, although anonymous POST auth is a
  separate concern.
- The legacy anonymous form has no saved user drafts, user preferences, crosspost accounts,
  userpics, or custom access groups. `LJ::entry_form` still renders the ordinary entry
  content/options that do not require a remote user.

## Existing native behavior and incompatibilities

- `DW::Controller::Entry::new_handler` already permits an anonymous render and `_init`
  selects `default_entryform_panels(anonymous => 1)` (`Entry.pm:121-196,1086-1088`).
- `legacy_update_get_render` already implements the needed GET/hook mapping for subject,
  body, tags, editor mode, datetime, journal, and explicit action (`Entry.pm:728-759`). It
  can operate with `remote => undef`; it should be reused rather than adding another form
  pipeline.
- The native page title is `/entry/form.tt.title` (`Create Entries`) at
  `views/entry/form.tt:65`; it currently has no caller-supplied title override. A retained
  anonymous wrapper needs the explicit `/update.bml.title2` title.
- Native anonymous credentials use `username` and `password`, plus `post_as=other` and
  `postas_usejournal` (`views/entry/module-journal.tt:41-48,79-102`). The login modal also
  uses `username`/`password` (`views/entry/login.tt:18-38`). The retained form uses
  `user`/`password` and `usejournal`.
- Native `_auth` consumes `username`, not `user` (`Entry.pm:1605-1645`). Therefore merely
  pointing the native form at `/update`, or merely pointing the retained schema at
  `/entry/new`, changes the POST contract. A supplied anonymous `usejournal` also needs an
  explicit decision: the native module displays a resolved journal but its anonymous
  submission field is `postas_usejournal`.
- `_prepopulate` reads `tags`, while retained `/update` uses `prop_taglist`; the existing
  `legacy_update_get_render` mapping already handles this and should remain the entry point.
- The native default action preserves the current query. The ordinary retained anonymous
  form action is `update` without that query. The callable must accept an explicit action;
  public activation must wait for the POST-schema decision.

## Smallest safe callable package

Add a callable anonymous GET renderer alongside `legacy_update_get_render`; do not register
it publicly yet.

1. Require an actual GET and no remote user. The eventual route caller continues to own the
   existing invalid-target, identity/cannot-post, beta, alternate-login, and share ordering.
2. Convert request GET arguments to the retained flat hash once. Snapshot
   `subject`/`event`/`prop_taglist`, then invoke `update_fields` once with that same mutable
   flat reference. Resolve hook overrides with `exists`, as the retained page does.
3. Compute anonymous server datetime and RTE support, pass `$LJ::DEFAULT_EDITOR`, canonical
   `usejournal`, and no crosspost accounts to `legacy_update_get_render`.
4. Add a narrow optional title override to the shared new-form renderer/template and pass
   `LJ::Lang::ml('/update.bml.title2')`. The default `/entry/new` title must remain unchanged.
5. Keep the form action an explicit callable option. Tests may render either candidate
   action, but no public route should select one until the credential/target POST schema is
   decided and tested.

Do not duplicate `_init`, `_render_new_form`, the TT form, or anonymous authentication.

## Finite render-only acceptance

1. Under a real `DW::Request` with no cookies, render subject/body/tags containing markup
   and verify parsed values, exact localized legacy title, visible form, and no missing-string
   banner.
2. Supply repeated query values and a localized `update_fields` fixture. Prove exactly one
   hook call, the same original flat hash reference, NUL-joined repeats, pre-hook field
   snapshot semantics, and `exists`-based empty overrides.
3. Exercise site-default rich and plain editor choices with RTE available/unavailable and
   the hook preformatted override; assert the actual selected native editor control.
4. Exercise absent and valid `usejournal` only as rendering data. Assert the displayed
   target and record the emitted target-field schema; do not claim posting or permission
   behavior.
5. Assert the explicitly supplied form action exactly, including absence of accidental
   query duplication. Also assert direct `/entry/new` keeps its existing title/action.
6. Parse and name every anonymous credential/target control. Treat the observed native
   `username`/`password`/`post_as`/`postas_usejournal` schema and retained
   `user`/`password`/`usejournal` schema as an unresolved activation decision, not parity.
7. Render two sequential anonymous requests with distinct fields/hook results and prove no
   cross-request leakage. Force-fresh fixture reads must show no entries, drafts, editor
   preferences, or other user properties changed.

## Separate later gate

Before public anonymous `/update` GET activation, choose and prove one complete POST path:
either emit retained credential/target names and adapt them deliberately, or use the native
schema/action and characterize its authentication result against retained behavior. That
gate requires actual authentication and failed/successful POST coverage and is deliberately
outside this render-only package.

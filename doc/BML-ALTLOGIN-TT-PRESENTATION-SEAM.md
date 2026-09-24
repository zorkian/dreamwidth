# Callable altlogin TT presentation seam

Source audit date: 2026-09-23. This is a rendering design aid only. It does not
authorize a public route, POST composition, password authentication, or a
credential schema change.

## Current boundary

`DW::Controller::Entry::legacy_update_get_render` already preserves the
authenticated remote when it calls `_init` and `_render_new_form`. That remote
is what supplies editor preferences, draft state, panels, icons, access groups,
journal lists, crosspost defaults, display-date defaults, and the `#js-remote`
marker. The presentation seam must keep passing that remote unchanged. Passing
`undef` merely to reuse the logged-out login modal would silently replace those
defaults and would activate the wrong JavaScript path.

`views/entry/form.tt` includes `entry/login.tt` only when `remote` is absent.
The existing partial is a one-time native login modal. It emits hidden
`username` and `password` controls, duplicates those names inside the modal,
and `htdocs/js/pages/entry/new.js` copies the modal values into the hidden
controls before submitting. `_auth` consumes `username`. None of this is the
retained altlogin schema, whose visible field is `user`, whose password starts
blank, and whose submit control is `action:update`.

Because `#js-remote` remains present, `new.js::hasRemote()` is true. The normal
one-time modal interception on `input[name='action:post']` is therefore not
installed. Draft, editor, journal, security, and panel initialization continue
to use the authenticated remote. Preview temporarily disables every enabled
password input and restores the form action; preview compatibility remains a
separate route/schema gate.

## Smallest option boundary

Use one narrowly named render option, for example:

```perl
legacy_altlogin => {
    username => $post_hook_get->{user} // '',
}
```

The structure should contain display data only. It must not receive the raw GET
hash, password, or an arbitrary action URL.

1. `_render_new_form` copies the whitelisted structure to
   `$vars->{legacy_altlogin}`. It also accepts the already existing explicit
   `action_url` and a narrow `submit_action_name`, defaulting to
   `action:post`. Permit `action:update` only for this compatibility option.
2. `legacy_update_get_render` forwards `legacy_altlogin` and the submit action
   without changing `remote`, `_init`, `formdata`, editor selection, or drafts.
3. The future callable altlogin handler supplies the fixed action
   `/update?altlogin=1` and `action:update`. It must not use
   `keep_query_string`: retained rendering intentionally discards every other
   GET field from the action, including credential-like `password` input.
4. In `views/entry/form.tt`, include `entry/login.tt` when
   `legacy_altlogin` is present or when `remote` is absent. Parameterize both
   ordinary post buttons with the allowlisted submit name so the callable form
   has `action:update`; all existing callers retain `action:post`.
5. In `views/entry/login.tt`, add a top-level `IF legacy_altlogin` branch. That
   branch renders a visible `#altlogin_wrapper` fieldset containing:
   - `form.textbox` named `user`, id `altlogin_username`, with an explicit
     `value = legacy_altlogin.username`;
   - `form.password` named `password`, id `altlogin_password`;
   - absolute labels `/update.bml.username` and `/update.bml.password`.

   `form.textbox` escapes the explicit value. `form.password` uses
   `noautofill`, so it never copies a datasource value. The branch must not
   emit the ordinary modal, its hidden `username`/`password` fields, or
   `#js-post-entry-login`. The existing modal stays byte-for-byte behaviorally
   unchanged in the `ELSE` branch.

This is enough to show the retained credentials while keeping the remote's
entry defaults. The hidden `#js-remote` marker must remain because modern entry
JavaScript uses it to select authenticated initialization. The compatibility
branch should not add old `htdocs/js/entry.js`; that script assumes
`document.updateForm`, rewrites actions, hides unrelated controls, and would
mix the legacy and native initialization models.

## Action and credential safety boundary

The explicit form action is a fixed compatibility value, not the current raw
query. In particular, this is wrong:

```perl
LJ::create_url('/update', keep_query_string => 1)
```

With `GET password=encoded%3Cpassword-marker%3E`, that would expose the marker
in rendered HTML even if the password input itself were blank. The callable
display proof must require the exact normalized action
`/update?altlogin=1`, a blank parsed password, and absence of the unique marker
in the entire response, including percent-encoded form actions.

Rendering `user`, `password`, and `action:update` does not make the native
`_auth` path compatible. `_auth` reads `username`; retained update reads
`user`, applies its own missing-password and `auth_okay` behavior, then performs
the separately characterized protocol and hook sequence. The callable renderer
must remain unregistered until a reviewed POST adapter owns that schema and its
failure continuations. The test-only form action is therefore a compatibility
contract for later composition, not evidence that submitting it is safe today.

## Finite display assertions

Actual RequestWrapper plus real TT rendering should prove:

1. Authenticated remote remains in `_init`: distinct remote editor,
   `disable_auto_formatting` off/on, draft data, panel/default state, and
   selected post-hook journal render correctly and remain unchanged fresh.
2. `#altlogin_wrapper` is visible; `user` contains the escaped post-hook value;
   `password` parses blank; the response contains neither the supplied password
   marker nor its percent-encoded action reflection.
3. There is no `#current_username`, `#js-post-entry-login`, hidden native
   `username`, or duplicate password control. `#js-remote` remains present for
   authenticated JavaScript initialization.
4. The form action is exactly normalized `/update?altlogin=1`; both visible
   submit buttons use `action:update`; `lj_form_auth`, post-hook `usejournal`,
   and the existing preview/spellcheck controls remain present.
5. Ordinary authenticated, anonymous, share, and edit renderers retain their
   current action names, modal behavior, and resources when the option is
   absent. Sequential altlogin and ordinary renders do not leak the option.
6. A small browser rendering check should assert the credentials are visible,
   the one-time modal never opens on submit-button focus/click interception,
   FCK/editor initialization still follows the authenticated remote, and no
   page or resource errors occur. It must not submit credentials until the
   separate POST composition gate is complete.


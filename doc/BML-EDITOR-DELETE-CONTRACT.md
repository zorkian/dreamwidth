# Owned entry deletion contract

This baseline records the retained legacy deletion action and the currently
rendered native editor behavior before the old editor routes are retired.

## Modern native editor

The supported owned-entry deletion surface is the authenticated
`/entry/<owner>/<ditemid>/edit` form:

- GET renders the ordinary edit form with `action:delete`, a valid
  `lj_form_auth` token, and the delete-confirmation JavaScript contract.  It
  does not mutate the entry.
- Clicking the rendered delete control invokes the translated browser
  confirmation; rejecting it leaves the page and entry unchanged.
- POSTing that rendered form with `action:delete` and its token calls the
  normal edit handler, which allows an empty event for deletion and renders a
  user-facing deletion result.
- The owner’s unrelated entries are not targets of this action.

`t/plack-entry-delete-parity.t` verifies the authenticated form and successful
owned delete with forced-fresh entry reads.  `t/browser/entry-delete.js` uses a
disposable owner to verify the client-side confirmation cancellation path.

## Legacy BML editor

`htdocs/editjournal.bml` renders its deletion submit control as `action:delete`
on the `editjournal` form.  Its save/delete branch clears the protocol event for
delete and posts the resulting request through the legacy entry protocol.  This
matches the action-name contract retained by the native edit form.

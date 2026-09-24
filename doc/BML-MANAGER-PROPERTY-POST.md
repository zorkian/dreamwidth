# Retained manager `savemaintainer` callable handoff

Date: 2026-09-23

Scope: source-only comparison of the retained other-poster community
`action:savemaintainer` POST with the existing native property-only maintainer
branch. This does not authorize public routing, manager GET migration, delete,
delete-spam, reporting, or any other mutation surface.

## Retained ordering and contract

`htdocs/editjournal.bml` performs these steps in order:

1. Require the original logged-in session user (`remote`). Resolve the effective
   individual actor (`u`) from GET `authas`, defaulting to `remote`.
2. Resolve the journal with legacy precedence: GET `usejournal`, POST
   `usejournal`, then GET `journal`; an actor-self name collapses to the personal
   journal.
3. Resolve itemid with GET before POST, construct the entry in that journal,
   and require visibility to the original session user (`editjournal.bml:150-155`).
4. Run retained `getevents` under the effective actor and require success,
   existence, and exact anum (`:157-177`).
5. For an other-poster community entry, disable ordinary save and allow manager
   actions only when the effective actor can manage the community (`:179-187`).
   `disabled_spamdelete` also becomes true for a spam-report sysban (`:187-188`).
6. The read-only check is guarded by `!disabled_save` (`:190-193`). Because an
   other-poster manager entry already set `disabled_save`, this check does not
   disable its maintainer property action. The beta redirect is likewise skipped.
7. Promote a recognized `submit_value` to its action field, preserving the
   JavaScript submission contract (`:202-206`).
8. Accept `action:savemaintainer` only when `!disabled_spamdelete`, validate
   form auth before writes, and write exactly
   `adult_content_maintainer_reason`, `adult_content_maintainer`, and
   `opt_nocomments_maintainer` from their `prop_` POST fields (`:221-232`).
   False or missing values delete those log properties through `set_logprop`.
9. Return the retained 302 redirect to `entry_obj->url`, which drops the editor
   query (`:234`). Invalid form auth returns the localized legacy bad-input body
   without a success redirect.

The original session user and effective actor are therefore distinct concepts:
the session user supplies login/form-auth and the initial visibility check;
the effective actor supplies `getevents` and `can_manage`. Current
`get_authas_user` rules make a granted different individual actor unreachable,
so tests should prove normal same-actor behavior and invalid-authas rejection,
not invent a delegated-individual fixture.

## Existing native branch and concrete differences

`DW::Controller::Entry::_edit` handles a direct
`action:savemaintainer` at `cgi-bin/DW/Controller/Entry.pm:1315-1343`.
It validates exact ditemid/jitemid/anum, `editable_by(remote)`, other-poster
status, community type, `remote->can_manage`, and a non-read-only journal;
then it validates the explicit form token, writes the same three properties,
and redirects to the current edit URL.

Do not call this direct branch and claim retained parity without handling these
differences:

- Retained behavior rejects `savemaintainer` when the community has a
  `spamreport` sysban. The direct native branch has no sysban check.
- Retained source permits the other-poster property action when the community
  or actor is read-only because its read-only check is skipped after ordinary
  save is disabled. The direct native branch explicitly rejects a read-only
  journal. Any tightening is a separate policy change, not migration parity.
- Retained action recognition includes a whitelisted `submit_value`; the
  direct native branch checks only the explicit action field.
- Retained actor selection honors GET `authas`; the direct native route uses
  the session remote.
- Retained success redirects to the public entry URL. The direct native branch
  redirects to the current edit URL with its arguments.
- For the comments override, retained code forwards the raw missing/false
  value to `set_logprop`; native code normalizes it to `0`. Both delete the
  property today, but the callable adapter should preserve the retained input
  contract rather than depend on that implementation equivalence.

`_render_maintainer_form` and `views/entry/maintainer.tt` are already usable:
they expose only these three fields and `action:savemaintainer`, accept an
explicit canonical action, and preserve its raw encoded/repeated query.

## Smallest callable property-only package

Add a callable legacy manager-property POST adapter, with no route registration.
It should:

- require a real POST and classify through
  `DW::Entry::Legacy::legacy_edit_action($post, maintainer_enabled => 1)`;
  own only `savemaintainer` and return `undef` for every other action;
- preserve GET-before-POST itemid, legacy journal precedence, effective actor,
  exact ditemid/anum, session visibility, and effective-actor manager checks;
- reproduce the retained `!disabled_spamdelete` eligibility, including the
  local sysban predicate, while explicitly preserving or separately deciding
  the source-observed read-only behavior;
- validate form auth before calling a small shared three-property writer;
- pass only the three named raw values to `LJ::set_logprop` and never decode an
  entry body or invoke edit, delete, spam, crosspost, or success hooks;
- return a 302 to the public entry URL on success and the retained localized
  invalid-form response on a claimed invalid-token request. Unsupported or
  ineligible contexts must return `undef` before effects so BML remains owner.

Keep the renderer action URL separate from authorization. It may be the native
canonical edit URL with its raw query, while successful retained POST behavior
still redirects to the public entry URL.

## Finite proof

Reuse from `t/plack-entry-maintainer.t`:

- actual retained and native property forms;
- exact three-property persistence, fresh reload, and preservation of
  subject/body and an unrelated nondefault property;
- explicit canonical form action with encoded and repeated query;
- missing/invalid-token retained nonmutation and no redirect.

Add for the callable adapter:

1. Direct and `submit_value=action:savemaintainer` recognition; no action,
   unknown, save, spellcheck, delete, and delete-spam all return `undef` with
   zero writer calls.
2. Both aliases with actual retained form fields; GET/POST/journal and itemid
   precedence, self collapse, invalid/composite itemids, personal/own-poster,
   noncommunity, nonmanager, invalid authas, and sequential request isolation.
3. A guard-order test with a writer counter: missing/invalid CSRF, denied actor,
   bad target, and sysban produce zero writes. Explicitly lock the chosen
   read-only behavior to the retained source contract or document a separate
   policy change.
4. Set all three nondefault values, then clear all three with missing/empty
   controls; force-fresh reads prove only those properties changed while
   content, security, and unrelated properties remain exact.
5. Success is 302 with exact public entry `Location` and no duplicate query.
   Invalid form auth has a meaningful localized body, no `Location`, and no
   writes.
6. Normal actor/session identity and invalid distinct `authas` are explicit;
   do not create an unreachable granted individual-authas case.

This callable proof is not approval for public manager GET or POST activation.

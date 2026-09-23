# Manager property-only public POST activation matrix

## Production seam

In the item-bearing POST branch of `EntryPicker`, call handlers in this order:

1. `legacy_owned_edit_handler`
2. `legacy_same_poster_community_edit_handler`
3. `legacy_manager_property_post_handler`
4. retained BML fallback

Return immediately for every defined response. Add no manager call to the GET branch. The manager
helper may claim only classified `savemaintainer`; save, spellcheck, delete, delete-spam, unknown,
and actionless requests must remain BML-owned. Keep manager GET rendering and all delete/report
implementation in BML.

## Reused callable prerequisite

The corrected `t/plack-entry-legacy-manager-property.t` should already prove exact handler internals:
real POST/direct and whitelisted `submit_value`, distinct target/item precedence, ineligible declines,
raw three-property writer inputs including missing values, sysban and retained readonly behavior,
invalid token, exact redirect, preservation, and sequential isolation. Public tests should focus on
routing and actual-app representation rather than duplicate every helper assertion.

## Actual-app HTTP proof

Use disposable session manager, poster, outsider, two communities, target and unrelated entries,
and real two-cookie sessions. Wrap production handlers/writer/report function only with delegating
counters; do not replace their decisions.

1. **GET remains retained.** For both `/editjournal` and `.bml`, an other-poster manager GET returns
   the retained BML form with `action:delete`, `action:deletespam`, and
   `action:savemaintainer`. It must not return the native maintainer form. No state changes.
2. **Both aliases claim valid property POST.** Harvest the actual retained form, set three distinct
   nondefault manager values, and click `savemaintainer`. Assert resolver order exactly personal,
   same-poster community, manager; one manager invocation; 302; exact public entry `Location` with
   no editor/query suffix; exactly one writer call containing only the three raw values; force-fresh
   exact properties; unchanged subject/body/security/unrelated property and unrelated entry.
   Cover direct action on one alias and `submit_value=action:savemaintainer` on the other.
3. **Clear semantics.** Submit empty reason/adult values and omit the comments override control.
   Assert the writer receives exact empty/undef raw values, one write, fresh properties deleted, and
   unrelated data unchanged.
4. **Missing and invalid token.** Truly omit the token, then use a distinct invalid token. Both must
   reach manager after the first two declines, return the native localized invalid-form response,
   have no `Location`, perform zero writes, and never fall through to BML. Follow with a valid save
   to prove request isolation.
5. **Target precedence through the public route.** With distinct communities/entries prove GET
   `usejournal` over contradictory POST, POST `usejournal` over GET `journal`, GET itemid over hidden
   POST itemid, and POST-only journal/item selection. Each valid property request must redirect to
   and mutate only the selected entry; all competing and unrelated entries remain exact. Also prove
   actor-self target collapse declines the manager resolver.
6. **Ineligible contexts fall through before effects.** Nonmanager, invalid `authas`, invalid or
   mismatched composite item, personal journal, noncommunity target, and actor-owned community entry
   must produce zero writer/edit/report/hook calls and a meaningful retained response. Use distinct
   fixtures so unchanged assertions cannot pass through target confusion.
7. **Readonly parity.** With a valid token and fresh distinct values, separately mark the effective
   manager readonly and the community readonly. Each retained-compatible manager property request
   still performs one property write, returns the exact 302 entry URL, and preserves entry content.
   This records existing behavior and adds no policy.
8. **Sysban ordering.** With a valid harvested token, locally enable the exact community
   `spamreport` sysban. The manager resolver declines before form-auth/write, BML remains owner, and
   writer/auth-check counters remain zero. Entry state is force-fresh unchanged.
9. **Manager delete surfaces remain BML.** For delete and delete-spam, harvest the actual retained
   manager form but replace its token with an invalid one. Assert all three native resolvers decline,
   the retained invalid-form response appears, no redirect occurs, the entry remains valid, and
   delete/report/writer counters are zero. Never execute a valid reporting or delete action.
10. **Other actions.** Actionless, unknown, save, and spellcheck payloads reach retained BML with the
    manager resolver declining and zero property writes. The callable prerequisite must contain the
    direct exact action fields; do not synthesize submit-button values with `make_request`.
11. **Sequential isolation.** After every denied/fallback context, a valid manager property request
    resolves the original actor, journal, and item, invokes each resolver once in order, and writes
    only that target.

## Browser proof

Use the disposable fixture/helper lifecycle already reviewed for editor browsers. In the plain
production app:

- open an other-poster manager URL at desktop and narrow widths and verify the retained BML
  delete/delete-spam/savemaintainer controls remain visible;
- change the three manager properties and click only `savemaintainer`;
- await the public entry redirect, then force-fresh helper reads prove exact property persistence and
  unchanged entry content;
- verify no page error, named intentional failure exits nonzero, and fixture/server/browser helpers
  are gone.

No manager GET migration, valid delete/delete-spam/report action, new authorization policy, or
external interface is part of this gate.

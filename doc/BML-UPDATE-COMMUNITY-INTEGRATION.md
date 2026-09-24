# Legacy update community/moderation adapter handoff

Audit checkpoint: retained behavior at `a272189a05bf714480c22807a565a33228d95374`; callable owner correction reviewed at `26cba0810d9420f5131a9fcf0512a55f60f6ef5e`.

## Smallest extension

Extend `DW::Controller::Entry::legacy_update_handler` only after its existing transform, alternate-login, CSRF/referer, and readonly guards. Resolve the journal from the submitted legacy field:

1. A nonempty POST `usejournal` names the target journal.
2. An absent or explicitly empty POST `usejournal` selects the authenticated owner. Do not use a GET-only target during save. The retained renderer copies its GET selection into the rendered POST field at `htdocs/update.bml:199-218`; the save path itself uses only POST at `htdocs/update.bml:299` and `342-349`.
3. A named missing, readonly, or unauthorized journal must not silently fall back to the owner. Keep it outside this callable slice or return the established visible failure before owner persistence. Use the existing `can_post_to` policy; do not add a permission rule.

For an accepted target, pass `_do_post` the existing native auth shape `{ poster => $remote, journal => $target }` and protocol flags `{ noauth => 1, u => $remote }`. Keep the `legacy_success` actor/session remote as the authenticated user. Seed `prepare_entry_form` with the exact retained flat protocol fields from `htdocs/update.bml:342-349`: `mode=postevent`, protocol `ver`, owner `user`, submitted `password`, submitted `usejournal`, `tz=guess`, and `xpost=0`. The decoded request object must remain the shared reference observed by decode, post-attempt spam, and success hooks.

No new moderated branch is needed. `DW::Controller::Entry::_do_post` already recognizes `{ message, no itemid }` at `cgi-bin/DW/Controller/Entry.pm:1138-1147`, renders the moderation response, invokes only the legacy HTML success hook with undefined journal/item link, and performs legacy housekeeping. `_queue_crosspost` already requires poster and journal equality at `cgi-bin/DW/Controller/Entry.pm:1014-1017`, so accepted community posts do not schedule owner crossposts.

## Finite tests

Extend the existing actual-form fixtures rather than add a policy matrix:

1. Authorized unmoderated community: GET the retained form with `?usejournal=community`, submit its real POST through the callable adapter, and force-fresh verify one entry in the community, exact poster/content/properties, none in the owner, community response links, and no crosspost scheduling.
2. Moderated community: reuse `t/plack-entry-moderated-post.t:97-285`; assert one `modlog/modblob` request, no published row, exact `usejournal` and poster, meaningful HTTP 200 moderation text, legacy draft body cleared while draft properties remain, only the HTML success hook, undefined hook journal/item link, and the original decoded flat request reference.
3. Precedence/fallback: a POST community target beats a differing GET target; explicit empty POST plus community GET posts to owner; neither field posts to owner. A named nonexistent or denied target creates neither owner nor community data.
4. Hook seed: for community success and moderation, assert exact `mode/ver/user/password/usejournal/xpost` fields and reference identity across decoder, spam, and applicable success hook. This complements the owner assertions already passing at `26cba0810`.
5. Sequential isolation: community, owner, then moderated community calls in one process retain their own journal, flat request, response, and draft effects.

This extension does not register old routes, alter permissions, retire BML, or change external hook interfaces.

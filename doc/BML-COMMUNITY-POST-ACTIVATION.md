# Public same-poster community POST activation matrix

Source checkpoint: integrated resolver `ce765e52b` (`124473f0d` implementation),
compared with `doc/BML-SAME-POSTER-COMMUNITY-EDIT-POST.md`.

## Minimal production composition

In `DW::Controller::EntryPicker::entry_picker_handler`, retain the item-bearing
POST order:

1. call `legacy_owned_edit_handler`;
2. return immediately when it returns a defined response;
3. only then call `legacy_same_poster_community_edit_handler`;
4. return immediately when it returns a defined response;
5. return `undef` so retained BML handles every declined request.

No resolver should be called for itemless picker traffic. Never invoke retained
BML after either resolver returns a defined success or retry response.

## Evidence already accepted; do not duplicate broadly

- Shared helper `55c9e8a7`: explicit community opt-in with personal default
  rejection; session remote deletion log; effective actor spam/edit; exact
  decoded request identity and save/delete order; native retry after failure.
- Callable resolver `124473f0`: real retained-form save/delete and fresh
  persistence, unrelated-entry preservation, community seed, no crosspost/new
  hooks, deletion extras, invalid-date native retry and fresh nonmutation, and
  no/unknown/missing-token/invalid-token declines before decoder/effects.
- Existing public picker/owned-edit suites: personal handler behavior, picker
  selection, public same-poster community GET, manager BML controls, and the
  existing manager CSRF boundaries.

These prove helper/resolver behavior. They do not prove that the unmodified
public `EntryPicker` calls them in the required order or that both public aliases
share that composition.

## Finite public activation tests

Use the actual `app.psgi` route with no routing overlay. Wrap the two production
callables only to count calls while forwarding to their originals. Use disposable
poster/community/entries and force-fresh entry reads.

### 1. Accepted community save and delete, both aliases

- Harvest the actual retained same-poster community form.
- POST a visible save through `/editjournal`; assert personal handler count 1,
  community resolver count 1, native success response, exact fresh subject/body
  (one additional representative property is sufficient), and unrelated entry
  unchanged.
- POST a visible delete through `/editjournal.bml`; assert the same call order,
  native deletion response including the already-proved local deletion extra,
  selected entry deleted, and unrelated entry preserved.
- These requests must show no retained BML form/error after the accepted attempt.

### 2. Accepted failure cannot fall through

- Through one public alias, submit the actual same-poster form with a distinct
  subject/body and invalid date.
- Assert personal then community counts are exactly one, response contains one
  native form with canonical community action and raw invalid inputs, and stored
  entry is unchanged.
- Add a BML-fallback counter/marker at the route boundary and assert zero after
  this accepted attempted save. This is the critical double-attempt regression.

### 3. Personal-first behavior

- Submit one valid personal owned-entry save through the actual public route.
- Assert personal handler count 1, community resolver count 0, existing native
  success, and fresh personal persistence. This proves insertion did not route
  personal traffic through the community resolver.

### 4. Required retained fallthroughs, without new mutations

For each row, assert the public response/controls are retained BML behavior,
community resolver does not decode or mutate, and fresh target/unrelated state is
unchanged. A resolver call is expected only for item-bearing POST rows; itemless
picker must call neither resolver.

| Row | Required proof |
| --- | --- |
| Itemless picker POST | Existing selector result/redirect; personal 0, community 0. |
| Other-poster manager | Actual retained manager form still exposes delete and `savemaintainer`; a denied POST remains BML-owned. Do not perform a valid manager mutation. |
| `action:deletespam` | Actual retained manager action reaches BML boundary; no report/mark operation is invoked in this test. |
| `action:spellcheck` | With local configured checker stub, same-poster community form returns retained spellcheck result and does not persist. |
| No/unknown action | Retained response, no decoder/effects; public composition does not manufacture save/delete. |
| Missing/invalid CSRF | Meaningful retained denial and fresh nonmutation; no success response. |
| Invalid/missing/repeated itemid | Resolver declines before decoder/effects and retained route owns the response. |
| Readonly actor or community | Retained disabled/error behavior and fresh nonmutation. |
| Beta same-poster actor | Existing retained redirect occurs; no decoder/effects. |

The manager and delete-spam rows are routing assertions only. They add no manager
mutation, reporting, or authorization-policy coverage.

### 5. Target precedence and isolation

- One safe declined or failed request each proves GET `usejournal` over POST,
  POST over `journal`, and same-user collapse remains with the personal path.
  Reuse existing fixtures; no new granted-authas policy fixture is required.
- Sequence personal accepted, community accepted, manager fallthrough, then
  itemless picker in one process. Assert handler counters and target state per
  request so no actor/journal/action state leaks.

## Completion boundary

This closes public POST dispatch only. It does not activate manager-native POST,
delete-spam/reporting, alternate authorization, or retire retained BML.

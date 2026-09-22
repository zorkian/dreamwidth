# BML removal implementation log

## 2026-09-21 overnight pass

- Authorization: implement the removal plan starting with characterization and
  access filters; local reviewable commits, isolated worktree/container, no push,
  deployment, or production changes.
- Baseline: d9ea4bea6. Branch: bml-overnight-20260921.
- Worktree: /private/tmp/dreamwidth-bml-20260921.
- Evidence directory on host: /private/tmp/dreamwidth-bml-evidence-20260921.
- The original checkout and existing bml-be-gone worktree remain untouched.
- Started a dedicated devcontainer with its own MySQL volume.

## Access-filter characterization

Disposition: migrate. Modern navigation still links to this page and there is
no replacement for editing access groups. Reading filters are a different model.
The page does not use LJ::Widget, so its migration does not require the shared
widget refactor first.

Contract to preserve:

- Login and authorized authas selection; communities display an unavailable
  message (they cannot have access filters).
- IDs 1 through 60; names, public flag, order, membership, and existing hidden
  field names. Browser operations: create, rename, delete, reorder, multi-select
  add/remove; changes persist only on Save Changes.
- Validate all comma-containing new/changed names before any mutation.
- Accept both old editfriend_groupmask_USER and split maskhi/masklo fields.
  Preserve bits above 31, including group 60; never restore a trust edge removed
  between page load and submission.
- POST with mode=save requires a valid form token. Save shows a result page with
  links to posting and subscription filters. Other modes render the editor.
- Preserve the script's prohibition on reusing a deleted group ID before saving.

Baseline observations to test:

- Community rejection currently happens after the save branch, so forged saves
  need a regression check and an ownership/type guard before mutation.
- Group methods can return failure; avoid silently claiming a save succeeded.
- Existing JS uses 31-bit halves because JavaScript bit operations are 32-bit.
- Delete clears member bits on the client; verify the server's resulting masks
  and actual entry visibility, including crafted and stale submissions.

## Initial queue (completed below)

1. Finish environment setup; run baseline tests and capture old UI states.
2. Migrate access-filter controller/template/JS/strings with regression coverage.
3. Run behavioral, visual, formatting, compilation and static-build checks.
4. Commit the validated package and continue to independent prerequisites.

Production beta settings/local extensions are outside this isolated pass; do not
remove beta-gated entry/inbox functionality without resolving their cutover gates.

## Access-filter migration completed

- Dedicated container: 4e7a47333842. Old BML page removed; controller, Foundation
  template, extracted JS and relocated translations added. Old .bml URL still
  resolves through modern routing. Updated cross-template translation callers.
- Preserved group IDs, 31-bit mask halves, whole-mask submissions, order/public
  metadata, and save-result links. Community saves are now rejected before any
  mutation; stale submitted masks cannot reintroduce a deleted group bit.
- Added t/plack-access-filters.t: 25 assertions passed against old BML, then 27
  passed against TT with the additional community/stale-save regressions.
  Tests include persistent groups/masks and actual protected-entry visibility.
- Baseline existing content-filter/trustmask/routing tests passed. The fake-cache
  wrapper initially broke the test because the loader shifts cached arrays;
  using the isolated real cache corrected the test fixture.
- t/browser/access-filters.js passed against both implementations: login,
  create/add/save/reload, rename/reorder, remove/delete, community and unauthorized
  authas. Captured empty, populated, mobile, saved, community, unauthorized states.
  Visually inspected the TT desktop and 390px screenshots; no layout overflow.
- Browser testing caught missing JS due to the resource group; fixed by registering
  the extracted script in Foundation. This was not caught by HTTP tests.
- Full tidy apply/check passed (1,025 check assertions), compile passed (1,593
  assertions including existing skips), full static build passed. Targeted suite
  passed: access-filter, wtf, content-filters, tags-trustmask-count, ml (129 tests).
- Evidence: /private/tmp/dreamwidth-bml-evidence-20260921/access-before and
  /private/tmp/dreamwidth-bml-evidence-20260921/access-after/access-after.
- Browser reproduction (inside devcontainer, seeded accounts required):
  `bin/dev/screenshot /login` installs Chrome/Puppeteer if needed; then run
  `node t/browser/access-filters.js`. Script expects test_user to start without
  access groups and cleans up groups it creates on success.

Next: remove shared widget BML input/error dependencies needed by customization;
keep compatibility for surviving BML callers and add request-isolation tests.

## Shared widget request seam completed

- Widget GET/POST inputs, repeated form values, and errors now use the current
  request. Profile and widget RPC callers no longer depend on BML error globals.
  The BML renderer temporarily bridges its error array for surviving pages.
- Invalid CSRF now stops widget dispatch before a handler can mutate data.
  Verified AJAX authorization remains supported and scoped to that request.
- Removed the effective-remote helper's stale BML authas fallback. Tests cover
  current GET/POST identity and isolation from preceding BML requests.
- Real headless testing exposed accumulated customization initialization scripts
  in persistent BML workers: a click could send several RPCs with old tokens.
  Both customization pages now reset headextra before rendering. The browser
  regression asserts one RPC per click, persistent title saves and restoration
  for a personal journal and a maintained community, with no JS errors.
- t/widget-request.t passes 22 assertions. The earlier broader widget/Plack/profile
  run passed 322 tests across 17 files; final affected widget/auth/BML/profile
  run passed 48 tests across four files. Final full tidy check (1,026 assertions)
  and compile check (1,593 assertions including existing skips) passed.
- Reproduction: `node t/browser/widget-titles.js` inside the seeded container.
  Final run passed after restarting Starman. Baseline customization screenshot:
  /private/tmp/dreamwidth-bml-evidence-20260921/customize-before.png.

Next independent package: preserve and migrate the still-used FCK image-preview
iframe. Customization still needs Foundation resource/legacy-JS compatibility
work before its BML pages can be removed.

## Image-preview iframe migration completed

- Moved imgpreview.bml verbatim (including its LGPL notice) into the standalone
  entry/image-preview.tt template. ImagePreview controller preserves /imgpreview
  and /imgpreview.bml, HTML content type, and anonymous iframe access.
- t/plack-image-preview.t passed the same 14 assertions before and after migration.
  BML engine tests now create a temporary executable fixture and verify its output,
  rather than depending on a production page that is being removed. Combined
  HTTP/engine run passed 25 tests.
- t/browser/image-preview.js passed before and after: real modern editor, real FCK
  image dialog, callback element identity, image load, original dimensions, locked
  aspect-ratio resize, alternate text, and insertion into the editor. No entry was
  published. Both final runs had no browser exceptions. An earlier exploratory
  run observed a parent-dialog setupIframeHandlers error; that legacy upload
  helper remains to be assessed with imguploadrte migration.
- Full formatting check passed (1,028 assertions); compilation passed (1,595
  assertions including existing skips). No static asset contents changed.
- Evidence: /private/tmp/dreamwidth-bml-evidence-20260921/image-preview-before and
  image-preview-after. Visually inspected the final dialog screenshot.
- Reproduction: `node t/browser/image-preview.js /tmp/image-preview-after`.

The inventory is now 14 executable/page .bml files plus the original three BML
configuration files; nine .bml.text files and both .look files remain. Engine
removal is still gated on the remaining pages and runtime dependencies.

## Parent image dialog migration completed

- Replaced root imguploadrte.bml with ImageDialog controller and standalone
  entry/image-dialog.tt. Preserved login, GET/POST rendering, .bml alias, FCK DOM
  IDs, legacy resources, FAQ hook, shared translation keys, and preview route.
  Kept inherited GPL notices in the controller and template.
- Preserved the last-upload-return callback and integer dimensions. The template
  passes escaped JS strings to a function callback instead of nested eval text.
  Tests include quoted/backslashed URLs containing closing script tags.
- Baseline dialog HTTP contract passed 27 tests; migrated dialog/preview suite
  passed 41. Headless checks passed both before and after: insert, select/edit
  existing image, link wrapper, original dimensions, locked resize, alternate
  text, and HTML switch. Final browser run requires zero JS exceptions.
- The initial exploratory helper error followed opening the dialog without a
  valid editor selection; focusing/selecting through the editor corrected the
  test setup. InObFCK exists in fck_image.js. However, legacy upload-return code
  references insobjform, absent from the root dialog. Preserving its callback
  contract does not certify an end-to-end upload service. No uploads performed.
- Full format check passed (1,030 assertions) and compile check passed (1,597
  assertions including existing skips). No bundled JS/CSS asset changes.
- Screenshots: /private/tmp/dreamwidth-bml-evidence-20260921/image-dialog-before
  and image-dialog-after; final dialog visually inspected.

13 BML page files remain, plus three configs, nine translation files, and two
looks. The alternate static-path ImageButton dialog remains: it has additional
legacy hosting/upload capability branches and is not proven equivalent to root.

## Decisions and external gates still open

- Entry/inbox beta cutover: confirm release readiness and eligibility policy,
  including unvalidated senders and old POST forms, before deleting legacy flows.
- Legacy upload service / alternate ImageButton: determine supported deployed
  configuration before retiring that separate dialog or host-specific forms.
- Local deployment overlays, BMLInit hooks and non-default AJAX mappings require
  a deployment inventory before deleting the engine. This pass only inspects
  the repository and isolated seeded development environment.
- Customization is unblocked at the Perl widget request layer but still needs
  Foundation resource ordering and legacy DOM-helper compatibility, followed by
  theme/layout/options acceptance. No claim of complete customization parity.

## Customization characterization completed

- Added t/plack-customize.t: 58 passing HTTP assertions for anonymous/unauthorized
  access, personal/community styles and ownership, next-page redirects, valid
  and invalid CSRF, persisted title widget changes through both pages, and eight
  options groups. These are a baseline for migration, not full theme/options
  acceptance: theme application, every property mutation, and reset flows remain.
- This integration test requires a development server with compiled ciel/indil.
  The minimal test database has no compiled public themes, so it uses the isolated
  dev database with temporary users cleaned up by LJ::Test. Reading fresh loaded
  users was necessary to avoid asserting against stale property caches.
- Added t/browser/customize-baseline.js. Ten desktop states captured: all themes,
  community theme browser, presentation, colors, fonts, images, text, modules,
  custom CSS, display. All loaded with no JS exceptions.
- Evidence and machine-readable results: existing evidence directory's
  customize-baseline/ subdirectory. Visual inspection of colors revealed an
  existing missing /customize/options.advanced translation at the bottom.
  HTTP rendering also emits existing uninitialized-value warnings from
  LJ::HTMLControls; assertions pass but these are not claimed warning-free.

## Concrete next package

1. Make widget resources work with Foundation: active resource group, dependency
   order, initialization timing, and legacy DOM.getElement versus jQuery $ calls.
   Include nested widget initialization and real RPC refresh behavior.
2. Move ThemeNav query/redirect handling to DW::Request, explicitly propagating
   redirect responses from widget dispatch. Preserve search/page/show/authas.
3. Migrate customize/index and options markup/strings into Foundation templates
   with dedicated handlers; preserve style initialization and allowed widgets.
4. Extend the new baseline tests to theme application/preview, layout changes,
   every options-widget family, reset/save/reload, community targeting, and
   responsive screenshots. Delete the two BML pages only after those pass.

This pass leaves the remaining runtime and product gates explicit; it does not
claim that zero BML pages, complete replacement parity, or engine removal has
been achieved. No push, deployment, or production change was performed.

## Final verification for this checkpoint

- Combined behavior suite: 10 files, 261 tests, all passed. Command:
  `prove t/plack-access-filters.t t/widget-request.t t/plack-image-preview.t
  t/plack-image-dialog.t t/plack-customize.t t/plack-bml.t t/wtf.t
  t/content-filters.t t/tags-trustmask-count.t t/ml.t`
- Final formatting check: 1,031 assertions passed. Latest full module compile:
  1,597 assertions passed including existing skips; subsequent additions were
  characterization tests/docs only. Static build passed for access-filter JS;
  subsequent migrated iframe/dialog assets did not change bundled JS/CSS.
- Headless acceptance passed for access filters, personal/community widget RPCs,
  and image preview/insertion/editing. Customization baseline captured separately.
- Test logs remain in container /tmp/bml-final-regression.log and
  /tmp/bml-final-tidy.log; compile log /tmp/bml-dialog-compile.log.

## 2026-09-22 portable handoff

User explicitly authorized pushing the checkpoint to zorkian/dreamwidth and
opening a PR for review. This supersedes the original no-push instruction for
this handoff; no deployment or production action is authorized.
[BML-HANDOFF.md](BML-HANDOFF.md) records current instructions, the planned
Astra/Terra/Sol roles, environment/reproduction details, and continuation criteria.
No agents have started and no independent Sol review has occurred. Verified
screenshots are now committed under doc/bml-evidence/2026-09-21, so the handoff
does not depend on the original /tmp evidence directory.

## 2026-09-22 Astra implementation resumed

- User authorized implementation under Astra coordination, two Terra implementers
  and an independent Sol reviewer, all visible in Herdr. New work remains local;
  checkpoint publication authorization does not authorize further pushes.
- Foreman checkout/branch: `bml-astra-foreman-20260922`, starting at
  `595a54928a25758e0326e627a126774dc6655d2f`. The parent checkout and preexisting
  worktrees/containers are not used for implementation or tests.
- Verified `HERDR_ENV=1`, Docker availability, and successful isolated
  devcontainer startup. Setup seeded development accounts and compiled themes
  were available: customization integration tests ran rather than skipped.
- The shell sandbox fails with `bwrap: loopback: Failed RTM_NEWADDR`; reviewed
  host escalations work. Worker launches retain workspace-write sandboxing and
  on-request approval. No approval bypass was used.
- Reproduced the checkpoint suite: 261 tests in 10 files passed. Full format
  apply/check passed with 1,031 assertions; compilation passed with 1,597
  assertions including existing skips. Existing uninitialized-value warnings
  remain in customization rendering.
- Installed browser prerequisites using `bin/dev/screenshot`; login returned
  HTTP 200. The first access-filter browser run found the image's prebuilt static
  assets lacked `access-filters.js`. After `bin/build-static.sh`, the access-filter
  flow passed, as did personal/community title RPC persistence/restoration and
  actual rich-text image insert/edit/preview flows.
- Terra widget worker: `bml-terra-widgets-20260922`, Herdr workspace `w6`.
  Owns resource ordering, initialization and explicit DOM-helper compatibility.
- Terra ThemeNav worker: `bml-terra-themenav-20260922`, workspace `w7`.
  Owns request/query handling and explicit widget redirect propagation.
- Sol reviewer: `bml-sol-review-20260922`, workspace `w8`. Reviewing fixed range
  `d9ea4bea6..595a54928` independently; no actionable regression found. Its
  focused HTTP and access-filter/image/widget browser tests passed, with one
  intermittent allocator abort in the combined customization test run; all 58
  customization assertions passed on an isolated rerun. Two further exact combined runs passed all 261 tests; the original
  `malloc(): invalid next size (unsorted)` / exit 134 did not recur. Its native
  allocator cause remains unknown. Live upload-return service remains untested.
- Each worker has a separate checkout and must use its own devcontainer.
  [BML-CUSTOMIZE-ACCEPTANCE.md](BML-CUSTOMIZE-ACCEPTANCE.md) records the next
  controller/template package's acceptance gate, including links-list behavior
  missing from the earlier rendering baseline.

- Final baseline static build completed successfully. All ten customization
  screenshot states recorded zero JS exceptions. Captured additional links-list
  and 390px theme/color states before migration. Evidence is in the foreman
  container `/tmp/bml-baseline-customize` and host `/tmp/bml-astra-customize-before`.
  Visually inspected theme browser, colors and access-filter mobile captures;
  the existing missing advanced-customization string remains visible in BML.


### Approval mode and preserved worker sessions

The user explicitly authorized `--approve-for-me` on resuming the foreman after
an interruption. This supersedes the earlier launch caveat: automatic approval
review with workspace sandboxing is authorized for these workers and routine
implementation, setup, tests and local commits. Safeguards remain enabled.

- Sol: `01a0c9d8-e3d8-7330-bc30-c78bf4ec2b4d`, safely exited while idle and
  resumed with automatic review in the same Herdr pane.
- Terra ThemeNav: `01a0c9d8-7910-7fe3-ac68-19dc9567a899`, likewise resumed after
  committing `2fe1b6a20`; now undertaking the independent FCK poll dialog package.
- Terra widgets: `01a0c9d8-0966-7a70-b058-5a3a4328a791`, safely resumed with automatic
  review after finishing its current test command; all work in progress preserved.

ThemeNav commit `2fe1b6a20` is under independent Sol review. Its reported focused
suite passes 92 tests, and format/compile checks pass. It is not yet integrated.
The widget gate additionally requires a real Foundation-rendered browser fixture;
injecting jQuery after legacy page initialization alone is insufficient evidence.


### New-package review and additional characterization

- Independent Sol review of `2fe1b6a20` found a material error-display regression:
  the BML caller passes the always-truthy widget error arrayref directly to
  `LJ::bad_input`, rendering `LJ::Error::DieObject=HASH(...)` after both successful
  widget saves and invalid-CSRF submissions. The 92-test suite missed the response
  body issue. Sent to Terra for a separate fix, HTTP body assertions and Sol
  recheck before integration. Other changed dispatch/query paths had no material
  finding.
- Captured 15 existing settings states in the foreman container: anonymous
  display, eight personal categories, four community categories, unauthorized
  authas and 390px display. All requests returned HTTP 200; no resource HTTP
  failures. Personal Other Sites raises an existing JavaScript exception,
  `Cannot set properties of undefined (setting 'display')`; the other states
  recorded no exceptions. This is rendering characterization, not settings-save
  acceptance. Capture script: host `/tmp/bml-settings-baseline.js`; data/images:
  host `/tmp/bml-astra-settings-before`, container `/tmp/bml-settings-before`.
- Additional customization before screenshots are retained locally in
  `doc/bml-evidence/2026-09-22`. No artifacts or new commits have been pushed.


### ThemeNav seam integrated after independent recheck

- Terra committed the arrayref error-rendering correction as `7f9db3179`.
  Sol independently reproduced valid and invalid-token POSTs: no object-pointer
  banner on either, no error banner on success, and meaningful invalid-form text
  on rejection. Its expanded focused suite passed 102 tests.
- Integrated reviewed commits into foreman as `2e042ecd5` and `cf2f8ab6b`.
  ThemeNav uses current request queries with boundary-safe parameter replacement;
  widget dispatch preserves declared order and propagates explicit redirect URLs.
  Existing BML caller consumes those URLs; future TT callers must do likewise.
- Widget resource work remains pending: the real Foundation fixture exposed
  immediate inline `Customize.ThemeNav.searchwords` and
  `Customize.ThemeChooser.confirmation` assignments before the body runtime.
  Terra is correcting that ordering, beyond the original wrapped-JS queue.
- Independent FCK poll migration is underway in the ThemeNav worker, after old
  dialog capture through a real focused RTE selection. No page deletion has yet
  been integrated for that package.


### Widget Foundation package review

- Terra produced `ea7e65817` after real Foundation fixture validation, not merely
  injecting jQuery into an already initialized BML page. Deferred inline widget
  setup and ThemeNav/ThemeChooser data assignments now load after their runtime;
  widget code uses a local DOM helper without replacing Foundation's jQuery.
- The nested browser flow verifies one ThemeNav request plus its intentional
  CurrentTheme refresh per filter action, then another action on replaced nested
  markup. An early test incorrectly counted both as a duplicate; preserved the
  intentional dependent refresh and corrected the per-widget assertions.
- Sol reviewed production changes with no material regression. Its static build,
  actual Foundation runner, legacy title browser and 112 focused assertions
  passed. It found the temporary fixture guard missed dangling symlinks, allowing
  cleanup to delete one after installation failed.
- Terra corrective commit `2d072dc3e` adds `-L` checks for both paths and removes
  the unnecessary ThemeChooser wrapper-identity guard added during the RPC-count
  investigation. Independent recheck is pending; package not yet integrated.
- Customization persistence characterization has started against BML in parallel.
  Poll HTTP tests pass, but browser acceptance has not passed: `/entry/new` stalls
  in that worker container. The unchanged minimal readiness probe succeeds in
  the foreman container. Diagnose isolated runtime/data before accepting or
  weakening the poll test; an earlier worker prose success claim was not backed
  by the saved nonzero-exit browser output and is not accepted as evidence.


- Foreman integrated ThemeNav regression rerun passed all 102 focused assertions.
- Poll editor stall diagnosed: a saved-draft restore confirmation blocks Chrome
  before DOM readiness. A dialog-instrumented probe that dismissed that specific
  prompt reached `/entry/new` HTTP 200 and `RTE_READY`, exit 0. Preserve the draft
  evidence and explicitly handle the fixture prompt; do not claim the poll
  insert/edit acceptance passed based on the readiness probe alone.


### Reviewed widget integration and next packages

- Sol rechecked `2d072dc3e` atop `ea7e65817`: all four existing regular-file
  and dangling-symlink destinations were refused and preserved by the actual
  fixture runner. Actual Foundation nested refresh and title RPC flow passed
  with the unnecessary identity guard removed. Integration gate clear.
- Integrated as `487d3e1d2` and `91295c21a`, atop reviewed ThemeNav fixes.
  Foreman combined validation passed 112 focused assertions, static build,
  actual Foundation fixture browser and personal/community legacy title browser.
  Logs in foreman container `/tmp/bml-widgets-integrated-{tests,build,browser,legacy}.log`.
- Terra committed old customization mutation characterization as `47a66155e`
  and started controller/template conversion. Sol is inspecting characterization
  coverage; full acceptance matrix remains required before integration.
- Poll migration fixed SHA `f037a27cb` is awaiting independent Sol review. Terra
  reports 17 focused tests, format/compile/build and real editor browser pass;
  browser log and setup/questions/HTML evidence are in its container at
  `/tmp/fck-poll-acceptance-20260922-final-rerun4`. This supersedes earlier failing
  browser runs, but does not substitute for independent review.
- While poll review proceeds, its Terra worker is characterizing request-language
  behavior and proposing a compatibility design. Production language conversion
  has not started. Existing-page compatibility and request isolation remain gates.


### Integrated regression and active acceptance work

- Foreman checkpoint regression with widget-resource tests passed 293 assertions
  across 11 files. Formatting passed 1,033 checks and compile passed 1,597
  assertions. Logs: `/tmp/bml-integrated-{regression,tidy,compile}.log` in the
  foreman container.
- Sol poll review of `f037a27cb` found no material production regression. Its
  static build, 57 poll/image assertions and actual browser passed; diagnostic
  inspection confirmed exactly four polls and replacement of the selected
  nonzero-index poll. Integration awaits harness correction: final unexpected
  dialog checks and complete saved-draft restoration, including editor mode.
  Clearing only the body did not restore the fixture. Before/after screenshots
  copied to host `/tmp/bml-astra-poll-{before,after}`; Setup and populated
  Questions states visually inspected.
- Sol reviewed characterization `47a66155e` and strengthened `18e4a0656`. Tests
  now require an alternate theme and exercise additional legacy aliases/S1
  initialization. Exact preview identity, distinct layout persistence, generic
  option control families, real-form reset and valid unauthorized mutation
  remain conversion gates. Terra received the detailed findings directly.
- Language characterization `72af53305` confirms global BML scope can override
  a later modern request scope. Native request-local context design approved,
  with actual PSGI/nested/error restoration, fallback/cache, custom getter and
  background compatibility tests required. No language change integrated yet.
- Settings acceptance matrix is `doc/BML-SETTINGS-ACCEPTANCE.md`. Foreman
  characterization `d792dc5c4` passes 14 tests using actual rendered display-form
  fields, fresh GET persistence, legacy aliases, invalid CSRF and valid-token
  unauthorized target. This is a bounded baseline, not complete hub parity.
  Test-only review requested; remaining setting families and notifications
  remain unimplemented. Logs: foreman `/tmp/bml-settings-tests.log`.


### Response-body and browser acceptance corrections

- Sol found the first settings characterization could pass while its synthetic
  `as` actor produced a 147-byte error response after saving. The test now uses
  a real disposable session with both cookies and requires the rendered response,
  no server exception, distinct initial values, and forced fresh property reads.
  Corrective commit `6a24a6b7b` passes all 18 assertions in both foreman and Sol
  containers. This resolves the test false positive; no production defect is
  asserted from the synthetic-actor failure.
- Poll correction `c05449cd5` restores original draft body and properties in
  `finally` through a separate authenticated page. Sol verified restoration on
  failure as well as success, including a nonempty fixture. Its subject-bearing
  restore confirmation is still rejected by the exact allowlist; another small
  correction is pending. Intermittent FCK `SetEnabled` errors remain under
  diagnosis, with no error suppression accepted.
- Language candidate `bc7088a6b` is queued for independent review. Mandatory
  nested scope/exception restoration and database/cache acceptance remain open.
- Customization mutation WIP reports 72 passing assertions, but its initial
  browser capture is NOT an acceptance pass: foreman inspected `results.json`
  and found CodeMirror exceptions in seven option states despite exit zero.
  Terra is fixing resource ordering and adding enforced JS-error checks while
  completing generic property-family save/reset acceptance. Captured WIP colors
  also displayed missing strings; subsequent translation moves require fresh
  verified captures. BML deletion remains unintegrated.


### Poll migrated and independently accepted

- Sol cleared the exact poll-only lifecycle correction `0b32de310`, reviewed
  without the intervening language candidate. Empty, subject fixture and a
  genuinely preexisting nonempty draft all passed actual browser acceptance;
  independent GET confirmed full original draft/properties preserved.
- Integrated source `f037a27cb`, `c05449cd5`, `0b32de310` locally as
  `80c1c7c27`, `adb8502ff`, `6300adc42`. Old `/tools/fck_poll.bml` remains a
  compatibility route to the standalone TT controller; plugin uses extensionless
  URL. Nonzero-index poll edits populate correctly. Twelve BML page files remain.
- Foreman integrated poll/image/protocol tests passed 44 assertions, static build
  passed and actual modern editor browser passed. Logs in foreman container:
  `/tmp/bml-poll-integrated-{tests,build,browser}.log`; screenshots retained in
  `doc/bml-evidence/2026-09-22/poll-before` and `poll-after`.
- Native language scope-loss finding is corrected in source `6d81b9548`, pending
  independent recheck and remaining nested/cache acceptance. No language candidate
  integrated. Customization CodeMirror diagnosis remains active: installed TT
  compares string `==` correctly, disproving the initial numeric-comparison
  explanation. Resource loading/initialization requires actual browser evidence.


### Native language review and continuing customization acceptance

- Integrated poll format/compile checks passed 1,036 and 1,599 assertions.
- Customization test increment `e01066729` passes 132 property assertions;
  Foundation resource registration and page-object initialization corrections
  removed the recorded CodeMirror errors. Strict browser mutation work now
  covers actual CSS, ordered links and custom-text saves/resets. Final denial
  checks, fixture preservation, translation retirement and production commit
  remain in the widget Terra checkout; no customization deletion integrated.
- Language candidate fixes are on preserved branch `bml-terra-themenav-20260922`:
  `6d81b9548` preserves BML scope across language changes; `d7ea4b0bc` restores
  nested scopes including exceptions and valid effective-language fallback;
  `9c300057c` strengthens cache and real BML native/legacy lookup tests;
  `e16647eb4` preserves the scoped TT debug-key contract. Sol rechecked those
  findings as resolved, but the overall language integration gate remains open.
- Sol made the intermittent warm source-autoload failure deterministic: mixed
  case keys were stored and invalidated differently from normalized lookups.
  Correction `f087aed71` normalizes cache keys. Sol then reproduced stale warm
  DB-only values after all-language removal and root removal with child fallback.
  A narrow all-affected-language invalidation correction is in progress.
- One language compile run segfaulted late in `get-users-for-paid-accounts.pl`;
  subsequent full compile passed. Logs preserved in the ThemeNav container at
  `/tmp/lang-compile-correction{,-rerun}.log`. Cause remains unknown and is not
  attributed to the separately explained translation-cache bug.
- ThemeNav Terra created `bml-terra-settings-20260922` from foreman `ce2874a36`
  in its existing isolated worktree/container. The original language branch and
  exact session are preserved. It reran the reviewed 18-test settings baseline
  and started anonymous/community/notification characterization. That test-only
  WIP is safely stashed with message `settings characterization WIP before
  language cache correction` while priority language correction runs.
- Sol's independent picker extraction audit is retained in
  `doc/BML-ENTRY-PICKER-ACCEPTANCE.md`. Modern editor maintainer parity remains
  a cutover gate; read-only picker extraction can proceed independently later.


### Native language independently accepted and integrated

- Sol cleared exact source `774925a26b8c71805235a381eec29fd4b308e9f0` after
  its independent DB-only removal probe passed all nine checks and the combined
  native language/BML/cache suite passed 42 assertions. No material native-range
  finding remains. All affected latest-row language caches are invalidated.
- Integrated the nine native commits as `207f70451`, `c49960248`, `ea1cf1913`,
  `29bc1c753`, `f7119e637`, `04daf5eaf`, `bf7db4c81`, `bd02c8fa1`, `f51de6ca4`.
  Existing poll commits were not duplicated. All work remains local.
- Foreman integrated native/widget/customization/settings/poll/image coverage
  passed 229 tests across ten files; tidy passed 1,037 and compile passed 1,599.
  Logs: `/tmp/bml-native-integrated-{tests,tidy,compile}.log` in its container.
- Customization production candidate `70a66a0cb` is committed in the widgets
  worktree and queued for independent Sol review. No page deletion integrated.
  Foreman found its browser harness still overwrites seeded settings without
  restoring original state; a separate fixture-lifecycle correction is required.
- Settings characterization source `e4cae3eb2` extends the reviewed real-session
  baseline to 35 assertions, including community, privileged read-only and
  notification cases. It is queued for review, not integrated. Terra continues
  remaining category/hook/validation/browser acceptance on the settings branch;
  the prior stash was restored successfully. Production hub migration remains
  behind customization acceptance.

- Broader native request/authentication/error/template regression passed another
  92 tests across eight files (`/tmp/bml-native-request-regression.log`). The
  foreman restarted its server and captured/inspected translated customization
  and settings pages with `bin/dev/screenshot`; both returned HTTP 200, with
  intact labels. Images retained at host `/tmp/bml-astra-native-evidence`.
- Customization follow-up `44125e980` attempts fixture restoration, but foreman
  found omitted generic properties reset by the same form and incomplete failure
  cleanup. Terra is correcting this and the still-open preview identity,
  distinct layout, actual property reload and real-form reset acceptance gaps.
  No customization integration approval is implied by its reported test counts.
- Foreman source-only inbox audit is `BML-INBOX-ACCEPTANCE.md`; it records action
  and pagination mappings, additional compose error-collection paths requiring
  reproduction, and the unresolved sender eligibility/beta cutover gates.


### Continuing compatibility review and characterization

- Sol found customization `70a66a0cb` registered an unreachable index.bml route:
  DW::Routing strips the extension before matching. First fix `30b230ff1`
  restored index.bml but synthesized a slashless redirect that dropped POST
  bodies. Foreman identified that consequence and Sol independently reproduced
  it. Corrective `c46146316` adds no_redirects and broader alias submissions;
  exact recheck is pending. No customization deletion has been integrated.
- Customization browser fixtures now use disposable users (`afcc4d3c3`) rather
  than mutating test_user. Follow-ups `c46146316` and `3f87be1d1` address startup
  and cleanup lifecycle. Both migrated TT templates now carry inherited notices.
  Preview identity, distinct theme/layout and actual property/reset acceptance
  remain work in progress; reported passing counts do not close those gates.
- Settings characterization grew through `6c4ae6ce9`, `70a954caf`, `20e7d159a`
  and `2fecefaed` (57 assertions reported). Sol caught a falsely reported fix
  absent from immutable `70a954caf`, plus a cookie denial assertion ignoring
  response changes. `20e7d159a` actually contains a fresh eligible subscription
  and forced fresh denial read, and sends cookies while asserting no setting
  cookie update. Recheck remains pending; none of this range is integrated yet.
- `2fecefaed` adds scoped extension-hook save/validation characterization.
  Notification ret_url and remaining category/browser mutations are still open.
  Settings branch is preserved; hook WIP was restored and committed.
- At a clean boundary Terra created `bml-terra-native-callers-20260922` from
  reviewed native foreman `f51de6ca4` in the same owned worktree/container/session.
  Bounded next package removes direct BML translation calls from MassPrivacy,
  RPC::CutExpander and Customize::Advanced with explicit pre-template scope.
  This is independent of the customization/settings page deletion gates.
- Alternate ImageButton dialog source/static-dispatch evidence is documented in
  `BML-ALTERNATE-IMAGE-DIALOG.md`. Both distributed editor bundles and context
  menu retain the command; current plain-text static response does not prove
  the intended feature is unused or authorize dropping its upload shell.

### Reviewed callers and remaining acceptance (2026-09-22)

- Sol cleared customization alias correction `c46146316` with independent
  four-alias GET/POST probes (24 assertions), and disposable fixture lifecycle
  follow-up `3f87be1d1` with normal and intentional-failure browser runs. Broader
  customization acceptance remains open; no page deletion is integrated.
- Sol cleared settings `20e7d159a` and hook `2fecefaed` (57 assertions). The six
  settings characterization/plan commits are integrated as `21e6d6890`,
  `702c7d20b`, `a665e5a6a`, `e1ecc46f4`, `65677a97e`, `d602048b9`.
  Foreman reran the 57 assertions successfully. Categories/browser remain open.
- Foreman tracking return characterization `ff2b5abb9` passed 16 assertions and
  Sol independently confirmed the real form, valid session, quota/CSRF failures,
  fresh subscription and trusted return redirect. Sol identified the separate
  receiver trust gap: legacy settings redirects a forged POST ret_url verbatim.
  Added absolute and scheme-relative offsite receiver cases as explicit legacy
  TODOs, automatically required when the BML hub is removed. Migration must
  constrain returns to the intended origin; trusted-caller coverage is not enough.
- Native controller source `3c7c80ae3` and handler fixtures `c25653b39` cleared
  Sol review: 45 assertions across four files, tidy 1,038 and compile 1,599.
  Integrated locally as `2f9b0f43f` and `51666e404`. Foreman combined native and
  expanded return coverage passed 67 assertions across five files, with the two
  explicit legacy receiver TODO failures (`/tmp/bml-native-callers-return.log`).
- Native Message/Poll/UserMessageRecvd source and fixtures `6603f2cda` are queued
  for Sol review. Terra returned to independent settings category/browser work;
  customization Terra continues distinct selection, property/reset and denial
  acceptance. All branches, worker sessions and containers remain preserved.

- Sol cleared native services `6603f2cda`: five-file language/service suite passed
  48 assertions, tidy 1,039 and compile 1,599. Integrated as `ba3604b24`; foreman
  service plus poll tests pass (`/tmp/bml-native-services-integrated.log`).
- Sol cleared settings receiver TODO baseline `86b144d66`: 22 assertions pass
  with two intended legacy off-origin redirect TODO failures. This records the
  required receiving-controller fix, not approval to retain the vulnerability.
- Foreman picker characterization started at `bd4b87237` and expanded through
  `7ab7d3a28`, `b007ec369`, `95fcdf04c`. It now passes 64 real-session assertions,
  including community managers, read-only journals and retained other-poster
  editor controls. Sol identified missing direct BML POST and exact-latest checks;
  fixes use real distinct protocol event dates and direct alias submissions.
  Bodies are snapshotted before requests and entry singletons reset before reads.
  Final recheck pending. Logs `/tmp/bml-entry-picker-{snapshot,order}.log`.
- Customization acceptance `25959d094` improved preview/theme/layout identity;
  `6f6bf5b95` added browser property/reset and denied-mutation coverage. Foreman
  found its denial form selector could choose unrelated forms with missing IDs.
  `b18a5070` adds real apply-control guards and more reset/CSRF assertions, but its
  initial focused rerun exposed incomplete reset payload fixtures. Terra is
  correcting those using complete rendered forms; no integration yet.
- Visual inspection of the migrated 390px Links List page found cramped controls
  and overflow. Legacy colors/mobile evidence is already similarly constrained;
  matched Links List comparison is underway. No new visual regression is asserted
  from an unmatched screenshot, and JS-only passes do not close visual acceptance.

- Sol cleared picker `95fcdf04c` independently (64/64). Browser baseline
  `de14507c5` passes normal and intentional-failure cleanup runs; review pending.
  Screenshots are preserved under `bml-evidence/2026-09-22/picker-before/`.
  Explicit .bml title renders correctly, while extensionless legacy title uses
  missing `/editjournal.title`; DW::BML scopes legacy ML by incoming URI before
  and after the native language change. Replacement headings must translate.
- Matched legacy 390px Links List evidence is preserved under
  `bml-evidence/2026-09-22/customize-before/linkslist-narrow.png`. Legacy horizontal
  overflow is confirmed, but migrated inputs shrink much more severely. Terra
  is addressing usable narrow input widths rather than treating all overflow as
  a new regression. Browser assertions alone did not reveal this visual issue.
- Customization reset fixture correction `8917dc475` now submits complete real
  forms and reports 169 passing HTTP assertions. Independent recheck queued.
- Settings category increment `fde5bdc43` reports 72 passing HTTP assertions;
  browser `da6072d85` covers only controls/invalid validation and is insufficient
  mutation acceptance. Terra is implementing disposable browser users and real
  saves, replacing the claim that a seeded full-form invalid POST is nonmutating.

### Continued acceptance — 2026-09-22, 18:46 UTC

- Sol cleared narrow Links List `4aae7087f` after independently reproducing the
  first width-only correction's 52px visible fields. The follow-up stacks narrow
  navigation/content, preserves local scrolling, and passes actual visible-field
  intersection/focus checks. Desktop behavior remains unchanged. Foreman viewed
  the new screenshot and confirmed fields are initially visible.
- Sol cleared `/customize/options.bml` POST coverage `fd4c8bcfb` (106). Actual
  controller name/foreign-style ownership fixture `4c220b920` reports 118 passes;
  recheck and consolidated final customization matrix audit are pending. Initial
  fixture errors included unauthorized actors and stale pre-request user props;
  these do not establish production ownership regressions.
- Settings category/fix sources `fde5bdc43`, `de5621341` cleared review and are
  integrated as `87d0268ec`, `6724f718f`. Foreman settings/return tests pass 94
  assertions with the two explicit receiver TODO failures.
- Settings browser source range `da6072d85`, `05d14a830`, `4177ca8cb`, `79831becd`
  cleared independent normal/failure lifecycle and mutation review. Integrated as
  `65dc45522`, `d0475eb3d`, `d99501cab`, `e0d9bb463`; foreman browser rerun passes
  (`/tmp/bml-settings-browser-integrated.log`). It uses disposable accounts,
  verifies community/privacy/mobile reloads and exact inactive deletion with an
  unrelated active Inbox subscription preserved by a fresh helper DB read.
- Additional settings baseline `22b8fd0f`/`0f4b301c` records a real legacy resource
  gap: Settings is absent on the jquery-group page, so its unsaved-change handler
  never starts. Changed privacy N is discarded by navigation and fresh DB remains
  M. Passing corrected browser evidence is `/tmp/settings-browser-unsaved.log` in
  the worker container; independent review pending. Migration must explicitly
  load compatible resources and implement reliable save/discard navigation.
- Sol independently cleared picker dispatch increment `81ed8db2e` (80). Direct
  BML POSTs with mode=init, itemid and synthesized delete/maintainer actions reach
  CSRF guards; missing/invalid tokens preserve entry and maintainer properties.
  This covers the extraction boundary, not successful editor mutation parity.

### Continued integration — 2026-09-22, 19:00 UTC

- Sol cleared ThemeChooser debug cleanup source `853d7bde8`; integrated locally
  as `86a8788ed`. The removed diagnostic was pre-existing and exposed theme
  search/filter values to stderr. Focused independent widget tests passed 28.
- Sol cleared Other Sites/local settings source `ec2e7a83c` (83 assertions) and
  the unsaved-navigation baseline `22b8fd0f` + `0f4b301c`. Integrated locally as
  `a687a4985`, `859889089`, `46cf9b4e3`. Foreman combined settings/return suite
  passes 105 assertions, with the two documented legacy redirect TODO failures
  (`/tmp/bml-settings-integrated-105.log`). Browser integration rerun underway.
- Mobile API-key source `5fea7e600` is explicitly failing worker WIP, excluded
  from accepted integration. Terra is correcting the rendered delete form
  contract and reset control lookup; exact passing tests and Sol review remain
  required. No production Mobile defect is established by this fixture failure.
- Final customization proof work remains split: widgets Terra owns nonzero
  user-layer ownership, exercised control types, and invalid-option input/error
  preservation; themenav Terra will cover filters, subtitles and display resets
  in separate new test files after its clean Mobile correction. Sol is reviewing
  the original access-filter checkpoint while these implementation tasks run.

- Foreman integrated settings browser rerun also passes
  (`/tmp/bml-settings-unsaved-integrated.log`), including absent legacy Settings
  runtime and discarded unsaved choice. Mobile follow-up `b45bc71b1` remains
  failing WIP too: the invalid-CSRF response is an error page without the form,
  so the independent reset flow must begin with a fresh authenticated GET.

### Next native-consumer package boundaries

Source inspection identifies a small global-key group suitable after current
acceptance work: NotificationMethod Email/Inbox titles, AccountStatistics expiry
text, and Setting::Display::AccountLevel status. Test actual methods with a
request getter, substitutions and nonweb fallback; no email delivery is needed.
Do not classify larger consumers as equivalent one-line replacements:

- InboxFolderNav also emits literal BML ML and needlogin tags; converting its
  two direct ml calls alone does not make its rendered output BML-independent.
- FAQ search uses BML language selection as well as ml; FAQ browsing uses
  language-default and modification-time APIs. Preserve language choices and
  caching headers through native request APIs, with handler-level tests.
- S2 initializes language through BML before rendering and uses request-adapter
  methods as well as global cut-label translations. Preserve journal/default
  language behavior and sequential request isolation when replacing that setup.
- LJ::Lang::get_lang_names computes an unused translated name, while set_lang
  still forwards to BML. Audit actual callers before changing/removing either;
  a source-only search is not acceptance for externally callable behavior.

### Original checkpoint review follow-up

- Sol reviewed access-filter migration source `c2ed9b0f9` against immutable
  foreman `46cf9b4e3`: no production regression found; 27 HTTP assertions, static
  build and normal browser flow pass. Translation move, permissions, CSRF,
  aliases, filter/membership operations and wide masks are covered.
- Material browser-harness finding remains: `t/browser/access-filters.js` uses
  seeded test_user/test_friend and only closes Chrome in finally. Failure after
  the first saved filter leaves group/membership state behind. Normal-run exact
  pre/post equality does not prove failure cleanup. Assign disposable helper
  lifecycle plus fail-after-save acceptance to Terra at its next clean boundary.
- Mobile final candidate `229979bd7` reports 93 passing settings assertions;
  exact independent review is queued. It corrects the previously excluded WIP
  range; no Mobile source change or accepted integration is claimed yet.
- Integrated settings fixture required formatting-only correction `b4e7475fd`;
  all 1043 tidy checks now pass (`/tmp/bml-settings-integrated-tidy-fixed.log`).

- Sol cleared final Mobile test range through `229979bd7`; integrated its final
  content as single foreman `e4679e8c8`, without accepting the failing intermediate
  checkpoints separately. Foreman settings/return run now passes 115 assertions
  (`/tmp/bml-settings-integrated-115.log`).
- Legacy settings visual matrix is durable in `settings-before/` under the
  2026-09-22 evidence directory (commit `cc7554229`).
- Customization gate6 probes currently show integer/color coercion rather than
  a rejected option. Preserve the experimental failure logs; independent audit
  must distinguish a pre-existing absent validation contract from a migration
  regression. No blanket new validation policy or deletion gate waiver yet.

### Finite validation-gate disposition

Sol independently established that customization gate6 was asking for a contract
absent from both legacy and migrated widgets. Coercion/normalization is shared;
integer and Color probes therefore do not establish regressions. Gate6 is closed
as not applicable, with details in BML-CUSTOMIZE-ACCEPTANCE.md. Existing CSRF and
unauthorized nonmutation requirements remain. No new semantic validation policy
is added as part of BML removal.

Original image preview/dialog production review is bounded clear (41 HTTP
assertions and real editor browser flow). Sol found saved draft-properties
mutation even after successful seeded browser runs. Both image and access-filter
harnesses are queued for disposable-fixture corrections and intentional-failure
checks, after widgets Terra completes customization1/4.

### Final customization proofs — 2026-09-22

- Gate3 source `718a2d5a5` + `3dae19752` independently clears distinct personal
  and managed-community subtitle save/reload with one RPC, plus intentional
  failure exit1 and no surviving helper.
- Gates1/4 source `9cd353e17` independently clears 124 controller assertions and
  the full browser flow after an exact static build. Nonzero repaired-community
  ownership and unchanged foreign layers are proved. Dedicated select/checkbox
  actions use actual controls and fresh GETs after save/reset; process exit0 and
  helper cleanup are confirmed. Generic first-control iteration alone initially
  failed the new inventory, so it was replaced with explicit type coverage.
- Gate2 `2348d4da9` had a category self-link gap despite 54 passes. Correction
  `03ff0a8b` chooses a rendered category other than all and reports 56 passes;
  independent recheck remains pending. Designer/layout checks follow untouched
  emitted parameters and require nonempty, universally matching result metadata.
- Gate5 `5a7259b3` reports passing real display save/reset with fresh GETs and
  preserved theme/layout. The test waits for mood preview AJAX before setting
  the force checkbox; the earlier failure was a fixture timing error. Independent
  review remains pending. Its inspected reset screenshot is preserved locally.
- Widgets Terra now owns separate disposable access/image harness corrections;
  themenav Terra prepared settings migration and awaits the post-customization
  base. No worker checkout or session was replaced.

### Customization integration and next production packages

- Sol cleared category navigation correction `03ff0a8b` (56 assertions) and
  final Display replacement-node proof `fed30ca8e`. Together with gates1/4
  `9cd353e17`, gate3 `3dae19752`, and gate6 NA, the finite customization matrix
  is complete. Integrated reviewed final content as `bcdced59f`; two BML pages
  removed, ten page files remain. Original worker commits remain preserved.
- Foreman exact integrated validation: static build PASS; tidy 1047, compile
  1601; combined 17-file regression PASS, 714 top-level tests. Logs are
  `/tmp/bml-customize-integrated-{build,tidy,compile,prove}.log` in container
  `8d7783a043d8`. Actual customization baseline and navigation/display browser
  flows both pass in `/tmp/bml-customize-integrated-browser.log` and
  `/tmp/bml-customize-integrated-display.log`.
- Sol independently cleared access/image disposable harness sources
  `a3d45557d`, `def79a51b`, and strict signal-exit correction `74c332713`.
  Both normal flows and intentional failures leave no helper; seeded accounts
  are no longer used. Integrated final reviewed content as `855414735`.
- Settings Terra now implements production conversion from `bcdced59f` on
  `bml-terra-settings-migration-20260922`; receiver redirect validation,
  safe legacy deletion aliases, compatible settings resources and unsaved
  navigation are explicit requirements, not exemptions.
- Picker Terra committed `1c5f0efd12cae67424ae9e982e4601cee988f5bc` with
  104 HTTP assertions, normal/failure browser evidence, tidy1044/compile1601.
  Sol independent review is running. Foreman visual/source inspection requested
  a separate correction to raw untranslated security enums and plain community
  poster names. No picker integration or editor retirement is claimed yet.

- Foreman integrated disposable browser normal runs both pass:
  `/tmp/bml-access-disposable-integrated.log` and
  `/tmp/bml-image-disposable-integrated.log`; final tidy passes 1049 checks
  (`/tmp/bml-disposable-integrated-tidy.log`). Sol already covered intentional
  failure and signal cleanup on the exact source range.

### Native account labels and inbox repair queue

- Sol cleared worker `c1aba5fb4` (four native full-key callers and direct method
  tests). Integrated as `538d5d8dc`. Foreman combined native caller/service,
  request-language and notification-method run passes 5 files / 130 tests;
  log `/tmp/bml-native-account-integrated.log` in the foreman container.
- Inbox compose error candidate `e4ba001a2` is under Sol review, not integrated.
  Its no-delivery authenticated tests report 23 passing assertions; preserves
  rejected input and handles service-provided rendered error strings correctly.
- Picker final review through `0ec661a94` found four concrete compatibility
  gaps: input changes selecting the appropriate radio, existing locale keys,
  individual-only authas selector, and accessible security/poster labels.
  Input-selection correction `fba4e942b` reports direct-input browser pass.
  Terra is fixing the remaining findings on the preserved picker branch.
  Itemid fallback/CSRF/permissions/aliases otherwise passed independent review.

- Sol cleared inbox compose `e4ba001a2`, including an independent five-assertion
  real-request probe of the extra index `add_string` line. Keep that line:
  handle_post returns rendered sentences, not ML keys. Integrated as
  `3dd1c4464`; foreman focused run passes 3 files / 31 tests in
  `/tmp/bml-inbox-compose-integrated.log`.
- Picker `bdca9e525` addresses scope/selector/labels but remains unaccepted:
  foreman found translated icon text passed as LJ::img's type argument, which
  emits XXX instead of an image. Terra must use the alt attribute argument,
  test actual image text, and finish remaining controller error-key scopes.
- Settings normal browser flow passes in its worker, but foreman screenshot
  comparison found inherited 625px minimum-width overflow at a 390px viewport
  and an omitted Account Settings heading. Both are routed as required visual
  acceptance corrections before final immutable review.

### Picker integrated; settings and native followups under review

- Sol cleared final picker source `e4e3958b7`, including actual image alt/title,
  no XXX placeholders, legacy title/error ML keys, and direct-input behavior.
  Integrated as `e83cddf0e`. Foreman own-container validation passes 3 files /
  155 tests, tidy1051, compile1603 and real browser. Logs:
  `/tmp/bml-picker-integrated-{prove,tidy,compile,browser}.log`.
  Durable screenshots: `doc/bml-evidence/2026-09-22/picker-after`.
  This extracts selection only; ten BML pages still remain.
- Settings candidate `bcb019343f` is committed and under Sol review. Worker
  reports104 settings and37 return assertions, static build, browser,
  tidy1048 and compile1603. Foreman inspected final narrow anonymous layout:
  overflow and heading issues are resolved. Not integrated before review.
- Spam `038607cea` had a meaningful error-display bug: literal text was passed
  to FormErrors::add and appeared in a missing-string banner. Sol's stronger
  body assertion caught the false positive. Separate fix `345d6e246` uses
  add_string with40 passing HTTP assertions; queued for independent recheck.
- Event language range `eb65a9f66` is queued for Sol. Worker actual-method,
  notification inbox and comment tests plus scoped tidy/compile1603 pass.
- Widgets Terra continues owned CSRF bookmark confirmation/action handling;
  Themenav Terra continues native S2 page labels in a separate branch.
  All work stays local and existing sessions/worktrees are preserved.

### Inbox spam integrated; settings finite proofs pending

- Sol cleared spam correction `345d6e246` atop `038607cea`. Integrated final
  content as `e772d7919`. Foreman own-container spam+compose regression passes
  2 files / 63 assertions in `/tmp/bml-inbox-spam-integrated.log`. Existing
  checkbox-value and invalid-token warnings remain recorded, not new failures.
- Settings production review through `5f323e9e5` is clear after localized
  confirmation (`f0042473`) and accepted same-origin encoded-slash return URLs.
  Sol independently passed 104 settings, 46 return, 4 confirmation assertions,
  the four-alias16-assertion probe, static build and disposable browser flow.
  Before integration, Terra is adding exactly three finite coverage proofs:
  account-stat hook, notification page/form context, and existing-subscription
  modification. These are test gaps, not asserted production bugs.
- Bookmark WIP remains unaccepted while denial regressions are diagnosed using
  before/after persisted state. Notification qids are per-account; foreign-ID
  tests must prove the ID is absent from the owner, not assume global uniqueness.
- Native Event `eb65a9f66` and S2 label `cd45ffb4` await Sol. FAQ runtime seams
  are the next independent Themenav task, preserved around settings followups.

### Native Event and S2 integrated

- Sol cleared Event `eb65a9f66` and S2 `cd45ffb4`; integrated as `f4b760a3e`
  and `5249750db`. Foreman Event/notification/native regression passes5 files /
  118 tests (`/tmp/bml-native-event-integrated.log`); S2 constructor/color
  regression passes2 files /16 tests (`/tmp/bml-native-s2-integrated.log`).
- Combined spam/Event/S2 checkout passes tidy1054 and compile1603 in
  `/tmp/bml-native-inbox-integrated-{tidy,compile}.log`.
- Bookmark denial investigation remains open. Source shows check_form_auth
  uses `shift || $BMLCodeBlock::POST{lj_form_auth}`, potentially reusing a prior
  legacy token for an explicitly missing/empty modern token. Invalid-token
  assertions reused the already-mutated target and cannot independently prove
  an invalid-token bypass. Terra and Sol are testing the exact sequential
  request/DB boundary; no bookmark range has been integrated.

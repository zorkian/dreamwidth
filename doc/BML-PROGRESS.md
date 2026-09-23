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

### Shared form-auth isolation fixed; notification rendering corrections

- Sol independently confirmed stale legacy POST token reuse for explicit empty
  modern calls. Core `2f5509984` plus meaningful real-token test `4b557e1af`
  are cleared and integrated as `42840ba7b`. The corrected test fails against
  old code for empty/undef tokens while positive controls pass. Arbitrary
  invalid tokens were already rejected; do not conflate those cases.
- Foreman integrated validation: six files /308 tests pass in
  `/tmp/bml-form-auth-integrated.log`, covering real-token unit controls,
  spam/compose, customization and retained legacy settings/returns. Formatting
  1055 and compile1603 pass in `/tmp/bml-form-auth-{tidy,compile}.log`.
- Settings review narrowed additional actual output defects at `5f323e9e5`:
  notification fragment relative keys resolve under the hub scope and display
  missing strings; localized SettingsConfirmMsg is omitted on notifications;
  quota error output retains a visible `errorbar?>` suffix. Sol verified the
  quota sentence IS visible, correcting the initial invisibility hypothesis.
  Terra must emit native markup and prove real rendered labels/config/errors,
  alongside the previously finite account-hook/page/edit-subscription proofs.
  Settings and bookmarks remain unintegrated pending these bounded checks.

### Settings integration complete

- Sol cleared all production and finite acceptance through `0d8fd5ff6` atop
  `a7a4d038e`, `5f323e9e5`, `f0042473`, `bcb019343`. Integrated final reviewed
  content as `035e27196`; nine BML page files remain.
- Foreman exact combined regression passes17 files /501 tests in
  `/tmp/bml-settings-integrated-prove.log`; static build, tidy1058, compile1605
  and full disposable settings browser pass in corresponding build/tidy/
  compile/browser logs. Matching15-state captures also pass with no JS/resource
  failures; durable before/after images are under doc/bml-evidence/2026-09-22.
- FAQ production `656b2cbea` is reviewed sound; corrected test `d719fae1c`
  (including parent `7c3d81367`) now proves native rendering leaves the legacy
  base_recent_mod global unchanged, not merely that HTTP has no Last-Modified.
  Final independent recheck pending. Direct request-context consumers are the
  next active Themenav package; bookmark browser work remains active in widgets.

### FAQ integrated; runtime and bookmark reviews

- FAQ source `656b2cbea` plus corrections `7c3d81367`/`d719fae1c` is
  independently clear and integrated as `4f7832ea4`. The final test proves
  native FAQ rendering does not mutate BML process-global modification time;
  Sol proved that assertion fails on the old handler. Foreman regression passes
  four files /97 tests, tidy1059 and compile1605 in
  `/tmp/bml-faq-integrated{,-tidy,-compile}.log`.
- Native request consumers `fdace9826` await Sol review. The separate proposed
  UniqCookie package was twice rejected by automatic approval review as outside
  the prior bounded package, even after checking plan line96 explicitly lists
  that module. No changes were made to it; explicit scope clarification is
  pending while other work continues. Themenav audits PageStats read-only.
- Bookmark `4caf02a83` remains unintegrated. Sol found the new legacy button
  duplicated the image-only InboxItem_Bookmark class, causing JS initialization
  to read undefined button.src. Correction `12f01f135` removes the duplicate
  class and adds JS-enabled legacy RPC/reload coverage; Sol recheck pending.
  Widgets then continues actual maintainer characterization/implementation on
  its preserved separate branch, with itemid BML fallback retained.

### Legacy inbox bulk CSRF reproduction

- Foreman real-session probe at `80f14c739` confirms legacy selected markRead
  changes direct DB state N->R with both absent and invalid CSRF, while modern
  controls deny both. Separate disposable rows, no external delivery; two of12
  assertions fail in `/tmp/bml-inbox-bulk-auth-probe.log`. This is pre-existing.
- Themenav now implements the bounded legacy bulk guard/regression on a separate
  branch; native request consumer `fdace9826` stays queued for Sol. PageStats
  read-only audit finds its adapter filename unset under Plack and unused by
  in-tree GA plugins; external filename contract remains a disposition item.

### Platform restriction and unaffected continuation

- Parent reported a platform restriction on cybersecurity requests and directed
  no retry or reassignment to bypass it. The affected inbox probes/fixes/reviews
  are preserved and held; no inferred permission from the scheduled check.
  UniqCookie authorization remains unanswered and that module untouched.
- Preserved worker state: bulk guard `b1117371e` plus all-action fixture
  correction `3f8a2e7c5`; modern view-dispatch controller/test WIP is being
  stashed in Themenav checkout. Bookmark followup `de705e8` atop `12f01f135`
  and `4caf02a83` remains unintegrated and not gate-clear.
- Unaffected work continues: native request-context test-only completion (real
  intervening no-cookie request, true loginout-marker rendering behavior), S2
  request-note rendering audit, and restricted maintainer UI parity. Sol
  production-cleared `fdace9826` but requires those two permanent tests.
- Maintainer characterization `a9bcc488a` passes140 independently but needs a
  nondefault unrelated-property fixture and a genuinely different denied value;
  Terra is correcting both before the bounded native UI implementation.
- Six matching disposable legacy/modern inbox baseline screenshots are committed
  under `doc/bml-evidence/2026-09-22/inbox-before`; this is visual evidence, not
  a claim of behavioral acceptance or clean console/network checks.

### Native request consumers integrated

- Sol cleared `fdace9826` plus permanent test correction `060f8ebdb`; integrated
  locally as `2e57379dc`. Intervening anonymous request and true/false loginout
  marker controls are meaningful. Foreman passes7 files /86 tests in
  `/tmp/bml-native-request-integrated.log`; tidy1060 and compile1605 pass in
  `/tmp/bml-native-request-{tidy,compile}.log`.
- Ordinary journal rendering baseline captures recent/read/archive/month/day/entry
  at200 with no pageerror/requestfailed events, using a disposable local fixture.
  Saved under `journal-rendering-before`; capture timing and limits are explicit.
- Admin FAQ candidate `a3b51c425` remains unintegrated: removal accidentally
  dropped a TT closing delimiter, and its mocked renderer did not exercise the
  template or removed callback. Terra is fixing the delimiter and replacing
  that test with actual template rendering and content/global-state assertions.

### Maintainer characterization integrated; rendering work active

- Sol cleared `a9bcc488a` plus correction `078067ef9`; integrated as
  `156f37328`. Foreman exact test passes141 in
  `/tmp/bml-maintainer-characterization-integrated.log`. The nondefault
  unrelated property and genuinely different denied value resolve prior weak
  assertions. This is prerequisite characterization, not native UI approval.
- Widgets now has native restricted maintainer GET/form and property-only POST
  WIP; it must complete actual form save/reload plus browser acceptance before
  committing or integration. Legacy editor/itemid routes remain retained.
- Admin FAQ `a3b51c425` + `a7a14e557` awaits Sol actual-render review. The
  delimiter is restored and the regression now runs the real TT body rather
  than mocking it away. S2 request-note rendering migration proceeds separately
  from base `2e57379dc`, with existing adapter/language initialization retained.

### Native S2 rendering replay and admin FAQ complete

- Sol cleared admin FAQ `a3b51c425` + `a7a14e557`; integrated as `c39b78ca1`.
  Foreman actual-template/native FAQ/category suites pass 4 files / 92 tests
  in `/tmp/bml-admin-faq-integrated.log`.
- Sol cleared S2 request-note rendering `c2204e313`; integrated as `0bceb2942`.
  Focused rendering/native-language/color suites pass 3 files / 19 tests in
  `/tmp/bml-s2-integrated.log`. After a clean server restart, all six journal
  views return 200 with no page errors or failed resources. Disposable helper
  exits successfully; screenshots/results are in `journal-rendering-native`.
- Combined formatting 1063 and compile 1605 pass in
  `/tmp/bml-rendering-{tidy,compile}.log`. No production deployment or push.
- Authas label conversion `11ec1c696` is with Sol for independent review.
  Terra continues ordinary control-strip translations and maintainer UI
  rendering acceptance. Restricted inbox work remains held; the UniqCookie
  approval question is still unanswered and no authorization is inferred.

### Ordinary translation and maintainer review queue

- Authas production `11ec1c696` is functionally clear in Sol review. Required
  test formatting and default text assertions are corrected by `a0adf67e9`
  and `f0e722c25`; an explicit Foundation default-label assertion is still
  being added because the legacy sentence exercises a different label key.
- Control-strip label-map candidate `eb8fd7163` remains unintegrated. Terra is
  converting the remaining substitution calls and strengthening actual-template,
  hook, and default-text evidence; the first test mocked template output and
  mislabeled request-default behavior as background behavior.
- Native maintainer UI candidate `b861d751c` passes worker152 HTTP assertions,
  browser, tidy and compile1605, but remains unintegrated. Foreman found the
  adult override select lacks selected-state rendering; the browser checked
  only the reason after save. Terra is correcting exact persisted selection
  and checkbox reload assertions. Its temporary local config was restored;
  the earlier missing control was an unset template variable, now corrected.
- Widgets also has the next ordinary Support FAQ default-language package on
  a separate branch. Sol is auditing text-length language compatibility and
  reviewing the immutable ordinary ranges. Held work remains unchanged.

### Authas native labels integrated

- Sol cleared exact final `d8d0fa892` atop `11ec1c696`, `a0adf67e9`,
  `f0e722c25`: both default Foundation labels are now asserted in actual output,
  and required formatting passes. Integrated locally as `363cda887`.
- Foreman helper/settings/customization regression passes3 files /249 tests,
  `/tmp/bml-authas-integrated.log`; exact changed-file tidy passes in
  `/tmp/bml-authas-integrated-tidy.log`.
- Control-strip range through `2416c5e125` (including actual TT/hook correction
  `36404e182`) and std_max_length `68c28dd1a` are with Sol. Maintainer correction
  `90be0f37c` is queued for recheck of selected state and poster-property data.
  All remain unintegrated pending their bounded reviews. OPML redirect and
  Support FAQ default-language work continue separately; held work is unchanged.

### Explicit UniqCookie approval received

- User asked what the open question was, received the precise two-read
  UniqCookie migration explanation, then replied "do it". This supersedes the
  earlier unanswered approval status for that package only.
- Assigned to the existing Themenav Terra: native request URI/note reads,
  explicit dependency, preserved precedence and behavior, focused harmless
  request-context regressions. Automatic review remains enabled; no workaround
  for a rejection is authorized. Previously held inbox/platform work stays held.

### Control strip, maintainer UI and ordinary helpers integrated

- Sol cleared control-strip range through `2416c5e125`; integrated as
  `0512f0105`. Foreman5 files /18 top-level tests pass, tidy1065/compile1605.
  Six ordinary journal views again return200 without JS/resource failures;
  normalized captured text matches prior replay. Evidence: `controlstrip-native`.
- Sol cleared maintainer `b861d751c` + `90be0f37c`; integrated as `2a33bfeb7`.
  Foreman maintainer+picker285 tests and real desktop/narrow browser pass.
  Rating/reason/checkbox reload and poster property data are covered. Visual
  inspection found duplicate heading; a separate narrow cleanup is queued.
- Sol cleared std_max_length `68c28dd1a` + `7770828d9`, integrated `23023f579`;
  OPML `2b162e1b3` + `f31de37a1`, integrated `04f0fe2b2`. Combined helper tests
  pass4 files /18 top-level assertions in `/tmp/bml-native-web-integrated.log`.
  OPML native303 deliberately repairs old404/noLocation; explicit-user200 and
  anonymous302 behavior remain. No unsupported status-parity claim.
- Support FAQ `55bb9e683` awaits Sol. S2 language initialization is assigned as
  the next ordinary package; explicit journal adapter remains separate.

### Approved UniqCookie package complete

- User-approved source `366d2584f` is independently clear: new request isolation,
  existing48 cookie assertions and10 sysban assertions pass in Sol container.
  Integrated locally as `a23efe915`; only the two request reads and explicit
  dependency change. Mapping/cookie format/block policy remain unchanged.
- Cleared maintainer heading fix `a4dfa3156` integrated as `8986e7de8`.
  Foreman combined5 files /223 tests pass in
  `/tmp/bml-uniq-maintainer-integrated.log`; tidy1070 and compile1605 pass in
  `/tmp/bml-uniq-integrated-{tidy,compile}.log`. All work remains local.
- Support FAQ source `55bb9e683` was cleared and integrated as `7634070da`;
  foreman3 files /78 tests pass in `/tmp/bml-support-faq-integrated.log`.
- S2 language initialization `78817b24a` and Birthday labels `3e1749319` are
  undergoing independent review. SiteScheme request selection and journal/feed
  adapter characterization proceed separately. The inbox platform hold remains.

### Native S2 language initialization and Birthday integrated

- Sol cleared S2 `78817b24a`, integrated as `ea61aa63d`; Birthday `3e1749319`,
  integrated as `d50c11eea`. Foreman6 files /30 top-level tests pass in
  `/tmp/bml-s2-birthday-integrated.log`.
- Exact restarted six-view journal replay returns200 with no JS/resource errors,
  successful disposable helper completion, and normalized captured text equal
  to prior control-strip replay. Evidence is in `s2-language-native`.
- Final maintainer screenshot replay after `8986e7de8` passes and visibly has one
  heading; captures are in `maintainer-final` rather than the earlier duplicate
  heading captures retained for comparison.
- SiteScheme `c431dba34` awaits independent review. Terra packages next cover
  journal/feed adapter method mapping and ordinary draft/preview characterization
  before legacy page retirement. No premature editor or BML engine deletion.

### SiteScheme integrated; external hook question pending

- Sol cleared `c431dba34` with24 real-form assertions; integrated `0838d1028`.
  Foreman settings/language4 files /151 tests, tidy1073 and compile1605 pass in
  `/tmp/bml-scheme-language-{integrated,tidy,compile}.log`.
- Journal/feed audit and characterization `c2bf8d5de` await Sol. RSS/Atom already
  use native conditional response APIs. No in-tree custom data_handler:* or
  s2_head_content_extra implementations exist. User has been asked whether
  deployed extensions use those Apache-style arguments; answer is pending.
  Do not infer approval or remove the adapters while the question is pending.
- Independent work continues on ordinary draft/preview characterization and
  comment request metadata maintenance. Neither requires changing the external
  hook contract or resuming held inbox work.

### Journal characterization and corrected editor audit

- Sol cleared Journal/feed characterization `c2bf8d5de`, integrated as
  `24d762c77`. It does not remove either external-hook adapter; the deployment
  question remains unanswered.
- Independent actual editor HTTP probing supersedes the source-only invisible
  general-error claim: the outer wrapper renders errors. Empty-body translation
  is the reproduced defect; invalid-date text, retained inputs and unchanged
  persistence pass. Rendering corrections through `1e934ae71` await review and
  remove the unnecessary duplicate error block.
- Separate Terra work continues on real owned-entry save/reload and timestamp
  parity. Draft/preview `f7c7b285a` and comment metadata `5994d6271` await Sol.

- Foreman Journal/feed integration passes3 files /49 tests in container
  `/tmp/bml-journal-feed-integrated.log`. Native SiteScheme real-browser replay
  passes both immediate-response and fresh-reload theme classes for purple/red,
  with no JS/resource failures and completed disposable fixture cleanup. Four
  captures are saved in `sitescheme-native`; browser log is on the host at
  `/tmp/bml-sitescheme-browser.log`.

### Native comment metadata integrated

- Sol cleared `5994d6271`: native request metadata preserves existing forwarded
  and historical IP composition, repeat behavior and no-request behavior;
  independent focused/existing suites pass455 assertions. Integrated locally
  as `fcba06e32`. Foreman4 files /421 tests pass in container
  `/tmp/bml-comment-metadata-final.log`. The initial command named nonexistent
  `t/talkpost.t`; corrected to the existing comment validation suite.
- Editor rendering through `1e934ae71` is production-clear with independent
 17 committed plus16 probe assertions. Permanent test cache-reset correction
  remains queued; no duplicate general error block remains in the final range.
- Draft/preview `f7c7b285a` independently passes the browser but needs fresh entry
  count, visible preview DOM text and exact dialog-count assertions. It remains
  unintegrated. Owned-edit `afbbfa240` is queued separately for Sol.

### Ordinary editor HTTP parity and rendering integrated

- Sol cleared owned-edit `afbbfa240` (35 assertions) and mode HTTP
  `54553b668` (61), integrated as `f07bac73b` and `558ba0609`. Browser mode
  parity remains distinct and pending.
- Sol cleared final rendering range through `f36190dd1`, integrated as
  `0aad3e37f`. Existing full empty-body translation, dynamic current-field
  limits and translated date/time labels preserve outer-wrapper errors.
  The fresh-entry regression now resets the singleton cache.
- Foreman combined4 files /116 tests pass in container
  `/tmp/bml-editor-parity-integrated.log`; earlier owned-edit+picker run
  passes162 in `/tmp/bml-entry-edit-integrated.log`. Native comment integration
  full tidy1075/compile1605 pass. All commits remain local.
- Draft correction `1929db445` is under independent browser recheck; timestamp
  browser proof and duplicate FCK dialog consolidation are active separately.

- Sol cleared corrected draft range through `1929db445`; integrated as
  `f86d593dd`. Foreman clean-server real browser passes draft persistence,
  restore/clear, visible preview, exact dialog sequence, unchanged fresh entry
  count and fixture cleanup. Captures: `entry-draft-native`; host log
  `/tmp/bml-entry-draft-integrated.log`. Legacy draft interoperability remains
  separate. Latest editor production tidy1078/compile1605 pass.
- Timestamp HTTP/browser `fdbb67460` awaits Sol. Browser-mode gate5 is assigned
  to Terra; no acceptance claimed from its branch setup alone.

### Legacy draft compatibility findings

- Independent real-browser audit at `1929db445` confirms absent legacy editor
  overwrites a nondefault preferred mode with Casual HTML, while retaining
  content/metadata. Decline clears body but initialization repopulates editor
  property instead of leaving all properties cleared. Separate-account cases
  avoid the earlier reseed race. Narrow fixes/tests are queued with Terra.
- Browser-mode candidate `a6889cd94` awaits independent review. Timestamp
  checkbox/visible-panel corrections pass worker HTTP17/browser and are being
  committed; they are not yet independently cleared.

### Pending browser proof corrections and FCK alias

- Mode browser `a6889cd94` exits0 but is not accepted: it selects the mode
  before checking initial state, omits rendered initial-body/legacy detection
  proof and a no-op save, and compares saved body with a regex. Widgets now
  owns the separate correction; Themenav owns draft parity fixes.
- FCK duplicate deletion `dd207c99c` passes worker35 HTTP, real Image/ImageButton
  insert/edit, build/tidy/compile and intentional cleanup, but foreman found the
  promised nested legacy route absent from the exact commit. Added old-path
  assertion labels still exercise only root paths. Integration is held for a
  real nested alias and direct GET/POST tests; independent confirmation queued.
- Timestamp correction `013cc57da` awaits Sol recheck. No held inbox work or
  external Journal hook interface has been changed.

### Timestamp acceptance integrated

- Sol cleared `013cc57da` atop `fdbb67460`; integrated `8823c34c1`. Foreman
  timestamp/rendering2 files /34 assertions and desktop/narrow visible-control
  browser pass. Capture inspection confirms visible fitting narrow controls.
  Evidence: `entry-displaydate-native`; host browser log
  `/tmp/bml-entry-displaydate-browser.log`.
- Sol independently confirmed FCK `dd207c99c` nested aliases return404; root
  routes pass. It remains held pending the already-assigned route correction.

### Finite edit-form matrix independently clear

- Sol cleared mode browser `d3ad7add3` atop `a6889cd94`, integrated locally as
  `e9281a322`. Actual initial state, no-op/changed saves, exact bodies/editor
  properties and failure cleanup are covered. Foreman replay is running.
- Sol cleared FCK alias `d85f96d33` atop `dd207c99c`: all65 HTTP aliases and
  previous actual Image/ImageButton browser behavior pass. Integration waits
  for the active foreman mode replay to finish before changing runtime files.
- Draft candidate `2a57cbf58` remains held: its blanket synthetic-event filter
  drops the real icon selector change event. Initialization-only correction and
  subsequent user autosave browser proof are being implemented separately.

### FCK duplicate removed; eight BML pages remain

- Cleared sources `dd207c99c` + `d85f96d33` integrated as `6dca2d923`. Root and
  nested aliases remain native; both split command bundles use the root path.
  Foreman build,3 files /95 HTTP tests, actual Image/ImageButton insertion/edit,
  modal cleanup and no-JS/resource-error checks pass. Captures: fck-consolidated.
- Foreman integrated mode browser also passes all five exact no-op/changed
  roundtrips; captures: entry-modes-native. The finite ordinary edit-form matrix
  is now independently cleared and integration-tested.
- New-post characterization `79b65d19d` awaits Sol. Legacy posting-form contract
  characterization and narrower draft initialization/autosave fixes remain active.

### Native private-post characterization integrated

- Sol cleared test-only `79b65d19d`, integrated as `42b80ed08`. Foreman new/edit
 2 files /73 assertions pass in container `/tmp/bml-entry-new-integrated.log`.
  Real private-post action creates exactly one entry with fresh exact content
  and metadata, and clears seeded draft body/properties. Cleared body reads
  undef under existing storage semantics; no production change was made.
- Full integrated FCK formatting1082 and compile1605 pass in container
  `/tmp/bml-fck-integrated-{tidy,compile}.log`.
- Legacy update URL/form characterization is active separately. No old editor
  route, beta gate, or deferred Journal hook interface has been retired.

### Preview extraction and remaining editor contracts

- Finite preview contract is recorded at `83f0e1172`; Terra is implementing a
  legacy-schema wrapper around the native renderer, with old aliases, translation
  scope and style selection preserved. Compilation alone is not acceptance;
  HTTP metadata/poll/embed and actual old/new popup evidence remain required.
- Draft candidate through `03b07b101` passes worker normal/failure lifecycle runs
  but remains under Sol review. The blanket synthetic-event guard was removed;
  binding at window load still needs early-input timing review. No integration
  is claimed yet.
- Test-only legacy update `821770db5` and owned-entry deletion `53dd7cccd` await
  review. Delete uses the supported edit-form action:delete and confirmation;
  no standalone delete route exists or is proposed. Widgets proceeds with a
  separate legacy owned-edit form characterization.
- Existing worktrees, sessions, containers and local-only publication policy
  are preserved. External Journal hooks remain an unanswered deployment gate;
  held inbox work remains untouched.

### Legacy private-post baseline integrated; draft timing held

- Sol cleared the bounded 49-assertion legacy update baseline `821770db5`,
  integrated as `b1f8b13cc`. Foreman combined legacy/native private-post run
  passes2 files /87 assertions in `/tmp/bml-legacy-update-integrated.log`.
  Beta query preservation is source-inspected but not yet asserted by that test;
  a separate narrow query followup is queued with Terra.
- Sol reproduced an actual early-input autosave regression at draft candidate
  `03b07b101`: delaying an image after DOM readiness postpones window.load;
  entered subject/body remain absent from fresh saved draft after load and the
  normal autosave delay. Candidate stays unintegrated. Terra preserves preview
  WIP in a named stash while correcting initialization ordering and adding the
  delayed-image regression, then resumes preview work.

### 2026-09-23 owned-delete characterization integrated

- Sol cleared `53dd7cccd`: HTTP16, real normal browser, intentional-failure
  exit1 and helper cleanup. Integrated locally as `440faea99`.
- Foreman delete/edit2 files /51 assertions and real browser pass; no fixture
  helper remains. Captures are under `2026-09-23/entry-delete-native`.
- Legacy owned-edit `b4d28421e` is now independently reviewing; no old editor
  route is removed by these test-only characterizations.

### Legacy edit baseline integrated

- Sol cleared `b4d28421e` with101 assertions and focused formatting; integrated
  as `53357f450`. Foreman legacy/native edit2 files /136 assertions pass in
  `/tmp/bml-legacy-edit-integrated.log`. The actual visible Save submit must
  be chosen because a falsey hidden action:save precedes it in the old form.
- Query preservation followup `5016ad50e` awaits narrow independent review.
- Draft source correction `cdeb4d68b` remains held: foreman identified that a
  static initial-properties comparison suppresses later reverts and precedes
  the body-change branch. Terra is correcting those paths and adding permanent
  early-input/change-revert coverage before any integration.

### Query compatibility and next bounded packages

- Sol cleared `5016ad50e`; integrated as `4d72caddd`, foreman51 assertions pass
  in `/tmp/bml-legacy-update-query-integrated.log`. Encoded values and the old
  repeated-value NUL representation survive the beta GET redirect in both aliases.
- Draft range through `2abd3d682` now contains permanent delayed-image,
  property-revert and body-only coverage; Sol is independently rechecking it.
  Preview WIP is restored separately and remains uncommitted/incomplete.
- Moderated posting baseline `87dd370c9` passes worker66 assertions and awaits
  Sol. It records legacy retained draft properties versus native full clearing;
  external delivery is stubbed, and no production change is made.
- Independent language audit identified a minimal cleanup: remove the unused
  BML::ml call from get_lang_names and delete the uncalled set_lang method.
  Native names retain configured/explicit order and skip unknown languages.
  Plain nonweb get_lang_names currently fails solely on that unused BML call.
  Terra is implementing the finite request/nonweb/PrivList tests separately.

### Moderation baseline and native language names integrated

- Sol cleared moderated baseline `87dd370c9`, integrated as `3862f9eba`.
  Documentation-only merge conflict was resolved by retaining both the configured
  spellcheck boundary and moderation evidence. No production posting change.
- Sol cleared minimal language cleanup `368deaed8`, integrated as `b29e99f50`.
  Unused BML lookup and uncalled set_lang are removed; actual configured native
  names and PrivList output are unchanged, and plain nonweb lookup now works.
- Foreman combined5 files /143 tests pass in
  `/tmp/bml-moderated-lang-integrated.log`; full tidy1089 and compile1605 pass
  in `/tmp/bml-lang-names-integrated-{tidy,compile}.log`.
- Draft `2abd3d682` remains held: independent delayed decline-clear response
  reproduces lost newly typed subject/body. Widgets now owns that isolated
  correction; its preview-browser WIP is preserved. Themenav owns preview HTTP
  and shared-renderer work at incomplete checkpoint `39cf0ff9d`.
- Preview checkpoint retains BML file and is not integrated. Foreman found
  legacy stylesys!=2 incorrectly falling into the native S2 choice and an
  incorrect placeholder scope: the decoder uses global entryform.subject.hint2,
  with one remaining BML::ml call. Corrections and meaningful locale/style tests
  are assigned. Browser baseline/final remains a separate finite package.

### Current immutable draft and preview review queue

- Draft `4c1bb999e` fixed delayed-clear input but independently failed untouched
  decline by recreating draft properties. Correction `6616ce8c4` compares pending
  events with the initial snapshot; worker reports both browser suites passing.
  Sol recheck is pending; the entire candidate range stays unintegrated.
- Preview source and popup browser through `d1fc00e58` are independently bounded
  clear. Followup `45df8b99d` strengthens exact userpic, context, access, style and
  final nonmutation assertions. Exact formatting and native two-poll/embed
  controls remain assigned, and no preview BML deletion is accepted yet.
- Configured spellcheck finite contract is recorded at `a426524be`; its test-only
  legacy characterization is next for Themenav after preview evidence. Widgets
  has a separate ordinary crossposting audit, with all delivery stubbed.
- Existing deployment-hook question and held restrictions remain unchanged.

### Preview popup baseline integrated

- Independently clear browser characterization `bdce75f8c` is integrated as
  `5f6a1b12d`, without candidate renderer changes. Foreman exact legacy/native
  popup run passes, fresh entry count remains unchanged and fixture exits.
  Host log `/tmp/bml-entry-preview-before.log`; focused helper tidy passes.
- Six before-migration desktop/narrow captures are retained under
  `doc/bml-evidence/2026-09-23/entry-preview-before/`.
- Sol confirmed an additional ordinary hook-parity finding: the shared native
  renderer newly invokes spam_check for legacy previews. Terra is preserving
  the original native-only invocation and adding a local counter assertion.
  No external hook interface change is authorized or implemented.

### Draft recheck remains held on focused-field timing

- Sol recheck at `6616ce8c4` passed the committed held-clear scenario and
  untouched decline on rerun (one initial timeout retained as an observation).
  A separate deterministic timing probe still loses a subject typed during
  pending clear and blurred only after clear succeeds: the new handler snapshots
  that typed value before the change event, then suppresses it as unchanged.
  Probe/log: `/tmp/sol-draft-subject-blur.{js,log}` in the Sol container.
- Widgets is preserving crossposting characterization WIP at a safe boundary
  before correcting the draft snapshot/input timing with a permanent regression.
  No draft candidate has been integrated. Crossposting audit `400fcffce` remains
  separate, and external delivery is stubbed in its unfinished test fixture.
- Preview formatting WIP briefly used literal backslash-n inputs; foreman caught
  the false proof and required real newline/markup assertions before acceptance.
  The native-only hook-invocation correction is also pending independent review.

### Delayed-image diagnosis completed; final regression ordering pending

- Scheduled run inspection found no surviving draft browser/helper in either
  Terra container or Sol container. Live ownership is Widgets for draft,
  Themenav for preview; no duplicate run was launched in a worker container.
- Source correction `5b260732a` independently passes Sol's preserved subject
  typed-before-clear/blur-after-clear probe and the existing delayed-image,
  untouched-decline parity suite. Worker normal parity/preview also pass;
  intentional cleanup exits1 with helper absent and focused checks pass.
- Permanent test `49b75211e` requires one narrow ordering correction: continuing
  an intercepted request does not prove response/callback completion before
  Tab. Widgets is making that ordering explicit before final integration.
  No additional draft coverage is requested.
- Preview followup `d61cf7537` now passes worker20 top-level assertions with real
  raw/casual newlines, two poll controls in both pipelines, and preserved
  native-only hook invocation. Independent finite review and full validation
  status are pending. Preview WIP/history and crossposting stash are preserved.

### Preview candidate integrated and verified

- Sol cleared finite candidate through `e6847b817`; integrated final range as
  `abc509db6` with the legacy BML file retained pending method/fallback audit.
- Foreman preview plus shared-decoder legacy new/edit suite: 3files173 PASS;
  static build PASS, full tidy1091 and compile1605 PASS. Container logs
  `/tmp/bml-preview-integrated-{prove,build,tidy,compile}.log`.
- Exact integrated popup browser PASS after clean server restart; no entry
  creation or JS/HTTP failures; helper absent. Host log
  `/tmp/bml-entry-preview-native.log`, captures under entry-preview-native.
- Final draft test ordering alone still passed old code because an unrelated
  editor change caused a save. Widgets isolated subject-only timing in
  `fc570e26e`; fixed run passes, exact known-broken comparison remains underway.
  Production `5b260732a` is independently clear, but permanent-test gate remains.

### Preview method compatibility and draft negative control

- Sol retirement audit identified a material method regression in the accepted
  preview candidate: POST-only native registration returns405 for GET/HEAD,
  while old routes returned200 with localized bml.requirepost (HEAD empty).
  Correction is assigned on the integrated base before executable removal.
  Both aliases, request getter and HEAD representation parity will be tested;
  retained .bml.text remains required by the explicit native translation scope.
- Draft permanent subject-only regression `fc570e26e` passes fixed source and
  fails known-broken `6616ce8c4` at the intended saved-subject assertion in the
  worker container; cleanup/restoration completed. Sol exact recheck is underway.
  Earlier broader timing tests were false positives due an editor change
  incidentally causing a property save. No additional draft features are added.
- Spellcheck baseline `3b367d0c` passes worker15 assertions and awaits independent
  review. Crossposting native-post baseline `785a5004` passes10; actual legacy
  aliases and native edit followup remain active. Delivery stays stubbed.

### Draft timing range integrated: finite gate closed

- Sol fully cleared production through `5b260732a` and permanent test through
  `fc570e26e`. Exact fixed browser passes; exact known-broken6616 fails at the
  saved-subject wait; disposable helper cleanup succeeds in both cases.
- Integrated final range as `11fd6c97d`. Foreman static build and scoped helper
  tidy pass, then sequential exact browser suites both exit0: delayed-image,
  legacy accept/decline, property reverts, and final isolated subject/clear/blur.
  Logs in foreman container `/tmp/bml-draft-final-{build,tidy,parity,preview}.log`.
  Anchored helper check is empty after completion. This closes the finite draft
  timing investigation; no additional draft coverage is required.
- Preview method/deletion range remains held on one response-shape correction:
  legacy requirepost GET returned bare localized text, while error_ml wraps a
  full Error page. Terra is returning native localized text directly and adding
  exact GET-body/HEAD assertions. Candidate source/deletion otherwise reviewed.

### Recovery reconciled; characterization ranges integrated

- Confirmed clean root and committed final draft ledger2b164e4ee after recovery.
  Existing worker sessions survived; stale 4c/6616 findings were not reopened.
  Handoff rewritten around current accepted state in b28269995; old chronology
  remains here and in Git history rather than contradictory active queues.
- Sol bounded-clear spellcheck baseline3b367d0c integrated f6a8261d7, foreman15
  PASS. Sol bounded-clear crosspost range through9e6614a3 integrated d6aa5dbb7;
  combined two-file65 PASS, /tmp/bml-crosspost-spellcheck-integrated.log.
- Widgets now extends only finite legacy spellcheck retention/disabled/draft
  proofs; Themenav finishes preview bare-response correction; Sol reviews exact
  fixes and native spellcheck plan. No deployment-hook approval or held-work
  authorization was inferred from recovery.

### Preview executable retired; seven pages remain

- Sol cleared method/retirement range through013be9041, integrated38dca7bd7.
  GET returns the exact bare native-localized requirepost body, HEAD retains
  matching representation headers with no body, and both legacy aliases work.
  Only executable preview/entry.bml is removed; translation companion remains.
- Foreman focused22 PASS in /tmp/bml-preview-retirement-integrated.log and
  exact actual popup browser PASS after restart, host
  /tmp/bml-preview-retired-browser.log. Fixture helper absent after completion.
- Native spellcheck implementation is active in Themenav. Expanded legacy
  baseline2c6 passes28 but Sol identified incomplete original finite assertions:
  exact returned body/backdate/RTE, full draft properties, disabled edit control.
  Widgets owns that narrow correction;2c6 is not accepted/integrated yet.

### Continued native spellcheck and next image insertion contract

- Collected native spellcheck candidate d920ae962 (worker26 HTTP assertions);
  Sol independently reviewing it. Themes owns required real RTE acceptance via
  reversible isolated test-server configuration and in-process checker stub,
  with no external checker or production configuration changes.
- Widgets is correcting the sole remaining legacy baseline issue at044ad05b4:
  hidden switched_rte_on is always0, so meaningful stored-RTE proof must observe
  conditional useRichText initialization and a non-RTE response control.
- Preserved Sol's completed ordinary image-popup audit in
  BML-IMAGE-INSERT-ACCEPTANCE.md. Existing imgupload performs URL insertion,
  not uploads; modern plain-editor parity is the bounded next package. Actual
  media upload APIs and external deployment interfaces remain outside scope.

### Legacy spellcheck proof complete; native corrections in review

- Integrated independently clear legacy characterization through47f62923d as
  c6c1f96f9. Stored-RTE proof observes conditional useRichText initialization with
  a non-RTE control, rather than the unconditional hidden zero value. Foreman
  spellcheck/crosspost combined91 PASS, /tmp/bml-editor-characterization-final.log.
- Sol found three native d920 issues: unavailable checker action could reach save,
  submitted community context was lost, and action state used a writable POST
  sentinel. Terra correction c95084daa passes38 and is under independent recheck;
  no native spellcheck range is integrated yet. Isolated browser fixture dde8aa7c3
  independently passes normal/failure cleanup; final production replay is active.
- Legacy image insertion baseline through3998819c17 passes normal browser with
  visible desktop/narrow popup captures. Final failure cleanup remains in progress.
  Pre-existing dangling resize handler after popup close is explicitly recorded;
  no production change or page-error suppression was used for characterization.

### Native spellcheck integrated after final context correction

- Sol final-clear f8bbe2413 includes the additional explicit-empty owner selection
  correction: posted field presence wins over stale community GET context.
  Original owner-switch probe2/2 and final focused41 PASS. Earlier unavailable
  checker action and writable POST-sentinel findings are resolved. Integrated
  native range d920 throughf8 as19a32d950.
- Foreman combined5files205 PASS; full tidy1099 and compile1605 PASS; build PASS;
  actual isolated configured RTE browser PASS, helpers/server absent afterward.
  Logs /tmp/bml-native-spellcheck-{combined,tidy,compile,build,browser}.log.
  Captures preserved in doc/bml-evidence/2026-09-23/entry-spellcheck-native.
- Legacy image baseline through6af8b9a4d independently clear, integrated61682d4d3,
  foreman25 PASS. Both normal and intentional-failure lifecycle independently
  passed. Before captures explicitly record old narrow clipping/overflow.
- Widgets native URL-insertion10e2 is only an implementation checkpoint; required
  browser acceptance and refinements remain unaccepted WIP. Themes Protocol notes
  178af2896 is queued for review, with external getevents callback left unchanged.
  Sol continues finite ordinary legacy POST mapping audit for the next extraction.

### Native Protocol note storage integrated

- Sol clear178af2896 integratedc2cc22f9c: only clientver and journalid note writes
  now use DW::Request; truthy existing journal note and no-request behavior remain.
  External DISABLE_PROTOCOL callback, authentication and permission flow unchanged.
- Independent15 focused,26 request subtests and tidy1097 pass. Worker full compile
  1605 passes; existing t/protocol.t intentionally skips1..0 and is not counted as
  exercised coverage. Foreman combined notes/request/roundtrip51 PASS in
  /tmp/bml-protocol-notes-integrated.log.
- Sol ordinary old-POST schema audit preserved77db58478 in
  BML-EDITOR-POST-COMPATIBILITY.md. First decoder extraction characterizes exact
  old behavior then moves it without route changes, retaining decode_entry_form
  hook and current LJ API. No external interface retirement is implied.

### Legacy decoder extracted without route changes

- Sol clear characterizatione6657c8c and extractioncf7fd694e integrated as
  46a1a5398 and31a4c2fd3. Old/new decoder bodies are byte-identical after name
  normalization; GPL notice retained. LJ forwarding preserves original arguments
  and return, and deployment hook identity/order remains intact.
- Foreman legacy decoder/update/edit157 PASS; dependent legacy preview22 PASS;
  full compile1607 PASS. Logs /tmp/bml-legacy-decoder-{integrated,preview,compile}.log.
- Next normalizer keeps old flat-property semantics and crosspost values while
  preparing canonical native input. Foreman identified legacy repeated POST NUL
  joining at DW/BML.pm948-949: a native Hash::MultiValue boundary must preserve
  that scalar contract explicitly, not silently take one repeated value.
- Native image remains unintegrated. Enter parent-form submission was reproduced
  by Sol; the correction is being covered with actual keyboard assertions. URL
  constraint/FAQ-hook fixes and final viewport/RTE/lifecycle matrix remain active.


### Canonical normalizer accepted; native image harness correction queued

- Sol independently cleared264a0e19..c12a30c5a. Integrated design26040bb19 and
  implementation7d3a8eb70; foreman decoder/normalizer/crosspost59 PASS in
  /tmp/bml-legacy-normalizer-integrated.log. Repeated POST fields retain exact
  old each-order NUL joining, including empty-first values. No routes changed.
- Retry mapper90fec3cdf is awaiting independent review. Foreman found the raw
  legacy subject placeholder would reappear on native retry; the correction uses
  canonical normalized subject and tests a real native decode of that retry.
- Image production through42d0f6f5 independently resolves local URL constraints,
  Enter accidentally submitting the parent form, Cancel behavior and FAQ hook.
  Sol found its intentional browser run could instead fail when FCK fetched the
  deliberately invalid escaping-test URL. Browser-onlyba1991d4a uses a successful
  local image while retaining escaping and strict resource-error assertions.
  Worker normal and named intentional failure/cleanup pass; Sol recheck queued.
- Legacy success housekeeping is separate preserved WIP, not accepted code.
  The next pure edit action selector also changes no routes or persistence.


### Native plain-editor image integration complete

- Independent final gateba1991d4a clear: local successful RTE image retains the
  escaping assertion; intentional run reaches the named throw, exits1 and leaves
  no fixture. Production local URL, keyboard Enter/Cancel and FAQ fixes clear.
- Integrated as59ebe781c. Foreman focused4files56 PASS, static build PASS, actual
  browser PASS, tidy1105 PASS and compile1607 PASS. Logs in foreman container:
  /tmp/bml-native-image-{integrated,build,browser,tidy,compile}.log.
- Foreman inspected desktop/narrow captures in image-insert-native. Legacy
  imgupload remains only while old posting-page callers remain; shared translation
  keys are intentionally retained.
- Separate mapper gate remains held at90fec: raw custom_bit_0/61 were ignored by
  old decoding but forwarded to native retry. Narrow exact1..60 correction and
  permanent boundary regression are assigned. No mapper code is integrated yet.


### Legacy wrapper prerequisites: finite reviews and hook preservation

- Pure selector451081d7f independently clear: explicit caller-supplied maintainer
  eligibility restores old disabled-branch fallthrough to spellcheck/delete/save;
  direct and synthetic submit_value cases pass. Integration awaits mapper range.
- Mapper5f187 fixed0/61 but numeric bounds still admitted zero-padded01/001/060
  keys which old decoding ignores. Foreman identified and Sol reproduced these
  exact-key failures. Final literal-key correctione3deb7485 is in recheck.
- Housekeeping0e88+3e876 remains unaccepted. Foreman caught invented credential
  field order in both helper and tests; actual fields are prop_xpost_password_ID,
  prop_xpost_chal_ID and prop_xpost_resp_ID. Legacy session-remote queue eligibility
  must also be retained separately from authenticated poster identity. Fixes active.
- Root source audit3f464bfb2 and test-only8a55d0170 preserve legacy success-hook
  requirements. Actual ordinary and moderated form suites pass149 assertions,
  log /tmp/bml-legacy-success-hooks-combined.log, scoped tidy PASS. Independent
  review queued; no production hook change. Preparation must retain the original
  flat request reference shared by decoder/success hooks, alongside separate
  canonical data. Existing deployment interfaces are preserved, not retired.


### Native retry and rendering prerequisites integrated

- Final mapper e3deb independently clears invalid0/61 and padded01/001/060 while
  retaining exact1/60; integrated374e45d80. Selector451 independently clear and
  integratedde05d97bb. Foreman helpers plus actual old update/edit191 PASS in
  /tmp/bml-legacy-helper-integrated.log.
- Preparation27026 independently clear, integrated182cad0d7. Original decoder
  seed/ref/flat fields remain intact; canonical top-level and props hashes are
  separate. Existing in-place normalizer behavior remains. Combined5 helper
  suites23 top-level PASS in /tmp/bml-legacy-preparation-integrated.log.
- Root rendering extractionbe407 independently clear: exactly7 inserted lines,
  unchanged tail and seven explicit former lexical inputs. Foreman and Sol85
  affected HTTP assertions PASS. Combined-tree tidy1107 and compile1607 PASS
  before subsequent preparation test addition, logs /tmp/bml-editor-helpers-*.log.
- Actual old success-hook baseline8a55 independently clear149 PASS. Follow-up
  b762 timing test75 PASS awaits independent review: legacy check observes saved
  entry before success rendering and shares original flat decoder request.
- No old posting/edit route was changed by these helper packages. Housekeeping
  final427 remains in independent review; success-hook and rerender adapters
  continue in isolated worker branches. No publication or deployment.


### Legacy housekeeping integrated; real hook response fix remains held

- Sol final427e4109b clear: actual credential field spelling, session-remote
  identity, and POST/GET master fallback all verified with no external delivery.
  Integratedd8b910151; foreman4files216 PASS in
  /tmp/bml-legacy-housekeeping-integrated.log (including native defaults and
  actual moderated posting). No legacy route cutover yet.
- Root hook timingb762 independently clear75/75: actual persisted count and
  shared original request reference prove the recorded old ordering.
- Hook implementation483f is NOT accepted. Foreman found it concatenated hook
  HTML onto DW::Template::render_template's status return, after that API prints
  the response. Its stub returned fake markup and masked this. Worker correction
  must pass legacy HTML into real template rendering and prove actual body/status
  for ordinary and moderated responses. Baseline requires options before HTML;
  it does not require calling the HTML hook after sitescheme emission.
- Sol is checking prepared canonical data against an actual disposable native
  save while independent rerender/hook fixes proceed. No new authorization or
  deployment-interface decision is inferred.


### Legacy new-post prerequisites complete; explicit adapters active

- Hook483f..7d11 independently clear with actual ordinary and moderated template
  response/status proof; integrated0c3bb1722. Foreman4files193 PASS in
  /tmp/bml-legacy-success-hooks-integrated.log.
- Rerender00b independently clear, integratedb96357e07. Actual parsed native form
  retains mapped controls and exact encoded/repeated query on /entry/new action;
  no save. Foreman4files107 PASS in /tmp/bml-legacy-rerender-integrated.log.
- Post-attempt callbackd372 independently clear, integratedda092e789: explicit
  legacy context only, original flat request, old failure/ordinary/moderated
  ordering retained. Native pre-save path unchanged. Foreman callbacks3files91
  PASS; full tidy1112 and compile1607 PASS in /tmp/bml-legacy-adapters-*.log.
- Sol actual prepared legacy-to-native save probe atd8b910151 passed30 assertions
  using a rendered old form, disposable owner and force-fresh persisted entry:
  subject/body/RTE/security/date/backdate/tags/location/music retained. Probe at
  /tmp/bml-sol-canonical-save-probe.pl in reviewer host/container; no route/auth,
  hook or external crosspost claim.
- Themes now implements callable ordinary owner-old-POST adapter with test-only
  routing; Widgets prepares owned-edit rerender. Both exclude public route
  registration and page deletion until their bounded implementation gates pass.


### Owned-edit rendering and first owner update adapter

- Mechanical edit renderer extraction ed03dfc2d independently clear and
  integrated as 5bead7879. Foreman edit/rendering parity passed 52 assertions in
  /tmp/bml-edit-render-extraction-integrated.log. Existing missing Russian
  fixture diagnostics remain; no changed behavior was found.
- Owned-edit integration audit is preserved in
  BML-OWNED-EDIT-INTEGRATION.md (99d2d0dfd). Edit delete/log/pre-save-hook order
  differs from new-post ordering; no new-post draft/preference housekeeping
  belongs in the edit adapter.
- Callable owned-edit rerender bdc3f3a6a is held: independent invalid-year probe
  rendered 0000-02-03 instead of submitted not-a-year-02-03. Persisted entries
  remained unchanged. Widgets is correcting displayed raw date/time retention
  separately from canonical backend values and its edit-success work.
- Callable owner-only update adapter 752163c08 is in independent Sol review.
  Worker reports old-form plus adapter 180 assertions, focused pipeline 218,
  tidy 1113 and compile 1607 passing. No public routes are registered. Themes
  continues disposable real-browser acceptance through test-only routing.
- Held inbox work and pending external Journal hook interfaces remain unchanged.


### Update adapter review findings and edit corrections

- Sol holds owner adapter752: decoder hook runs before token/referer decisions;
  flat request lacks old mode/ver/user/password/usejournal/xpost seed fields;
  valid empty body skips old protocol-attempt then spam-hook ordering. Separate
  reproduced probes confirm hook counts. Themes is correcting these before
  integration, preserving browser harness WIP.
- Widgets committed edit success seams015f36746 and raw date/time display fix
  7550febd5 atop bdc. Both are queued for independent review. Canonical backend
  values remain separate from raw retry controls. Worker continues ordinary
  owned save/delete callable adapter without public registration.


### Owned-edit prerequisites integrated after independent rechecks

- Rerender bdc plus755 raw date/time correction independently clear, integrated
  cef5672e6 and83765695c. Original invalid-year probe now passes18; committed
  rerender22 proves invalid date/time text and unchanged fresh entries. Foreman
  shared mapper/new retry/native edit combined5files102 PASS in
  /tmp/bml-owned-edit-rerender-integrated.log.
- Opt-in edit success015 independently clear, integrateda272189a0. Exact raw
  callback/master/session actor, composite ID/deleted flag, delete extras order,
  suspended notice, failed-save and native defaults are preserved. Sol direct
  sentinel6 PASS proves draft and editor preferences unchanged. Foreman combined
  edit/crosspost/new-housekeeping/hooks5files176 PASS in
  /tmp/bml-owned-edit-success-integrated.log.
- Full foreman tidy1114 and compile1607 PASS in
  /tmp/bml-owned-edit-{tidy,compile}.log. No root test process remains active.
  Public route registration remains unchanged; callable update correction and
  ordinary-owned edit adapter continue in worker branches.


### Callable owner adapters integrated; real-request acceptance continues

- Owner update752+26c independently clear, integrated13cba88f7/c116f5b44.
  Invalid-token/untrusted-referer paths return before hook-bearing decode; exact
  old seed fields survive decode/spam/success; real-token empty body preserves
  protocol-attempt then spam-hook timing. Sol187 PASS. Browser and public route
  activation remain separate gates.
- Edit helperbeb had a concrete raw-POST versus decoded-request bug; final771
  independently clears it (original reviewer probe5/10 before,10/10 after).
  Integrated5af39e827/88e2c2cc8. Delete clears decoded and canonical event; raw
  POST stays separate for crosspost callbacks. Helper26 PASS does not prove
  real-form routing or persistence; Widgets continues that exact HTTP deliverable.
- Foreman combined callable/retained/native6files462 PASS in
  /tmp/bml-callable-adapters-integrated.log; tidy1116 and compile1607 PASS in
  /tmp/bml-callable-adapters-{tidy,compile}.log. All root test processes completed.
- Independent next community/moderation handoff preserved at
  BML-UPDATE-COMMUNITY-INTEGRATION.md (fb550e880). POST usejournal alone selects
  the save target; absent/empty means owner, named missing/denied never falls
  back to owner. Existing policy, moderation and extension contracts stay intact.


### Real-request acceptance remains held on fixture corrections

- Widgets test-only real middleware increment757 and direct-alias increment8d
  are NOT accepted. Sol added fresh security assertions and reproduced private
  entries becoming public: visible_click selected the first empty same-name
  control, and manual submit_value rewriting hid the wrong form serialization.
  Fix requires the established truthy visible submit predicate, removing the
  rewrite, and exact fresh security retention. Baseline22 passing assertions
  miss this; reviewer corrected diagnostic24 passes. No canonical production
  defect is established by this fixture failure.
- Sol proper-seed helper diagnostic25 passes canonical body/subject/metadata/
  security and delete ordering with no persistence claim. Real denied/retry
  alias matrix remains separate worker WIP; unsupported source fallback alone
  is not accepted test coverage.
- Themes browser harness remains uncommitted. Foreman identified old FCK
  instance draft versus native entry-body, and old alias GET form action differs
  from the page URL; those harness assumptions were corrected. Current work
  diagnoses native retry editor initialization from exact runtime state. No
  browser pass or route activation is claimed; disposable processes are checked
  before reruns rather than launching duplicates.


### Actual error retry and update browser acceptance clear

- Foreman completed the unfinished HTTP matrix in93fab0e2d, independently clear
  by Sol: actual encoded form pairs remove every action control and submit_value;
  distinct submitted subject/body, zero decode/spam hooks, fresh security/body/
  subject/unrelated checks make no-action/unknown/missing/invalid cases nonvacuous.
  Exact POST alias URIs are now asserted. The test uses original editevent seed.
- Real invalid-date POST exposed a production duplicate alert: helper added the
  same backend error to errors and warnings.93fab removes the warning copy and
  guards absent success status. Actual Foundation HTTP proves one visible error,
  raw invalid date/subject/body/security, modern retry/query and no persistence.
  Direct helper asserts one error object/no warning instead of depending on its
  partial request's warning markup. Foreman4files221 PASS; Sol HTTP138/helper26/
  rerender22/selector6/edit-success16 all PASS.81 worker increment is superseded,
  not integrated as accepted evidence.
- Update browser192 independently clear and integrated75e674910. Foreman exact
  static build and real normal browser pass in /tmp/bml-update-adapter-*.log;
  no helper/server remains. Sol normal and named intentional exit1 cleanup pass.
  Source old draft/native entry-body FCK names and rendered form action are
  asserted. Initial404 was stale built combined JS assets; rebuilding
  build/static/max/js resolved it without production changes or mode bypass.
- Inspected foreman captures preserved by5a390efd4 in
  doc/bml-evidence/2026-09-23/legacy-update-adapter. Full tidy1119 and compile1607
  PASS in /tmp/bml-editor-acceptance-{tidy,compile}.log; root sessions completed.
- Widgets0a3513ca1 browser save/delete is retained-BML baseline only (port8080,
  no native route). Not accepted as native migration evidence. Worker now has
  clear93 prerequisite and must add isolated test-only native route plus retry.
  Themes continues authorized community/moderated update extension. No public
  route activation, BML deletion, push or deployment yet.


### Community extension reviewed; URL activation remains separate

- Immutable7c806d7a0 production is bounded-clear after Sol278 assertions and
  strengthened reviewer counterchecks. Permanent test correction remains pending:
  undef form value emits an empty field, so absence must actually omit usejournal;
  no-community-crosspost needs a selected master checkbox; differing nonempty
  POST/GET targets need explicit precedence proof. No production defect found.
- Themes is correcting those assertions separately from new route activation.
  Activation must preserve the routing call ABI and old early fallback guards;
  registering the named-options helper directly would receive a positional route
  object. GET and unsupported old forms remain BML until their own migration.
- Native edit browser remains WIP. Foreman found its isolated test server read
  only GET itemid, while the actual old form submits hidden POST itemid. The
  apparent successful save therefore fell through to old BML. Worker is fixing
  the test route and asserting native response markup plus modern retry action.
  No native browser gate is claimed from the earlier generic success assertion.


### Community acceptance integrated; production route reviews queued

- Sol e54d50c9c test correction CLEAR: selected crosspost master, truly omitted
  target field, and differing POST/GET community counts pass286 independently.
  Integrated7c/e54 as bdfe83dcd/ad7debbef. Foreman combined update/retained/
  moderation/crosspost/edit5files629 PASS, full tidy1119/compile1607 PASS in
  /tmp/bml-community-{integrated,tidy,compile}.log. All root processes complete.
- Public update activation82a496e03 is immutable and under independent review,
  not yet integrated. Worker proceeds separately on nonpersisting rerenders and
  transforms; audit preserved in BML-UPDATE-TRANSFORMS.md (fc5cfe09b).
- Native edit browser cfe07cdf2 is queued for review with its baseline fixture0a.
  Test server now resolves the actual hidden POST itemid and asserts native
  success markup. Worker normal/retry/save/delete and named intentional exit1
  cleanup pass with desktop/narrow captures. Production dispatcher remains next
  bounded work, preserving existing picker and all unsupported BML branches.


### Accepted update POST subset now uses native dispatch locally

- Sol82a496e03 bounded CLEAR: public app43, callable286, retained75, tidy1116,
  compile1607 PASS. Independent strengthened native retry47 PASS proves visible
  error, exact subject/empty body and fresh nonmutation. Route wrapper preserves
  callback ABI, all-method fallback, no_redirects and legacy .bml normalization;
  old text/GET-target/identity/can_post guards precede decoding.
- Integrated8ba94e59d. Foreman combined public/callable/retained/moderation/native
  new5files522 PASS in /tmp/bml-update-activation-integrated.log. GET/unsupported
  requests remain BML, accepted owner/community/moderated POSTs use native save.
- Callable transform WIP must retain include_transforms off by default because
  its base now registers the adapter publicly. Ordinary rerender empty-field
  retention differs from transform truthy fallback. Worker is implementing the
  full finite field/hook/nonmutation/isolation matrix before review.


### Disabled transform candidate held; edit retry proof correction queued

- Sol callable transforms07f49a1be..98a667bf4 NOT clear despite342 PASS. Three
  material differences: checker runs before token validation, ordinary absent
  subject/body/tags lose GET defaults, and transform merges metadata that old
  transform never carried while empty POST xpost incorrectly suppresses GET.
  Worker fixes exact baseline maps and guard ordering with permanent assertions.
  Public include_transforms stays off; no candidate integration claimed.
- Ordinary custom-security fixture initially lacked a real access group, so
  all three rerender cases selected public; this was not preview-only evidence.
  Worker supplies a real owned group before interpreting mapper behavior.
- cfe browser normal/named failure and independent distinct retry variant PASS,
  but committed retry reposted unchanged values. Worker b79d7332b corrects it
  with distinct subject/body/native success/fresh persistence; recheck pending.
- Ordinary owned dispatcher38bdc5111 is immutable and queued for Sol. Worker
  progresses separate browser acceptance through actual public app dispatch,
  keeping the callable browser branch and all prior work preserved.


### Callable edit browser integration and preserved captures

- Sol exactb79d7332b CLEAR: distinct retry values, modern success link and fresh
  database values prove retry saved; normal browser/check and lifecycle pass.
  Integrated0a/cfe/b79 as42ab08b25/6a26ab7a8/30b7d90f4. Foreman exact static build
  and browser PASS in /tmp/bml-owned-edit-browser-{build,integrated}.log; no
  fixture or adapter server remains. Captures3ecfc9438 visibly preserve retained
  baseline versus native desktop/narrow error form. Legacy missing title is
  explicitly documented, not claimed fixed by this callable browser package.
- Public dispatcher38bd and overlay-free browser239e remain under review.
  Transform fixesa6/b80 and token tests6bd are not integrated yet; remaining
  exact fallback assertions and independent fixed-range recheck are pending.


### Callable transforms and public owned edits integrated

- Sol finaldc1814ca9 callable transform range CLEAR:396 + public default-off43
  + tidy1116 PASS; reviewer397 proves actual account checkbox fallback.
  Integratedda02bde4c..776789fba, keeping public include_transforms off. Foreman
  decoder/normalizer/formdata/rerender/spellcheck/adapter7files517 PASS in
  /tmp/bml-update-transforms-integrated.log.
- Sol028e5c666 dispatcher permanent matrix CLEAR:162 twice and tidy1120 PASS.
  Hidden POST itemid explicitly invokes native helper1; beta/readonly/authas
  fallback is nonvacuous, with readonly limited to its method-guard fixture.
  Integrated38bd/58b/028e as5ea5858fc/31d322889/dad4bc220. Public browser239e
  clear normal/intentional cleanup, integrated06735ba3a without route overlay.
- Foreman combined6files901 PASS, exact real public owned-edit browser PASS,
  full tidy1123/compile1607 PASS. Logs /tmp/bml-editor-public-{integrated,tidy,
  compile}.log and /tmp/bml-owned-edit-public-integrated.log; no fixture/server
  remains. Desktop/narrow evidence preserved e575e2a76. All root sessions closed.
- Next: public transform activation (worker111 passing, not yet reviewed),
  callable authenticated GET renderer with original prefill/hook/draft contract,
  then remaining GET/unsupported paths. Editor mapping uses already accepted
  retry semantics per BML-UPDATE-GET-EDITORS.md; no invented product gate.
  All integrations local, no push/deploy or BML editor deletion.

### Next GET packages and public transform review

- Public transform activation565eb2cff19f52981086f4b6770744ab603fb1d5
  is committed with111 worker assertions and queued for independent Sol review;
  it is not integrated yet.
- Callable update GET rendererc5d862a8009c017de6bbca3e05e02665f66408ee
  has9 template-variable assertions. Actual template acceptance is in progress;
  foreman identified the retained user-preformat OR hook-preformat contract at
  LJ/Web.pm:1267 and routed the false-hook/true-user case for correction.
- Independent ordinary owned-edit GET audit is preserved in
  BML-OWNED-EDIT-GET.md. Themes is implementing a callable-only wrapper on an
  isolated branch, with canonical native form action and raw query preservation.
  No GET route activation, deployment interface change or held inbox work is
  authorized by these increments.

### Public transforms accepted locally

Sol565eb2cff CLEAR: public111 and callable396 PASS. Integrated asd419097ae;
foreman combined public update/callable/owned-dispatch3files669 PASS, tidy1123
and compile1607 PASS. Logs /tmp/bml-public-transform-{integrated,tidy,compile}.log.
A preliminary invocation used a wrong test filename and is preserved separately
as invocation-error, not counted as evidence. The comment-context cherry-pick
conflict retained the existing owned-edit dispatcher unchanged. Public legacy
showform/moreopts/preview/transforms/spellcheck now use reviewed native rerenders.
Ordinary GET and excluded contexts still use retained BML. No push/deploy.

### Callable update GET rendering accepted

- Sol finalc5..76d CLEAR: retained preformat OR restored in72f; supported rich
  precedence unchanged. Actual localized hook callback/ref/count, real escaped
  fields, exact action/query, date/journal/editor and fresh draft/preference
  preservation pass57/57 independently. No public GET route claim.
- Integrated98f202d14/bc52393ca/b8dbb3758. Foreman renderer/new-rerender/native
  parity/public activation4files228 PASS in /tmp/bml-update-get-render-integrated.log.
- Owned GETcce03c7bf remains under independent review. Widgets continues the
  callable update GET wrapper; Themes continues callable owned GET browser proof.

### Callable owned-edit GET accepted

Solcce03c7bf CLEAR:89 ownedGET +162 dispatch +35 native parity PASS, exact
canonical action/query, meaningful distinct save wiring and fallback boundaries.
Integrateddedfa7bc0. Foreman combined both callable GET paths and adjacent
public routes5files454 PASS, tidy1125 and compile1607 PASS in
/tmp/bml-callable-get-{integrated,tidy,compile}.log. No public GET activation.
Owned GET browser normal/intentional runs pass in worker; final commit/review
pending. Update callable wrapper remains WIP; foreman routed strict method,
flat hook ABI, native redirect and retained prefill/hook ordering corrections.

### Owned GET browser accepted and captured

Sol ee8..03362 CLEAR: corrected fixture reads fresh draft body and thawed
properties, exact seeded fields plus before/after GET equality; normal browser
PASS, named intentional exit1, no helper/server. Integratedc7ad9abb9/7e3f9dc51.
Foreman normal replay PASS and anchored process check empty; captures preserved
under legacy-owned-edit-get, log /tmp/bml-owned-get-browser-integrated.log.
Public GET activation waits for the passing retained-schema fixture prerequisite.
Update callable wrappera349/7aa remains under final review; browser work active.

### Update wrapper remains held at7aa

Sol exact markup probe shows both default41 and query-selected nondefault42
checked. Production still ORs raw GET with defaults; the test only inspects
HTML::Form->value, which returns first selected input and misses42. Routed
narrow direct-default map plus every-checkbox assertion. Redirect302 correction
is clear. Browser WIP preserved; no a349/7aa integration or public GET activation.

### Callable update GET wrapper accepted

Sol a349..ec6 CLEAR:45 assertions including actual302 and both account checkbox
states, hook/reference/order/query and fresh state. Integrated8ba47739b/24995c4e5/
d77e85b20. Foreman4files302 PASS, tidy1128/compile1607 PASS in
/tmp/bml-update-get-wrapper-{integrated,tidy,compile}.log. Public GET unchanged.
Update browser WIP timeout traced to seeded first-visit modal, missing fixture
seed_draft command and modal/navigation await order; fixes active, not accepted.

### Retained-form fixture prerequisite accepted

Sol860303fd CLEAR: shared test-only GET BML/POST captured-handler composition,
local routing restoration,493 HTTP and normal/named-failure browser PASS.
Integratedfa4e13737. Foreman combined four affected/nativeGET suites493 PASS in
/tmp/bml-owned-get-fixture-integrated.log. Public owned GET activation remains
separate active work. Update GET browserb2 remains under independent replay.

### Public personal-owned GET and renderer extraction accepted

Sol e16 and727 CLEAR; integratedb92d6bd49/5c91b54a2. Maintainer template call
extraction preserves direct native behavior and supports explicit canonical
form action. The public item-bearing GET branch now invokes the cleared narrow
personal-owner renderer; excluded requests retain BML, POST remains unchanged.
Foreman five focused suites571 PASS. Update GET browser dc3/b2 separately
accepted and integrated6e1a52ac1/009a844b8, real foreman replay PASS; desktop and
390px evidence preserved under legacy-update-get. Public update GET remains
separate. Next: community callable GET and retained update-form test composition.

Foreman public owned GET browser replay PASS with plain app.psgi, distinct native
save, and no remaining fixture/server. Public desktop/390px captures preserved
alongside prior callable captures. Full tidy1132 and compile1607 PASS in
/tmp/bml-get-integrated-{tidy,compile}.log. No root validation remains running.

Retained old-form POST checks after public owned GET activation: two additional
suites241 PASS in /tmp/bml-owned-get-retained-post-integrated.log. Shared fixture
composition therefore preserves old schema and generated-token requests while
public GET uses the native editor. Source-only remaining update GET split is
recorded in BML-UPDATE-GET-REMAINING.md: terminal identity/cannot-post display is
a small future package; readonly warning-form is separate; anonymous credentials
must remain BML until their schema/action/authentication transition is reviewed.
No authorization or deployment interface change is implied by the audit.

### Retained update-form prerequisite accepted

Sol359579574/9ceede79d CLEAR; integrated8c9813584/11c75c53e. Scoped test helper
retains physical BML GET forms and forwards POST/non-GET to captured production;
route restoration asserted. Browser old-form -> production save/native retry
and named failure cleanup independently passed. Stale spellcheck assertions now
parse current native response, require real old backdating control and verify
native entrytime_outoforder=1. Foreman four suites632 PASS in
/tmp/bml-update-fixture-integrated.log. Public eligible GET activation separate.

### Callable community GET renderer accepted

Sol final6b90..cf2 CLEAR; integrated003e8c593 throughd00ab5dbb. Same-poster uses
shared ordinary editor; authorized other-poster manager uses property-only
maintainer rendering. Explicit canonical/raw-query actions, readonly/context
fallbacks and beta distinction preserved. Finite HTTP proofs include real
sessions, supported nondefault usemask1/access security, sorted saved tags,
userpic/native form parity, anonymous isolation, fresh entry/user draft state,
and explicit absence of unsupported community custom-group controls. Foreman
four suites352 PASS in /tmp/bml-community-get-integrated.log. Browser and public
community activation remain separate unaccepted work.

### Public update GET accepted

Sol a0d/ad63/3e2 CLEAR; integrated53f82843f/7963b513d/9177ba357. Eligible GET
uses cleared native wrapper, non-GET keeps prior handler, excluded requests keep
BML. Actual alias/query/editor/draft proofs, safe stubbed retained-share prefill,
actual anonymous credential controls, exact invalid-target error and beta302
are accepted. Foreman seven suites787 PASS, tidy1134/compile1607 PASS, actual
plain-app browser PASS/cleanup empty. Public desktop/narrow captures preserved;
390px visually inspected and usable. Retained update.bml still serves remaining
contexts; this is not retirement approval.

### Private terminal response renderer accepted

Sol e16cdedeb CLEAR, integrated1aca57868. Dedicated native template preserves
identity Sorry title and message, cannot-post title plus configured MSG_NO_POST
HTML precedence and translated fallback. Classified callable only; no route,
authentication, anonymous/share or readonly behavior changes. Foreman three
adjacent suites96 PASS in /tmp/bml-terminal-renderer-integrated.log. Public
classification activation and its real-session/browser proofs remain separate.

### Callable community browser accepted

Sol6860/c4 CLEAR, integrated17e74d7e2/98c4e1107. Foreman browser PASS with fresh
entry/access-mask/maintainer/user-draft/editor preservation, exact canonical raw
query actions, selected controls including disable-comments, desktop/narrow fit,
and no JS/network failures. Captures preserved under community-edit-get;390px
ordinary and manager forms visually inspected. Cleanup empty. Public same-poster
activation remains separate and manager public GET remains on retained BML.

Public community browser diagnosis: retained manager BML loads xpost.js although
its disabled-save form omits prop_xpost_check. setUpXpostForm finds updateForm,
then updater dereferences a null master. Sol source-confirmed this pre-existing
baseline defect; native same-poster form uses js-post-entry and skips the legacy
initializer. Separate narrow setup guard/regression assigned; public activation
still held, no error suppression or removed manager actions accepted.

### Retained manager XPost baseline independently confirmed

Sol exact preactivation9177 browser: ordinary legacy updateForm with master has
no error; manager updateForm without master retains all three legacy actions but
throws in xpostAcctUpdated. Exact guard3a792 runtime replay removes that error
without changing the actions or ordinary initialization. Permanent test73b560543
and public same-poster activation acceptance remain under independent review.
Terminal public2ed3af945 also queued; no accepted integration or deletion yet.

### XPost missing-master guard accepted

Sol3a7923d89/73b560543 CLEAR; integratedd6bd37f19/77930b27b. Foreman exact
initializer regression and static build PASS. Permanent test fails preguard at
the intended no-master assertion; independent real browser confirms both normal
legacy initialization and manager action surfaces with no page errors. This
resolves the pre-existing baseline bug; public community activation is separate.

### Public same-poster community GET accepted

Sol final354..773 CLEAR; integratedaf0643fbe/0c5b6f927/f468b49ac/ea8ad7aca.
Personal wrapper remains first; community same-poster wrapper uses canonical
native action with raw query, while other-poster manager falls through to BML
and retains all three actions. Foreman four suites530 PASS, exact-assets public
browser PASS, helpers absent. Public desktop/narrow captures preserved under
community-edit-get-public; native390 form visually fits. Retained manager title
missing-string diagnostic is documented baseline. No BML retirement or manager
mutation/activation claim.

### Public terminal update responses accepted

Sol2ed/a93/3f315 CLEAR; integrated2f36ed6fc/653c12cba/f47aab510. Identity and
cannot-post legacy GETs use native terminal output with retained titles, keys,
MSG_NO_POST HTML and ordering. No form/hooks/share construction; anonymous and
readonly forms remain BML. Foreman five suites266 PASS, real browser PASS and
helper cleanup empty, compile1607 PASS. Fulltidy1139 PASS after removing one extra
blank line from community browser server ineb47aca13. Desktop/narrow terminal
captures preserved; narrow cannot-post verified visually. No BML deletion/push.

### Ordinary manager-delete baseline accepted

Sol6ade9d30b CLEAR, integrated6c70d09ef. Actual retained manager form with valid
session/token and visible delete control removes only the intended other-poster
community entry. Fresh unrelated content/security/props survive; original flat
seed/ref and decode -> delete log -> spam check -> protocol order are asserted,
with deletion extras and zero report/crosspost calls. Foreman30 PASS and focused
tidy PASS. This supplies test-only baseline evidence, not native manager rollout.

### Callable readonly form and native Web headings accepted

Sol readonlye30/b7/843 CLEAR; integrated0fa540eb3/95fc0245e/b5e3183d1. Foreman
126 adjacent assertions and actual browser PASS, helpers absent;390px warning and
rich editor visibly usable, captures preserved. Target-after-hook proof uses a
distinct community and exact selected control, not the default owner. No public
readonly activation yet.

Sol Web headingsc861 CLEAR; integrated5b8aa3ccd. error_list/warning_list headings
use native language; bad_input, legacy wrappers and supplied markup remain
unchanged. Foreman three helper suites12 top-level tests PASS. Full combined
tidy1143 and compile1607 PASS. No held interface, deployment or publishing change.

### Public readonly integration complete

Sol4493 and test correctionc9 CLEAR; integrateda564e9e50/ed5210e22. Foreman
plain-app actual-readonly browser PASS/nohelpers, saved desktop/narrow captures,
and merged5files206 PASS after correcting five stale BML-fallback expectations.
Full tidy1146 and compile1607 PASS. Hooks use the same flat request and native
warning/editor/draft behavior stays intact; anonymous/altlogin/share remain BML.

### Same-poster community edit helper accepted

Sol55c9 CLEAR, integrated184a32c7a. Explicit callable opt-in preserves personal
default rejection, original session deletion-log actor, effective spam/protocol
actor, and native retry after attempted failure. Foreman3files202 PASS; no public
resolver/route or manager/reporting scope. Callable invalid-target renderera662
also independently clear, integrated51a7ec6c1 with root17 PASS; public dispatch
remains separate.

### Next bounded reviews queued

Invalid-target public candidate 24fddcb82 includes accepted readonly ancestry
and worker seven-suite 246 PASS; Sol review pending. Callable community resolver
124473f0 is independently queued and its test-only browser acceptance continues.
Anonymous GET rendering source audit is preserved separately; authentication and
public schema/route decisions are not implemented or inferred from that audit.

### Public invalid-target terminal accepted

Sol combined24fddcb82 CLEAR, integratedf7f159f6c. Foreman seven suites246 PASS
and real browser PASS with no owned helpers. Desktop/390 captures saved and
narrow output visually checked. Exact legacy title/message and first-guard
ordering are preserved. Remaining-consumer inventory is documented; callable
anonymous rendering and community POST browser work continue separately.

### Callable community POST resolver accepted

Sol124473f0 CLEAR; integratedce765e52b. Foreman four suites265 PASS and shared
full tidy1148/compile1607 PASS. Explicit same-poster community resolver retains
pre-decoder exclusions and shared native retry after attempted mutation. Public
dispatch remains unchanged; browser and finite activation matrix are separate.

### Callable anonymous rendering accepted

Sol d8f79ac07 CLEAR; integrated9e05a87a8. Foreman five adjacent suites213 PASS.
Optional native title/username rendering preserves legacy hook timing, escaped
prefill, blank password, editor defaults and sequential isolation. No public
anonymous route or authentication/POST changes. Browser acceptance is separate.

### Callable community browser acceptance complete

Sol861+615 CLEAR, integrated936b31e35/7b05844c5. EOF lifecycle correction rejects
pending reads if the fixture exits before data. Foreman normal browser PASS, no
helpers; desktop/narrow captures preserved and390px retry inspected. Integrated
full tidy1151/compile1607 PASS. Public community POST matrix remains separate.

### Anonymous callable browser accepted

Sol d2dc5a167 CLEAR, integratedafeafd8ca. Foreman no-submit browser exit0 with
empty owned-process check; desktop/narrow captures preserved and390px form
visually checked. Exact title/content/RTE/target and fresh-state behavior passed.
Public anonymous activation and POST compatibility remain separate gates.

### Public same-poster community POST accepted

Sol final HTTPed191 and browser979 CLEAR; integratedbbd359599..2e4a449f6.
Foreman five suites519 PASS, real browser PASS, full tidy1154/compile1607 PASS.
Desktop/390 captures preserved under community-edit-post-public, narrow retry
visually checked and helper cleanup empty. Both aliases now try personal then
same-poster community adapters before retained BML; accepted failures stay on
native retry. Manager/reporting and other excluded contexts remain retained.

### Anonymous retained POST baseline accepted

Sol207..2cb CLEAR, integratede14dda093..fbe73790b. Foreman baseline and anonymous
GET128 PASS. Ordinary password form persistence, exact failure responses/input
retention, blank passwords, poster formatting changes and remote-only state
preservation are now nonvacuously characterized. No native POST route is activated.

### Anonymous retry rendering prerequisite accepted

Sol dc7 CLEAR, integratedf26b50442. Foreman three renderer suites78 PASS. Explicit
anonymous username retention preserves native hidden/visible controls and blank
passwords without adding authentication, saves, hooks or route registration.

### Manager callable final corrections under review

Sol66 independently passed94 assertions and cleared the original finite gaps.
Tiny test-only4c replaces the report delegate with a zero-effect counter and adds
post-loop no-hook proof (worker95 PASS). Callable browser4a has worker normal,
named-failure and clean-EOF passes. Both immutable commits are queued for Sol;
public activation remains uncommitted while its finite matrix is prepared.

### Manager callable property HTTP accepted

Sol82 production plus66/4c finite tests CLEAR, final95 assertions. Integrated as
d5d91fc4f..a88bb4e97. Foreman action/maintainer/property/community dispatch four-file
regression387 PASS. Only three property values are written by the callable;
no public route or manager delete/report change. Browser gate remains separate.

### Callable manager browser accepted

Sol4a CLEAR; integrated1e7bd2faa. Foreman normal replay PASS and owned-process
check empty; desktop/narrow captures preserved under manager-property-callable.
Retained layout/title baseline remains visible, without changed GET markup.
Callable integration formatting1157 and compilation1607 passed. Public property
POST activation is the next separate finite gate.

### Anonymous owner callable HTTP accepted

Sol finalc778 CLEAR93; integratedb79ea4bf2..d2b7cc6ba. Foreman five-suite regression
614 PASS. The new callable accepts only the reviewed successful-password owner
slice, preserves legacy hook/housekeeping contracts, and sends accepted save errors
to native retry. Shared _do_post is unchanged. Browser and public activation remain
separate gates; failed credentials and excluded contexts remain retained BML-owned.

Anonymous callable integrated formatting1160 and compile1607 also passed; browser
and public activation remain separate, with no new public anonymous route.

### Public manager property POST accepted

Sol423+09 finite actual-app178 and plain-app browser CLEAR; integrated8d2be92c5
and88a819e17. Foreman adjacent five suites692 PASS, public browser PASS with empty
owned-process check, formatting1161 and compile1607 PASS. Desktop/narrow captures
are preserved under manager-property-public. Dispatch tries personal, same-poster
community, then property-only manager, stopping on each defined result. Manager GET
and delete/report surfaces remain retained; no valid reporting or deletion action
was included in this package.

## Callable share integration and remaining anonymous composition gate

- Sol cleared d7784f3f8 + dd049ba45 callable share source/HTTP/browser. Integrated
  locally as689cb2725/45bf590ce, with formatting-only800f8d52a under narrow review.
- Foreman four focused suites178 PASS, exact assets and real browser PASS; owned
  server/fixture exited. Desktop/narrow evidence: update-share-callable directory.
  Full formatting/compile session43129 remains in progress at this checkpoint.
- Public share remains separate. Anonymous callable browser fixture diagnosis
  found incorrect property storage reads and inactive raw-date controls; fixes
  remain worker-owned and uncommitted. Accepted anonymous HTTP is not reopened.
- Public anonymous audit679c7ad8e documents duplicate failed-login/rate side effects
  from naive fallback. Retained sequence characterization is next, test-only.
  Alternate-login rendering boundary audit preserved14da59427, no activation.

- Share final integration checks completed: tidy1163 and compile1607 PASS. Sol
  cleared formatting-only bbb0a2970; foreman inspected usable 390px capture.
- Retained anonymous sequence bc021fbd0 is pending Sol (worker100 PASS). It records
  three wrong-password checks and persistence after a forced protocol-login error.
  No native public anonymous composition is enabled.
- Widgets browser exposed malformed absent-draft JavaScript in retained anonymous
  GET; separate rendering fix/regression requested. Browser acceptance still open.

- Retained anonymous draft JS correction04ffff (Sol CLEAR95/scoped tidy) integrated
  asbb6b088e3; foreman adjacent163 PASS. No auth/route/save behavior changed.
- Anonymous browser first normal pass reached after real FCK interaction/fixture
  corrections; immutable browser and failure/EOF cleanup acceptance still pending.
- Retained sequence5a2 correction worker108 PASS queued Sol; public share candidate
  remains worker WIP with initial public78 PASS, no integration claim.

- Retained sequencebc021+5a2 accepted Sol108 and integrated9df4acb83/e018e1fa0;
  foreman adjacent203 PASS. Native continuation design preserved13f4ea792, callable
  implementation assigned with public activation/default _do_post unchanged.
- Anonymous browser64ce682e7 and public sharefa1767d51 are queued independent review;
  worker acceptance passed, no root integration or public anonymous claim.
- Next independent Themes package is retained altlogin GET test-only baseline.

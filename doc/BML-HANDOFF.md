# BML removal: resume handoff

## Active continuation: 2026-09-22

Implementation has resumed under the dedicated Astra foreman. The earlier
checkpoint-only instruction and launch caveat below are historical. See the
latest BML-PROGRESS.md section for live branches, worker session IDs, reproduced
validation and review status. The user now explicitly authorizes
`--approve-for-me` for these sessions, retaining automatic safety review and
workspace sandboxing. New work remains local; no further push or deployment is
authorized. Parent checkout and preexisting worktrees/containers stay untouched.

Current isolated foreman branch/worktree is `bml-astra-foreman-20260922`.
Reviewed ThemeNav, Foundation widgets, poll dialog, request-local language and
native caller/service ranges are integrated locally. Customization migration is
now integrated as `bcdced59f`: all six finite acceptance gates are resolved,
including the explicitly inapplicable legacy semantic-validation gate. Ten BML
page files remain. Foreman validation passes 714 tests across 17 files, both
customization browser suites, static build, 1047 tidy and 1601 compile checks.

Original access-filter and image dialog/preview production reviews are clear.
Their disposable browser fixture corrections through worker `74c332713` are
independently reviewed and integrated locally as `855414735`. Normal and
intentional-failure runs prove helper cleanup, including signal-exit rejection.

Themenav Terra is implementing settings on
`bml-terra-settings-migration-20260922`, based on reviewed foreman `bcdced59f`.
Its checklist is `/tmp/bml-settings-production-checklist.md`. Preserve aliases,
Foundation-compatible resources and hooks; constrain receiver return URLs and
replace legacy notification GET deletion with owned confirmation plus CSRF POST.
The integrated legacy HTTP/return baseline passes 115 assertions (two explicit
off-origin redirect TODOs); before screenshots are preserved in settings-before.
Unsaved navigation and Other Sites resources are migration requirements.

Widgets Terra committed native no-item entry-picker extraction as
`1c5f0efd12cae67424ae9e982e4601cee988f5bc` on
`bml-terra-entry-picker-20260922`. It is under Sol review and not integrated.
Any itemid request must fall through unchanged to the existing BML editor.
Foreman requested a separate security-indicator/linked-poster rendering fix.
Modern editor other-poster manager parity remains a separate retirement gate.

Preserve all three existing worker sessions/worktrees/containers; use the exact
session identifiers in BML-PROGRESS.md. Their sessions sometimes end after
routine edits or while tests are active: inspect and resume concrete unfinished
work rather than treating such a checkpoint as completion.

Everything below that describes unstarted workers, checkpoint-only authorization
or thirteen remaining pages is historical context for the original checkpoint.

## Start here

Read this file, [BML-PROGRESS.md](BML-PROGRESS.md),
[BML-REMOVAL-PLAN.md](BML-REMOVAL-PLAN.md), [BML-MIGRATION.md](BML-MIGRATION.md),
and the applicable AGENTS.md before work. The inventory in the plan is the
original baseline; the progress log records subsequent removals.

Checkpoint branch: `zorkian/dreamwidth:bml-overnight-20260921`.
Baseline: `d9ea4bea6`. Six completed work commits:

| Commit | Package |
|---|---|
| ee3db5005 | Inventory, removal plan, initial characterization |
| c2ed9b0f9 | Access-filter controller/template/JS migration |
| 0f6bf0fb7 | Shared widget request state and request-isolation fixes |
| 50276ed0a | Standalone image-preview iframe migration |
| d5c4037a8 | Standalone rich-text image dialog migration |
| 65e502439 | Customization HTTP/browser baseline and progress log |

13 BML page files remain, plus three configs, nine translation files, two looks,
and shared runtime dependencies. The entire BML system is NOT removed.
The previous agent stopped at a clean checkpoint despite instructions to
continue. That was not a blocker and must not become the stopping rule again.

## User instructions and current authorization

- Work toward removal of the entire BML system. Continue subsequent packages
  when prerequisites are satisfied. Keep reviewable commits and a progress log.
- Do not stop at a clean checkpoint, passing tests, or completion of one package.
  Once resumed, stop only when done or genuinely blocked across all available
  independent work. Document unresolved product decisions and continue elsewhere.
- Run required tests and headless browser checks. Use isolated worktrees and
  devcontainers. No deployment or production changes.
- User selected this Herdr session as an **Astra foreman**, **Terra** for
  implementation, and **Sol** for independent review; multiple agents are allowed.
  This architecture was planned but NO agents have been started and no Sol review
  has occurred. Do not describe these existing commits as independently reviewed.
- The latest task is to preserve/push this checkpoint and open a PR for visibility,
  rather than start the agent workflow now. Resume implementation when the user
  explicitly instructs the new window to do so. This push/PR is explicitly
  authorized; the earlier no-push restriction was superseded for this checkpoint.
- Questions and discussion are not implementation authorization. Respect any
  subsequent user instruction, especially stop/pause instructions.

## Foreman/implementation/review workflow on resume

Astra owns the inventory, dependency gates, acceptance criteria, integration,
review triage, and user updates. Start a Terra worker with a bounded package and
explicit preserved behavior/tests/deletion criteria. Sol reviews a fixed commit
ID independently for lost functionality, permissions, CSRF, compatibility,
request isolation and meaningful test coverage. Astra decides fixes and sends
concrete corrections back to Terra; Sol rechecks material fixes. Commit and
integrate validated results, update the ledger, and immediately take the next
unblocked package. Do not equate one blocked stream with overall blockage.

Use the explicit model overrides `gpt-5.6-terra` for implementers and
`gpt-5.6-sol` for reviewers; the supervising session should use `gpt-6-astra`.
Pass a self-contained task/handoff when starting agents with limited context.
With four total slots, use Astra + up to two independent Terra workers + Sol.
Separate implementation worktrees/containers; no agents write to the same checkout.
Review fixed commits in a separate review checkout when running tests. Do not
invent Herdr window-control capabilities: use available agents/worktrees and
report any orchestration limitation honestly.

## Immediate next package

Customization migration, detailed in the progress log:

1. Make widget JS/resources compatible with Foundation resource ordering and
   initialization, including nested widgets and AJAX refresh. Legacy widgets use
   DOM-style `$`, while Foundation uses jQuery. A global replacement is unsafe.
2. Replace ThemeNav BML query/redirect helpers and explicitly propagate redirects
   through widget dispatch. Preserve search/page/show/authas and POST semantics.
3. Migrate customize/index and customize/options into controllers/Foundation
   templates; preserve style initialization, strings, permissions and widgets.
4. Extend tests beyond baseline rendering/title updates to theme application and
   preview, layouts, all option-widget families, reset/save/reload, community
   targeting, old URLs, and responsive rendering. Delete BML pages only when ready.

Independent later work includes settings, remaining FCK poll dialog, entry
picker/parity, inbox parity, translation/request runtime, then engine deletion.
Use the dependency sequence and validation matrix in the removal plan.

## Existing environment and portable setup

Same-machine worktree: `/private/tmp/dreamwidth-bml-20260921`.
Existing container: `4e7a47333842` (verify current availability; IDs are not portable).
Container mount: `/workspaces/dreamwidth`. Its MySQL volume is isolated.
Original checkout `/Users/mark/src/dreamwidth` and the pre-existing
`bml-be-gone` worktree were not modified. Do not repurpose another session's state.

For another machine/window, fetch the branch from zorkian/dreamwidth and create
an isolated worktree from it. Follow AGENTS.md to start its devcontainer:

```bash
npx @devcontainers/cli up --workspace-folder .
docker ps --filter "label=devcontainer.local_folder=$(pwd)" --format '{{.ID}}'
docker port <container-id>
```

Edit/run Git on the host. Run tests/builds/formatting inside the container.
Setup seeds test_user, test_friend, test_paid and test_comm; the browser tests
expect the repository's development seed credentials. See bin/dev/seed-testdata.
Customization integration requires compiled ciel/indil and uses temporary users
in the development database, not the minimal theme-less test database.
The existing test_user title is a test fixture value, not a production title.

## Reproduce validation

Inside the container, with development fixtures:

```bash
prove t/plack-access-filters.t t/widget-request.t t/plack-image-preview.t \
  t/plack-image-dialog.t t/plack-customize.t t/plack-bml.t t/wtf.t \
  t/content-filters.t t/tags-trustmask-count.t t/ml.t
perl extlib/bin/tidyall -a
perl t/02-tidy.t
perl t/00-compile.t
bin/build-static.sh
bin/dev/screenshot /login
node t/browser/access-filters.js
node t/browser/widget-titles.js
node t/browser/image-preview.js /tmp/image-dialog-after
node t/browser/customize-baseline.js /tmp/customize-baseline
```

The screenshot helper installs Chrome/Puppeteer prerequisites. Browser scripts
currently use `/opt/dw-screenshot/node_modules/puppeteer-core`,
`/usr/bin/google-chrome-stable`, and container localhost:8080. Access-filter
browser testing expects test_user initially has no access groups; use a dedicated
seeded container. Baseline capture is not complete customization acceptance.
Restart only your own container's Starman after route/startup changes as AGENTS.md
specifies. Never use desktop browser automation for these checks.

Last recorded combined suite: 261 tests / 10 files passed. Formatting: 1,031
assertions passed. Compilation: 1,597 assertions including existing skips passed.
Full static build passed for access-filter JS. Actual headless flows passed for
access filters, personal/community title RPCs, and image insert/edit/preview.
These results belong to the checkpoint; validate new changes appropriately.

Portable screenshots and customization results are committed under
[bml-evidence/2026-09-21](bml-evidence/2026-09-21/README.md). Raw test logs are only
in the existing container's /tmp; they are not required for a fresh setup and
have not been uploaded. The progress log summarizes their results and limitations.

## Remaining decisions and definition of done

Do not remove beta-gated entry/inbox flows until their parity and cutover gates
are resolved, including sender eligibility and old POST actions. The alternate
ImageButton dialog contains legacy host/upload branches and is not proven
redundant. The root upload-return callback was preserved; no upload service was
certified. Deployed local overlays/BMLInit/AJAX mappings need a deployment
inventory before final engine deletion; production access was not used here.

Done means every inventory item has a tested disposition, compatible routes
remain where needed, and startup/acceptance work with the BML engine physically
absent. Merely eliminating .bml page files, renaming adapters, or retaining a
permanent BML shim does not satisfy that goal.


## Continuation update — 2026-09-22, 18:33 UTC

All work remains local, with the same Herdr sessions/worktrees/devcontainers and
reviewed automatic approvals. Do not restart or replace workers. Terra workers
sometimes end after a partial step or while a browser is running; inspect and
resume them with the concrete remaining deliverable rather than treating that
as completion. Never edit their active checkouts concurrently.

Foreman integrated native controller caller commits as `2f9b0f43f`, `51666e404`
and native services as `ba3604b24`, all independently cleared by Sol. Foreman
native/return coverage passed 67 assertions, service/poll rerun passed, and later
full tidy/compile passed 1,042/1,599 (`/tmp/bml-foreman-picker-{tidy,compile}.log`).

Settings characterization through `2fecefaed` is integrated and cleared (57).
Foreman return test `ff2b5abb9` plus `86b144d66` is reviewed, with 22 assertions
and two explicit legacy off-origin receiver TODO failures; migration must fix
receiver validation. New worker category `fde5bdc43` adds 72 total assertions;
Sol found a weak privacy unchanged assertion, fixed by `de562134176` and awaiting
recheck. Browser `05d14a830` saves community/privacy/mobile using disposable
accounts, but cleanup lifecycle still needs correction. Settings Terra is
actively fixing that, then must add actual notifications/unsaved acceptance.
No settings production conversion is integrated; wait for customization gate.

Customization production plus acceptance remains on the widgets branch, not
integrated. Alias and disposable fixture lifecycle findings are cleared. HTTP
reset correction `8917dc475` passes 169; remaining text-click serialization was
fixed in `c5b939a15`, along with the first narrow input-width correction. Foreman
viewed its screenshot and found fields still clipped out of view. Widgets Terra
is running a follow-up that stacks narrow navigation/content and verifies visible
focused input area (`/tmp/linkslist-visible-browser`). Then finish initialization,
style ownership/name migration, logged-out/options aliases/validation gates.
Sol is reviewing fixed immutable ranges; no blanket custom gate approval yet.

Picker HTTP baseline `95fcdf04c` is independently cleared (64): exact dated latest
entries, direct POST aliases, pre-request body snapshots/fresh reads, community
manager and retained other-poster editor controls. Browser baseline `de14507c5`
is independently cleared: actual keyboard/recent/date/community/narrow, normal
and intentional failure cleanup. Screenshots are committed under
`doc/bml-evidence/2026-09-22/picker-before`. Legacy extensionless title is missing,
explicit .bml is correct; require translated replacement heading. The current
permission model does not allow delegated personal authas; do not invent a grant.
`BML-ENTRY-PICKER-ACCEPTANCE.md` records the source-backed temporary route decline
approach to preserve itemid requests through existing BML fallback, still needing
actual dispatch tests before extraction. Editor beta/parity gates remain separate.

Next integration after customization gate: use `git log --reverse --cherry-pick
--right-only foreman...widgets` to avoid duplicate widget patches; run combined
native+custom tests and static/browser on the foreman container after restart.
Then Terra can extract the picker while settings Terra converts its hub. Other
independent inbox/image-dialog/native runtime packages remain as documented;
external beta/overlay/upload decisions do not justify stopping all work.

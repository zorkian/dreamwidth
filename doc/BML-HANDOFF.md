# BML removal: current resume handoff

Updated 2026-09-23 after recovery of the same foreman session. This file records
current state; historical package chronology and evidence are in BML-PROGRESS.md
and Git history. Read AGENTS.md, BML-PROGRESS.md, BML-REMOVAL-PLAN.md and
BML-MIGRATION.md before continuing. Do not restart already integrated packages.

## Authorization and boundaries

Continue the full BML removal project through unblocked bounded packages, with
Astra coordination, up to two Terra implementers and one independent Sol reviewer.
Use the existing Herdr sessions, worktrees and devcontainers. Host edits/Git;
tests, formatting and builds inside the owning container. Routine local work is
authorized with workspace sandboxing and automatic approval review; respect
rejections. Preserve user focus and other checkouts. No pushes, deployment or
production changes are authorized for these new commits.

The separate platform-restricted inbox work remains held: do not retry or
reassign it around the restriction. The external deployment-hook question is
unanswered: do deployed extensions consume s2_head_content_extra or data_handler:*
with an Apache-style request? Leave both Journal adapter interfaces unchanged.
UniqCookie approval was resolved and its package integrated; do not ask again.

## Preserved topology

Foreman: /home/mark/dreamwidth/.worktrees/bml-astra-foreman-20260922,
branch bml-astra-foreman-20260922, Herdr w5:p1, container 8d7783a043d8.
Session 01a0c9d6-0108-7401-a170-9ada1e2141c2, model gpt-6-astra.

| Worker | Herdr | Container | Session |
|---|---|---|---|
| bml-terra-widgets | w6:p1 | 4da9c8ba2712 | 01a0c9d8-0966-7a70-b058-5a3a4328a791 |
| bml-terra-themenav | w7:p1 | 48178cc525ed | 01a0c9d8-7910-7fe3-ac68-19dc9567a899 |
| bml-sol-review | w8:p1 | 904e68156988 | 01a0c9d8-e3d8-7330-bc30-c78bf4ec2b4d |

Worker checkouts are /home/mark/dreamwidth/.worktrees/<worker>-20260922.
Terra uses gpt-5.6-terra; Sol uses gpt-5.6-sol. Preserve exact sessions and WIP.
Inspect live panes before directing work: scheduled monitoring snapshots can be
stale. A done badge is not proof a package finished; collect logs/exit status.
Do not launch duplicate browser runs when an exact run/helper remains alive.

## Integrated current checkpoint

- Draft timing is CLOSED: source through fc570e26e independently clear,
  integrated as 11fd6c97d. Sol exact fixed browser PASS and known-broken6616 FAIL
  at isolated subject persistence; delayed-image/untouched-decline also PASS.
  Foreman sequential parity and preview browser suites both exit0, build and
  scoped helper tidy pass, helpers absent. Final ledger commit 2b164e4ee exists.
  Do not reopen the old 4c/6616 findings from stale recovery messages.
- Preview shared renderer integrated as abc509db6; method compatibility and
  executable retirement integrated38dca7bd7 after independent clear013be9041. Foreman3files173 PASS, build PASS,
  tidy1091/compile1605 PASS, actual popup browser PASS. Before/after captures in
  doc/bml-evidence/2026-09-23/entry-preview-{before,native}.
- Legacy spellcheck characterization through47f62923d independently clear,
  integrated c6c1f96f9. Conditional stored-RTE initialization and non-RTE control
  replace the vacuous hidden-field assertion. Foreman combined spellcheck and
  crossposting91 PASS in /tmp/bml-editor-characterization-final.log.
- Earlier customization/settings/picker/FCK/native language and ordinary editor
  packages are integrated and reviewed as recorded in BML-PROGRESS.md.
  Seven executable BML pages still remain in the foreman tree at this update.

## Current bounded queue

1. Themenav: decoder extraction and canonical normalizer are independently clear,
   integrated through7d3a8eb70. Foreman decoder/normalizer/crosspost59 PASS in
   /tmp/bml-legacy-normalizer-integrated.log. Pure native retry mapper through
   90fec3cdf is queued for Sol; it retains the decoder-normalized subject so the
   old localized placeholder cannot become saved retry text. Next independent
   increment is a pure whitelisted legacy edit action selector; no route changes.
2. Widgets: native image throughba1991d4a is independently clear and integrated
   as59ebe781c. Foreman56 focused/build/browser/tidy1105/compile1607 PASS; desktop
   and narrow captures are preserved in image-insert-native and inspected.
   Housekeeping first slice0e88c454b is committed but not accepted: pipeline
   failure/moderation and raw crosspost callback tests are still being completed.
3. Sol: imageba199 is clear. Retry mapper90fec is held: it forwards raw custom
   bits0/61 ignored by the old decoder. Themes is correcting exact1..60 bounds
   and adding old-decode/native-retry proof. Pure action selectorc475d14a9 is
   separately queued for review.
   Decoder, normalizer, Protocol notes and native spellcheck are already clear.
   Held inbox work and external deployment interfaces remain excluded.

Native spellcheck foreman validation: combined5files205 PASS, tidy1099 PASS,
compile1605 PASS, static build PASS, and isolated configured real-RTE browser PASS
with no remaining helper/server. Logs /tmp/bml-native-spellcheck-{combined,tidy,
compile,build,browser}.log in foreman container. Desktop/narrow captures preserved
in doc/bml-evidence/2026-09-23/entry-spellcheck-native.

Legacy image URL baseline through6af8b9a4d independently clear, integrated61682d4d3;
foreman25 PASS in /tmp/bml-imgupload-baseline-integrated.log. Before captures in
image-insert-before explicitly record old narrow overflow and popup clipping.

## Working method and evidence

Review immutable commits independently. Route concrete findings back to Terra;
obtain material-fix rechecks. Integrate clean ranges locally and run appropriate
combined-tree checks. Keep the ledger current without treating a passing
checkpoint as completion of the whole project. Preserve real URLs/form fields,
translations, permissions and behavior; retain required visual evidence.

Root checkout and documentation update were confirmed clean/committed after the
reported recovery. Docker containers survived. Historical macOS /private/tmp
paths and old container IDs in older logs are not current resources. Shell
sandbox bwrap loopback errors have required reviewed escalations; do not bypass
approval review. Use Herdr skill with HERDR_ENV=1, preserve focus, and keep
unresolved external decisions separate from independent implementation work.

# Current authorization: proceed with beta graduation — 2026-09-23

The user reviewed the proposed approach and explicitly authorized proceeding. This supersedes the analysis-only hold below. Graduate existing beta replacements instead of recreating legacy systems. Intentional UI differences and minor presentation losses are accepted; do not build UI parity for its own sake.

Proceed with the decision report's recommended approach: preserve shared improvements, close essential functional/security gaps, graduate native entry and inbox routes, and remove obsolete legacy adapters through reviewed forward commits rather than history rewriting. Retire alternate login; users can log into the other account. Accept minor UI differences (including plain-editor embed-button loss and cosmetic notices); let users reselect editor preferences. Retain existing drafts/data and working old GET links. Define safe explicit handling of outstanding old POST forms; never silently discard submitted content. Preserve community-manager moderation capabilities. Fix native correctness/security issues within existing permitted boundaries. Prefer canonical inbox URLs and entry navigation with legacy redirects.

Fable owns a bounded implementation sequence and independent Opus review, using the existing Sonnet workers. Audit mixed/shared dependencies before deletion. Do not discard preserved worker branches or evidence merely because their work is obsolete; obsolete unintegrated changes need not be integrated. Unknown production configuration and local hooks remain explicit deployment/removal gates; do not assert they are unused or erase a dependency without evidence. No push, remote merge, deployment, real moderation/report side effects, or bypass of prior tool/policy restrictions is authorized by this resume. Surface concrete blockers; continue other authorized local work.

Monitoring may again track implementation progress. Historical analysis and hold instructions follow for context and do not override this authorization.

---

# Current BML direction: graduate replacements; analysis only

User decision, 2026-09-23. This supersedes earlier instructions to resume implementation and preserve full legacy feature parity.

Where a newer/beta replacement exists (including entry/update and inbox), the goal is to graduate it and retire the old BML surface. Do not recreate every legacy feature. Assess differences first so the user can choose which losses are acceptable and which gaps must be closed.

Current authorization is analysis and documentation only. Fable coordinates the existing team for read-only audits. Stop implementation, integration, route activation and rollback pending user review of the analysis. Preserve branches, commits, uncommitted work, evidence and checkpoints; allow safe cleanup of owned processes. Do not discard work or rewrite history.

Required decision report:
- Inventory all beta replacements and their legacy entry points, with source evidence.
- List user-visible old/new differences, shared dependencies, deployment unknowns and genuine feature gaps. Recommend accept/retire or close each gap; do not presume 100% parity.
- Audit completed and in-flight migration work. Separate necessary/shared changes from obsolete legacy-only ports, including tests and adapters.
- Propose an orderly rollback/removal sequence using commits and dependency relationships. Explain retained work, mixed commits, data/draft preservation and risks. No rollback yet.
- Present explicit choices and a recommended path for the user before building resumes.

Keep previous security, deployment and external-side-effect boundaries. Model changes do not bypass restrictions. Monitoring may track this analysis but must not restart implementation or treat waiting for user decisions as a stall.

---

Historical instructions below; overridden where conflicting.

# Explicit user resume and Claude migration — 2026-09-23
The user explicitly authorized replacing all four paused Codex agents with Claude Code and resuming the full BML removal migration. This supersedes pause directives in historical checkpoint files. Preserve existing worktrees, branches, uncommitted WIP, containers, evidence and accepted integrations. Do not restart completed packages.

Team mapping (historical names in files are obsolete agent names, not obsolete paths):
- bml-fable-foreman: Fable 5.1, w5:p1, /home/mark/dreamwidth/.worktrees/bml-astra-foreman-20260922, container 8d7783a043d8
- bml-sonnet-widgets: Sonnet 5, w6:p1, /home/mark/dreamwidth/.worktrees/bml-terra-widgets-20260922, container 4da9c8ba2712
- bml-sonnet-themenav: Sonnet 5, w7:p1, /home/mark/dreamwidth/.worktrees/bml-terra-themenav-20260922, container 48178cc525ed
- bml-opus-review: Opus 5.5, w8:p1, /home/mark/dreamwidth/.worktrees/bml-sol-review-20260922, container 904e68156988

Read AGENTS.md and applicable CLAUDE.md first. Use the Herdr skill at /home/mark/.codex/skills/herdr/SKILL.md; confirm HERDR_ENV=1. Coordinate via herdr agent prompt/read/get using NEW names. Keep user focus unchanged. Use existing workers rather than spawning extra agents. All four are equally capable; foreman owns integration and task allocation; reviewer independently checks immutable commits.

Primary checkpoint: /home/mark/dreamwidth/.worktrees/bml-astra-foreman-20260922/doc/BML-PAUSED-2026-09-23.md at checkpoint commit331f1f042. Worker handoffs are durably copied beside it under doc/bml-evidence/2026-09-23/pause/. Read your corresponding record and relevant scoped contracts, then inspect actual branch/status before acting. Long BML-HANDOFF.md contains historical entries: latest checkpoint and subsequent evidence supersede stale text.

Validate your existing devcontainer is alive and repository/dependencies available. Edits/Git on host; tests/format/build in your own container under /workspaces/dreamwidth. Do not recreate healthy containers/databases or run tests on host. Servers stopped at pause; start only your own needed servers. Preserve owned process cleanup.

Authorization: continue necessary local implementation, fixes, commits, review, integration and validation autonomously; do not repeatedly ask permission for these. Finish assigned packages through meaningful tests and immutable reviewable commit instead of stopping after inspection or a routine failure. Automatic review may still block individual actions: report actual block and do not bypass it. Existing held inbox/cybersecurity tasks must not be retried under a new model to evade a prior restriction. Keep unresolved deployed-extension contracts held. Do not push, publish, merge remotely or deploy. No real reporting/moderation actions, external fetch expansion, or invented authentication policy. User resume does not erase the checkpoint's other held boundaries.

Report complete bounded changes with evidence and exact SHA to foreman; distinguish source clearance from HTTP/browser/public-route acceptance. Preserve prior accepted tests; fix finite concrete findings, avoid endless optional scope expansion. When assigned work is complete, report and await a new foreman assignment. On actual blockers explain precisely. Do not choose a different model without foreman/user direction. Foreman may propose Opus escalation for repeated substantive implementation failures, not bypass restrictions.

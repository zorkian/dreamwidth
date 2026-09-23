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

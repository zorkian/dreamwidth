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

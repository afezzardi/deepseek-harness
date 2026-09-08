# Fable 5.1 review — 2026-09-08

Source: review relayed by the user for the uncommitted continuation from `588162d2e8`. The [review request](fable-5.1-request.md) identifies that reviewed state. Line references in the original review referred to that tree. Current resolutions are in the [disposition report](../FABLE-REVIEW.md).

The reviewer reported no blocking defects and independently reconciled the continuation's recorded session, grade, candidate, split, fidelity, concurrency, experiment, source-integrity, and validation counts. The review requested six fixes before commit:

1. Include the environment grader, an explicit grading version, and consulted child sources in checkpoint identity.
2. Record every tool-selection rejection and count considered versus selected events, including unexpected exceptions.
3. Compare write content with the expected output; leave edits unknown when the same path has multiple mutations.
4. Consolidate the new decision note into the existing owner or use the required note format, and update stale final-answer-only and acceptance-report statements.
5. Add a successful background-job delegation fixture and specify jobs support with non-continuable subagents in the task-revision plan.
6. Add publication negative controls for candidate fidelity, split, approval, and eligibility checks.

Additional requests: append shared agent evidence once; reject duplicate grades for a trial; document or avoid evaluation reposting on retries; route corrupted provider payloads through the matcher and reject unresolved complete-corpus recordings; share candidate group-key generation; describe or change the terminal-turn selection limit; record trial cwd; remove redundant whitespace/ignore rules; deliberately place review artifacts; and update the handoff after review.

Accepted limitations: one publication writer, internal hash consistency without reviewer authentication, pending renderer approval, currently unpassable delegation/workflow families, heuristic failure attribution, two admission-only proxy IDs, manual audit-profile stopping, and the pre-existing Markdown-wrap failure. The reviewer confirmed both exporters remained wired and all inspected readiness flags remained false.

# Next pinned task revision

Status: planned; no additional inference campaign or paid operation has run.

Preserve the r2 task version and its 144-trial experiment. Publish repaired task definitions as a distinct Phoenix version and use a fresh campaign directory. Compare the repaired experiment separately; do not relabel r2 trials or overwrite their workspaces.

1. Put exact required JSON field names and value schemas in every prompt, including aggregation totals, release codes, reconciliation balances, and workflow agreement. Retain the independent oracle; make the requested representation unambiguous.
2. Align the exposed tools with the frozen allowed-tool policy, and communicate restrictions in the prompt. Check the effective tool list before collection.
3. For delegation, load `@deepseek-ai/dsh-jobs` and `@deepseek-ai/dsh-tool-jobs`, including `job_output`. Configure the task's subagent tool with `backgroundMode: one-shot` and `enableRunInBackground: true`; send `run_in_background: true`. The `continuable` configuration returns child IDs and cannot satisfy this benchmark's job-ID collection protocol. Scope the overlay to the campaign; preserve user inference settings and aliases.
4. Make workflow member outputs distinguishable so recorded return order is observable. Equal code-only member values cannot establish ordering. Keep owned child snapshots and completion events as required evidence.
5. Record the actual subprocess cwd in each trial receipt and in the run identity. Historical trials without it require an explicitly evidenced derived audit manifest. Keep originals unchanged.
6. Run the strengthened keyless mutation, delegation, publication, checkpoint, and payload-matching controls before any separately authorized collection. Keep the existing four-request cap and medium effort for a comparable baseline. Renderer approval remains a separate requirement.

The installed subagent configuration and return behavior are defined in `packages/subagent/tool-subagent/src/index.ts`; generic job collection status is defined in `packages/jobs/tool-jobs/src/index.ts`. Their observed r2 behavior is recorded in the [continuation report](CONTINUATION.md). This plan does not change those upstream modules or launch the proposed campaign.

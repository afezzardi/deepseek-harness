# Agent Note: private workspace for executable lint probes

Status: implemented

English | [中文](2026-09-11-private-lint-contract-workspace.zh.md)

## Problem

The executable lint tests create temporary TypeScript sources to exercise project discovery and source-versus-test rules. A concurrent catalog scan can enumerate a probe before its owner deletes it, then fail with ENOENT while opening it. Unique filenames prevent collisions between writers but do not isolate readers of the source tree.

## Decision

The [lint spec](../../../../scripts/oxlint-contract.spec.ts) copies the TypeScript project layout into an exclusive temporary workspace, shares dependency and native-declaration directories read-only, and removes the workspace after its synchronous subprocesses complete. Probes never enter the real checkout. An assertion checks that placement while each project-discovery probe exists.

The [runner temporary-storage policy](2026-09-06-pr-ci-runner-temporary-storage.md) continues to own job cleanup and capacity. This decision adds reader isolation within that storage; it does not replace the runner policy.

## Alternatives

Ignoring missing files in catalog generation would hide source mutations. Serializing tests inside one Vitest process would not protect scans in other coverage partitions. Both leave ownership of the transient files unresolved.

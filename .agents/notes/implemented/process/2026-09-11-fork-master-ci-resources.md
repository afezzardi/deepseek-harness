# Agent Note: Fork master CI resource ownership

Status: implemented

English | [中文](2026-09-11-fork-master-ci-resources.zh.md)

## Problem

Forks do not inherit upstream runner registrations or external DeepSeek credentials. This fork uses self-hosted inference and intentionally has no `DEEPSEEK_API_KEY_EXTERNAL`.

## Decision

[Master CI](../../../../.github/workflows/ci-master.yml) restricts upstream standby drills and manual fleet benchmarks to non-fork repositories. Hosted Wine and Python runtime packaging remain enabled on forks.

[E2E](../../../../.github/workflows/e2e.yml) and the real-API preflight/test steps in [Python runtime packaging](../../../../.github/workflows/build-exe-for-python-sdk.yml) require `github.event.repository.fork == false`. Existing PR-author exclusions and missing-secret failures remain in force for eligible upstream runs. Keyless installed-wheel checks remain enabled on forks. External-API tests do not redirect to the fork's inference host.

The [failover runbook](2026-07-26-ci-failover-runbook.md) and [real-API policy](../testing/2026-06-19-real-api-e2e-ci.md) retain their independent upstream scope.

## Alternatives considered

**Provision upstream resources in every fork.** Runner registration and external API billing require independent operator decisions.

**Skip all master checks.** This loses keyless packaging, Wine, and kernel confinement evidence that hosted runners can provide.

**Redirect tests to self-hosted inference.** This changes the tested provider and requires a separately defined inference validation task.

## Consequences

Fork runs provide no external DeepSeek API or upstream standby-readiness evidence. Re-enabling those jobs on a fork requires an explicit workflow policy change. Deployment and training remain separate operations.

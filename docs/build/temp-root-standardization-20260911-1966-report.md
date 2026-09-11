# Build Delivery Report

## Executive Summary

The run is not ready under the recorded gates.

## Run and Source

- Run: `temp-root-standardization-20260911-1966`
- Repository: `/home/raptorx/coding/agent-workflows`
- Base: `1966259`
- Integration branch: `build/temp-root-standardization-20260911-1966-integration`

## Approval

Approved plan `c1d00d7bc8d95a49a6829625e7a1f5eea28fe228698aeeb52ec648b30e88416e`, scope `cda17c1863ad262adefef7702c1b57c03e42c945acb8a6d6bed8578a26e67e0b`, and authorizations `e97afd1f67713fcab2eb663433e0e42fe9d67cee8e3dec8b7922e6dbf9f5531c` in `bounded-unattended` mode (event `task-request`).

## Stage Receipts

| Stage | Status | Commit | Checks | Findings | Deferred | Blockers | Manifest |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| brainstorm | completed | 19662590ac0a8435180f263be96d002c6c696c4d | none | 0 | 0 | 0 | /home/raptorx/.codex/build-runs/temp-root-standardization-20260911-1966/status/handoffs/plan.json |
| seed-tests | completed | 8f553bb | expected-failure:1 | 0 | 0 | 0 | /home/raptorx/.codex/build-runs/temp-root-standardization-20260911-1966/status/handoffs/seed.json |
| blue | completed | 8997496ac4174920d00e55d3c1bdf1cf4a2e2366 | passed:4 | 0 | 0 | 0 | /home/raptorx/.codex/build-runs/temp-root-standardization-20260911-1966/status/handoffs/blue.json |
| red-1 | completed | 8997496ac4174920d00e55d3c1bdf1cf4a2e2366 | none | 4 | 1 | 0 | /home/raptorx/.codex/build-runs/temp-root-standardization-20260911-1966/status/handoffs/red-1.json |
| fixer-1 | blocked | cc339e2f6b4399d980cc182da61e09457eb6722e | passed:5, failed:2 | 3 | 0 | 1 | /home/raptorx/.codex/build-runs/temp-root-standardization-20260911-1966/status/handoffs/fixer-1.json |

## Deferred Review Items

1 report-only finding(s) are retained in /home/raptorx/.codex/build-runs/temp-root-standardization-20260911-1966/status/handoffs/red-1.json; they were outside the approved Build repair boundary.

## Proxy Budget Warnings

None.

## Readiness

Not ready for merge approval

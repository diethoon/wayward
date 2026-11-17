# WORKFLOW GATEWAY — REQUIRED PROCEDURE

## 1. Scope and precedence
Applies to all tasks and branches in this repository. Read root AGENTS.md first. Then apply this document, WORKFLOW_EXECUTION_POLICY.md, FORENSIC_AND_VERIFICATION_POLICY.md, and relevant nested instructions. Preserve repository-specific build, release, platform, and ownership rules. Global safety, evidence integrity, data preservation, and independent verification cannot be weakened by a local instruction.

## 2. Preflight record (mandatory)
Before implementation:
1. Confirm repository full name and intended task.
2. Confirm current branch; never silently switch branches.
3. Confirm remote URL and available authentication/access.
4. Fetch/read the remote target branch HEAD; record SHA and timestamp/context.
5. Record local HEAD and compare ancestor/divergence status.
6. Inspect tracked, untracked, staged, and unstaged changes.
7. Inspect recent commits, open PRs/issues/workflows where relevant.
8. Read handoff notes, task instructions, nested AGENTS.md, and prior failure reports.
9. Identify owning team/repository, allowed paths, prohibited paths, external services, and required permissions.
10. Record a baseline before edits.

Do not assume a local checkout is current. Do not overwrite an uncommitted change or another agent's work. If a safe baseline cannot be established, stop only the conflicting mutation and continue independent read-only investigation.

## 3. Required evidence trail
Maintain a concise work record: claim → evidence/source → confidence/status → action. Distinguish observed facts, inference, and unknowns. Preserve raw failure evidence before modifying code or rerunning jobs.

## 4. Change control
Make the smallest change that addresses the demonstrated root cause. Avoid unrelated formatting, refactors, dependency churn, feature changes, and generated-file noise. Never modify product functionality in a policy-only task. No force-push, destructive reset, unauthorized merge, release, deployment, production mutation, or secret exposure. Commit only intended files; report exact SHA and diff scope.

## 5. Completion sequence
Investigate → establish expected behavior independently → implement → focused checks → relevant integration/CI → build/package → retrieve and inspect artifacts → verify final repository state → report. Parallelize independent read-only or isolated work; serialize shared writes and dependent operations. Never leave async jobs untracked.

## 6. Exceptions
If credentials, permissions, external quota, unavailable physical hardware, or explicit approval genuinely block a step, name the exact dependency and evidence. Complete all independent work and provide a safe handoff. Do not ask the user to do work available tools can perform.

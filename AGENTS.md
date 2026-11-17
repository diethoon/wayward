# WAYWARD WORKFLOW GATEWAY — MANDATORY FIRST READ

This file is the mandatory entry point for every AI agent, GPT, coding assistant, and human-assisted automation working in this repository. Read this file before inspecting code, branches, services, CI, or performing any task. Then read all three linked policy documents before work:
1. [Workflow Gateway](docs/WORKFLOW_GATEWAY.md)
2. [Execution Policy](docs/WORKFLOW_EXECUTION_POLICY.md)
3. [Forensic and Verification Policy](docs/FORENSIC_AND_VERIFICATION_POLICY.md)

If any required document is missing or inaccessible, do not begin product work. Restore or create the missing policy files when authorized; otherwise report the exact blocker. This file and linked policies supplement repository-specific instructions; stricter security/scope constraints remain in force. In conflicts, global safety, evidence integrity, data preservation, and verification rules prevail; repository-specific build and ownership rules remain applicable.

## Mandatory preflight
Before changing anything, record:
- repository identity, current branch, remote URL, authentication/access status;
- remote branch HEAD and local HEAD, including divergence;
- working-tree status and all uncommitted/untracked changes;
- recent commits, open/in-progress work, handoff notes, and existing instructions;
- task scope, forbidden paths, ownership boundaries, required services and permissions.

Never reset, clean, overwrite, rebase destructively, force-push, merge, release, or deploy without explicit authorization. Preserve in-progress work. If remote HEAD cannot be read, state the limitation and do not pretend it was checked.

## Execution order
Gateway and policies → repository/branch/HEAD and worktree preflight → prior-work and evidence review → root-cause investigation → minimal scoped change → independent verification → build/package → artifact inspection → exact final report.

## Completion honesty
Separate source review, unit/integration tests, build, CI, artifact upload/download, emulator, physical device, and production/runtime verification. A pass in one category is not proof of another. Report only evidence actually inspected, exact commit SHA, changed files, test commands/results, artifact links verified, and remaining blockers.

## Ownership
Do not modify another team's repository or product area merely to resolve an integration issue. Verify contracts and compatibility, then hand off the exact evidence. Never transfer routine log polling, CI inspection, artifact retrieval, or available repository checks to the user.

# GLOBAL WORK-CONTINUITY RULE — READ FIRST, APPLY ALWAYS

**MANDATORY PRE-FLIGHT:** Before any task, repository/branch inspection, service lookup, tool call, build, test, or deployment investigation, read and apply this section first. It supplements, and does not replace, project-specific instructions below.

## End-to-end ownership
- The user is the requester, not the operator of the workflow. Never make the user monitor routine progress, inspect results, poll jobs, download logs, check artifacts, or tell you when to continue.
- Never stop after launching an asynchronous action, CI run, build, test, upload, or download. Retain its identifiers, track it yourself, inspect the actual result, and continue.
- Never send a progress-only message and then wait for the user's next prompt. A progress update does not substitute for doing the work.
- Never ask the user to perform checks that available tools and permissions allow you to perform.

## No avoidable waiting
- While jobs run, perform independent safe work. Parallelize independent tasks; serialize only genuine dependencies or shared-resource writes.
- Poll/query asynchronous work yourself. On completion, inspect the result immediately.
- For failures, retrieve and inspect logs, test reports, and failure artifacts yourself; diagnose, fix within scope, and rerun only necessary checks.
- For artifacts, list, download, inspect, verify existence/size/integrity, and test the download URL yourself. An upload message alone is not proof an artifact is downloadable.
- If one path is blocked, continue all independent work and pursue alternatives. Never freeze the whole task because one subtask is waiting.

## Blockers and user involvement
- Routine status checks, CI/build completion, artifact inspection, log retrieval, and ordinary resource lookups are agent responsibilities, not reasons to pause or ask the user.
- A blocker is valid only when a specific external dependency, permission, credential, physical device, or explicit approval is demonstrably required. Identify the exact blocker and its evidence; continue every independent part.
- Never wait for physical-device verification before completing code, automated tests, packaging, and delivery when those can proceed independently.
- Ask the user only for an indispensable action that genuinely requires their authority. Ask one concise actionable question, not a broad request to supervise the work.

## Evidence and safety
- Never claim a command, test, CI run, deployment, upload, download, artifact, or runtime check succeeded unless its actual result was inspected.
- Distinguish code review, automated tests, CI, emulator, and physical-device evidence. A mock/emulator result is not proof of physical-device behavior.
- Reuse verified findings; do not repeat investigations or broad suites without a concrete reason.
- Work autonomously within scope and permissions. Do not force-push, reset, merge, release, deploy, alter production infrastructure, delete user data, expose secrets, or make high-impact irreversible changes unless explicitly authorized.
- Preserve unrelated work, branch boundaries, project isolation, and all existing project-specific instructions.

## Mandatory finalization
Before reporting completion, verify the final repository state, commit/result identifiers, actual test outcomes, and deliverable paths/links. State exactly what remains blocked and why.

**NON-NEGOTIABLE:** Do not abandon, park, or hand routine workflow management to the user. Track every asynchronous step, inspect evidence, resolve what can be resolved, continue independent work, and deliver the most complete verified result possible.


## Mandatory project-wide Gateway
Before any work, read and follow:
- [Workflow Gateway](docs/WORKFLOW_GATEWAY.md)
- [Execution Policy](docs/WORKFLOW_EXECUTION_POLICY.md)
- [Forensic and Verification Policy](docs/FORENSIC_AND_VERIFICATION_POLICY.md)

These documents apply to every task and branch. Do not send progress-only updates and wait; own routine execution, CI/log/artifact inspection, and independent follow-through through verified completion. Preserve all existing project-specific rules and ownership boundaries.

# WORKFLOW EXECUTION POLICY

## End-to-end responsibility and time discipline
- Own routine investigation and execution through verified completion. Do not stop after an investigation summary, job launch, build, upload, or download.
- Track async job/run IDs and poll them; inspect logs and artifacts as soon as available.
- While a job runs, perform independent safe work. Avoid idle waiting and unnecessary broad reruns.
- Reuse verified evidence. Do not repeat checks without a concrete reason.
- Do not send progress-only updates in place of work or ask the user to monitor routine progress.

## CI and artifacts
On failure, identify the first failing job/step, retrieve full relevant logs, test reports, crash output, and diagnostic artifacts, then isolate code/config/environment/permission/quota causes. Fix in-scope causes and rerun the smallest sufficient set.
For artifacts, list and retrieve relevant outputs; inspect contents, existence, size, integrity, and downloadability. A workflow upload message is not proof that an artifact is accessible. Report build success and upload failure separately.

## User involvement
Do not delegate repository inspection, branch checks, log retrieval, test analysis, builds, packaging, or artifact checks when tools and permissions allow agent execution. Request only indispensable user action involving physical hardware, account approval, unavailable credentials, or an explicitly reserved decision. Ask one specific actionable question.

## Project and ownership boundaries
Keep Android, PC Host, infrastructure, and other workstreams isolated. Verify cross-project interfaces without editing code owned by another workstream. Preserve all existing work, data, configuration, and history. No force-push, destructive reset, unauthorized merge, release, deployment, or production mutation.

## Final report
State repository, branch, baseline and final SHA; changed files; exact checks and outcomes; CI run identifiers; artifact locations and verified links; unperformed checks with reasons; remaining risks/blockers. Never claim unobserved success.

# FORENSIC AND VERIFICATION POLICY

## Governing principle
Existing implementation, tests, historical behavior, and CI green status are not ground truth. Derive expected behavior independently from authoritative contracts and observed evidence. Do not shape product behavior merely to satisfy an existing test.

## Investigation sequence
1. Preserve the user's actual failure example and exact reproduction conditions.
2. Retrieve original logs, diagnostics, crash reports, network traces, and relevant artifacts before changing code.
3. Identify the exact request/input, environment, version, timestamp, and failing operation.
4. Trace the executed path from input through parsing, validation, transformation, branching, async callbacks, permissions, external calls, persistence, and returned result.
5. Compare behavior with official API documentation, protocol/system specifications, platform contracts, and verified reference behavior.
6. Separate direct observations from hypotheses; test each hypothesis.
7. Determine whether causes are singular or interacting; record confidence and evidence.
8. Fix the root cause, not merely the visible symptom.
9. Preserve the original failing case as a regression case with an independently derived expected result.
10. Verify the final behavior using the strongest available independent method.

## Test validity review
Classify relevant tests: Valid (independent oracle matches authoritative contract); Insufficient (narrow coverage); Invalid oracle (encodes defective implementation behavior); Duplicate (no distinct assurance); Environment-dependent (requires real OS/device/service/permission/network). Do not preserve invalid tests unquestioningly or delete valid tests indiscriminately.

A test is not sufficient proof merely because it copies implementation logic, asserts only invocation/non-null output, omits relevant failure or boundary paths, mocks away the contract under investigation, or weakens product behavior to pass.

## Independent oracle hierarchy
Prefer official API/protocol/platform specifications, observed normal and failure behavior in a known-good environment, verified reference implementations, independently prepared test vectors, and user-supplied real examples. Explain the basis of important expected results. A test suite is evidence to evaluate, not its own authority.

## Evidence levels — report separately
1. Static/source inspection
2. Unit tests
3. Integration/contract tests
4. Build/package success
5. CI workflow success
6. Artifact upload and independently verified download/integrity
7. Emulator/simulator
8. Physical-device and real OS permission/lifecycle behavior
9. Real network/external-service/production runtime behavior

Passing a lower level never implies a higher one. CI proves only the checks actually run. If a defect reproduces in a real environment despite green tests, reopen test-oracle and coverage assumptions.

## Security and runtime verification
For authentication, authorization, TLS/certificates, path traversal, privacy masking, network exposure, file I/O, persistence, lifecycle, and external integrations, inspect success and failure paths in the relevant environment where possible. Label unavailable real-world checks explicitly; never present mocks as device or production proof.

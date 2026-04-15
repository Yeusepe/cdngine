# Resilient Coding, Debugging, And Performance

This document turns a broad engineering research sweep into repository rules.

Its purpose is simple: **someone coding in CDNgine should produce code that is resistant to errors, easy to understand, easy to debug, and fast enough for production reality**.

The full research pass reviewed **119 reputable sources**. The inventory below records the **100 strongest directly reusable references** for repository policy.

The rules here are intentionally operational. They are meant to shape design, implementation, tests, review, and incident response.

## 1. Core expectations

1. Prefer code that is easy to reason about over code that is merely clever.
2. Make invalid states hard to represent.
3. Make failures obvious, structured, and diagnosable.
4. Keep interfaces stable and explicit.
5. Treat retries, concurrency, and partial failure as normal conditions.
6. Measure performance before and after hot-path changes.
7. Keep documentation, tests, and code in the same change.
8. Make asset, version, workflow, and derivative lineage visible across logs, traces, and audit records.

## 2. Readability and maintainability rules

1. Keep functions and modules focused on one responsibility.
2. Name things by domain meaning, not local implementation trivia.
3. Prefer explicit inputs and outputs over hidden ambient state.
4. Move repeated policy into clear helpers or shared modules, not copy-paste branches.
5. Keep happy-path code visually obvious.
6. Comment why a rule exists, not what the syntax already says.
7. Encode invariants in types, schema validation, and assertions near the boundary.
8. Use formatting and linting to remove style debate from review.

## 3. Failure handling rules

1. Validate external input at first receipt.
2. Return structured errors with actionable context.
3. Do not swallow exceptions, silent fallbacks, or partial-write failures.
4. Bound network calls, background work, and locks with explicit timeouts.
5. Retry only operations that are safe to retry.
6. Retries must be bounded, jittered, and observable.
7. Prefer idempotent write paths and deterministic replay behavior.
8. Treat dependency outages, malformed input, stale state, and duplicate requests as normal test cases.
9. For mutating APIs, define the idempotency key scope, conflict behavior, and durable evidence of completion.

## 4. Debuggability and observability rules

1. Emit structured logs rather than free-form strings for important events.
2. Include correlation identifiers across API, workflow, and worker boundaries.
3. Log enough context to explain a failure without leaking secrets.
4. Expose metrics around user-visible outcomes, queue health, retry pressure, and failure classes.
5. Trace cross-service operations that can stall, retry, or fan out.
6. Prefer RFC 9457 problem-details responses and diagnostic metadata over generic 500-style failures.
7. Make operator actions and state transitions auditable.

## 5. Testing and change-safety rules

1. Follow the repository TDD order: docs, contract, failing test, implementation, evidence.
2. Add a regression test for every defect that escaped.
3. Test both success and failure paths.
4. Make tests deterministic by controlling time, randomness, and external I/O.
5. Keep unit tests narrow and integration tests realistic.
6. Use end-to-end tests for critical flows, not as a substitute for lower-layer coverage.
7. Favor assertions on externally visible behavior rather than incidental implementation details.
8. For concurrency, retries, and workflow logic, prove idempotency and replay behavior explicitly.

## 6. Interface, state, and data rules

1. Normalize input once and pass validated data inward.
2. Keep public contracts versioned and intentionally compatible.
3. Do not let provider-specific storage or queue terms leak into stable API models.
4. Keep transactional ownership explicit.
5. Avoid shared mutable state unless the concurrency contract is documented and tested.
6. Persist durable truth in the system that owns it; do not let cache or workflow state impersonate the source of truth.
7. Use migrations and schema change discipline for persisted data.
8. For registry and publication paths, document the transaction, isolation, locking, or optimistic-concurrency expectations.

## 7. Performance rules

1. Measure before optimizing.
2. Profile hot paths instead of guessing.
3. Prefer fewer round-trips, fewer copies, and fewer unnecessary transformations.
4. Batch work where semantics allow it.
5. Keep memory growth, queue backlog, and retry amplification visible.
6. Optimize for the expected production workload shape, not microbenchmarks alone.
7. Treat performance regressions as correctness issues on hot paths.

## 8. Security and operational safety rules

1. Treat all external input as hostile until validated.
2. Favor least privilege and narrow credentials.
3. Keep secrets out of logs, exceptions, and test fixtures.
4. Pin or review critical dependencies and keep them current.
5. Design failure behavior to fail closed when access control or signature validation is ambiguous.
6. Make administrative and replay surfaces auditable and permissioned.
7. For ingest, verify file signatures, not just filename or declared MIME type, and preserve a quarantine path for suspicious inputs.

## 9. Review checklist

Use this checklist in addition to the review guidance elsewhere in the suite:

1. Is the code easier to reason about after this change?
2. Are invariants explicit?
3. Are failures diagnosable?
4. Are retries/timeouts/idempotency handled deliberately?
5. Are tests proving the risky behavior?
6. Is the public or internal contract clearer rather than more implicit?
7. Are logs, metrics, traces, or audit events good enough for production debugging?
8. Is performance impact known for hot paths?
9. Are docs and references updated with the code?

## 10. Source highlights

The strongest baseline references for this document are:

- [Google Engineering Practices](https://google.github.io/eng-practices/)
- [Google Style Guides](https://google.github.io/styleguide/)
- [Site Reliability Engineering](https://sre.google/sre-book/table-of-contents/)
- [AWS Well-Architected Reliability Pillar](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html)
- [AWS Builders Library: Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
- [AWS Builders Library: Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)
- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Google API Design Guide](https://cloud.google.com/apis/design)
- [Microsoft REST API Guidelines](https://github.com/microsoft/api-guidelines)
- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
- [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457.html)
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [NIST Secure Software Development Framework](https://csrc.nist.gov/projects/ssdf)
- [Diataxis](https://diataxis.fr/)

## 11. 100-source research inventory

This inventory is the research base behind the rules above. It is intentionally broad so that future contributors can trace the expectations here back to reputable sources.

| # | Category | Source | URL | Why it matters |
| --- | --- | --- | --- | --- |
| 1 | style/readability | Google Style Guide | https://google.github.io/styleguide/ | Strong baseline for consistent, readable code and docs. |
| 2 | style/readability | Google Java Style Guide | https://google.github.io/styleguide/javaguide.html | Useful model for naming, structure, and clarity. |
| 3 | style/readability | PEP 8 | https://peps.python.org/pep-0008/ | Canonical readability rules for Python-heavy tooling and scripts. |
| 4 | style/readability | C# Coding Conventions | https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/coding-style/coding-conventions | Official .NET readability and maintainability guidance. |
| 5 | style/readability | Airbnb JavaScript Style Guide | https://github.com/airbnb/javascript | Widely used guide for predictable JS and TS code. |
| 6 | style/readability | Go Code Review Comments | https://go.dev/wiki/CodeReviewComments | Practical guidance for idiomatic, readable Go. |
| 7 | style/readability | Swift API Design Guidelines | https://www.swift.org/documentation/api-design-guidelines/ | Excellent naming and API legibility guidance. |
| 8 | style/readability | Kotlin Coding Conventions | https://kotlinlang.org/docs/coding-conventions.html | Good rules for readable Kotlin code. |
| 9 | style/readability | Rust API Guidelines | https://rust-lang.github.io/api-guidelines/ | Strong guidance for explicit, ergonomic APIs. |
| 10 | style/readability | Java Code Conventions | https://www.oracle.com/java/technologies/javase/codeconventions-contents.html | Longstanding baseline for readable Java code. |
| 11 | code review/change management | Google Engineering Practices: Code Review | https://google.github.io/eng-practices/review/ | Canonical review workflow for quality and safety. |
| 12 | code review/change management | GitHub Reviewing Changes in Pull Requests | https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests | Practical review process guidance. |
| 13 | code review/change management | GitHub CODEOWNERS | https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners | Routes changes to the right owners. |
| 14 | code review/change management | GitHub Protected Branches | https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/about-protected-branches | Enforces checks and safer merges. |
| 15 | code review/change management | GitLab Merge Requests | https://docs.gitlab.com/ee/user/project/merge_requests/ | Solid change review workflow reference. |
| 16 | code review/change management | Azure DevOps Review Pull Requests | https://learn.microsoft.com/en-us/azure/devops/repos/git/review-pull-requests | Useful controlled-review model. |
| 17 | code review/change management | Gerrit Documentation | https://gerrit-review.googlesource.com/Documentation/ | Mature review discipline reference. |
| 18 | code review/change management | Conventional Commits | https://www.conventionalcommits.org/en/v1.0.0/ | Improves traceable change history. |
| 19 | code review/change management | Semantic Versioning | https://semver.org/ | Defines compatibility expectations for released interfaces. |
| 20 | code review/change management | Trunk Based Development | https://trunkbaseddevelopment.com/ | Helps keep changes small and integration safe. |
| 21 | testing/TDD | Google Testing Blog | https://testing.googleblog.com/ | High-signal testing strategy and flake reduction guidance. |
| 22 | testing/TDD | JUnit 5 User Guide | https://junit.org/junit5/docs/current/user-guide/ | Canonical Java testing reference. |
| 23 | testing/TDD | pytest Documentation | https://docs.pytest.org/en/stable/ | Strong fixture and test-structure guidance. |
| 24 | testing/TDD | NUnit Documentation | https://docs.nunit.org/ | Reliable .NET testing reference. |
| 25 | testing/TDD | xUnit.net Getting Started | https://xunit.net/docs/getting-started/v2/getting-started | Practical modern .NET testing baseline. |
| 26 | testing/TDD | Go testing package | https://pkg.go.dev/testing | Official Go testing semantics. |
| 27 | testing/TDD | Jest Documentation | https://jestjs.io/docs/getting-started | Common JS and TS testing reference. |
| 28 | testing/TDD | Playwright Test Intro | https://playwright.dev/docs/test-intro | Deterministic browser and end-to-end test guidance. |
| 29 | testing/TDD | Selenium Documentation | https://www.selenium.dev/documentation/ | Canonical UI automation reference. |
| 30 | testing/TDD | Testcontainers | https://testcontainers.com/ | Strong integration-test realism without shared environments. |
| 31 | debugging/observability | OpenTelemetry Documentation | https://opentelemetry.io/docs/ | Canonical traces, metrics, and logs standard. |
| 32 | debugging/observability | SRE Book: Monitoring Distributed Systems | https://sre.google/sre-book/monitoring-distributed-systems/ | Excellent model for actionable monitoring. |
| 33 | debugging/observability | Chrome DevTools Documentation | https://developer.chrome.com/docs/devtools/ | Useful debugging reference for browser-facing systems. |
| 34 | debugging/observability | ASP.NET Core Logging | https://learn.microsoft.com/en-us/aspnet/core/fundamentals/logging/ | Clear structured logging guidance. |
| 35 | debugging/observability | Python logging | https://docs.python.org/3/library/logging.html | Standard logging model for diagnostic output. |
| 36 | debugging/observability | Go pprof | https://pkg.go.dev/net/http/pprof | Essential profiling tool for Go services. |
| 37 | debugging/observability | Rust tracing | https://docs.rs/tracing/latest/tracing/ | Strong structured diagnostics model. |
| 38 | debugging/observability | Prometheus Instrumentation | https://prometheus.io/docs/instrumenting/ | Canonical metrics design guidance. |
| 39 | debugging/observability | Grafana Documentation | https://grafana.com/docs/ | Good operational dashboard reference. |
| 40 | debugging/observability | Sentry Documentation | https://docs.sentry.io/ | Good error aggregation and debugging model. |
| 41 | resilience/reliability | Site Reliability Engineering | https://sre.google/sre-book/table-of-contents/ | Canonical reliability engineering foundation. |
| 42 | resilience/reliability | AWS Well-Architected Reliability Pillar | https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html | Practical reliability design guidance. |
| 43 | resilience/reliability | Azure Resiliency Overview | https://learn.microsoft.com/en-us/azure/architecture/framework/resiliency/overview | Strong failure-handling framework. |
| 44 | resilience/reliability | Azure Retry Pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/retry | Good rules for bounded retries. |
| 45 | resilience/reliability | Azure Circuit Breaker Pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker | Prevents cascading failures. |
| 46 | resilience/reliability | Azure Timeout Pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/timeout | Essential for bounding slow work. |
| 47 | resilience/reliability | Azure Bulkhead Pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/bulkhead | Useful for isolating failures. |
| 48 | resilience/reliability | Polly | https://www.pollydocs.org/ | Mature resilience policy reference. |
| 49 | resilience/reliability | Resilience4j | https://resilience4j.readme.io/ | Strong Java reliability pattern library. |
| 50 | resilience/reliability | Kubernetes Probes | https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/ | Canonical service health model. |
| 51 | API/interface design | Google API Design Guide | https://cloud.google.com/apis/design | Strong baseline for stable APIs. |
| 52 | API/interface design | Microsoft REST API Guidelines | https://github.com/microsoft/api-guidelines | Practical API consistency guide. |
| 53 | API/interface design | OpenAPI Specification | https://spec.openapis.org/oas/latest.html | Machine-readable API contract standard. |
| 54 | API/interface design | RFC 9110 HTTP Semantics | https://www.rfc-editor.org/rfc/rfc9110 | Canonical HTTP behavior reference. |
| 55 | API/interface design | RFC 9457 Problem Details | https://www.rfc-editor.org/rfc/rfc9457.html | Strong structured API error model. |
| 56 | API/interface design | RFC 3986 URI Generic Syntax | https://www.rfc-editor.org/rfc/rfc3986 | Important for stable resource identifiers. |
| 57 | API/interface design | JSON:API | https://jsonapi.org/format/ | Good conventions for response design. |
| 58 | API/interface design | gRPC Documentation | https://grpc.io/docs/ | Strong typed service contract reference. |
| 59 | API/interface design | GraphQL Best Practices | https://graphql.org/learn/best-practices/ | Helpful for avoiding brittle query design. |
| 60 | API/interface design | AsyncAPI Specification | https://www.asyncapi.com/docs/reference/specification/latest | Event contract standard. |
| 61 | state/data/storage | The Twelve-Factor App: Config | https://12factor.net/config | Keeps config explicit and portable. |
| 62 | state/data/storage | PostgreSQL Transactions Tutorial | https://www.postgresql.org/docs/current/tutorial-transactions.html | Core reference for correct transactional behavior. |
| 63 | state/data/storage | PostgreSQL MVCC Intro | https://www.postgresql.org/docs/current/mvcc-intro.html | Explains concurrency and isolation behavior. |
| 64 | state/data/storage | SQLite Isolation | https://www.sqlite.org/isolation.html | Clear transaction-isolation model. |
| 65 | state/data/storage | SQLite Locking and Concurrency | https://www.sqlite.org/lockingv3.html | Good explanation of contention and safety. |
| 66 | state/data/storage | Redis Data Types | https://redis.io/docs/latest/develop/data-types/ | Helps choose correct cache structures. |
| 67 | state/data/storage | Apache Kafka Documentation | https://kafka.apache.org/documentation/ | Durable event processing reference. |
| 68 | state/data/storage | PostgreSQL JSON Types | https://www.postgresql.org/docs/current/datatype-json.html | Relevant JSONB and structured-metadata guidance for the default registry stack. |
| 69 | state/data/storage | DynamoDB Basic Data Modeling | https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-modeling-nosql-BasicDataModeling.html | Useful scalable data-model guidance. |
| 70 | state/data/storage | EF Core Concurrency | https://learn.microsoft.com/en-us/ef/core/saving/concurrency | Practical write-conflict handling reference. |
| 71 | performance | web.dev Performance | https://web.dev/performance/ | Strong modern web performance guidance. |
| 72 | performance | MDN Web Performance | https://developer.mozilla.org/en-US/docs/Web/Performance | Canonical browser performance reference. |
| 73 | performance | V8 Blog | https://v8.dev/blog | Useful engine-level performance insight. |
| 74 | performance | .NET Performance Best Practices | https://learn.microsoft.com/en-us/dotnet/core/performance/performance-best-practices | Practical performance engineering guidance. |
| 75 | performance | Java Performance Overview | https://docs.oracle.com/en/java/javase/21/core/java-performance-overview.html | Official Java runtime performance reference. |
| 76 | performance | Flame Graphs | https://www.brendangregg.com/flamegraphs.html | Canonical hot-path diagnosis technique. |
| 77 | performance | Linux perf Wiki | https://perf.wiki.kernel.org/index.php/Main_Page | Low-level performance diagnostics reference. |
| 78 | performance | Go Diagnostics | https://go.dev/doc/diagnostics | Strong Go profiling and tracing guide. |
| 79 | performance | PostgreSQL Performance Tips | https://www.postgresql.org/docs/current/performance-tips.html | Important for database tuning. |
| 80 | performance | SQLite Query Planner | https://www.sqlite.org/queryplanner.html | Useful for query-shape and planner awareness. |
| 81 | security/secure coding | OWASP Top 10 | https://owasp.org/www-project-top-ten/ | Baseline risk model for application security. |
| 82 | security/secure coding | OWASP ASVS | https://owasp.org/www-project-application-security-verification-standard/ | Strong application-security verification baseline. |
| 83 | security/secure coding | NIST Secure Software Development Framework | https://csrc.nist.gov/projects/ssdf | Canonical secure development framework. |
| 84 | security/secure coding | CWE Top 25 | https://cwe.mitre.org/top25/ | High-value weakness taxonomy. |
| 85 | security/secure coding | CERT Secure Coding Standards | https://wiki.sei.cmu.edu/confluence/display/seccode | Language-specific secure coding reference. |
| 86 | security/secure coding | Microsoft Secure Coding Guidelines | https://learn.microsoft.com/en-us/windows/win32/seccore/secure-coding-guidelines | Practical secure coding rules. |
| 87 | security/secure coding | OSS-Fuzz New Project Guide | https://github.com/google/oss-fuzz/blob/master/docs/new_project_guide.md | Good robustness and fuzzing mindset. |
| 88 | security/secure coding | SLSA Framework | https://slsa.dev/ | Strong supply-chain integrity model. |
| 89 | security/secure coding | OpenSSF Scorecard | https://securityscorecards.dev/ | Measures repository security hygiene. |
| 90 | security/secure coding | GitHub Dependabot Version Updates | https://docs.github.com/en/code-security/dependabot/dependabot-version-updates | Helps keep dependencies current and safer. |
| 91 | documentation/maintainability | Diataxis | https://diataxis.fr/ | Excellent structure for useful documentation. |
| 92 | documentation/maintainability | Write the Docs Guide | https://www.writethedocs.org/guide/ | Practical docs-process and docs-culture guidance. |
| 93 | documentation/maintainability | Google Technical Writing Course | https://developers.google.com/tech-writing | Strong concise technical writing baseline. |
| 94 | documentation/maintainability | Keep a Changelog | https://keepachangelog.com/en/1.1.0/ | Encourages useful release notes. |
| 95 | documentation/maintainability | Architecture Decision Records | https://adr.github.io/ | Preserves architectural reasoning. |
| 96 | documentation/maintainability | Semantic Versioning | https://semver.org/ | Useful compatibility and release contract. |
| 97 | documentation/maintainability | Microsoft Writing Style Guide | https://learn.microsoft.com/en-us/style-guide/welcome/ | Strong reference for clear technical prose. |
| 98 | documentation/maintainability | Red Hat Documentation Style Guide | https://redhat-documentation.github.io/supplementary-style-guide/ | Good model for practical docs. |
| 99 | documentation/maintainability | Atlassian Documentation Style Guide | https://developer.atlassian.com/server/framework/atlassian-sdk/documentation-style-guide/ | Helpful task-oriented documentation reference. |
| 100 | documentation/maintainability | GitLab Documentation Style Guide | https://docs.gitlab.com/ee/development/documentation/styleguide/ | Strong docs-as-code style reference. |

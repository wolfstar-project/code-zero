# Governance

Code Zero is an open-source WolfStar Project repository. This document describes how technical decisions and contributions are handled while the project is in its early development stage.

## Roles

### Contributors

Anyone who reports issues, proposes designs, improves documentation, reviews changes, writes tests, or contributes code is a contributor.

### Maintainers

Maintainers are trusted WolfStar Project members with repository write or administrative access. They are responsible for review, releases, security response, repository policy, and keeping the project aligned with its goals and safety model.

## Decision making

Routine changes are decided through pull-request review. Prefer evidence from tests, benchmarks, reproductions, and documented constraints over preference alone.

Changes that materially affect architecture, security boundaries, supported execution providers, public APIs, licensing, or project governance should be discussed before implementation. Maintainers make the final decision when consensus cannot be reached.

The core architectural rule is that the agent runtime decides what should happen while adapters and the runner control external effects. Execution of untrusted code must remain behind the runner boundary.

## Pull requests

Changes should be focused, reviewable, and verified. Maintainers may request that unrelated refactors be split from behavior changes. A pull request can be merged when its required checks pass, review feedback is resolved, and a maintainer considers the change safe and in scope.

Approval is not guaranteed solely because a change is technically correct. Compatibility, maintenance cost, security, project direction, and scope are also considered.

## Security-sensitive changes

Changes to command execution, filesystem access, network policy, sandboxing, authentication, authorization, webhook verification, secret handling, or autonomous write behavior require additional scrutiny and explicit verification evidence.

Security vulnerabilities must be reported according to [SECURITY.md](SECURITY.md), not through public issues.

## Becoming a maintainer

Maintainer access is granted by existing WolfStar Project maintainers based on sustained, constructive contributions and demonstrated judgment around the project's architecture and security boundaries. There is no automatic contribution-count threshold.

## Conduct

Participation in project spaces is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

---
title: Code Zero
description: An autonomous engineer that finds, fixes, and verifies problems in pull requests — with evidence, not assertions.
navigation: false
seo:
  title: Code Zero
  description: An open-source autonomous engineer that finds, fixes, and verifies problems in pull requests.
---

::u-page-hero
#title
An autonomous engineer for pull requests

#description
Finds, fixes, and verifies problems in pull requests — with evidence, not assertions.

#links
:::u-button
---

to: /guide/installation
trailing-icon: i-lucide-arrow-right
size: xl
---

Get started
:::

:::u-button
---

to: /guide/introduction
color: neutral
variant: outline
size: xl
---

What is Code Zero?
:::

:::u-button
---

to: https://github.com/wolfstar-project/code-zero
target: _blank
color: neutral
variant: outline
size: xl
icon: i-simple-icons-github
---

GitHub
:::
::

::u-page-section
#features
:::u-page-feature
---

icon: i-lucide-badge-check
---

#title
Evidence over assertion

#description
Every fix carries the commands that verified it. Feedback is never treated as truth merely because it came from a human or an AI reviewer.
:::

:::u-page-feature
---

icon: i-lucide-shield-check
---

#title
Safe by default

#description
The observe mode inspects and reports and never writes to a target repository. Automatic fixes require confidence, an allowed change-risk class, repository permission, and verification.
:::

:::u-page-feature
---

icon: i-lucide-square-terminal
---

#title
One execution boundary

#description
A single runner package is the only code allowed to run commands or mutate a checkout, locally or inside an isolated sandbox.
:::

:::u-page-feature
---

icon: i-lucide-cable
---

#title
Provider-neutral

#description
GitHub, GitLab, Bitbucket, and Gitea adapters on one side; OpenAI, Anthropic, Google, and OpenAI-compatible model providers on the other. The runtime depends on neither.
:::

:::u-page-feature
---

icon: i-lucide-git-pull-request
---

#title
Issues become pull requests

#description
A labeled, repository-scoped issue can be investigated, implemented on an isolated branch, verified, and published as a pull request carrying its acceptance criteria and evidence.
:::

:::u-page-feature
---

icon: i-lucide-layout-dashboard
---

#title
One deployable app

#description
A single Nuxt dashboard serves the UI, a typed oRPC control plane, an OpenAPI surface, and authentication from one origin.
:::
::

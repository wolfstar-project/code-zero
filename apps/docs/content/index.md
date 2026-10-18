---
title: Documentation
description: Install Code Zero, run your first read-only review, and configure your deployment.
navigation: false
seo:
  title: Documentation
  description: Installation, self-hosting, configuration, and API guides for Code Zero.
---

::u-page-hero
---

orientation: horizontal
---

#title
Start with a read-only review

#description
Install Code Zero and review a change before enabling automated changes. These guides take you from the first local run to your own deployment.

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

How Code Zero works
:::

#default
:::u-page-grid
---

class: grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4
---

::::u-page-card
---

title: Install Code Zero
description: Set up the workspace and run the local CLI.
to: /guide/installation
variant: outline
---

::::

::::u-page-card
---

title: Self-host the dashboard
description: Configure the database, authentication, and deployment.
to: /guide/deployment
variant: outline
---

::::

::::u-page-card
---

title: Use the CLI
description: Create a policy, inspect your environment, or review a change.
to: /reference/cli
variant: outline
---

::::

::::u-page-card
---

title: Connect to the API
description: Use the typed client or the HTTP API.
to: /guide/api/overview
variant: outline
---

::::
:::
::

::u-page-section
---

class: border-t border-default
---

#title
Understand what the agent can change

#description
Observe mode is the default. Before enabling writes, configure the repository policy and understand the execution boundary.

#default
:::u-page-grid
---

class: grid-cols-1 sm:grid-cols-1 md:grid-cols-3 gap-4
---

::::u-page-card
---

title: Repository configuration
description: Choose modes, checks, model providers, and execution policy.
to: /guide/configuration
variant: outline
---

::::

::::u-page-card
---

title: Safety and approvals
description: Understand the gates a proposed change must pass.
to: /guide/safety
variant: outline
---

::::

::::u-page-card
---

title: Architecture
description: Follow the agent, runner, and adapter boundaries.
to: /guide/architecture/overview
variant: outline
---

::::
:::
::

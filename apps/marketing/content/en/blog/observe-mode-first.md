---
title: 'Observe mode first, always'
description: 'Why every Code Zero run starts read-only, and why promoting to fix mode is a decision you make in policy, not in a prompt.'
date: '2026-08-06'
author: 'Amelia Ortiz'
authorInitials: 'AO'
tag: 'safety'
---

The most common question we get about autonomous fixing is also the best one: _what stops it from
breaking my repository?_ The honest answer is that nothing should have to stop it, because it
should never have started with write access.

Every Code Zero run begins in observe mode. It can read the checkout, reproduce the problem, and
run the repository's own checks — and it reports what it found and what it would change. Nothing
touches a file until fix mode is enabled in repository policy, reviewed and merged like any other
change to your codebase.

That ordering matters more than any individual safeguard. A reviewer who has seen a week of
observe-mode reports knows exactly what the agent would have done with write access, before it ever
has it. Trust is earned from evidence, not asserted by a changelog.

## What a first week looks like

Point it at a backlog of stale review comments. Let it validate each one against the actual
checkout: some it will confirm with cited evidence, some it will reject with the reasons listed,
some it will mark inconclusive for a human. At the end of the week you have a triaged backlog and a
decision to make — and by then it's an informed one.

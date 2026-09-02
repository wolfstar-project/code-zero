---
title: 'One boundary for every write'
description: 'Commands and file mutations go through a single runner boundary. That is one file to audit, not a codebase to trust.'
date: '2026-07-28'
author: 'Jonas Weber'
authorInitials: 'JW'
tag: 'architecture'
---

Ask a security reviewer what they think of an autonomous coding agent and they will ask you one
question back: _what, exactly, can it execute?_

In Code Zero the answer fits in a sentence: only `packages/runner` may run a command or mutate a
checkout, and everything else must ask it through typed contracts. Working directories are
validated, escape attempts are rejected, timeouts and output limits are enforced — in one place.

The alternative is what most agent frameworks ship: shell access sprinkled across tools, each call
site individually responsible for being careful. That is not auditable in any meaningful sense.
A single boundary is. Your reviewer reads one package and knows the whole blast radius.

## Isolation when it counts

Repository-supplied commands — your test suite, your linter — are the untrusted part, and those are
what isolation moves into an ephemeral sandbox. Every hosted lease has a maximum lifetime, quota
checks run before provisioning, and the agent only ever receives the ordinary `Runner` contract.
The evidence bundle records which runner ran what, so "verified in isolation" is a checkable claim
rather than a vibe.

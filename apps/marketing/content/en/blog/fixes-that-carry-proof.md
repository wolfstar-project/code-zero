---
title: 'Fixes that carry their own proof'
description: 'A pull request from Code Zero is rendered evidence: the commands that verified the change, not a claim that it works.'
date: '2026-07-15'
author: 'Maya Chen'
authorInitials: 'MC'
tag: 'evidence'
---

Reviewers stopped trusting automated pull requests for a simple reason: most of them are guesses
wearing a confident commit message.

Code Zero takes the opposite bet. A change is only proposed once the repository's own checks pass
against it, and the pull request body _is_ the rendered evidence bundle — the acceptance criteria,
the commands that ran, their output, and the diff review that preceded publication. If
verification fails, the run ends and reports why. No hopeful pull request, no noise.

## Why this changes review behavior

When every automated PR arrives with the proof attached, reviewers stop re-deriving it. The
question shifts from "does this even work?" to "is this the change we want?" — which is the
question human review is actually good at. Teams tell us this is the moment agent output stopped
being treated as spam, and it is why we will not ship a mode that skips verification.

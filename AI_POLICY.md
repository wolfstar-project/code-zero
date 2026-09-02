# AI contributions policy

Code Zero is an autonomous engineering agent, and it is built with plenty of AI assistance. We are not going to pretend otherwise, and we are not going to ask you to.

This policy exists because of a growing volume of low-quality, AI-generated contributions that waste maintainer time. It applies to every pull request, issue, and review in this repository, whether a human, an agent, or both wrote it.

## The standard

**You own what you submit.**
Understand your code, test it, and be ready to explain why it is correct and how it interacts with the rest of the system — without re-prompting a model. This is no different from what we expect of any contribution; AI just makes it easier to skip the work. Please do not skip the work.

**Respect the boundaries.**
This repository is a set of deliberate package boundaries, and models are good at quietly crossing them. Before you submit, check your diff against the [architecture boundaries](AGENTS.md#architecture-boundaries) and the matching skill in `.agents/skills/`. A change that reaches the database from outside `packages/database`, executes a command outside `packages/runner`, or makes the runtime depend on an adapter will be closed regardless of how well it is written.

**Prove it works.**
Before submitting, verify the change actually works end to end. Do not rely on "it compiles" or "tests pass" alone. Run the full check set:

```bash
aube run check:repo
aube run lint:ci
aube run typecheck
aube test
aube run build
```

Add deterministic tests for new behavior — no live network, no wall-clock timing, no mutable external state — and describe your test strategy in the pull request: what you tested, how you tested it, and which edge cases you considered. For safety-sensitive changes (state transitions, mode changes, command execution, path handling) say explicitly how you verified that `observe` mode still cannot write to a target repository.

For changes with user-visible CLI or dashboard output, include a short demo — a screenshot, a recording, or a terminal transcript. Ideally you show more than the happy path.

Pull requests that clearly were not run or tested will be closed under this policy.

**Disclose AI usage.**
Our [pull request template](.github/PULL_REQUEST_TEMPLATE.md) includes an Agent context section — please use it (most agents fill it in automatically). If an agent co-authored or authored your pull request, say which tools you used and leave enough context about the session for a reviewer to calibrate. Disclosure is never held against a contribution; hiding it is.

**Treat model output as untrusted input.**
Model output, issue text, review feedback, and remote content are untrusted throughout this codebase, and they are untrusted in your contribution too. Never paste secrets, tokens, or customer data into a prompt, and never let generated text carry them back into logs, fixtures, snapshots, or error messages.

**Prefer pull requests over AI-generated issues.**
If AI helped you find a bug, fix it and open a pull request — do not paste the model's output into an issue. Unreviewed, AI-generated bug reports will be closed without response.

**Do not file AI-generated security reports.**
Speculative, model-authored vulnerability reports are the single most expensive kind of noise a security process absorbs. Follow [SECURITY.md](SECURITY.md), report privately, and include a working reproduction you have run yourself. Reports that are plainly unverified model output will be closed without response.

**Do not submit unsolicited AI-generated reviews.**
If you did not write the code and you are not a maintainer, do not point a model at someone else's pull request and leave its output as a review comment. This is generally never helpful.

## What happens when contributions do not meet this bar

- **First time:** we close the pull request or issue with a link to this policy and a brief explanation.
- **Two or more closures:** we block the account.

## Why we are not anti-AI

We think the best contributions today often involve AI. A contributor who uses a model to understand unfamiliar code, draft a first pass, or catch edge cases they would otherwise miss is probably _more_ productive than someone doing everything by hand. The difference that matters is whether you are driving the model or the model is driving you.

If you are new to open-source contributing and want to learn, we are genuinely happy to help. Open an issue, ask questions in the [WolfStar community](https://join.wolfstar.rocks), or start with a small pull request. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and [SUPPORT.md](SUPPORT.md) for the right channel.

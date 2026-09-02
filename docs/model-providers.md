# Model providers

Code Zero supports native OpenAI, Anthropic, and Google Generative AI adapters, Vercel AI Gateway, and arbitrary OpenAI-compatible endpoints — all behind one `ModelProvider` contract in `packages/models`, sharing one structured-output, usage-accounting, timeout, and error-redaction path.

## Select a provider

The transport is selected in repository policy; the credential comes only from the environment:

```yaml
model:
  provider: anthropic
  name: claude-sonnet-4-5
```

| `model.provider`    | Credential environment variable                          | Model example                 |
| ------------------- | -------------------------------------------------------- | ----------------------------- |
| `ai-gateway`        | `AI_GATEWAY_API_KEY` or Vercel OIDC                      | `anthropic/claude-sonnet-4.5` |
| `anthropic`         | `ANTHROPIC_API_KEY`                                      | `claude-sonnet-4-5`           |
| `google`            | `GOOGLE_GENERATIVE_AI_API_KEY`                           | `gemini-2.5-pro`              |
| `openai`            | `OPENAI_API_KEY`                                         | `gpt-5`                       |
| `openai-compatible` | `OPENAI_COMPATIBLE_API_KEY` (or legacy `OPENAI_API_KEY`) | provider-specific             |

The AI Gateway accepts `provider/model` identifiers and exposes the broader AI SDK provider catalog without adding provider-specific logic to the Code Zero runtime.

## Custom endpoints

`CODE_ZERO_MODEL_BASE_URL` is an optional **operator** environment variable for custom gateways and self-hosted endpoints. Endpoint URLs and credentials cannot be named or embedded in `.code-zero.yml`, so untrusted repository policy cannot redirect a provider secret.

## Cost accounting

To record cost, configure explicit rates — Code Zero never guesses provider pricing:

```yaml
model:
  provider: openai-compatible
  name: gpt-5
  inputCostPerMillionTokens: 1.25
  outputCostPerMillionTokens: 10
```

Usage (tokens and, when configured, cost) is accounted per run and carried in the task result.

## Guarantees

- Credentials are read only from the provider's documented environment variable and are never persisted with task evidence.
- The agent runtime sees neither SDK objects nor credentials — `packages/models` keeps AI SDK types behind the adapter boundary.
- Errors are redacted before they surface, so a provider exception cannot leak a credential into logs or evidence.

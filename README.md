<div align="center">

# dsh-auxiliary

**Auxiliary models for DeepSeek Harness: vision understanding and context compression through dedicated model routes.**

English | [简体中文](README.zh_CN.md)

</div>

`dsh-auxiliary` is a [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) plugin that adds auxiliary model capabilities on top of the harness LLM seam (`ctx.llm`), without changing the main conversation model:

- **Vision provider** — registers an OpenAI-compatible `aux-vision` provider route that accepts harness `image` content blocks and streams chat completions from any OpenAI-compatible vision endpoint.
- **`inspect_image` tool** — lets the agent read a local image file and ask the auxiliary vision model about it, so a text-only main model can still understand screenshots, photos, and diagrams.
- **Compaction routing** — an `llm/stream` waterfall listener reroutes every `purpose: 'compaction'` summary call to a dedicated auxiliary summarizer pair, so context compression runs on a separate (cheaper/faster, or vision-capable) model.
- **Compression engine** *(optional)* — a `BasicCompactionEngine` subclass that drives summarization with an explicit context-compression instruction instead of the default prompt.

## How it works

The plugin follows the standard DSH extension points documented in the [plugin development guide](https://deepseek-harness.github.io/deepseek-harness/develop/basic/):

| Feature | Extension point |
| --- | --- |
| Vision provider | `ctx.llm.registerAdapter()` + `ctx.llm.registerConfigurableProviders()` (appears in the Models settings page) |
| `inspect_image` tool | `ctx.tools.register(defineTool(...))` + `ctx.systemPrompt.section(...)` |
| Compaction routing | `ctx.on('llm/stream', ...)` waterfall listener |
| Compression engine | subclass hook `BasicCompactionEngine.summarize()` |
| Auxiliary Models settings page | client `settings.section` slot (`ctx.slots.register`) |

Image content uses the harness `image` content block (`ImageAttachmentRef`), committed and read through the `ctx.attachments` seam, so the adapter never touches a concrete storage backend.

## Installation

The plugin is a plain cordis plugin (non-bundle). Add it to a DSH web profile, for example via the plugin manager or by adding the package to the profile bundle layer and listing it in the profile config:

```bash
npm install dsh-auxiliary
```

Then enable it in the profile plugin list (see [`examples/profile.yml`](examples/profile.yml)):

```yaml
- name: dsh-auxiliary
  config:
    vision:
      enabled: true
      baseURL: https://api.openai.com/v1   # any OpenAI-compatible vision endpoint
      apiKeyEnv: VISION_API_KEY
      model: gpt-4o-mini
    compact:
      enabled: true
      provider: aux-vision                 # reroute compaction summaries here
      model: gpt-4o-mini
```

The API key is resolved through the credentials service (the web Models page) or the `VISION_API_KEY` environment variable.

## Configuration

All fields are optional; defaults are shown.

```yaml
- name: dsh-auxiliary
  config:
    vision:
      enabled: true                        # register the aux-vision provider route
      displayName: Aux Vision (OpenAI-compatible)
      baseURL: https://api.openai.com/v1   # OpenAI-compatible /chat/completions endpoint
      apiKeyEnv: VISION_API_KEY            # credential ref or environment variable
      model: gpt-4o-mini                   # primary vision model
      models: []                           # optional advisory catalog entries
      maxTokens: 2048                      # per-request output cap
      defaultContextWindow: 128000
      streamIdleTimeoutMs: 300000
      retryPolicy: { mode: normal, maxRetries: 2 }
    tool:
      enabled: true                        # register the inspect_image tool
      maxImageBytes: 10485760              # per-file size cap
      timeoutMs: 120000                    # cooperative tool-call budget
    compact:
      enabled: false                       # reroute compaction summaries to an auxiliary model
      provider: ""                         # must be set together with model
      model: ""
    engine:
      enabled: false                       # optional compression engine (mutually exclusive with dsh-compaction-basic)
      thresholdRatio: 0.8
      retainRatio: 0.16
      maxTokens: 8192
      compactionRetries: 1
      maxOverflowRetries: 1
      auto: true
      compressPrompt: "..."                # custom compression instruction
```

### Settings page: Auxiliary Models

The plugin ships a web settings section (**Settings → Auxiliary Models**) that
lists every provider already configured in Models and lets you pick one plus
one of its models. Saving writes `vision.provider` + `vision.model`, after
which `inspect_image` (and any compaction routing you enable) routes through
that provider — no custom endpoint needed. The legacy custom-endpoint mode
(`baseURL` + `apiKeyEnv`) remains available when `vision.provider` is unset.

### Notes

- `compact.enabled` reroutes only `purpose: 'compaction'` calls. Point `provider`/`model` at any registered route — e.g. `aux-vision` (handles image-bearing history) or a cheap model on your main provider.
- `engine.enabled: true` **replaces** the stock compaction backend; do not load `@deepseek-ai/dsh-compaction-basic` at the same time. The plugin detects the conflict and skips the engine with a warning.
- Vision tool arguments: `path` (absolute or workspace-relative) and optional `question`. Supported formats: PNG, JPEG, WebP, GIF.

## Development

```bash
npm install          # installs dependencies (typescript, @deepseek-ai/* peers)
npm run typecheck    # tsc --noEmit
npm run build        # emits lib/
```

## License

[LGPL-3.0](LICENSE)

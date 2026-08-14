<div align="center">

# dsh-auxiliary

**Auxiliary models for DeepSeek Harness: vision understanding and context compression through dedicated model routes.**

English | [简体中文](README.zh_CN.md)

</div>

`dsh-auxiliary` is a [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) plugin that adds auxiliary model capabilities on top of the harness LLM seam (`ctx.llm`), without changing the main conversation model:

- **Vision model** — reuses a provider and model already configured in Models: add them in the **Models** page, then pick them under **Settings → Auxiliary Models** (saved as `vision.provider` + `vision.model`), and `inspect_image` calls the vision model through that provider.
- **`inspect_image` tool** — lets the agent read a local image file and ask the auxiliary vision model about it, so a text-only main model can still understand screenshots, photos, and diagrams.
- **Compaction routing** — an `llm/stream` waterfall listener reroutes every `purpose: 'compaction'` summary call to a dedicated auxiliary summarizer pair, so context compression runs on a separate (cheaper/faster, or vision-capable) model.
- **Compression engine** *(optional)* — a `BasicCompactionEngine` subclass that drives summarization with an explicit context-compression instruction instead of the default prompt.

## How it works

The plugin follows the standard DSH extension points documented in the [plugin development guide](https://deepseek-harness.github.io/deepseek-harness/develop/basic/):

| Feature | Extension point |
| --- | --- |
| Vision selection | client `api.llm.providers()` / `api.llm.models()` + `ctx.llm.stream()` (reuse existing Models routes) |
| `inspect_image` tool | `ctx.tools.register(defineTool(...))` + `ctx.systemPrompt.section(...)` |
| Compaction routing | `ctx.on('llm/stream', ...)` waterfall listener |
| Compression engine | subclass hook `BasicCompactionEngine.summarize()` |
| Auxiliary Models settings page | client `settings.section` slot (`ctx.slots.register`) |

Image content uses the harness `image` content block (`ImageAttachmentRef`), committed and read through the `ctx.attachments` seam, so the plugin never touches a concrete storage backend.

## Installation

The plugin is a plain cordis plugin (non-bundle). Add it to a DSH web profile, for example via the plugin manager or by adding the package to the profile bundle layer and listing it in the profile config:

```bash
npm install dsh-auxiliary
```

Then enable it in the profile plugin list (see [`examples/profile.yml`](examples/profile.yml)):

```yaml
- name: dsh-auxiliary
  config:
    tool:
      enabled: true
```

Once enabled, add a provider and its models in the web **Models** page, then pick them under **Settings → Auxiliary Models** — no custom endpoint or API key is needed.

## Configuration

All fields are optional; defaults are shown.

```yaml
- name: dsh-auxiliary
  config:
    vision:
      maxTokens: 2048                      # inspect_image output cap (provider/model written by the settings page)
    tool:
      enabled: true                        # register the inspect_image tool
      maxImageBytes: 10485760              # per-file size cap
      timeoutMs: 120000                    # cooperative tool-call budget
    compact:
      enabled: false                       # reroute compaction summaries to an auxiliary model
      provider: ""                         # e.g. deepseek-official (a registered provider route id)
      model: ""                            # e.g. deepseek-chat (a model id on that provider)
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

The plugin ships a web settings section (**Settings → Auxiliary Models**).
Configure a provider and its models in the **Models** page first, then pick
them here: the page lists only providers that are currently enabled and
advertise at least one model in the catalog, and the model list shows only
that provider's catalog models. Saving writes `vision.provider` and
`vision.model` — the selection only affects the vision model `inspect_image`
uses; compaction summaries keep their own independent `compact.provider` /
`compact.model` pair.

### Notes

- `compact.enabled` reroutes only `purpose: 'compaction'` calls. Point `provider`/`model` at any registered route — e.g. `deepseek-official` with a cheaper model (placeholders; replace with your actual provider route and model id).
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

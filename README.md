<div align="center">

# dsh-auxiliary

**Auxiliary models for DeepSeek Harness: vision understanding and context compression through dedicated model routes.**

English | [简体中文](README.zh_CN.md)

</div>

`dsh-auxiliary` is a [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) plugin that adds auxiliary model capabilities on top of the harness LLM seam (`ctx.llm`), without changing the main conversation model:

- **Vision model** — reuses a provider and model already configured in Models: add them in the **Models** page, then pick them under **Settings → Auxiliary Models → Vision understanding** (saved as `vision.provider` + `vision.model`); `tool.enabled` independently controls whether `inspect_image` is registered.
- **`inspect_image` tool** — lets the agent read a local image file and ask the auxiliary vision model about it, so a text-only main model can still understand screenshots, photos, and diagrams.
- **Compaction routing** — an `llm/stream` waterfall listener reroutes every `purpose: 'compaction'` summary call to a dedicated auxiliary summarizer pair; `compact.enabled`, `compact.provider`, and `compact.model` are independent of the vision feature.
- **Compression engine** *(optional)* — a `BasicCompactionEngine` subclass that drives summarization with an explicit context-compression instruction instead of the default prompt; it adds no third model route and reuses the compact route when enabled.

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
      handoff: true                        # text-only main models may reference chat images via describe_image
    tool:
      enabled: true                        # register the inspect_image tool
      maxImageBytes: 10485760              # per-file size cap
      timeoutMs: 120000                    # cooperative tool-call budget
    compact:
      enabled: false                       # reroute compaction summaries to an auxiliary model
      provider: ""                         # e.g. deepseek-official (a registered provider route id)
      model: ""                            # e.g. deepseek-chat (a model id on that provider)
    approve:
      enabled: false                       # give dsh-command-approve-for-me's reviews a dedicated model
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
Configure a provider and its models in the **Models** page first, then use the
two independent cards here: **Vision understanding** has its own `tool.enabled`
switch and `vision.provider` / `vision.model`, while **Context compaction** has
its own `compact.enabled` switch and `compact.provider` / `compact.model`.
The picker presents all currently available models together, grouped by
provider. A saved route that is temporarily absent from the catalog is kept
and is never replaced automatically.

For a user-configured `llm-pi-ai` model, declare image support under
**Settings → Models → Provider → Customized settings → Models → Model
settings**. The **Allow image input** checkbox writes the model's canonical
`input` declaration (`[text, image]` when checked, `[text]` when cleared), so
both `inspect_image` and the main chat composer use the same capability fact.
Enable it only when the upstream endpoint actually accepts images; the
declaration cannot add vision support to a text-only model.

To use the selected vision route with a local file, put the image at a
Host-readable workspace-relative or absolute path, then ask the agent to run
`inspect_image`, for example: `Use inspect_image to analyze
screenshots/error.png`.

### Image handoff (chat images with a text-only main model)

When **Image handoff** (`vision.handoff`, default on) is enabled and a vision
provider/model is selected, attaching an image to a chat whose main model is
text-only no longer fails. Instead:

1. The image admission preflight is bypassed for models that declare no image
   input (a runtime wrapper on `ctx.llm.resolveModelInfo` claims image input
   while the handoff is active — the model catalog and the per-model checkboxes
   are unaffected, because they read the settings document directly).
2. A listener on the official `llm/stream` waterfall replaces the image block
   with a text reference `[image: {"attachmentId":…,"mediaType":…}]` before the
   adapter sees it, so the text-only model never receives an image payload
   (vision-route calls such as `inspect_image` are left untouched).
3. The system prompt tells the main model to call `describe_image` with the
   exact JSON from the reference; the tool reads the stored attachment bytes
   and asks the selected vision model, returning a text description that is
   injected into the conversation.

The reference is plain text, so it survives restarts, forks, and replays.
Disable `vision.handoff` to restore the original rejection behavior. Both
seams are plugin-side and leave every core package unmodified.

### Approval model (dsh-command-approve-for-me hookup)

[dsh-command-approve-for-me](https://github.com/ZhuRuoLing/dsh-command-approve-for-me)
adds codex-style auto-approval; in `review` mode a lightweight reviewer model
decides each approval prompt. By default the reviewer inherits the requesting
session's model route (or the plugin's own `reviewProvider` / `reviewModel`).
This plugin's **Approval model** card (`approve.enabled` plus
`approve.provider` / `approve.model`) gives the review a dedicated model
instead:

1. A listener on the official `llm/stream` waterfall recognizes the review
   call by its public contract — the fixed `>>> APPROVAL REQUEST START` marker
   in the user message, no `sessionId`, and `temperature: 0` — and reroutes it
   to `approve.provider` / `approve.model`.
2. Everything else about the call (system policy, transcript, timeout, retries,
   fallback) stays owned by the approve-for-me plugin; only the model route is
   swapped. The verdict still never enters the session history.

The routing activates only when the feature is enabled with a complete route;
without the plugin installed there are no review calls, so the listener is
inert. Prefer a cheap, fast model for reviews. Requires approve-for-me's
`mode: review` plus the `approve-for-me` or `strict-review` permission preset
to take effect.

The settings page detects whether the plugin is installed: the plugin serves a
read-only JSON endpoint at `/dsh-auxiliary/state`
(`{ "approvePluginInstalled": true|false }`) through the optional `webServer`
service, and the **Approval model** card shows a "plugin not installed" notice
with editing disabled when the plugin's presets are absent from the live
`permissionPresets` table. The endpoint is loopback-local, returns no
sensitive data, and is simply absent on headless profiles.

### Subagent model

```yaml
subagent:
  enabled: true
  provider: anvilcraft-ai
  model: deepseek-chat
```

Child agents inherit their parent's model route by default. When this feature
is enabled with a complete route, every delegated child — one-shot spawn/fork
runs and continuable children, including cold-resumed ones — is routed to the
selected pair instead. The plugin listens for `agent/created` and, for agents
whose delegation depth is > 0, installs an `agent/request` waterfall listener
on the agent's own scoped context; returning a replacement `LlmCallConfig` is
the loop's official "switch" contract, so the changed header snapshot is
logged like any other model switch. Remote providers (ACP) never register a
process-local agent and their children keep inheriting the parent route.
Prefer a cheap, fast model to control delegation cost. No external plugin is
required.

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

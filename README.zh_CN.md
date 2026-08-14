<div align="center">

# dsh-auxiliary

**DeepSeek Harness 辅助模型插件：通过独立的模型路由提供视觉理解与上下文压缩能力。**

[English](README.md) | 简体中文

</div>

`dsh-auxiliary` 是一个 [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) 插件，在 harness 的 LLM 抽象层（`ctx.llm`）之上添加辅助模型能力，且不影响主对话模型：

- **视觉提供方** —— 注册 OpenAI 兼容的 `aux-vision` 提供方路由，可接收 harness 的 `image` 内容块，并从任意 OpenAI 兼容视觉端点流式调用 chat completions。
- **`inspect_image` 工具** —— 让智能体读取本地图片文件并询问辅助视觉模型，使纯文本主模型也能理解截图、照片与图表。
- **压缩路由** —— 通过 `llm/stream` waterfall 监听器，把每次 `purpose: 'compaction'` 的摘要调用改路由到独立的辅助摘要模型对，让上下文压缩跑在单独的（更便宜/更快，或具备视觉能力的）模型上。
- **压缩引擎**（可选）—— 继承 `BasicCompactionEngine` 的子类，用显式的上下文压缩指令驱动摘要，替代默认提示词。

## 工作原理

插件遵循 [插件开发指南](https://deepseek-harness.github.io/deepseek-harness/develop/basic/) 中记载的标准 DSH 扩展点：

| 能力 | 扩展点 |
| --- | --- |
| 视觉提供方 | `ctx.llm.registerAdapter()` + `ctx.llm.registerConfigurableProviders()`（自动出现在 Models 设置页） |
| `inspect_image` 工具 | `ctx.tools.register(defineTool(...))` + `ctx.systemPrompt.section(...)` |
| 压缩路由 | `ctx.on('llm/stream', ...)` waterfall 监听器 |
| 压缩引擎 | 子类钩子 `BasicCompactionEngine.summarize()` |
| 「辅助模型」设置页 | client 端 `settings.section` 插槽（`ctx.slots.register`） |

图片内容使用 harness 的 `image` 内容块（`ImageAttachmentRef`），通过 `ctx.attachments` 抽象读写，适配器不接触任何具体存储后端。

## 安装

本插件是普通 cordis 插件（非 bundle）。把它加入 DSH Web profile，例如通过插件管理器安装，或在 profile 的 bundle 层加入该包并在 profile 配置中引用：

```bash
npm install dsh-auxiliary
```

然后在 profile 插件列表中启用（见 [`examples/profile.yml`](examples/profile.yml)）：

```yaml
- name: dsh-auxiliary
  config:
    vision:
      enabled: true
      baseURL: https://api.openai.com/v1   # 任意 OpenAI 兼容视觉端点
      apiKeyEnv: VISION_API_KEY
      model: gpt-4o-mini
    compact:
      enabled: true
      provider: aux-vision                 # 把压缩摘要路由到这里
      model: gpt-4o-mini
```

API 密钥通过凭据服务（Web 的 Models 页面）或 `VISION_API_KEY` 环境变量解析。

## 配置

所有字段均可选，括号内为默认值。

```yaml
- name: dsh-auxiliary
  config:
    vision:
      enabled: true                        # 注册 aux-vision 提供方路由
      displayName: Aux Vision (OpenAI-compatible)
      baseURL: https://api.openai.com/v1   # OpenAI 兼容 /chat/completions 端点
      apiKeyEnv: VISION_API_KEY            # 凭据引用或环境变量
      model: gpt-4o-mini                   # 主视觉模型
      models: []                           # 可选：补充模型目录条目
      maxTokens: 2048                      # 单次请求输出上限
      defaultContextWindow: 128000
      streamIdleTimeoutMs: 300000
      retryPolicy: { mode: normal, maxRetries: 2 }
    tool:
      enabled: true                        # 注册 inspect_image 工具
      maxImageBytes: 10485760              # 单文件大小上限
      timeoutMs: 120000                    # 协作式工具调用预算
    compact:
      enabled: false                       # 把压缩摘要改路由到辅助模型
      provider: ""                         # 必须与 model 成对设置
      model: ""
    engine:
      enabled: false                       # 可选压缩引擎（与 dsh-compaction-basic 互斥）
      thresholdRatio: 0.8
      retainRatio: 0.16
      maxTokens: 8192
      compactionRetries: 1
      maxOverflowRetries: 1
      auto: true
      compressPrompt: "..."                # 自定义压缩指令
```

### 设置页：辅助模型

插件自带一个 Web 设置分区（**设置 → 辅助模型**），列出「模型」页已配置的
所有提供商，可从中选择一个提供商及其模型。保存后写入
`vision.provider` + `vision.model`，此后 `inspect_image`（以及你启用的压缩
路由）将走该提供商——无需自定义端点。未设置 `vision.provider` 时，原有的
自定义端点模式（`baseURL` + `apiKeyEnv`）仍然可用。

### 说明

- `compact.enabled` 只改路由 `purpose: 'compaction'` 的调用。`provider`/`model` 可指向任意已注册路由——例如 `aux-vision`（可处理含图片的历史），或主提供方上更便宜的模型。
- `engine.enabled: true` 会**替换**默认压缩后端；请勿同时加载 `@deepseek-ai/dsh-compaction-basic`。插件检测到冲突会跳过引擎并告警。
- 视觉工具参数：`path`（绝对路径或工作区相对路径）与可选的 `question`。支持格式：PNG、JPEG、WebP、GIF。

## 开发

```bash
npm install          # 安装依赖（typescript、@deepseek-ai/* peers）
npm run typecheck    # tsc --noEmit
npm run build        # 产出 lib/
```

## 许可证

[LGPL-3.0](LICENSE)

<div align="center">

# dsh-auxiliary

**DeepSeek Harness 辅助模型插件：通过独立的模型路由提供视觉理解与上下文压缩能力。**

[English](README.md) | 简体中文

</div>

`dsh-auxiliary` 是一个 [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) 插件，在 harness 的 LLM 抽象层（`ctx.llm`）之上添加辅助模型能力，且不影响主对话模型：

- **视觉模型** —— 复用「模型」页已配置的提供商与模型：先在「模型」页添加提供商及其模型，再到 **设置 → 辅助模型 → 视觉理解** 选择并保存（写入 `vision.provider` / `vision.model`），`tool.enabled` 单独控制 `inspect_image` 是否注册。
- **`inspect_image` 工具** —— 让智能体读取本地图片文件并询问辅助视觉模型，使纯文本主模型也能理解截图、照片与图表。
- **压缩路由** —— 通过 `llm/stream` waterfall 监听器，把每次 `purpose: 'compaction'` 的摘要调用改路由到独立的辅助摘要模型对；`compact.enabled`、`compact.provider` 与 `compact.model` 都与视觉功能独立。
- **压缩引擎**（可选）—— 继承 `BasicCompactionEngine` 的子类，用显式的上下文压缩指令驱动摘要，替代默认提示词；它不增加第三条模型路由，启用时复用 compact 路由。

## 工作原理

插件遵循 [插件开发指南](https://deepseek-harness.github.io/deepseek-harness/develop/basic/) 中记载的标准 DSH 扩展点：

| 能力 | 扩展点 |
| --- | --- |
| 视觉选择 | 客户端 `api.llm.providers()` / `api.llm.models()` + `ctx.llm.stream()`（复用「模型」页已有路由） |
| `inspect_image` 工具 | `ctx.tools.register(defineTool(...))` + `ctx.systemPrompt.section(...)` |
| 压缩路由 | `ctx.on('llm/stream', ...)` waterfall 监听器 |
| 压缩引擎 | 子类钩子 `BasicCompactionEngine.summarize()` |
| 「辅助模型」设置页 | client 端 `settings.section` 插槽（`ctx.slots.register`） |

图片内容使用 harness 的 `image` 内容块（`ImageAttachmentRef`），通过 `ctx.attachments` 抽象读写，插件不接触任何具体存储后端。

## 安装

本插件是普通 cordis 插件（非 bundle）。把它加入 DSH Web profile，例如通过插件管理器安装，或在 profile 的 bundle 层加入该包并在 profile 配置中引用：

```bash
npm install dsh-auxiliary
```

然后在 profile 插件列表中启用（见 [`examples/profile.yml`](examples/profile.yml)）：

```yaml
- name: dsh-auxiliary
  config:
    tool:
      enabled: true
```

启用后，先在 Web 的「模型」页添加提供商及其模型，再到 **设置 → 辅助模型** 选择它们——无需配置自定义端点或 API 密钥。

## 配置

所有字段均可选，括号内为默认值。

```yaml
- name: dsh-auxiliary
  config:
    vision:
      maxTokens: 2048                      # inspect_image 输出上限（provider/model 由设置页写入）
    tool:
      enabled: true                        # 注册 inspect_image 工具
      maxImageBytes: 10485760              # 单文件大小上限
      timeoutMs: 120000                    # 协作式工具调用预算
    compact:
      enabled: false                       # 把压缩摘要改路由到辅助模型
      provider: ""                         # 示例：deepseek-official（已注册的提供商路由 id）
      model: ""                            # 示例：deepseek-chat（该提供商下的模型 id）
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

插件自带一个 Web 设置分区（**设置 → 辅助模型**）。先在「模型」页配置好提供商及其模型，再回到这里配置两张独立卡片：**视觉理解**有自己的 `tool.enabled` 开关与 `vision.provider` / `vision.model`，**上下文压缩**有自己的 `compact.enabled` 开关与 `compact.provider` / `compact.model`。模型选择器把所有当前可用模型集中列出，并按提供商分组；已保存但暂时不在目录中的路由会保留，不会被自动替换。

对于用户配置的 `llm-pi-ai` 模型，请在 **设置 → 模型 → 提供商 → 自定义设置 → 模型目录 → 模型设置** 中声明图片能力。勾选 **允许图片输入** 时写入模型的标准 `input: [text, image]` 声明，取消勾选时写入 `input: [text]`；`inspect_image` 与主聊天附件校验会读取同一份能力声明。仅应在上游接口确实接受图片时启用，该声明不能让纯文本模型获得视觉能力。

若要使用设置页选择的视觉模型，请把图片放在 Host 可读取的工作区相对路径或绝对路径，再让智能体调用 `inspect_image`，例如：`请调用 inspect_image 分析 screenshots/error.png`。

### 说明

- `compact.enabled` 只改路由 `purpose: 'compaction'` 的调用。`provider`/`model` 可指向任意已注册路由——例如 `deepseek-official` 配一个更便宜的模型（示例值，请替换为你实际配置的提供商路由 id 与模型 id）。
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

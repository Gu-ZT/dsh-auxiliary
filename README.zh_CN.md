<div align="center">

# dsh-auxiliary

**DeepSeek Harness 辅助模型插件：通过独立的模型路由提供视觉理解与上下文压缩能力。**

[English](README.md) | 简体中文

<a href="https://github.com/Gu-ZT/dsh-auxiliary/actions/workflows/npm-publish.yml">
  <img src="https://github.com/Gu-ZT/dsh-auxiliary/actions/workflows/npm-publish.yml/badge.svg" alt="Build Status">
</a>
<a href="https://www.npmjs.com/package/dsh-auxiliary">
  <img src="https://img.shields.io/npm/v/dsh-auxiliary.svg?sanitize=true" alt="Version">
</a>
<a href="https://www.npmjs.com/package/dsh-auxiliary">
  <img src="https://img.shields.io/npm/l/dsh-auxiliary.svg?sanitize=true" alt="License">
</a>

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

复制下面的内容，粘贴给 DSH Agent（本 Web GUI 中的助手）。由 Agent 帮你完成安装与验证，无需手动执行 npm 或编辑 profile 配置：

```text
把 dsh-auxiliary 插件安装到我指定的 profile（如果我没说，先问我）。npm 包名为 `dsh-auxiliary`；使用 GitHub 源 `github:Gu-ZT/dsh-auxiliary`，本地开发可用 `file:<路径>`。

步骤：
1. 添加插件依赖：`dsh plugin --profile <PROFILE> add dsh-auxiliary`（或我 profile 对应的插件管理器命令）。
2. 该包声明了 `prepack` 构建脚本。若 pnpm 报 `ERR_PNPM_IGNORED_BUILDS`，在 profile 的 `pnpm-workspace.yaml`（`allowBuilds`）中批准构建后重试。
3. 确认 profile 的 `cordis.patch.yml` 中有 dsh-auxiliary 的 insert 条目（`name: dsh-auxiliary`，`config: { tool: { enabled: true } }`）。`dsh plugin add` 有时只更新 `package.json`——若 insert 缺失，请自行补上。
4. 验证 `node_modules/dsh-auxiliary` 存在已构建的 `lib/` 目录（至少 `lib/index.js` 与 `lib/client.js`）。若构建产物缺失，在插件目录运行 `npm run build` 后重新 add。
5. 不要启动 profile——只安装并验证，然后报告你改动了什么。
```

安装完成后，在 Web 的 **设置 → 辅助模型** 中配置各路由即可。

## 配置

所有字段均可选，括号内为默认值。

```yaml
- name: dsh-auxiliary
  config:
    vision:
      maxTokens: 2048                      # inspect_image 输出上限（provider/model 由设置页写入）
      handoff: true                        # 主模型不支持图片时，聊天图片以引用形式发送并由 describe_image 转交
    tool:
      enabled: true                        # 注册 inspect_image 工具
      maxImageBytes: 10485760              # 单文件大小上限
      timeoutMs: 120000                    # 协作式工具调用预算
    compact:
      enabled: false                       # 把压缩摘要改路由到辅助模型
      provider: ""                         # 示例：deepseek-official（已注册的提供商路由 id）
      model: ""                            # 示例：deepseek-chat（该提供商下的模型 id）
    approve:
      enabled: false                       # 为 dsh-command-approve-for-me 的审查提供独立模型
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

![辅助模型设置页](docs/image.png)

插件自带一个 Web 设置分区（**设置 → 辅助模型**）。先在「模型」页配置好提供商及其模型，再回到这里配置两张独立卡片：**视觉理解**有自己的 `tool.enabled` 开关与 `vision.provider` / `vision.model`，**上下文压缩**有自己的 `compact.enabled` 开关与 `compact.provider` / `compact.model`。模型选择器把所有当前可用模型集中列出，并按提供商分组；已保存但暂时不在目录中的路由会保留，不会被自动替换。

对于用户配置的 `llm-pi-ai` 模型，请在 **设置 → 模型 → 提供商 → 自定义设置 → 模型目录 → 模型设置** 中声明图片能力。勾选 **允许图片输入** 时写入模型的标准 `input: [text, image]` 声明，取消勾选时写入 `input: [text]`；`inspect_image` 与主聊天附件校验会读取同一份能力声明。仅应在上游接口确实接受图片时启用，该声明不能让纯文本模型获得视觉能力。

若要使用设置页选择的视觉模型，请把图片放在 Host 可读取的工作区相对路径或绝对路径，再让智能体调用 `inspect_image`，例如：`请调用 inspect_image 分析 screenshots/error.png`。

### 图片转交（主模型为纯文本时的聊天图片）

**图片转交**（`vision.handoff`，默认开启）启用且已选择视觉提供商/模型后，在聊天中附加图片不再因为主模型不支持图片而失败，而是按以下流程工作：

1. 对未声明图片输入的模型，图片受理预检会被放行（运行时包装 `ctx.llm.resolveModelInfo`，在转交启用期间声明图片输入；模型目录与按模型的能力复选框不受影响，因为它们直接读取设置文档）。
2. 监听官方 `llm/stream` waterfall：在适配器看到图片之前，把图片块替换成文本引用 `[image: {"attachmentId":…,"mediaType":…}]`，纯文本主模型永远不会收到图片负载（`inspect_image` 等视觉路由调用不受影响）。
3. 系统提示引导主模型用引用中的 JSON 调用 `describe_image`；该工具读取已存储的附件字节并询问所选视觉模型，返回的文字描述被注入到对话中。

引用是纯文本，因此重启、fork 与历史重放后依然可用。关闭 `vision.handoff` 可恢复原来的拒绝行为。两个挂接点都在插件内，核心包零修改。

### 审批模型（dsh-command-approve-for-me 联动）

[dsh-command-approve-for-me](https://github.com/ZhuRuoLing/dsh-command-approve-for-me) 提供类 Codex 的自动审批；在 `review` 模式下，每条审批提示由轻量审查模型裁决。默认审查模型继承请求方会话的模型路由（或该插件自身的 `reviewProvider` / `reviewModel` 配置）。本插件的 **审批模型** 卡片（`approve.enabled` 加 `approve.provider` / `approve.model`）为审查提供独立模型：

1. 监听官方 `llm/stream` waterfall，按公开契约识别审查调用——用户消息中的固定标记 `>>> APPROVAL REQUEST START`、无 `sessionId`、`temperature: 0`——并将其改路由到 `approve.provider` / `approve.model`。
2. 调用其余部分（安全策略、转录、超时、重试、回退）仍归 approve-for-me 插件所有，只替换模型路由；裁决依旧不会写入会话历史。

路由仅在功能开启且路由完整时激活；未安装该插件时不存在审查调用，监听器自然闲置。审查建议选择便宜快速的模型。生效前提：approve-for-me 处于 `mode: review` 且会话选中 `approve-for-me` 或 `strict-review` 权限预设。

设置页会检测插件是否安装：插件通过可选的 `webServer` 服务提供只读 JSON 端点 `/dsh-auxiliary/state`（`{ "approvePluginInstalled": true|false }`）；当插件的预设不在 `permissionPresets` 实时表中时，「审批模型」卡片显示"未检测到插件"提示并禁用编辑。端点仅监听本机回环、不返回敏感数据，headless profile 中不会注册。

### 子代理模型

```yaml
subagent:
  enabled: true
  provider: anvilcraft-ai
  model: deepseek-chat
```

子代理默认继承父会话的模型路由。开启此功能且路由完整时，所有委派子代理——一次性 spawn/fork 委托、可续接子代理（含进程内冷恢复）——统一使用所选模型。插件监听 `agent/created`，对委派深度 > 0 的代理在其自身作用域上下文中安装 `agent/request` waterfall 监听；返回替换后的 `LlmCallConfig` 是 loop 官方的"切换"契约，变更的头快照与其他模型切换一样被记录。远程提供方（ACP）创建的子代理不经过本机代理注册，仍继承父会话。建议选择便宜快速的模型控制委派成本。此功能不需要任何外部插件。

### 标题生成模型

```yaml
title:
  enabled: true
  provider: anvilcraft-ai
  model: deepseek-chat
```

会话标题由 `dsh-session-title-llm` 提供方发起，其自带部署层 `provider`/`model` 配置。开启此功能且路由完整时，所有 `purpose: 'session-title'` 调用统一改走所选模型，不动提供方自身的配置与主会话路由。识别使用官方的 `GenerateOptions.purpose` 标记，不会与 agent-loop、压缩或审批调用混淆。与压缩路由一样，监听器常驻安装、路由不完整时纯透传。

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

/**
 * Browser-half copy dictionaries for the dsh-auxiliary settings section.
 * zh is the key source, en mirrors every key (bilingual balance enforced at
 * registration). @module dsh-auxiliary/client/locales
 */

export const zh = {
  /** Settings nav label. */
  nav: '辅助模型',
  /** Intro explaining the independent feature cards. */
  intro: '分别配置视觉理解与上下文压缩。两项功能各自有启用开关和模型路由；这里的模型均复用「模型」页中已配置的提供商。',
  /** Loading state. */
  loading: '加载中…',
  /** Load/save failure prefix. */
  error: '失败：',
  /** The plugin namespace cannot be saved through the current settings seam. */
  settingsUnavailable: '当前无法访问此插件的设置，不能保存选择。',
  /** The Host settings provider is read-only. */
  settingsReadOnly: '当前设置为只读，不能保存选择。',
  /** One or more providers failed to return a model catalog. */
  catalogFailure: '以下提供商的模型目录加载失败：',
  /** No active provider group has a catalog model. */
  noProvider: '当前没有可用模型。请先在「模型」页添加并启用提供商，再回到这里选择；已保存但暂不可用的路由不会被自动替换。',
  /** Vision feature card heading. */
  visionTitle: '视觉理解',
  /** Vision feature card explanation. */
  visionDescription: '控制 `inspect_image` 工具及其视觉模型。开启但尚未选择模型仍是合法配置；调用工具时会明确提示缺少视觉路由。',
  /** Vision feature switch label. */
  visionToggle: '启用 inspect_image',
  /** Vision picker label. */
  visionPickerLabel: '视觉模型（需支持图片输入）',
  /** Exact distinction between inspect_image and chat image attachments. */
  visionUsage: '此选择只供 inspect_image 读取 Host 上的本地图片；聊天附件仍由当前会话主模型决定。若聊天框提示“当前模型不支持图片”，请切换底部的主模型；要使用这里的视觉模型，请让智能体调用 inspect_image。',
  /** Compaction feature card heading. */
  compactTitle: '上下文压缩',
  /** Compaction feature card explanation. */
  compactDescription: '控制 `purpose: compaction` 摘要调用是否改用独立的 compact 模型路由。',
  /** Compaction feature switch label. */
  compactToggle: '启用压缩辅助路由',
  /** Compaction picker label. */
  compactPickerLabel: '压缩模型',
  /** Engine reuse explanation. */
  compactUsage: '开启但没有完整 provider/model route 时保持现有 pass-through 行为。`engine` 没有第三个模型选择器；启用压缩引擎时，它复用这里的 compact 路由。',
  /** Model picker trigger placeholder. */
  pickerPlaceholder: '选择提供商和模型',
  /** Model picker empty state. */
  pickerEmpty: '当前没有可选择的模型。',
  /** Stale saved route notice. */
  pickerUnavailable: '已保存的路由当前不可用',
  /** Model picker accessible list label. */
  pickerListLabel: '按提供商分组的模型列表',
  /** Save button. */
  save: '保存',
  /** In-progress save label. */
  saving: '保存中…',
  /** Saved confirmation. */
  saved: '已保存',
  /** Structured settings conflict message. */
  settingsConflict: '设置已被其他窗口或进程修改。当前草稿已保留，请重新保存以应用它。',
  /** Local half-route validation message. */
  routeIncomplete: '提供商和模型必须同时选择，或同时留空。',
};

/** Keys of the dsh-auxiliary surface copy. */
export type AuxiliaryKey = keyof typeof zh;

export const en: Record<AuxiliaryKey, string> = {
  nav: 'Auxiliary Models',
  intro: 'Configure vision understanding and context compaction independently. Each feature has its own switch and model route, reusing providers configured on the Models page.',
  loading: 'Loading…',
  error: 'Failed:',
  settingsUnavailable: 'This plugin’s settings are unavailable, so the selection cannot be saved.',
  settingsReadOnly: 'Settings are read-only, so the selection cannot be saved.',
  catalogFailure: 'Model catalog lookup failed for:',
  noProvider: 'No models are currently available. Add and enable a provider on the Models page first; a saved route that is temporarily unavailable is never replaced automatically.',
  visionTitle: 'Vision understanding',
  visionDescription: 'Controls the `inspect_image` tool and its vision model. Enabling it without a selected model remains valid; a tool call reports that the vision route is missing.',
  visionToggle: 'Enable inspect_image',
  visionPickerLabel: 'Vision model (must support image input)',
  visionUsage: 'This route is only for `inspect_image` reading local images on the Host; chat attachments still use the current session’s main model. If the composer says the current model does not support images, switch the main model there; to use this vision route, ask the agent to call `inspect_image`.',
  compactTitle: 'Context compaction',
  compactDescription: 'Controls whether `purpose: compaction` summaries use the independent compact model route.',
  compactToggle: 'Enable auxiliary compaction route',
  compactPickerLabel: 'Compaction model',
  compactUsage: 'An enabled feature without a complete provider/model route keeps the existing pass-through behavior. `engine` has no third model picker; when enabled, the compression engine reuses this compact route.',
  pickerPlaceholder: 'Choose a provider and model',
  pickerEmpty: 'No selectable models are available.',
  pickerUnavailable: 'Saved route is currently unavailable',
  pickerListLabel: 'Models grouped by provider',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved',
  settingsConflict: 'Settings changed in another window or process. Your draft was kept; save again to apply it.',
  routeIncomplete: 'Provider and model must both be selected, or both be left empty.',
};

/**
 * Browser-half copy dictionaries for the dsh-auxiliary settings section.
 * zh is the key source, en mirrors every key (bilingual balance enforced at
 * registration). @module dsh-auxiliary/client/locales
 */

export const zh = {
  /** Settings nav label. */
  nav: '辅助模型',
  /** Section intro paragraph. */
  intro: '选择「模型」页中已经配置好的提供商与模型，作为 inspect_image 读取图片时使用的视觉模型。此选择只影响 inspect_image；压缩摘要的模型由 compact 配置独立决定。',
  /** Provider select label. */
  providerLabel: '提供商',
  /** Model select label. */
  modelLabel: '模型（需支持图片输入）',
  /** How the selected model is used and how to supply an image. */
  imageUsage: '此选择仅供 inspect_image 使用，不会启用聊天框图片附件。图片需位于 Host 可读的工作区或绝对路径，并在消息中要求智能体调用 inspect_image。',
  /** Save button. */
  save: '保存',
  /** Saved confirmation. */
  saved: '已保存',
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
  /** No selectable provider (none active with catalog models). */
  noProvider: '没有可选择的提供商。请先在「模型」页添加并启用提供商（且它至少提供一个模型），再回到这里选择。',
};

/** Keys of the dsh-auxiliary surface copy. */
export type AuxiliaryKey = keyof typeof zh;

export const en: Record<AuxiliaryKey, string> = {
  nav: 'Auxiliary Models',
  intro: 'Pick the provider and model already configured in Models as the vision model inspect_image uses to read images. This selection only affects inspect_image; compaction summaries use the separate compact provider/model setting.',
  providerLabel: 'Provider',
  modelLabel: 'Model (must support image input)',
  imageUsage: 'This selection is only for inspect_image and does not enable chat image attachments. Put the image in a Host-readable workspace or use an absolute path, then ask the agent to call inspect_image.',
  save: 'Save',
  saved: 'Saved',
  loading: 'Loading…',
  error: 'Failed:',
  settingsUnavailable: 'This plugin’s settings are unavailable, so the selection cannot be saved.',
  settingsReadOnly: 'Settings are read-only, so the selection cannot be saved.',
  catalogFailure: 'Model catalog lookup failed for:',
  noProvider: 'No selectable providers. Add and enable a provider in the Models page first (it must advertise at least one model), then come back to pick it.',
};

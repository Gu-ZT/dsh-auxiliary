/**
 * Browser-half copy dictionaries for the dsh-auxiliary settings section.
 * zh is the key source, en mirrors every key (bilingual balance enforced at
 * registration). @module dsh-auxiliary/client/locales
 */

export const zh = {
  /** Settings nav label. */
  nav: '辅助模型',
  /** Section intro paragraph. */
  intro: '选择「模型」页中已经配置好的提供商与模型，用于辅助任务——inspect_image 使用的视觉模型，以及（启用时）压缩摘要的模型。',
  /** Provider select label. */
  providerLabel: '提供商',
  /** Model select label. */
  modelLabel: '模型',
  /** Save button. */
  save: '保存',
  /** Saved confirmation. */
  saved: '已保存',
  /** Loading state. */
  loading: '加载中…',
  /** Load/save failure prefix. */
  error: '失败：',
  /** No configurable provider yet. */
  noProvider: '未找到可配置的提供商。请先在「模型」页配置一个。',
  /** Selected provider advertises no models. */
  noModel: '该提供商没有可用的模型。',
};

/** Keys of the dsh-auxiliary surface copy. */
export type AuxiliaryKey = keyof typeof zh;

export const en: Record<AuxiliaryKey, string> = {
  nav: 'Auxiliary Models',
  intro: 'Pick the provider and model already configured in Models for auxiliary work — the vision model used by inspect_image, and (when enabled) compaction summaries.',
  providerLabel: 'Provider',
  modelLabel: 'Model',
  save: 'Save',
  saved: 'Saved',
  loading: 'Loading…',
  error: 'Failed:',
  noProvider: 'No configurable providers found. Configure one in the Models page first.',
  noModel: 'This provider advertises no models.',
};

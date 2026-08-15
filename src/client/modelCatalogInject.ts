/**
 * Model-catalog capability injection.
 *
 * The DSH Models settings page (dsh-client-ui-settings-models) does not expose
 * a slot inside its model rows, so this module injects "Allow image input" and
 * "Allow image generation" checkboxes directly into each editable llm-pi-ai
 * model row's advanced area. It never edits the core package: the page is
 * React-rendered and re-renders freely, so a MutationObserver re-applies the
 * injection whenever the DOM is rebuilt, and every write goes through the same
 * `llm-pi-ai` settings namespace the Models page itself writes.
 *
 * Provider/model identity is read from the settings document (data-driven),
 * not scraped from the DOM, so only user-owned llm-pi-ai model rows are ever
 * touched and DeepSeek-catalog rows are ignored by construction.
 *
 * @module dsh-auxiliary/client/modelCatalogInject
 */
import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import {
  loadModelGenerationCapability,
  loadModelImageCapability,
  saveModelGenerationCapability,
  saveModelImageCapability,
} from './api.js';

/** Marker attribute on an injected checkbox so a rebuild never double-injects. */
const MARK_IMAGE_INPUT = 'data-dsh-aux-image-input';
/** Marker attribute on an injected image-generation checkbox. */
const MARK_IMAGE_GEN = 'data-dsh-aux-image-gen';
/** aria-label prefixes of the model-id text input on both shipped languages. */
const MODEL_ID_LABELS = ['模型 ID ', 'Model ID '];
/** Aria labels of the per-row disclosure control (the page's own copy). */
const ADVANCED_LABELS = ['容量 ', 'Capacities ', '模型设置 ', 'Model settings '];

/** Copy keys one injected capability checkbox renders. */
type CapabilityCopyKey =
  | 'imageCapabilityToggle' | 'imageCapabilityDescription' | 'imageCapabilityLoading'
  | 'imageGenToggle' | 'imageGenDescription' | 'imageGenLoading';

/** One injected capability checkbox: marker, copy, and the row read/write pair. */
interface CapabilitySpec {
  mark: string;
  copy: {
    toggle: CapabilityCopyKey;
    description: CapabilityCopyKey;
    loading: CapabilityCopyKey;
  };
  load: (api: IApiClient, provider: string, model: string) => Promise<{ supported: boolean; writable: boolean }>;
  save: (api: IApiClient, provider: string, model: string, supported: boolean) => Promise<unknown>;
}

/** The two injected capabilities, in display order. */
const CAPABILITIES: readonly CapabilitySpec[] = [
  {
    mark: MARK_IMAGE_INPUT,
    copy: {
      toggle: 'imageCapabilityToggle',
      description: 'imageCapabilityDescription',
      loading: 'imageCapabilityLoading',
    },
    load: loadModelImageCapability,
    save: saveModelImageCapability,
  },
  {
    mark: MARK_IMAGE_GEN,
    copy: {
      toggle: 'imageGenToggle',
      description: 'imageGenDescription',
      loading: 'imageGenLoading',
    },
    load: loadModelGenerationCapability,
    save: saveModelGenerationCapability,
  },
];

/** Capability state rendered by one injected checkbox. */
interface CheckboxState {
  provider: string;
  model: string;
  supported: boolean;
  writable: boolean;
  busy: boolean;
}

/** Match a model-row input's aria-label prefix. */
function isModelIdInput(element: Element): boolean {
  const label = element.getAttribute('aria-label');
  return label !== null && MODEL_ID_LABELS.some((prefix) => label.startsWith(prefix));
}

/** The model row's advanced disclosure button, when present. */
function advancedTriggerOf(entry: Element): HTMLButtonElement | null {
  const buttons = entry.querySelectorAll<HTMLButtonElement>('button');
  for (const button of buttons) {
    const label = button.getAttribute('aria-label');
    if (label !== null && ADVANCED_LABELS.some((prefix) => label.startsWith(prefix))) return button;
  }
  return null;
}

/** The expanded advanced container of a model row, or null while collapsed. */
function advancedAreaOf(entry: Element): HTMLElement | null {
  const trigger = advancedTriggerOf(entry);
  if (trigger === null || trigger.getAttribute('aria-expanded') !== 'true') return null;
  const row = entry.firstElementChild as HTMLElement | null;
  const candidates = Array.from(entry.children).filter((child) => child !== row);
  return candidates.length === 0 ? null : candidates[candidates.length - 1] as HTMLElement;
}

/** Build one injected control, wiring its state read and write. */
function buildCheckbox(
  api: IApiClient,
  t: TranslateNS<'dsh-auxiliary'>,
  provider: string,
  model: string,
  spec: CapabilitySpec,
): HTMLElement {
  const state: CheckboxState = { provider, model, supported: false, writable: true, busy: true };

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = false;
  input.disabled = true;
  input.style.height = '16px';
  input.style.margin = '0';
  input.style.width = '16px';

  const label = document.createElement('span');
  label.textContent = t(spec.copy.toggle);

  const row = document.createElement('label');
  row.style.alignItems = 'center';
  row.style.display = 'flex';
  row.style.gap = '8px';
  row.style.minHeight = '36px';
  row.append(input, label);

  const hint = document.createElement('span');
  hint.style.color = 'var(--dsw-alias-label-tertiary)';
  hint.style.fontSize = '12px';
  hint.style.lineHeight = '18px';
  hint.textContent = t(spec.copy.description);

  const box = document.createElement('div');
  box.setAttribute(spec.mark, `${provider}\u0000${model}`);
  box.style.display = 'flex';
  box.style.flexDirection = 'column';
  box.style.gap = '4px';
  box.append(row, hint);

  const render = (): void => {
    input.checked = state.supported;
    input.disabled = state.busy || !state.writable;
    hint.textContent = state.busy ? t(spec.copy.loading) : t(spec.copy.description);
  };

  void spec.load(api, provider, model).then((capability) => {
    state.supported = capability.supported;
    state.writable = capability.writable;
    state.busy = false;
    render();
  }).catch(() => {
    state.writable = false;
    state.busy = false;
    render();
  });

  input.addEventListener('change', () => {
    if (state.busy || !state.writable) return;
    const requested = input.checked;
    state.busy = true;
    render();
    void spec.save(api, provider, model, requested).then(() => {
      state.supported = requested;
      state.busy = false;
      render();
    }).catch(() => {
      state.supported = !requested;
      state.busy = false;
      render();
    });
  });

  return box;
}

/** Inject into one expanded model row when its advanced area is present. */
function injectRow(
  api: IApiClient,
  t: TranslateNS<'dsh-auxiliary'>,
  input: Element,
  provider: string,
  model: string,
): void {
  const entry = input.parentElement?.parentElement;
  if (entry === undefined || entry === null) return;
  const advanced = advancedAreaOf(entry);
  if (advanced === null) return;
  for (const spec of CAPABILITIES) {
    if (advanced.querySelector(`[${spec.mark}]`) !== null) continue;
    advanced.append(buildCheckbox(api, t, provider, model, spec));
  }
}

/** One sweep over the page: inject into every currently expanded pi-ai row. */
function sweep(
  api: IApiClient,
  t: TranslateNS<'dsh-auxiliary'>,
  entries: ReadonlyArray<{ provider: string; model: string }>,
): void {
  const inputs = document.querySelectorAll('input[aria-label]');
  for (const entry of entries) {
    for (const input of inputs) {
      if (!isModelIdInput(input)) continue;
      const value = (input as HTMLInputElement).value.trim();
      if (value === entry.model) injectRow(api, t, input, entry.provider, entry.model);
    }
  }
}

/** List every user-owned llm-pi-ai model row from the settings document. */
async function piAiModelEntries(api: IApiClient): Promise<Array<{ provider: string; model: string }>> {
  const response = await api.settings.describe({});
  if (!response.result.ok) return [];
  const namespace = response.result.value.namespaces.find((entry) => entry.ns === 'llm-pi-ai');
  if (namespace === undefined) return [];
  const user = namespace.user as { providers?: Record<string, { models?: Array<{ id?: unknown }> }> } | undefined;
  const providers = user?.providers;
  if (providers === undefined) return [];
  const rows: Array<{ provider: string; model: string }> = [];
  for (const [provider, profile] of Object.entries(providers)) {
    for (const model of profile?.models ?? []) {
      if (typeof model?.id === 'string' && model.id.length > 0) rows.push({ provider, model: model.id });
    }
  }
  return rows;
}

/**
 * Start watching the settings page and keeping the injected checkboxes fresh.
 * Returns a disposer that stops the observer and removes nothing else.
 */
export function startModelCatalogInjection(
  api: IApiClient,
  t: TranslateNS<'dsh-auxiliary'>,
): () => void {
  let entries: Array<{ provider: string; model: string }> = [];
  let scheduled = false;
  let disposed = false;

  const run = (): void => {
    if (disposed) return;
    sweep(api, t, entries);
  };

  const schedule = (): void => {
    if (scheduled || disposed) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (disposed) return;
      run();
    });
  };

  const refreshEntries = (): void => {
    void piAiModelEntries(api).then((next) => {
      if (disposed) return;
      entries = next;
      schedule();
    }).catch(() => { /* keep the last known rows */ });
  };

  refreshEntries();
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  schedule();

  return () => {
    disposed = true;
    observer.disconnect();
  };
}

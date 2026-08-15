/**
 * Model-catalog capability injection.
 *
 * The DSH Models settings page (dsh-client-ui-settings-models) does not expose
 * a slot inside its model rows, so this module injects "Allow image input" and
 * "Allow image generation" checkboxes directly into each editable llm-pi-ai
 * model row. It never edits the core package: the page is React-rendered and
 * re-renders freely, so a MutationObserver re-applies the injection whenever
 * the DOM is rebuilt, and every write goes through the same `llm-pi-ai`
 * settings namespace the Models page itself writes.
 *
 * Provider/model identity is read from the settings document (data-driven),
 * not scraped from the DOM. A row's provider card is resolved for attribution
 * only; the checkbox read/write always targets the `llm-pi-ai` namespace.
 *
 * Rows are classified by their saved state:
 * - **saved** (in `namespace.user`) → live checkboxes that read/write the
 *   settings document immediately;
 * - **new draft** (typed id, not saved, not a catalog row) → checkboxes that
 *   record a pending mark locally; the mark is written right after the model
 *   is saved by the page's Apply, so the user can set image capabilities
 *   while adding the model, not only after saving it;
 * - **catalog** (inherited from the composition base, not yet saved) → a
 *   notice to save the model first (the page does not persist catalog rows on
 *   Apply);
 * - **non-pi-ai** (e.g. the DeepSeek official adapter) → a notice that the
 *   marks are `llm-pi-ai`-only.
 *
 * The injected block is appended to the row itself, not to the page's
 * "capacities" disclosure, so the checkboxes are visible whether or not the
 * row is expanded.
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

/** Marker attribute on an injected capability block (one per model row). */
const MARK_BLOCK = 'data-dsh-aux-capabilities';
/** Marker attribute on an injected "cannot be marked" notice. */
const MARK_NOTICE = 'data-dsh-aux-notice';
/** Marker attribute on an injected image-input checkbox. */
const MARK_IMAGE_INPUT = 'data-dsh-aux-image-input';
/** Marker attribute on an injected image-generation checkbox. */
const MARK_IMAGE_GEN = 'data-dsh-aux-image-gen';
/** Marker attribute marking a block built for a not-yet-saved draft row. */
const MARK_DRAFT = 'data-dsh-aux-draft';
/** aria-label prefixes of the model-id text input on both shipped languages. */
const MODEL_ID_LABELS = ['模型 ID ', 'Model ID '];

/** Copy keys one injected capability checkbox renders. */
type CapabilityCopyKey =
  | 'imageCapabilityToggle' | 'imageCapabilityDescription' | 'imageCapabilityLoading'
  | 'imageGenToggle' | 'imageGenDescription' | 'imageGenLoading';

/** One injected capability checkbox: marker, copy, and the row read/write pair. */
interface CapabilitySpec {
  mark: 'data-dsh-aux-image-input' | 'data-dsh-aux-image-gen';
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

/** Pending (not-yet-saved) marks of one new model row, keyed by capability mark. */
type PendingFlags = Partial<Record<'data-dsh-aux-image-input' | 'data-dsh-aux-image-gen', boolean>>;

/** Pending marks for every draft row, keyed by `provider\0model`. */
type PendingMap = Map<string, PendingFlags>;

/** Provider-directory attribution of one model row. */
interface ProviderInfo {
  /** Provider route key (`anvilcraft-ai`, `deepseek-official`, …). */
  provider: string;
  /** Settings namespace of that route (`llm-pi-ai`, `llm-deepseek`, …). */
  settingsNs: string;
}

/** Match a model-row input's aria-label prefix. */
function isModelIdInput(element: Element): boolean {
  const label = element.getAttribute('aria-label');
  return label !== null && MODEL_ID_LABELS.some((prefix) => label.startsWith(prefix));
}

/** Key of one model row inside the pending map. */
function rowKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`;
}

/**
 * Build one injected control. In draft mode the toggle only records a pending
 * mark (the row is not saved yet); otherwise it reads/writes the settings
 * document through the spec's load/save pair.
 */
function buildCheckbox(
  api: IApiClient,
  t: TranslateNS<'dsh-auxiliary'>,
  provider: string,
  model: string,
  spec: CapabilitySpec,
  draft: boolean,
  pending: PendingMap,
): HTMLElement {
  const key = rowKey(provider, model);
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

  if (draft) {
    // Draft row: reflect the pending mark, toggle only updates the pending map.
    state.supported = pending.get(key)?.[spec.mark] === true;
    state.writable = true;
    state.busy = false;
    render();
    input.addEventListener('change', () => {
      state.supported = input.checked;
      pending.set(key, { ...pending.get(key), [spec.mark]: state.supported });
      render();
    });
    return box;
  }

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

/** Build the always-visible capability block for one model row. */
function buildCapabilityBlock(
  api: IApiClient,
  t: TranslateNS<'dsh-auxiliary'>,
  provider: string,
  model: string,
  draft: boolean,
  pending: PendingMap,
): HTMLElement {
  const block = document.createElement('div');
  block.setAttribute(MARK_BLOCK, `${provider}\u0000${model}`);
  if (draft) block.setAttribute(MARK_DRAFT, '');
  block.style.borderTop = '1px solid var(--dsw-alias-border-l2)';
  block.style.display = 'flex';
  block.style.flexDirection = 'column';
  block.style.gap = '4px';
  block.style.marginTop = '8px';
  block.style.padding = '8px 4px 2px';
  for (const spec of CAPABILITIES) block.append(buildCheckbox(api, t, provider, model, spec, draft, pending));
  return block;
}

/** Build the plain-text notice shown on rows that cannot carry the marks yet. */
function buildNotice(t: TranslateNS<'dsh-auxiliary'>, key: 'imageCapabilityUnsupported' | 'imageCapabilitySaveFirst'): HTMLElement {
  const notice = document.createElement('div');
  notice.setAttribute(MARK_NOTICE, '');
  notice.style.color = 'var(--dsw-alias-label-tertiary)';
  notice.style.fontSize = '12px';
  notice.style.lineHeight = '18px';
  notice.style.padding = '8px 4px 2px';
  notice.textContent = t(key);
  return notice;
}

/** The model row wrapper (one `modelEntry`), or null when the DOM moved. */
function entryOf(input: Element): HTMLElement | null {
  const entry = input.parentElement?.parentElement;
  return entry instanceof HTMLElement ? entry : null;
}

/**
 * Inject checkboxes into one model row. A stale block (different model id or a
 * draft block that has since been saved) is rebuilt; a fresh one is kept.
 */
function injectRow(
  api: IApiClient,
  t: TranslateNS<'dsh-auxiliary'>,
  input: Element,
  provider: string,
  model: string,
  draft: boolean,
  pending: PendingMap,
): void {
  const entry = entryOf(input);
  if (entry === null) return;
  const key = rowKey(provider, model);
  const existing = entry.querySelector(`[${MARK_BLOCK}]`);
  if (existing !== null) {
    const fresh = existing.getAttribute(MARK_BLOCK) === key
      && (existing.hasAttribute(MARK_DRAFT) === draft);
    if (fresh) return;
    existing.remove();
  }
  entry.querySelector(`[${MARK_NOTICE}]`)?.remove();
  entry.append(buildCapabilityBlock(api, t, provider, model, draft, pending));
}

/** Inject the "cannot be marked yet" notice into one row, replacing any stale block. */
function injectNotice(
  input: Element,
  t: TranslateNS<'dsh-auxiliary'>,
  key: 'imageCapabilityUnsupported' | 'imageCapabilitySaveFirst',
): void {
  const entry = entryOf(input);
  if (entry === null) return;
  entry.querySelector(`[${MARK_BLOCK}]`)?.remove();
  if (entry.querySelector(`[${MARK_NOTICE}]`) !== null) return;
  entry.append(buildNotice(t, key));
}

/**
 * Resolve the provider card a model row belongs to. The model editor lives
 * inside the provider's `li` card, whose head carries the provider display
 * name; the display name is matched against the live provider directory.
 * @returns the provider route and its settings namespace, or undefined.
 */
function providerInfoOf(input: Element, providersByDisplay: Map<string, ProviderInfo>): ProviderInfo | undefined {
  const card = input.closest('li');
  if (card === null) return undefined;
  for (const span of card.querySelectorAll('span')) {
    const text = span.textContent?.trim() ?? '';
    if (text.length === 0) continue;
    const info = providersByDisplay.get(text);
    if (info !== undefined) return info;
  }
  return undefined;
}

/**
 * Write pending marks for rows that have since been saved by the page's Apply.
 * A pending mark is only applied once its model exists in the user section;
 * the draft checkbox therefore works before saving, and the mark lands right
 * after the model is persisted.
 * @returns whether any pending mark was applied (callers may resweep).
 */
async function applyPendingMarks(
  api: IApiClient,
  entries: ReadonlyArray<{ provider: string; model: string }>,
  pending: PendingMap,
): Promise<boolean> {
  let applied = false;
  for (const [key, flags] of pending) {
    const sep = key.indexOf('\u0000');
    const provider = key.slice(0, sep);
    const model = key.slice(sep + 1);
    if (!entries.some((entry) => entry.provider === provider && entry.model === model)) continue;
    try {
      if (flags['data-dsh-aux-image-input'] !== undefined) {
        await saveModelImageCapability(api, provider, model, flags['data-dsh-aux-image-input']);
      }
      if (flags['data-dsh-aux-image-gen'] !== undefined) {
        await saveModelGenerationCapability(api, provider, model, flags['data-dsh-aux-image-gen']);
      }
    } catch {
      continue; // keep the pending mark; a later sweep retries.
    }
    pending.delete(key);
    applied = true;
  }
  return applied;
}

/** One sweep over the page: mark every pi-ai row, explain every other row. */
function sweep(
  api: IApiClient,
  t: TranslateNS<'dsh-auxiliary'>,
  entries: ReadonlyArray<{ provider: string; model: string }>,
  catalogKeys: ReadonlySet<string>,
  providersByDisplay: Map<string, ProviderInfo>,
  pending: PendingMap,
): void {
  const inputs = document.querySelectorAll('input[aria-label]');
  for (const input of inputs) {
    if (!isModelIdInput(input)) continue;
    const value = (input as HTMLInputElement).value.trim();
    // Empty rows are edits in progress; leave them alone until an id exists.
    if (value.length === 0) continue;
    const info = providerInfoOf(input, providersByDisplay);
    if (info === undefined) continue;
    const saved = entries.some((entry) => entry.provider === info.provider && entry.model === value);
    if (saved || info.settingsNs === 'llm-pi-ai') {
      // Saved row → live checkboxes. New draft row under a pi-ai provider →
      // draft checkboxes (marks land after Apply). A catalog row that is not
      // saved yet cannot be persisted by the page, so it keeps a notice.
      const draft = !saved && info.settingsNs === 'llm-pi-ai' && !catalogKeys.has(rowKey(info.provider, value));
      if (saved || draft) {
        injectRow(api, t, input, info.provider, value, draft, pending);
        continue;
      }
    }
    // Not a user-owned pi-ai model: explain instead of staying silent.
    injectNotice(input, t, info.settingsNs === 'llm-pi-ai' ? 'imageCapabilitySaveFirst' : 'imageCapabilityUnsupported');
  }
}

/** Read the user-owned rows and the composition-base catalog of llm-pi-ai. */
async function piAiModelState(api: IApiClient): Promise<{
  entries: Array<{ provider: string; model: string }>;
  catalogKeys: Set<string>;
}> {
  const response = await api.settings.describe({});
  if (!response.result.ok) return { entries: [], catalogKeys: new Set() };
  const namespace = response.result.value.namespaces.find((entry) => entry.ns === 'llm-pi-ai');
  if (namespace === undefined) return { entries: [], catalogKeys: new Set() };
  const user = namespace.user as { providers?: Record<string, { models?: Array<{ id?: unknown }> }> } | undefined;
  const base = namespace.base as { providers?: Record<string, { models?: Array<{ id?: unknown }> }> } | undefined;
  const rows: Array<{ provider: string; model: string }> = [];
  const catalogKeys = new Set<string>();
  for (const [provider, profile] of Object.entries(user?.providers ?? {})) {
    for (const model of profile?.models ?? []) {
      if (typeof model?.id === 'string' && model.id.length > 0) rows.push({ provider, model: model.id });
    }
  }
  for (const [provider, profile] of Object.entries(base?.providers ?? {})) {
    for (const model of profile?.models ?? []) {
      if (typeof model?.id === 'string' && model.id.length > 0) catalogKeys.add(rowKey(provider, model.id));
    }
  }
  return { entries: rows, catalogKeys };
}

/** Map every provider display name to its route and settings namespace. */
async function providerDirectory(api: IApiClient): Promise<Map<string, ProviderInfo>> {
  const response = await api.llm.providers({});
  if (!response.result.ok) return new Map();
  const providers = new Map<string, ProviderInfo>();
  for (const provider of response.result.value.providers) {
    if (typeof provider.displayName === 'string' && provider.displayName.length > 0) {
      providers.set(provider.displayName, { provider: provider.provider, settingsNs: provider.settingsNs });
    }
  }
  return providers;
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
  let catalogKeys: Set<string> = new Set();
  let providersByDisplay: Map<string, ProviderInfo> = new Map();
  const pending: PendingMap = new Map();
  let scheduled = false;
  let refreshTimer: number | undefined;
  let disposed = false;

  const run = async (): Promise<void> => {
    if (disposed) return;
    // Rows saved since the last sweep get their pending marks written first.
    const applied = await applyPendingMarks(api, entries, pending).catch(() => false);
    if (disposed) return;
    sweep(api, t, entries, catalogKeys, providersByDisplay, pending);
    // The writes may have changed the document; let the debounced re-read
    // refresh entries so the next sweep rebuilds those rows as saved.
    if (applied) schedule();
  };

  const schedule = (): void => {
    if (disposed) return;
    // Sweep immediately with the current rows (cheap DOM pass)…
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        if (disposed) return;
        void run();
      });
    }
    // …and re-read the settings document after the DOM settles so rows saved
    // while the page stayed open (newly added models) get injected too. The
    // settings API has no change subscription, so a debounced re-read is the
    // cheapest reliable trigger.
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = undefined;
      if (disposed) return;
      void Promise.all([piAiModelState(api), providerDirectory(api)]).then(([state, providers]) => {
        if (disposed) return;
        const changed = state.entries.length !== entries.length
          || state.catalogKeys.size !== catalogKeys.size
          || providers.size !== providersByDisplay.size
          || state.entries.some((entry, index) => {
            const current = entries[index];
            return current === undefined || current.provider !== entry.provider || current.model !== entry.model;
          })
          || [...state.catalogKeys].some((key) => !catalogKeys.has(key))
          || [...providers.entries()].some(([display, info]) => {
            const current = providersByDisplay.get(display);
            return current === undefined || current.provider !== info.provider || current.settingsNs !== info.settingsNs;
          });
        if (changed) {
          entries = state.entries;
          catalogKeys = state.catalogKeys;
          providersByDisplay = providers;
          run();
        }
      }).catch(() => { /* keep the last known rows */ });
    }, 150);
  };

  const refreshEntries = (): void => {
    void Promise.all([piAiModelState(api), providerDirectory(api)]).then(([state, providers]) => {
      if (disposed) return;
      entries = state.entries;
      catalogKeys = state.catalogKeys;
      providersByDisplay = providers;
      schedule();
    }).catch(() => { /* keep the last known rows */ });
  };

  refreshEntries();
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  schedule();

  return () => {
    disposed = true;
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    observer.disconnect();
  };
}

/**
 * Browser-side Host data access for the dsh-auxiliary settings section. All
 * reads and writes use the connection's ApiProxy (`llm.*` / `settings.*`), so
 * the settings page shares the Host's provider directory and namespace writer.
 *
 * @module dsh-auxiliary/client/api
 */
import type {
  ConfigurableProviderView,
  IApiClient,
  ModelCatalogFailure,
  ModelCatalogModel,
  ModelProviderGroup as HostModelProviderGroup,
  RpcError,
  RpcResponse,
  SettingsNamespaceView,
} from '@deepseek-ai/dsh-client-connection/client';

/** One configurable provider row returned by the live route directory. */
export interface ProviderOption {
  /** Provider route key (`anvilcraft-ai`, `deepseek-official`, …). */
  id: string;
  /** Human-readable provider name. */
  name: string;
  /** Whether the route is currently registered and requestable. */
  active: boolean;
}

/** One model entry retained inside a provider group. */
export type ModelOption = ModelCatalogModel;

/** One provider group retained from `llm.models`. */
export type ModelProviderGroup = HostModelProviderGroup;

/** Host model catalog, preserving provider groups and lookup diagnostics. */
export interface ModelCatalog {
  /** Successful groups in provider-directory order. */
  groups: readonly ModelProviderGroup[];
  /** Non-fatal lookup failures reported by the Host. */
  failures: readonly ModelCatalogFailure[];
}

/** A possibly stale provider/model route stored in the auxiliary namespace. */
export interface AuxRoute {
  provider?: string;
  model?: string;
}

/** One independently configurable auxiliary feature. */
export interface AuxFeatureSettings extends AuxRoute {
  enabled: boolean;
}

/** Complete decoded auxiliary namespace state used by the settings page. */
export interface AuxSettings {
  /** `tool.enabled` plus the `vision` provider/model route. */
  vision: AuxFeatureSettings;
  /** `compact.enabled` plus the compact provider/model route. */
  compact: AuxFeatureSettings;
  /** Namespace revision for the next optimistic-concurrency write. */
  revision?: number;
  /** Whether the namespace is exposed by the current Host. */
  available: boolean;
  /** Whether the current settings provider accepts writes. */
  writable: boolean;
}

/** Complete settings snapshot returned after a successful feature write. */
export interface AuxSettingsSnapshot {
  vision: AuxFeatureSettings;
  compact: AuxFeatureSettings;
  revision: number;
}

/** Feature names accepted by the atomic auxiliary settings writer. */
export type AuxFeature = 'vision' | 'compact';

/** Draft shape submitted by one feature card. */
export interface AuxFeatureDraft extends AuxRoute {
  enabled: boolean;
}

/** Additional local validation code used before an RPC write. */
type LocalAuxiliaryErrorCode = 'invalid-route';

/** Structured error raised by an auxiliary API operation. */
export class AuxiliaryApiError extends Error {
  /** Machine-readable RPC or local validation code. */
  readonly code: RpcError['code'] | LocalAuxiliaryErrorCode;
  /** Wire details when the Host supplied them. */
  readonly details: unknown;

  constructor(
    code: RpcError['code'] | LocalAuxiliaryErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'AuxiliaryApiError';
    this.code = code;
    this.details = details;
  }
}

/** Unwrap a unary RPC response without discarding its discriminant code. */
function valueOf<T>(response: RpcResponse<T>): T {
  if (!response.result.ok) {
    throw new AuxiliaryApiError(
      response.result.error.code,
      response.result.error.message,
      response.result.error.details,
    );
  }
  return response.result.value;
}

/** List every configurable provider from the live route registry. */
export async function loadProviders(api: IApiClient): Promise<ProviderOption[]> {
  const value = valueOf(await api.llm.providers({}));
  return value.providers.map((entry: ConfigurableProviderView) => ({
    id: entry.provider,
    name: entry.displayName,
    active: entry.active,
  }));
}

/**
 * Load the model catalog while retaining its provider groups and failures.
 * Inactive provider routes remain out of the selectable groups even if their
 * last catalog response is still present.
 */
export async function loadModels(api: IApiClient): Promise<ModelCatalog> {
  const [providers, response] = await Promise.all([
    loadProviders(api),
    api.llm.models({}),
  ]);
  const value = valueOf(response);
  const activeProviders = new Set(providers.filter((provider) => provider.active).map((provider) => provider.id));
  return {
    groups: value.groups.filter((group: ModelProviderGroup) => activeProviders.has(group.id)),
    failures: value.failures,
  };
}

interface AuxNamespaceValue {
  vision?: {
    provider?: string;
    model?: string;
  };
  tool?: {
    enabled?: boolean;
  };
  compact?: {
    enabled?: boolean;
    provider?: string;
    model?: string;
  };
}

/** Read the schema-resolved auxiliary value from a wire namespace view. */
function namespaceValue(view: SettingsNamespaceView): AuxNamespaceValue {
  return view.value as AuxNamespaceValue;
}

/** Decode one namespace view into the complete feature snapshot. */
function snapshotOf(view: SettingsNamespaceView): AuxSettingsSnapshot {
  const value = namespaceValue(view);
  return {
    vision: {
      enabled: value.tool?.enabled ?? true,
      provider: value.vision?.provider,
      model: value.vision?.model,
    },
    compact: {
      enabled: value.compact?.enabled ?? false,
      provider: value.compact?.provider,
      model: value.compact?.model,
    },
    revision: view.revision,
  };
}

/** Read the dsh-auxiliary namespace from the settings descriptor. */
export async function loadAuxSettings(api: IApiClient): Promise<AuxSettings> {
  const value = valueOf(await api.settings.describe({}));
  const namespace: SettingsNamespaceView | undefined = value.namespaces.find((ns) => ns.ns === 'dsh-auxiliary');
  if (namespace === undefined) {
    return {
      vision: { enabled: true },
      compact: { enabled: false },
      available: false,
      writable: value.writable,
    };
  }
  const snapshot = snapshotOf(namespace);
  return {
    ...snapshot,
    available: true,
    writable: value.writable,
  };
}

/** Return the non-empty route text, or an empty wire value when cleared. */
function routeText(value: string | undefined): string {
  return value?.trim() ?? '';
}

/** Normalize and validate a feature draft before constructing its patch. */
function normalizedDraft(draft: AuxFeatureDraft): { enabled: boolean; provider: string; model: string } {
  const provider = routeText(draft.provider);
  const model = routeText(draft.model);
  if (Boolean(provider) !== Boolean(model)) {
    throw new AuxiliaryApiError(
      'invalid-route',
      'dsh-auxiliary: provider and model must be selected together',
    );
  }
  return { enabled: draft.enabled, provider, model };
}

/**
 * Atomically save one feature while preserving the other feature's namespace
 * fields. The returned snapshot is the complete post-write namespace value.
 */
export async function saveAuxFeature(
  api: IApiClient,
  feature: AuxFeature,
  draft: AuxFeatureDraft,
  expectedRevision?: number,
): Promise<AuxSettingsSnapshot> {
  const normalized = normalizedDraft(draft);
  const patch = feature === 'vision'
    ? {
      vision: {
        provider: normalized.provider,
        model: normalized.model,
      },
      tool: {
        enabled: normalized.enabled,
      },
    }
    : {
      compact: {
        enabled: normalized.enabled,
        provider: normalized.provider,
        model: normalized.model,
      },
    };
  const view = valueOf(await api.settings.update({
    ns: 'dsh-auxiliary',
    patch,
    ...(expectedRevision !== undefined ? { expectedRevision } : {}),
  }));
  return snapshotOf(view);
}

/** Return the Host revision from a structured settings conflict, if present. */
export function conflictRevision(error: unknown): number | undefined {
  if (!(error instanceof AuxiliaryApiError) || error.code !== 'settings-conflict') return undefined;
  const details = error.details;
  if (typeof details !== 'object' || details === null || !('actual' in details)) return undefined;
  const actual = (details as { actual?: unknown }).actual;
  return typeof actual === 'number' ? actual : undefined;
}

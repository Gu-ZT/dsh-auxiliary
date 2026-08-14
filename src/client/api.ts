/**
 * Browser-side Host data access for the dsh-auxiliary settings section. All
 * reads ride the connection's ApiProxy (llm.* / settings.*), the same wire the
 * Models page uses — no custom Host routes.
 * @module dsh-auxiliary/client/api
 */
import type {
  ConfigurableProviderView,
  IApiClient,
  ModelCatalogFailure,
  ModelCatalogModel,
  SettingsNamespaceView,
} from '@deepseek-ai/dsh-client-connection/client';

/** One configurable provider row for the select. */
export interface ProviderOption {
  /** Provider route key (`anvilcraft-ai`, `deepseek-official`, …). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Whether the route is currently registered and requestable. */
  active: boolean;
}

/** One model entry of a provider group. */
export interface ModelOption {
  id: string;
  name: string;
}

/** Host model catalog plus non-fatal per-provider lookup diagnostics. */
export interface ModelCatalog {
  modelsByProvider: Record<string, ModelOption[]>;
  failures: readonly ModelCatalogFailure[];
}

/** The currently stored auxiliary selection (vision provider/model). */
export interface AuxSelection {
  provider?: string;
  model?: string;
}

/** Settings state needed to show and write the auxiliary selection. */
export interface AuxSettings {
  selection: AuxSelection;
  revision?: number;
  available: boolean;
  writable: boolean;
}

/** Unwrap a unary RPC response's value, throwing on business errors. */
function valueOf<T>(response: { result: { ok: true; value: T } | { ok: false; error: { message: string } } }): T {
  if (!response.result.ok) throw new Error(response.result.error.message);
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

/** Host-scoped model catalog grouped by provider route. */
export async function loadModels(api: IApiClient): Promise<ModelCatalog> {
  const value = valueOf(await api.llm.models({}));
  const modelsByProvider: Record<string, ModelOption[]> = {};
  for (const group of value.groups) {
    modelsByProvider[group.id] = group.models.map((model: ModelCatalogModel) => ({ id: model.id, name: model.name }));
  }
  return { modelsByProvider, failures: value.failures };
}

/** Read the dsh-auxiliary namespace from the settings descriptor. */
export async function loadAuxSettings(api: IApiClient): Promise<AuxSettings> {
  const value = valueOf(await api.settings.describe({}));
  const namespace: SettingsNamespaceView | undefined = value.namespaces.find((ns) => ns.ns === 'dsh-auxiliary');
  const section = namespace?.value as { vision?: { provider?: string; model?: string } } | undefined;
  return {
    selection: {
      provider: section?.vision?.provider,
      model: section?.vision?.model,
    },
    revision: namespace?.revision,
    available: namespace !== undefined,
    writable: value.writable,
  };
}

/**
 * Persist one complete selection into the dsh-auxiliary settings user layer.
 * `update` bumps the namespace revision, so resolve and return the new one —
 * the caller adopts it as its next `expectedRevision`.
 */
export async function saveAuxSelection(
  api: IApiClient,
  selection: AuxSelection,
  expectedRevision?: number,
): Promise<number> {
  const provider = selection.provider?.trim();
  const model = selection.model?.trim();
  if (provider === undefined || provider === '' || model === undefined || model === '') {
    throw new Error('dsh-auxiliary: vision provider and model must both be selected');
  }
  const view = valueOf(await api.settings.update({
    ns: 'dsh-auxiliary',
    patch: {
      vision: { provider, model },
    },
    ...(expectedRevision !== undefined ? { expectedRevision } : {}),
  }));
  return view.revision;
}

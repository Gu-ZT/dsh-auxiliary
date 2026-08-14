/**
 * The "Auxiliary Models" settings page: pick the provider and model already
 * configured in Models for auxiliary work. Reads the live provider topology
 * (`llm.providers` / `llm.models`) and persists the selection into the
 * dsh-auxiliary settings namespace (`settings.update`).
 * @module dsh-auxiliary/client/AuxiliarySection
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client';
import { loadAuxSettings, loadModels, loadProviders, saveAuxSelection, type AuxSettings, type ModelOption, type ProviderOption } from './api.js';

/** Composed props: settings section owner share + this page's injected face. */
export interface AuxiliarySectionProps extends SettingsSectionOwnerProps {
  /** The connection's shared API client. */
  api: IApiClient;
  /** Namespace-bound translate. */
  t: TranslateNS<'dsh-auxiliary'>;
}

const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  maxWidth: 640,
  color: 'var(--dsw-alias-label-primary)',
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 500,
  lineHeight: 24,
};

const introStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: 22,
  color: 'var(--dsw-alias-label-tertiary)',
};

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginTop: 8,
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  lineHeight: 18,
  color: 'var(--dsw-alias-label-secondary)',
};

const inputStyle: CSSProperties = {
  boxSizing: 'border-box',
  border: '1px solid var(--dsw-alias-border-l2)',
  width: '100%',
  maxWidth: 320,
  height: 32,
  font: 'inherit',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  borderRadius: 8,
  padding: '0 10px',
  fontSize: 14,
  lineHeight: 22,
  cursor: 'pointer',
};

const saveRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginTop: 4,
};

const saveStyle: CSSProperties = {
  boxSizing: 'border-box',
  height: 32,
  font: 'inherit',
  cursor: 'pointer',
  border: 'none',
  borderRadius: 16,
  padding: '0 14px',
  fontSize: 14,
  lineHeight: 22,
  background: 'var(--dsw-alias-button-primary-fill)',
  color: 'var(--dsw-alias-label-primary-foreground)',
};

const savedStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 18,
  color: 'var(--dsw-alias-state-success-primary)',
};

const errorStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 18,
  color: 'var(--dsw-alias-state-error-primary)',
};

/** Pick the model that should be selected for a provider (stored one, else the first). */
function initialModel(models: readonly ModelOption[], stored: string | undefined): string {
  if (stored !== undefined && models.some((model) => model.id === stored)) return stored;
  return models[0]?.id ?? '';
}

/** The Auxiliary Models settings section. */
export function AuxiliarySection({ api, t }: AuxiliarySectionProps): JSX.Element {
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, ModelOption[]>>({});
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [revision, setRevision] = useState<number | undefined>(undefined);
  const [settingsAvailable, setSettingsAvailable] = useState(false);
  const [settingsWritable, setSettingsWritable] = useState(false);
  const [catalogFailure, setCatalogFailure] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [providerRows, catalog] = await Promise.all([
          loadProviders(api),
          loadModels(api),
        ]);
        let current: AuxSettings | undefined;
        let settingsError: string | undefined;
        try {
          current = await loadAuxSettings(api);
        } catch (cause) {
          settingsError = cause instanceof Error ? cause.message : String(cause);
        }
        if (cancelled) return;
        // Only routes that are live AND advertise at least one catalog model
        // are selectable; inactive or model-less providers are dropped.
        const available = providerRows.filter(
          (row) => row.active && (catalog.modelsByProvider[row.id]?.length ?? 0) > 0,
        );
        setProviders(available);
        setModelsByProvider(catalog.modelsByProvider);
        setRevision(current?.revision);
        setSettingsAvailable(current?.available ?? false);
        setSettingsWritable(current?.writable ?? false);
        setCatalogFailure(catalog.failures.length === 0
          ? undefined
          : catalog.failures.map((failure) => `${failure.name} (${failure.id}): ${failure.message}`).join('; '));
        setError(settingsError);
        // Prefer the stored selection while it is still selectable; otherwise
        // fall back to the first available provider (never an inactive route).
        const stored = current?.selection.provider;
        const initial = stored !== undefined && stored !== ''
          && available.some((row) => row.id === stored)
          ? stored
          : (available[0]?.id ?? '');
        setProvider(initial);
        setModel(initialModel(catalog.modelsByProvider[initial] ?? [], current?.selection.model));
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const onProviderChange = useCallback((next: string) => {
    setProvider(next);
    setModel(initialModel(modelsByProvider[next] ?? [], undefined));
    setSaved(false);
  }, [modelsByProvider]);

  const onModelChange = useCallback((next: string) => {
    setModel(next);
    setSaved(false);
  }, []);

  const onSave = useCallback(async () => {
    if (!settingsAvailable || !settingsWritable || provider === '' || model === '') return;
    setSaving(true);
    setError(undefined);
    setSaved(false);
    try {
      // settings.update bumps the namespace revision; adopt the returned one
      // so a consecutive save sends a fresh expectedRevision instead of a
      // stale copy that the settings seam would refuse.
      const next = await saveAuxSelection(api, { provider, model }, revision);
      setRevision(next);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }, [api, model, provider, revision, settingsAvailable, settingsWritable]);

  const modelOptions = modelsByProvider[provider] ?? [];
  const canSave = settingsAvailable && settingsWritable && provider !== '' && model !== '' && !saving;

  return (
    <div style={sectionStyle}>
      <h2 style={titleStyle}>{t('nav')}</h2>
      <p style={introStyle}>{t('intro')}</p>
      {loading ? <p style={introStyle}>{t('loading')}</p> : null}
      {!loading && !settingsAvailable ? <p style={errorStyle}>{t('settingsUnavailable')}</p> : null}
      {!loading && settingsAvailable && !settingsWritable ? <p style={errorStyle}>{t('settingsReadOnly')}</p> : null}
      {!loading && catalogFailure !== undefined ? <p style={errorStyle}>{t('catalogFailure')} {catalogFailure}</p> : null}
      {!loading && providers.length === 0 ? <p style={errorStyle}>{t('noProvider')}</p> : null}
      {!loading && providers.length > 0 ? (
        <>
          <label style={fieldStyle}>
            <span style={labelStyle}>{t('providerLabel')}</span>
            <select
              style={inputStyle}
              value={provider}
              onChange={(event) => onProviderChange(event.target.value)}
            >
              {providers.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>{t('modelLabel')}</span>
            <select
              style={inputStyle}
              value={model}
              onChange={(event) => onModelChange(event.target.value)}
            >
              {modelOptions.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.name}</option>
              ))}
            </select>
          </label>
          <div style={saveRowStyle}>
            <button
              type="button"
              style={{ ...saveStyle, opacity: canSave ? 1 : 0.4 }}
              disabled={!canSave}
              onClick={() => { void onSave(); }}
            >
              {t('save')}
            </button>
            {saved ? <p style={savedStyle}>{t('saved')}</p> : null}
          </div>
        </>
      ) : null}
      {error !== undefined ? <p style={errorStyle}>{t('error')} {error}</p> : null}
    </div>
  );
}

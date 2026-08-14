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
import { loadAuxSettings, loadModels, loadProviders, saveAuxSelection, type ModelOption, type ProviderOption } from './api.ts';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [providerRows, modelGroups, current] = await Promise.all([
          loadProviders(api),
          loadModels(api),
          loadAuxSettings(api),
        ]);
        if (cancelled) return;
        setProviders(providerRows);
        setModelsByProvider(modelGroups);
        setRevision(current.revision);
        // Prefer the stored selection; fall back to the first active provider.
        const initial = current.selection.provider !== undefined && current.selection.provider !== ''
          && providerRows.some((row) => row.id === current.selection.provider)
          ? current.selection.provider
          : (providerRows.find((row) => row.active)?.id ?? providerRows[0]?.id ?? '');
        setProvider(initial);
        setModel(initialModel(modelGroups[initial] ?? [], current.selection.model));
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
    if (provider === '' || model === '') return;
    setSaving(true);
    setError(undefined);
    setSaved(false);
    try {
      await saveAuxSelection(api, { provider, model }, revision);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }, [api, provider, model, revision]);

  const modelOptions = modelsByProvider[provider] ?? [];

  return (
    <section style={sectionStyle}>
      <h2 style={titleStyle}>{t('nav')}</h2>
      <p style={introStyle}>{t('intro')}</p>
      {loading ? <p style={introStyle}>{t('loading')}</p> : null}
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
                  {row.name}{row.active ? '' : ' (inactive)'}
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
              {modelOptions.length === 0 ? <option value="">{t('noModel')}</option> : null}
              {modelOptions.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.name}</option>
              ))}
            </select>
          </label>
          <div style={saveRowStyle}>
            <button
              type="button"
              style={{ ...saveStyle, opacity: provider === '' || model === '' || saving ? 0.4 : 1 }}
              disabled={provider === '' || model === '' || saving}
              onClick={() => { void onSave(); }}
            >
              {t('save')}
            </button>
            {saved ? <p style={savedStyle}>{t('saved')}</p> : null}
          </div>
        </>
      ) : null}
      {error !== undefined ? <p style={errorStyle}>{t('error')} {error}</p> : null}
    </section>
  );
}

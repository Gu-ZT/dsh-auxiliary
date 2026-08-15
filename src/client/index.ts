/**
 * Browser-half entry for dsh-auxiliary — runs inside the dsh web GUI.
 *
 * Registers the "Auxiliary Models" settings section (`settings.section` slot):
 * a page with independent vision and compaction cards that pick provider/model
 * routes already configured in Models. Reads the live provider topology and
 * persists each feature through the connection's Host API; no custom Host routes.
 *
 * Export discipline (packages/client rule): the /client surface carries what
 * cordis loading needs plus types only — all value exports stay internal.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client';
// Type-only: pulls the LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-ui-slots';
// Type-only: pulls the settings.section SlotMap declaration and owner props.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import { AuxiliarySection, type AuxiliarySectionProps } from './AuxiliarySection.js';
import { en, zh, type AuxiliaryKey } from './locales.js';
import { startModelCatalogInjection } from './modelCatalogInject.js';

/** Locale namespace this plugin owns. */
const NS = 'dsh-auxiliary';

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-auxiliary settings-page copy. */
    'dsh-auxiliary': AuxiliaryKey;
  }
}

/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['slots', 'locale', 'connection'];

/** Type-only surface (export discipline: no value exports beyond the plugin contract). */
export type { AuxiliarySectionProps } from './AuxiliarySection.js';
export type { AuxiliaryKey } from './locales.js';

/**
 * Register the Auxiliary Models settings section.
 * @param ctx - client root context (slots, locale, connection services).
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-auxiliary: dictionaries');

  const connection = ctx.get('connection');
  const t = ctx.locale.bind(NS);
  const injected = (): { api: typeof connection.api; t: TranslateNS<'dsh-auxiliary'> } => ({
    api: connection.api,
    t,
  });

  ctx.effect(
    () => startModelCatalogInjection(connection.api, t),
    'dsh-auxiliary: model catalog capability injection',
  );

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'auxiliary',
    order: 20,
    label: () => t('nav'),
    inject: injected,
  }, AuxiliarySection));
}

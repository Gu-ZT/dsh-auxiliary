/**
 * tsdown config for dsh-auxiliary — browser client bundle only. The node half
 * of the plugin (lib/index.js) is emitted by `tsc`; this config produces the
 * `window.__ModuleLoader__.load({id, factory})` closure-factory artifact the
 * GUI's client module system serves at `/plugins/dsh-auxiliary/client.js`.
 *
 * Externals resolve through the loader module table (platform seed modules
 * plus the runtime/client exemption); everything else is inlined.
 */
import { defineConfig } from 'tsdown';

/** The module specifiers the web shell shares into the frozen module table. */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-schema-form',
] as const;

/** Externals resolved from the loader module table (platform seeds + the documented runtime exemption). */
const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES, '@deepseek-ai/dsh-client-runtime/client'];

export default defineConfig({
  name: 'dsh-auxiliary/client',
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-auxiliary", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
});

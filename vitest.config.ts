import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import { fileURLToPath } from 'url';

/** Absolute path to a repo-relative location, for alias replacements. */
const at = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
	plugins: [
		swc.vite({
			jsc: {
				parser: {
					syntax: 'typescript',
					decorators: true,
				},
				transform: {
					decoratorVersion: '2022-03',
					decoratorMetadata: true,
					// unplugin-swc forwards jsxImportSource from tsconfig but never sets the
					// runtime, so JSX would compile to React.createElement and fail on import.
					// Component tests need the automatic Preact runtime.
					react: {
						runtime: 'automatic',
						importSource: 'preact',
					},
				},
			},
		}),
	],
	// Component tests import shared packages by their workspace names, and those
	// packages ship source with no build step or entry point, so they are aliased to
	// src the way web/vite.config.ts does it.
	resolve: {
		alias: [
			{ find: /^@shared\/planning$/, replacement: at('shared/planning') },
			{ find: /^@shared\/projects$/, replacement: at('shared/projects') },
			{ find: /^@specboard\/pages$/, replacement: at('shared/pages') },
			{ find: /^@specboard\/ui$/, replacement: at('shared/ui/src') },
			{ find: /^@specboard\/router$/, replacement: at('shared/router/src') },
			{ find: /^@specboard\/models$/, replacement: at('shared/models/src') },
			{ find: /^@specboard\/fetch$/, replacement: at('shared/fetch/src') },
			{ find: /^@specboard\/core(\/.*)?$/, replacement: `${at('shared/core/src')}$1` },
			{ find: /^@specboard\/telemetry$/, replacement: at('shared/telemetry/src') },
			// slate-react imports React; map it onto preact/compat as the app does.
			{ find: /^(react|react-dom)$/, replacement: at('node_modules/preact/compat') },
			// Slate's package main is CJS. Loaded that way it reaches Preact through Node's
			// own require() and lands on a second copy, whose hook bookkeeping is not the
			// one rendering the tree; every Slate component then throws on its first
			// useState. The ESM builds go through Vite and the alias above.
			{ find: /^slate$/, replacement: at('node_modules/slate/dist/index.es.js') },
			{ find: /^slate-dom$/, replacement: at('node_modules/slate-dom/dist/index.es.js') },
			{ find: /^slate-react$/, replacement: at('node_modules/slate-react/dist/index.es.js') },
			{ find: /^slate-history$/, replacement: at('node_modules/slate-history/dist/index.es.js') },
		],
		dedupe: ['preact', 'preact/hooks', 'preact/compat', 'slate', 'slate-react', 'slate-history'],
	},
	test: {
		globals: true,
		environment: 'node',
		include: ['**/*.test.ts', '**/*.test.tsx'],
		exclude: ['**/node_modules/**', '**/dist/**'],
		passWithNoTests: true,
	},
});

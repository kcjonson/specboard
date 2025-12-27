import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';

export default defineConfig({
	plugins: [preact()],
	build: {
		outDir: 'dist',
		manifest: true,
		rollupOptions: {
			input: {
				main: resolve(__dirname, 'index.html'),
				'shared-styles': resolve(__dirname, 'src/shared-styles.ts'),
				'login-styles': resolve(__dirname, 'src/login-styles.ts'),
			},
		},
	},
	resolve: {
		alias: {
			// Shared feature source (no build step)
			'@shared/planning': resolve(__dirname, '../shared/planning'),
			'@shared/pages': resolve(__dirname, '../shared/pages'),
			// Workspace packages (resolve to dist)
			'@doc-platform/ui': resolve(__dirname, '../shared/ui/src'),
			'@doc-platform/ui/tokens.css': resolve(__dirname, '../shared/ui/src/tokens.css'),
			'@doc-platform/ui/elements.css': resolve(__dirname, '../shared/ui/src/elements.css'),
			'@doc-platform/ui/shared.css': resolve(__dirname, '../shared/ui/src/shared.css'),
			'@frontend/styles/login.css': resolve(__dirname, '../frontend/src/styles/login.css'),
			'@doc-platform/router': resolve(__dirname, '../shared/router/dist'),
			'@doc-platform/models': resolve(__dirname, '../shared/models/dist'),
			'@doc-platform/fetch': resolve(__dirname, '../shared/fetch/dist'),
			'@doc-platform/core': resolve(__dirname, '../shared/core/dist'),
			// Ensure preact resolves from this package's node_modules
			'preact': resolve(__dirname, 'node_modules/preact'),
			'preact/hooks': resolve(__dirname, 'node_modules/preact/hooks'),
			'preact/jsx-runtime': resolve(__dirname, 'node_modules/preact/jsx-runtime'),
		},
		dedupe: ['preact'],
	},
});

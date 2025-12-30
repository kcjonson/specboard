import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';

export default defineConfig({
	plugins: [preact()],
	build: {
		outDir: 'dist',
		manifest: '.vite/manifest.json',
		rollupOptions: {
			input: {
				// SPA entry
				main: resolve(__dirname, 'index.html'),
				// SSG CSS bundles
				'ssg/src/styles/common.css': resolve(__dirname, '../ssg/src/styles/common.css'),
				'ssg/src/styles/login.css': resolve(__dirname, '../ssg/src/styles/login.css'),
				'ssg/src/styles/signup.css': resolve(__dirname, '../ssg/src/styles/signup.css'),
				'ssg/src/styles/not-found.css': resolve(__dirname, '../ssg/src/styles/not-found.css'),
				'ssg/src/styles/home.css': resolve(__dirname, '../ssg/src/styles/home.css'),
			},
		},
	},
	resolve: {
		alias: {
			// Shared feature source (no build step)
			'@shared/planning': resolve(__dirname, '../shared/planning'),
			'@shared/pages': resolve(__dirname, '../shared/pages'),
			'@shared/projects': resolve(__dirname, '../shared/projects'),
			// Workspace packages (resolve to dist)
			'@doc-platform/ui': resolve(__dirname, '../shared/ui/src'),
			'@doc-platform/ui/tokens.css': resolve(__dirname, '../shared/ui/src/tokens.css'),
			'@doc-platform/ui/elements.css': resolve(__dirname, '../shared/ui/src/elements.css'),
			'@doc-platform/ui/shared.css': resolve(__dirname, '../shared/ui/src/shared.css'),
			'@doc-platform/router': resolve(__dirname, '../shared/router/dist'),
			'@doc-platform/models': resolve(__dirname, '../shared/models/dist'),
			'@doc-platform/fetch': resolve(__dirname, '../shared/fetch/dist'),
			'@doc-platform/core': resolve(__dirname, '../shared/core/dist'),
			// Ensure preact resolves from this package's node_modules
			'preact': resolve(__dirname, 'node_modules/preact'),
			'preact/hooks': resolve(__dirname, 'node_modules/preact/hooks'),
			'preact/jsx-runtime': resolve(__dirname, 'node_modules/preact/jsx-runtime'),
			// Alias React to Preact for slate-react compatibility
			'react': resolve(__dirname, 'node_modules/preact/compat'),
			'react-dom': resolve(__dirname, 'node_modules/preact/compat'),
			// Ensure slate packages resolve from web's node_modules
			'slate': resolve(__dirname, 'node_modules/slate'),
			'slate-react': resolve(__dirname, 'node_modules/slate-react'),
			'slate-history': resolve(__dirname, 'node_modules/slate-history'),
			'is-hotkey': resolve(__dirname, 'node_modules/is-hotkey'),
		},
		dedupe: ['preact', 'slate', 'slate-react', 'slate-history'],
	},
});

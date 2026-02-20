import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';

export default defineConfig({
	// Keep Vite cache out of node_modules to avoid polluting workspace
	cacheDir: '.vite',
	plugins: [
		preact({
			babel: {
				plugins: [
					// TC39 decorators (2023-11 spec) for models package
					['@babel/plugin-proposal-decorators', { version: '2023-11' }],
				],
			},
		}),
	],
	server: {
		// Bind to all interfaces for Docker container access.
		// SECURITY: Only for containerized development, not public networks.
		host: '0.0.0.0',
		port: 5173,
		strictPort: true,
		// HMR configuration for Docker (client connects through nginx on port 80)
		hmr: {
			clientPort: 80,
			host: 'localhost',
			path: '/__vite_hmr',
		},
		// File watching with polling for Docker on macOS.
		// Interval of 300ms balances responsiveness with CPU usage.
		watch: {
			usePolling: true,
			interval: 300,
		},
		// Allow serving files from workspace root and shared packages
		fs: {
			allow: ['..'],
		},
	},
	css: {
		devSourcemap: true,
	},
	build: {
		outDir: 'dist',
		manifest: '.vite/manifest.json',
		sourcemap: true,
		rollupOptions: {
			input: {
				// SPA entry
				main: resolve(__dirname, 'index.html'),
				// Shared CSS bundle (used by both SSG and SPA)
				'styles/common.css': resolve(__dirname, '../shared/styles/common.css'),
				// SSG-specific CSS bundles
				'styles/ssg/login.css': resolve(__dirname, '../ssg/src/styles/login.css'),
				'styles/ssg/signup.css': resolve(__dirname, '../ssg/src/styles/signup.css'),
				'styles/ssg/not-found.css': resolve(__dirname, '../ssg/src/styles/not-found.css'),
				'styles/ssg/home.css': resolve(__dirname, '../ssg/src/styles/home.css'),
				'styles/ssg/auth.css': resolve(__dirname, '../ssg/src/styles/auth.css'),
			},
		},
	},
	resolve: {
		alias: {
			// Shared feature source (no build step)
			'@shared/planning': resolve(__dirname, '../shared/planning'),
			'@shared/projects': resolve(__dirname, '../shared/projects'),
			// Workspace packages (source, no build)
			'@specboard/pages': resolve(__dirname, '../shared/pages'),
			// Workspace packages - resolve to src for hot reloading
			'@specboard/ui': resolve(__dirname, '../shared/ui/src'),
			'@specboard/ui/tokens.css': resolve(__dirname, '../shared/ui/src/tokens.css'),
			'@specboard/ui/elements.css': resolve(__dirname, '../shared/ui/src/elements.css'),
			'@specboard/ui/shared.css': resolve(__dirname, '../shared/ui/src/shared.css'),
			'@specboard/router': resolve(__dirname, '../shared/router/src'),
			'@specboard/models': resolve(__dirname, '../shared/models/src'),
			'@specboard/fetch': resolve(__dirname, '../shared/fetch/src'),
			'@specboard/core': resolve(__dirname, '../shared/core/src'),
			'@specboard/telemetry': resolve(__dirname, '../shared/telemetry/src'),
			// Alias React to Preact for slate-react compatibility
			// (Vite doesn't respect npm overrides in dev mode)
			'react': resolve(__dirname, '../node_modules/preact/compat'),
			'react-dom': resolve(__dirname, '../node_modules/preact/compat'),
		},
		dedupe: ['preact', 'preact/hooks', 'preact/jsx-runtime', 'preact/jsx-dev-runtime', 'slate', 'slate-react', 'slate-history'],
	},
	optimizeDeps: {
		include: ['preact', 'preact/hooks', 'preact/jsx-runtime'],
	},
});

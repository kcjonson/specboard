import { defineConfig, Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';

/**
 * Force preact JSX runtime resolution to web/node_modules.
 * This fixes resolution for files in ../shared/ that get JSX imports
 * injected by @preact/preset-vite's Babel transform.
 */
function forcePreactResolution(): Plugin {
	const jsxRuntimePath = resolve(__dirname, '../node_modules/preact/jsx-runtime/dist/jsxRuntime.mjs');
	return {
		name: 'force-preact-resolution',
		// No enforce - runs in normal phase, after pre-phase JSX transform
		transform(code, id) {
			// Only process files that might have JSX runtime imports
			if (!code.includes('preact/jsx-dev-runtime') && !code.includes('preact/jsx-runtime')) {
				return null;
			}
			// Rewrite bare specifiers to absolute paths
			const newCode = code
				.replace(/from ["']preact\/jsx-dev-runtime["']/g, `from "${jsxRuntimePath}"`)
				.replace(/from ["']preact\/jsx-runtime["']/g, `from "${jsxRuntimePath}"`);
			if (newCode !== code) {
				return { code: newCode, map: null };
			}
			return null;
		},
	};
}

export default defineConfig({
	plugins: [
		forcePreactResolution(),
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
		// Allow external access from Docker
		host: '0.0.0.0',
		port: 5173,
		strictPort: true,
		// HMR configuration for Docker (client connects through nginx on port 80)
		hmr: {
			clientPort: 80,
			host: 'localhost',
			path: '/__vite_hmr',
		},
		// File watching with polling for Docker on macOS
		watch: {
			usePolling: true,
			interval: 100,
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
			'@doc-platform/pages': resolve(__dirname, '../shared/pages'),
			// Workspace packages - resolve to src for hot reloading
			'@doc-platform/ui': resolve(__dirname, '../shared/ui/src'),
			'@doc-platform/ui/tokens.css': resolve(__dirname, '../shared/ui/src/tokens.css'),
			'@doc-platform/ui/elements.css': resolve(__dirname, '../shared/ui/src/elements.css'),
			'@doc-platform/ui/shared.css': resolve(__dirname, '../shared/ui/src/shared.css'),
			'@doc-platform/router': resolve(__dirname, '../shared/router/src'),
			'@doc-platform/models': resolve(__dirname, '../shared/models/src'),
			'@doc-platform/fetch': resolve(__dirname, '../shared/fetch/src'),
			'@doc-platform/core': resolve(__dirname, '../shared/core/src'),
			'@doc-platform/telemetry': resolve(__dirname, '../shared/telemetry/src'),
			// Preact core aliases (jsx-runtime handled by forcePreactResolution plugin)
			'preact': resolve(__dirname, '../node_modules/preact'),
			'preact/hooks': resolve(__dirname, '../node_modules/preact/hooks'),
			// Alias React to Preact for slate-react compatibility
			'react': resolve(__dirname, '../node_modules/preact/compat'),
			'react-dom': resolve(__dirname, '../node_modules/preact/compat'),
			// Ensure slate packages resolve from web's node_modules
			'slate': resolve(__dirname, '../node_modules/slate'),
			'slate-react': resolve(__dirname, '../node_modules/slate-react'),
			'slate-history': resolve(__dirname, '../node_modules/slate-history'),
			'is-hotkey': resolve(__dirname, '../node_modules/is-hotkey'),
		},
		dedupe: ['preact', 'preact/hooks', 'preact/jsx-runtime', 'preact/jsx-dev-runtime', 'slate', 'slate-react', 'slate-history'],
	},
	optimizeDeps: {
		include: ['preact', 'preact/hooks', 'preact/jsx-runtime'],
	},
});

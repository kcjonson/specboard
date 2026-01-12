/**
 * Build script for frontend server
 * Uses esbuild to bundle TypeScript with .ts extension imports
 *
 * Workspace packages (@doc-platform/*) are bundled directly.
 * npm packages (node_modules) are kept external.
 *
 * Note: All workspace packages use @doc-platform/ prefix per project convention.
 * If this changes, update the filter below.
 */

import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';

// Get npm dependencies to mark as external (not workspace packages)
// Workspace packages use @doc-platform/ prefix and should be bundled, not externalized
const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const external = [
	...Object.keys(pkg.dependencies || {}),
	...Object.keys(pkg.devDependencies || {}),
].filter(dep => !dep.startsWith('@doc-platform/'));

await esbuild.build({
	entryPoints: ['src/index.ts'],
	bundle: true,
	platform: 'node',
	target: 'node22',
	format: 'esm',
	outdir: 'dist',
	external,
	sourcemap: true,
});

console.log('Frontend build complete');

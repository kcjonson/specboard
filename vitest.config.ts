import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

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
				},
			},
		}),
	],
	test: {
		globals: true,
		environment: 'node',
		include: ['**/*.test.ts', '**/*.test.tsx'],
		exclude: ['**/node_modules/**', '**/dist/**'],
		passWithNoTests: true,
	},
});

import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
	eslint.configs.recommended,
	{
		ignores: ['**/dist/**', '**/node_modules/**', '**/*.js', '**/*.mjs', '**/cdk.out/**'],
	},
	// TypeScript files (browser environment)
	{
		files: ['**/*.ts', '**/*.tsx'],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				ecmaVersion: 'latest',
				sourceType: 'module',
			},
			globals: {
				console: 'readonly',
				crypto: 'readonly',
				document: 'readonly',
				window: 'readonly',
				setTimeout: 'readonly',
				clearTimeout: 'readonly',
				setInterval: 'readonly',
				clearInterval: 'readonly',
				fetch: 'readonly',
				Request: 'readonly',
				Response: 'readonly',
				Headers: 'readonly',
				RequestInit: 'readonly',
				URLSearchParams: 'readonly',
				AbortController: 'readonly',
				AbortSignal: 'readonly',
				Element: 'readonly',
				MouseEvent: 'readonly',
				KeyboardEvent: 'readonly',
				FocusEvent: 'readonly',
				Event: 'readonly',
				HTMLDivElement: 'readonly',
				HTMLButtonElement: 'readonly',
				HTMLInputElement: 'readonly',
				HTMLTextAreaElement: 'readonly',
				HTMLSelectElement: 'readonly',
				HTMLElement: 'readonly',
				DragEvent: 'readonly',
				Node: 'readonly',
				prompt: 'readonly',
				confirm: 'readonly',
				alert: 'readonly',
				navigator: 'readonly',
				location: 'readonly',
				Blob: 'readonly',
			},
		},
		plugins: {
			'@typescript-eslint': tseslint,
		},
		rules: {
			// TypeScript rules
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
			'@typescript-eslint/explicit-function-return-type': ['error', {
				allowExpressions: true,
				allowTypedFunctionExpressions: true,
			}],
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/prefer-unknown-to-any': 'off',

			// General rules
			'no-unused-vars': 'off', // Use TypeScript version
			'no-console': ['warn', { allow: ['warn', 'error'] }],
			'prefer-const': 'error',
			'no-var': 'error',
		},
	},
	// Node.js files (api, mcp, infra, desktop, frontend server, shared server packages)
	{
		files: [
			'api/**/*.ts',
			'mcp/**/*.ts',
			'infra/**/*.ts',
			'*-desktop/**/*.ts',
			'frontend/**/*.ts',
			'shared/db/**/*.ts',
			'shared/auth/**/*.ts',
			'shared/core/**/*.ts',
			'shared/email/**/*.ts',
		],
		languageOptions: {
			globals: {
				process: 'readonly',
				__dirname: 'readonly',
				__filename: 'readonly',
				module: 'readonly',
				require: 'readonly',
				Buffer: 'readonly',
				URL: 'readonly',
			},
		},
		rules: {
			'no-console': 'off', // Allow console in Node apps
		},
	},
];

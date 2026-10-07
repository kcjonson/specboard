import { describe, it, expect } from 'vitest';
import { safeNextPath } from './next-path.ts';

describe('safeNextPath', () => {
	it.each([
		'/',
		'/projects',
		'/invite?token=abc123',
		'/projects/acme/roadmap/planning#board',
	])('keeps the same-origin path %s', (path) => {
		expect(safeNextPath(path)).toBe(path);
	});

	it.each([
		['a scheme-relative URL', '//evil.example.com/phish'],
		['a backslash that browsers read as //', '/\\evil.example.com'],
		['an absolute URL', 'https://evil.example.com'],
		['a javascript: URL', 'javascript:alert(1)'],
		['a relative path', 'projects'],
		['an empty string', ''],
		['a NUL byte', '/projects\x00'],
		['a newline', '/projects\n'],
		['DEL', '/projects\x7f'],
		['an overlong path', `/${'a'.repeat(2048)}`],
		['a number', 42],
		['null', null],
		['undefined', undefined],
	])('refuses %s', (_what, next) => {
		expect(safeNextPath(next)).toBeNull();
	});
});

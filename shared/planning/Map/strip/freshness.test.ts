import { describe, expect, it } from 'vitest';
import { freshnessText } from './freshness';

const MINUTE = 60_000;
const NOW = Date.parse('2026-09-30T18:00:00Z');

describe('freshness', () => {
	it('says just now inside the first minute', () => {
		expect(freshnessText(NOW, NOW)).toBe('Updated just now');
		expect(freshnessText(NOW - 59_000, NOW)).toBe('Updated just now');
	});

	it('counts minutes, then hours, then days', () => {
		expect(freshnessText(NOW - MINUTE, NOW)).toBe('Updated 1 min ago');
		expect(freshnessText(NOW - 4 * MINUTE - 20_000, NOW)).toBe('Updated 4 min ago');
		expect(freshnessText(NOW - 59 * MINUTE, NOW)).toBe('Updated 59 min ago');
		expect(freshnessText(NOW - 3 * 60 * MINUTE, NOW)).toBe('Updated 3 h ago');
		expect(freshnessText(NOW - 50 * 60 * MINUTE, NOW)).toBe('Updated 2 d ago');
	});

	it('does not go negative when the clock is a little behind the read', () => {
		expect(freshnessText(NOW + 5_000, NOW)).toBe('Updated just now');
	});

	it('adds ", retrying" when a refresh failed and the Map is showing what it had', () => {
		expect(freshnessText(NOW - 4 * MINUTE, NOW, true)).toBe('Updated 4 min ago, retrying');
	});

	it('has a short form for a strip with no room, and keeps retrying in it', () => {
		expect(freshnessText(NOW, NOW, false, true)).toBe('Updated now');
		expect(freshnessText(NOW - 4 * MINUTE, NOW, false, true)).toBe('Updated 4m');
		expect(freshnessText(NOW - 3 * 60 * MINUTE, NOW, false, true)).toBe('Updated 3h');
		expect(freshnessText(NOW - 50 * 60 * MINUTE, NOW, false, true)).toBe('Updated 2d');
		expect(freshnessText(NOW - 4 * MINUTE, NOW, true, true)).toBe('Updated 4m, retrying');
	});
});

/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from 'vitest';
import { getPlatformBridge } from './index';

afterEach(() => {
	delete window.platform;
});

describe('getPlatformBridge', () => {
	it('is null in the browser, where no preload has run', () => {
		expect(getPlatformBridge()).toBeNull();
	});

	it('returns the bridge the desktop preload exposes', () => {
		const bridge = {
			openExternal: async () => {},
			showOpenDialog: async () => '/repo/docs',
		};
		window.platform = bridge;
		expect(getPlatformBridge()).toBe(bridge);
	});
});

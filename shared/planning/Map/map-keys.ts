export type ZoomKey = 'in' | 'out';

interface KeyEventLike {
	code: string;
	altKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
	target: EventTarget | null;
}

/**
 * Figma's zoom keys: Z zooms in, Option+Z (Alt+Z) zooms out. Matched on `code`, since
 * Option+Z types an omega on a Mac and `key` would never say Z. Cmd+Z and Ctrl+Z stay undo,
 * and nothing fires while the person is typing, the same guard the planning page's other
 * shortcuts use.
 */
export function zoomKeyOf(event: KeyEventLike): ZoomKey | null {
	if (event.code !== 'KeyZ' || event.metaKey || event.ctrlKey) return null;
	const target = event.target as HTMLElement | null;
	if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return null;
	return event.altKey ? 'out' : 'in';
}

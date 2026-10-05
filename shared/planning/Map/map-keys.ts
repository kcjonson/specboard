import type { Direction } from './map-nav';

/** What a key does on the Map (spec, Keys). Escape is not here: the page's Escape ladder owns it, and it works from anywhere. */
export type MapKey =
	| { kind: 'move'; direction: Direction }
	| { kind: 'open' }
	/** `+`, `-`: around the focused dot. */
	| { kind: 'zoom-focus'; direction: 'in' | 'out' }
	/** `Z`, Option+`Z`: around the pointer, or the middle of the plot. */
	| { kind: 'zoom-pointer'; direction: 'in' | 'out' }
	| { kind: 'fit-all' }
	| { kind: 'now' }
	| { kind: 'fit-focus' }
	| { kind: 'needs'; delta: 1 | -1 }
	| { kind: 'live'; delta: 1 | -1 }
	| { kind: 'step'; delta: 1 | -1 }
	/** Shift+Left, Shift+Right: the tree keys, which plain arrows can't be since they move in space. */
	| { kind: 'collapse' }
	| { kind: 'expand' };

export interface KeyEventLike {
	key: string;
	code: string;
	altKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	target: EventTarget | null;
}

const ARROWS: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

export const isTypingTarget = (target: EventTarget | null): boolean => {
	const el = target as HTMLElement | null;
	return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/**
 * The Map's keys, kept clear of the planning page's `N`, `C`, `/`, `?`, Cmd+K, `M`, `E`,
 * and `1` to `3`. Nothing fires while the person is typing, and nothing with Cmd or Ctrl held
 * (Cmd+Z stays undo). Option is only Figma's zoom-out: Option+Z types an omega on a Mac, so Z
 * is read from `code`, where every other key reads the character it types.
 */
export function mapKeyOf(event: KeyEventLike): MapKey | null {
	if (event.metaKey || event.ctrlKey || isTypingTarget(event.target)) return null;
	if (event.code === 'KeyZ') return { kind: 'zoom-pointer', direction: event.altKey ? 'out' : 'in' };
	if (event.altKey) return null;
	const direction = ARROWS[event.key];
	if (direction) {
		if (!event.shiftKey) return { kind: 'move', direction };
		if (direction === 'left') return { kind: 'collapse' };
		if (direction === 'right') return { kind: 'expand' };
		return null;
	}
	switch (event.key) {
		case 'Enter':
			return event.shiftKey ? null : { kind: 'open' };
		case '+':
		case '=':
			return { kind: 'zoom-focus', direction: 'in' };
		case '-':
			return { kind: 'zoom-focus', direction: 'out' };
		case ']':
			return { kind: 'step', delta: 1 };
		case '[':
			return { kind: 'step', delta: -1 };
	}
	switch (event.key.toLowerCase()) {
		case '0':
			return { kind: 'fit-all' };
		case 't':
			return { kind: 'now' };
		case 'f':
			return { kind: 'fit-focus' };
		case 'p':
			return { kind: 'needs', delta: event.shiftKey ? -1 : 1 };
		case 'l':
			return { kind: 'live', delta: event.shiftKey ? -1 : 1 };
	}
	return null;
}

/**
 * The edge markers layer: what the surface placed, drawn as buttons that go to the item.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { EdgeMarkers } from './EdgeMarkers';
import { EDGE_MARKER_SIZE, type PlacedEdgeMarker } from './edge-markers';
import { EMPTY_OVERLAY, OverlayStore } from './overlay';

afterEach(cleanup);

const marker = (over: Partial<PlacedEdgeMarker> = {}): PlacedEdgeMarker => ({ key: 'SPE-4', kind: 'up-next', text: '2', x: 30, y: 200, angle: Math.PI, ...over });

describe('EdgeMarkers', () => {
	it('draws a button for each marker, named for what it is, its number, and which way the item is', () => {
		const store = new OverlayStore();
		const { getAllByRole } = render(<EdgeMarkers store={store} bottom={32} onJump={vi.fn()} />);
		act(() => store.publish({ ...EMPTY_OVERLAY, edges: [marker(), marker({ key: 'SPE-9', kind: 'live', text: undefined, x: 900, y: 40, angle: 0 })] }));
		const buttons = getAllByRole('button');
		expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Up next 2: SPE-4, off screen left', 'Live session: SPE-9, off screen right']);
		expect(buttons[0]!.style.left).toBe(`${30 - EDGE_MARKER_SIZE / 2}px`);
		expect(buttons[0]!.style.top).toBe(`${200 - EDGE_MARKER_SIZE / 2}px`);
		expect(buttons[0]!.textContent).toBe('2');
	});

	it('goes to the item when one is clicked', () => {
		const store = new OverlayStore();
		const onJump = vi.fn();
		const { getByRole } = render(<EdgeMarkers store={store} bottom={32} onJump={onJump} />);
		act(() => store.publish({ ...EMPTY_OVERLAY, edges: [marker()] }));
		fireEvent.click(getByRole('button'));
		expect(onJump).toHaveBeenCalledWith('SPE-4');
	});

	it('draws nothing when no item is off screen, and drops a marker the item came back into view for', () => {
		const store = new OverlayStore();
		const { queryAllByRole } = render(<EdgeMarkers store={store} bottom={32} onJump={vi.fn()} />);
		expect(queryAllByRole('button')).toHaveLength(0);
		act(() => store.publish({ ...EMPTY_OVERLAY, edges: [marker()] }));
		expect(queryAllByRole('button')).toHaveLength(1);
		act(() => store.publish({ ...EMPTY_OVERLAY, edges: [] }));
		expect(queryAllByRole('button')).toHaveLength(0);
	});
});

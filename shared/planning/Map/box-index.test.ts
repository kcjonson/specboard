import { describe, expect, it } from 'vitest';
import { BoxIndex, intersects, type Box } from './box-index';

describe('BoxIndex', () => {
	it('reports a hit only for boxes that overlap one it holds', () => {
		const index = new BoxIndex(32);
		index.add({ x: 100, y: 100, w: 50, h: 20 });
		expect(index.hits({ x: 140, y: 110, w: 30, h: 5 })).toBe(true);
		expect(index.hits({ x: 150, y: 100, w: 30, h: 20 })).toBe(false);
		expect(index.hits({ x: 100, y: 120, w: 30, h: 20 })).toBe(false);
		expect(index.hits({ x: 0, y: 0, w: 10, h: 10 })).toBe(false);
	});

	it('finds boxes spanning many cells and boxes in negative space', () => {
		const index = new BoxIndex(16);
		index.add({ x: -200, y: -80, w: 400, h: 160 });
		expect(index.hits({ x: 190, y: 70, w: 4, h: 4 })).toBe(true);
		expect(index.hits({ x: -203, y: -83, w: 4, h: 4 })).toBe(true);
		expect(index.hits({ x: 201, y: 0, w: 4, h: 4 })).toBe(false);
	});

	it('agrees with a brute-force scan on a random pile of boxes', () => {
		let seed = 7;
		const random = (): number => {
			seed = (seed * 1664525 + 1013904223) % 4294967296;
			return seed / 4294967296;
		};
		const boxes: Box[] = Array.from({ length: 300 }, () => ({ x: random() * 1000 - 100, y: random() * 600 - 50, w: 2 + random() * 60, h: 2 + random() * 30 }));
		const index = new BoxIndex();
		for (const box of boxes) index.add(box);
		for (let i = 0; i < 500; i++) {
			const probe = { x: random() * 1000 - 100, y: random() * 600 - 50, w: 2 + random() * 80, h: 2 + random() * 40 };
			expect(index.hits(probe)).toBe(boxes.some((box) => intersects(probe, box)));
		}
	});
});

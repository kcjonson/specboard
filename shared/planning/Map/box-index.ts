export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

export const intersects = (a: Box, b: Box): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Boxes already spoken for, in screen pixels, on a uniform grid: asking whether a box
 * hits one touches only the cells it covers, so placing hundreds of labels against
 * thousands of dots stays cheap enough to redo every frame.
 */
export class BoxIndex {
	private readonly cells = new Map<number, Box[]>();
	private readonly cell: number;

	constructor(cell = 64) {
		this.cell = cell;
	}

	add(box: Box): void {
		this.forCells(box, (bucket) => bucket.push(box), true);
	}

	hits(box: Box): boolean {
		let hit = false;
		this.forCells(box, (bucket) => {
			if (!hit && bucket.some((other) => intersects(box, other))) hit = true;
		}, false);
		return hit;
	}

	private forCells(box: Box, visit: (bucket: Box[]) => void, create: boolean): void {
		const x0 = Math.floor(box.x / this.cell);
		const x1 = Math.floor((box.x + box.w) / this.cell);
		const y0 = Math.floor(box.y / this.cell);
		const y1 = Math.floor((box.y + box.h) / this.cell);
		for (let cx = x0; cx <= x1; cx++) {
			for (let cy = y0; cy <= y1; cy++) {
				// Cells are keyed by one number; the stride keeps columns apart for any plausible plot.
				const key = cx * 100_003 + cy;
				let bucket = this.cells.get(key);
				if (!bucket) {
					if (!create) continue;
					bucket = [];
					this.cells.set(key, bucket);
				}
				visit(bucket);
			}
		}
	}
}

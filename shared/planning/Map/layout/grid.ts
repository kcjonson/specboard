/**
 * Points bucketed into a uniform grid by counting sort, for forces that only reach a
 * fixed distance. Points are stored in cell order, so a row of neighboring cells is
 * one contiguous run, and after the buffers have grown a rebuild allocates nothing.
 */
export class CellIndex {
	columns = 0;
	rows = 0;
	cells = 0;
	/** Cell c's points are `start[c]` up to `start[c + 1]` in the sorted arrays. */
	start = new Int32Array(1);
	x = new Float64Array(0);
	y = new Float64Array(0);
	/** Sorted position to the caller's point index. */
	point = new Int32Array(0);
	private cellOf = new Int32Array(0);

	/**
	 * Cells are at least `cell` wide; a scattered set gets wider ones rather than a grid
	 * with more cells than points. Returns the width used.
	 */
	build(xs: Float64Array, ys: Float64Array, count: number, cell: number): number {
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (let i = 0; i < count; i++) {
			const px = xs[i]!;
			const py = ys[i]!;
			if (px < minX) minX = px;
			if (px > maxX) maxX = px;
			if (py < minY) minY = py;
			if (py > maxY) maxY = py;
		}
		const width = Math.max(cell, Math.sqrt(((maxX - minX + 1) * (maxY - minY + 1)) / (4 * count + 64)));
		const columns = Math.floor((maxX - minX) / width) + 1;
		const rows = Math.floor((maxY - minY) / width) + 1;
		const cells = columns * rows;
		this.columns = columns;
		this.rows = rows;
		this.cells = cells;
		if (this.cellOf.length < count) {
			this.cellOf = new Int32Array(count);
			this.x = new Float64Array(count);
			this.y = new Float64Array(count);
			this.point = new Int32Array(count);
		}
		if (this.start.length < cells + 1) this.start = new Int32Array(cells + 1);
		const { cellOf, start, x, y, point } = this;
		start.fill(0, 0, cells + 1);
		for (let i = 0; i < count; i++) {
			const c = Math.floor((xs[i]! - minX) / width) + Math.floor((ys[i]! - minY) / width) * columns;
			cellOf[i] = c;
			start[c + 1]!++;
		}
		for (let c = 0; c < cells; c++) start[c + 1]! += start[c]!;
		// Fill using start[c] as a cursor, then shift the cursors back into starts.
		for (let i = 0; i < count; i++) {
			const k = start[cellOf[i]!]!++;
			x[k] = xs[i]!;
			y[k] = ys[i]!;
			point[k] = i;
		}
		for (let c = cells; c > 0; c--) start[c] = start[c - 1]!;
		start[0] = 0;
		return width;
	}
}

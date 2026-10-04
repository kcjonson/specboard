/**
 * The little color math the Map needs: mixing a mark toward the surface, and the WCAG
 * contrast that says how far it may go. Colors are sRGB channels 0 to 255, mixed in
 * sRGB as CSS `color-mix(in srgb, ...)` does.
 */

export interface Rgb {
	r: number;
	g: number;
	b: number;
}

/** WCAG 1.4.11's floor for graphical objects, which every status mark has to clear. */
export const NON_TEXT_CONTRAST = 3;

/** WCAG AA for normal-size text. */
export const TEXT_CONTRAST = 4.5;

/** Reads `#rgb`, `#rrggbb`, `rgb(r, g, b)`, and `rgba(r, g, b, a)` (alpha ignored), the forms a canvas normalizes colors to. */
export function parseColor(value: string): Rgb | null {
	const text = value.trim().toLowerCase();
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
	if (short) return { r: parseInt(short[1]! + short[1]!, 16), g: parseInt(short[2]! + short[2]!, 16), b: parseInt(short[3]! + short[3]!, 16) };
	const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(text);
	if (long) return { r: parseInt(long[1]!, 16), g: parseInt(long[2]!, 16), b: parseInt(long[3]!, 16) };
	const functional = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(text);
	if (functional) return { r: Number(functional[1]), g: Number(functional[2]), b: Number(functional[3]) };
	return null;
}

export function formatColor({ r, g, b }: Rgb): string {
	const hex = (channel: number): string => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, '0');
	return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** `amount` of `color` and the rest of `ground`: 1 is the color itself, 0 is the ground. */
export function mix(color: Rgb, ground: Rgb, amount: number): Rgb {
	return {
		r: ground.r + (color.r - ground.r) * amount,
		g: ground.g + (color.g - ground.g) * amount,
		b: ground.b + (color.b - ground.b) * amount,
	};
}

function relativeLuminance({ r, g, b }: Rgb): number {
	const linear = (channel: number): number => {
		const c = channel / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrast(a: Rgb, b: Rgb): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The least of `color` a mix toward `ground` can keep and still clear `ratio` against
 * it: plan weight tints down to here and no further. A color that doesn't clear the
 * ratio at full strength can't be tinted at all, so its floor is 1.
 */
export function contrastFloor(color: Rgb, ground: Rgb, ratio = NON_TEXT_CONTRAST): number {
	if (contrast(color, ground) < ratio) return 1;
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 24; i++) {
		const middle = (lo + hi) / 2;
		if (contrast(mix(color, ground, middle), ground) >= ratio) hi = middle;
		else lo = middle;
	}
	return hi;
}

/**
 * Ink for text on `fill`: the first of `inks` that clears text contrast, then black or
 * white, and failing all of those, whichever comes closest.
 */
export function readableInk(fill: Rgb, inks: readonly Rgb[], ratio = TEXT_CONTRAST): Rgb {
	const candidates = [...inks, { r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }];
	return candidates.find((ink) => contrast(ink, fill) >= ratio) ?? candidates.reduce((a, b) => (contrast(a, fill) >= contrast(b, fill) ? a : b));
}

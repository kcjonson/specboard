/** jsdom has no pointer events; a mouse event with the pointer fields on it is enough for the handlers. */
export function installPointerEvents(): void {
	if (typeof window.PointerEvent !== 'undefined') return;
	class PointerEventShim extends MouseEvent {
		readonly pointerId: number;
		readonly pointerType: string;
		readonly isPrimary: boolean;
		constructor(type: string, init: NonNullable<ConstructorParameters<typeof MouseEvent>[1]> & { pointerId?: number; pointerType?: string; isPrimary?: boolean } = {}) {
			super(type, init);
			this.pointerId = init.pointerId ?? 1;
			this.pointerType = init.pointerType ?? 'mouse';
			this.isPrimary = init.isPrimary ?? true;
		}
	}
	Object.defineProperty(window, 'PointerEvent', { value: PointerEventShim, configurable: true });
}

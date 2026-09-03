// CloseWatcher (Chrome 120 / Firefox 132 / Safari 18.4) hasn't landed in
// TypeScript's DOM lib yet. Delete this once lib.dom declares it.
declare class CloseWatcher extends EventTarget {
	constructor(options?: { signal?: AbortSignal });
	requestClose(): void;
	close(): void;
	destroy(): void;
	oncancel: ((this: CloseWatcher, ev: Event) => void) | null;
	onclose: ((this: CloseWatcher, ev: Event) => void) | null;
}

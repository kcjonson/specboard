// CloseWatcher (Chrome 120 / Firefox 132 / Safari 18.4) hasn't landed in
// TypeScript's DOM lib yet. Delete this once lib.dom declares it.
interface CloseWatcher extends EventTarget {
	requestClose(): void;
	close(): void;
	destroy(): void;
	oncancel: ((this: CloseWatcher, ev: Event) => void) | null;
	onclose: ((this: CloseWatcher, ev: Event) => void) | null;
}

declare const CloseWatcher: {
	prototype: CloseWatcher;
	new (options?: { signal?: AbortSignal }): CloseWatcher;
};

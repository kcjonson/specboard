/** A Storage that lives in memory: jsdom's isn't usable under the Node versions this runs on. */
export function memoryStorage(): Storage {
	const entries = new Map<string, string>();
	return {
		get length() {
			return entries.size;
		},
		clear: () => entries.clear(),
		getItem: (key) => entries.get(key) ?? null,
		key: (index) => Array.from(entries.keys())[index] ?? null,
		removeItem: (key) => void entries.delete(key),
		setItem: (key, value) => void entries.set(key, String(value)),
	};
}

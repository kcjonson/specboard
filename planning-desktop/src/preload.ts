import { contextBridge, ipcRenderer } from 'electron';

// Expose platform APIs to the renderer process
contextBridge.exposeInMainWorld('platform', {
	// System API (planning app doesn't need file/git access)
	openExternal: (url: string): Promise<void> =>
		ipcRenderer.invoke('system:openExternal', url),
});

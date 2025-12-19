import { contextBridge, ipcRenderer } from 'electron';

// Expose platform APIs to the renderer process
contextBridge.exposeInMainWorld('platform', {
	// FileSystem API
	readFile: (filePath: string): Promise<string> =>
		ipcRenderer.invoke('fs:readFile', filePath),
	writeFile: (filePath: string, content: string): Promise<void> =>
		ipcRenderer.invoke('fs:writeFile', filePath, content),
	readDir: (dirPath: string): Promise<string[]> =>
		ipcRenderer.invoke('fs:readDir', dirPath),

	// Git API
	gitStatus: (): Promise<unknown> =>
		ipcRenderer.invoke('git:status'),
	gitAdd: (paths: string[]): Promise<void> =>
		ipcRenderer.invoke('git:add', paths),
	gitCommit: (message: string): Promise<void> =>
		ipcRenderer.invoke('git:commit', message),

	// System API
	openExternal: (url: string): Promise<void> =>
		ipcRenderer.invoke('system:openExternal', url),
	showOpenDialog: (options: { directory?: boolean }): Promise<string | null> =>
		ipcRenderer.invoke('system:showOpenDialog', options),
});

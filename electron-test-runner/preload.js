const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('testRunnerApi', {
    runTests: (payload) => ipcRenderer.invoke('tests:run', payload),
    stopTests: () => ipcRenderer.invoke('tests:stop'),
    onOutput: (handler) => {
        const listener = (_event, payload) => handler(payload);
        ipcRenderer.on('tests:output', listener);
        return () => ipcRenderer.removeListener('tests:output', listener);
    },
    onStatus: (handler) => {
        const listener = (_event, payload) => handler(payload);
        ipcRenderer.on('tests:status', listener);
        return () => ipcRenderer.removeListener('tests:status', listener);
    },
    loadTimeline: () => ipcRenderer.invoke('timeline:load'),
    generateTimeline: () => ipcRenderer.invoke('timeline:generate'),
    compareTimeline: (payload) => ipcRenderer.invoke('timeline:compare', payload),
    startInspector: (payload) => ipcRenderer.invoke('inspector:start', payload),
    stopInspector: () => ipcRenderer.invoke('inspector:stop'),
    onInspectorUpdate: (handler) => {
        const listener = (_event, payload) => handler(payload);
        ipcRenderer.on('inspector:update', listener);
        return () => ipcRenderer.removeListener('inspector:update', listener);
    },
    onInspectorStatus: (handler) => {
        const listener = (_event, payload) => handler(payload);
        ipcRenderer.on('inspector:status', listener);
        return () => ipcRenderer.removeListener('inspector:status', listener);
    },
});

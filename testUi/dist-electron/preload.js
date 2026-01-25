"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('ipcRenderer', {
    on(...args) {
        const [channel, listener] = args;
        return electron_1.ipcRenderer.on(channel, (event, ...args) => listener(event, ...args));
    },
    off(...args) {
        const [channel, ...omit] = args;
        return electron_1.ipcRenderer.off(channel, ...omit);
    },
    send(...args) {
        const [channel, ...omit] = args;
        return electron_1.ipcRenderer.send(channel, ...omit);
    },
    invoke(...args) {
        const [channel, ...omit] = args;
        return electron_1.ipcRenderer.invoke(channel, ...omit);
    },
});
electron_1.contextBridge.exposeInMainWorld('api', {
    scanPage: (url) => electron_1.ipcRenderer.invoke('scan-page', url),
    validatePage: (url, jsonObj) => electron_1.ipcRenderer.invoke('validate-page', url, jsonObj),
    openBrowser: (url) => electron_1.ipcRenderer.invoke('open-browser', url),
});

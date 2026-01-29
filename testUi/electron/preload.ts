import { ipcRenderer, contextBridge } from 'electron'

contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})

contextBridge.exposeInMainWorld('api', {
  scanPage: (url: string) => ipcRenderer.invoke('scan-page', url),
  validatePage: (url: string, jsonObj: any, browserOpened?: boolean) =>
    ipcRenderer.invoke('validate-page', url, jsonObj, browserOpened),
  openBrowser: (url: string) => ipcRenderer.invoke('open-browser', url),
  openTestWindow: (loginUrl?: string) => ipcRenderer.invoke('open-test-window', loginUrl),
  scanCurrentPage: () => ipcRenderer.invoke('scan-current-page'),
  clickSubmitInTestWindow: () => ipcRenderer.invoke('click-submit-in-test-window'),
  validateCurrentPage: (jsonObj: any) => ipcRenderer.invoke('validate-current-page', jsonObj),
})

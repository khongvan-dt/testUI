/// <reference types="vite/client" />
 
interface Window {
  api: {
    scanPage: (url: string) => Promise<{ id: string; value: string }[]>
    validatePage: (url: string, jsonObj: any, browserOpened?: boolean) => Promise<{ pass: boolean; errors: any[] }>
  }
}

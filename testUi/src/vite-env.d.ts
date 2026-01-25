/// <reference types="vite/client" />
 
interface Window {
  api: {
    scanPage: (url: string) => Promise<{ id: string; value: string }[]>
    validatePage: (url: string, jsonObj: any) => Promise<{ pass: boolean; errors: any[] }>
  }
}

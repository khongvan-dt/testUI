/// <reference types="vite/client" />
 
interface Window {
  api: {
    scanPage: (url: string) => Promise<{ id: string; value: string }[]>
    validatePage: (url: string, jsonObj: any, browserOpened?: boolean) => Promise<{ pass: boolean; errors: any[] }>
    openBrowser: (url: string) => Promise<{ success: boolean }>
    openTestWindow: (loginUrl?: string) => Promise<{ success: boolean }>
    scanCurrentPage: () => Promise<{ id: string; value: string }[]>
    clickSubmitInTestWindow: () => Promise<{ clicked: boolean; message?: string }>
    validateCurrentPage: (jsonObj: any) => Promise<{ pass: boolean; errors: any[] }>
  }
}

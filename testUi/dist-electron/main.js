"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const http_1 = __importDefault(require("http"));
const fs_1 = require("fs");
const os_1 = require("os");
// Ngăn nhiều instance của app chạy cùng lúc
const gotTheLock = electron_1.app.requestSingleInstanceLock();
if (!gotTheLock) {
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', () => {
        // Nếu có instance khác đang chạy, focus vào window hiện tại
        if (win) {
            if (win.isMinimized())
                win.restore();
            win.focus();
        }
    });
}
let win = null;
let testWindow = null; // BrowserWindow để test - giữ mở suốt
let currentValidateProcess = null; // Lưu reference đến validate process hiện tại (deprecated - sẽ xóa)
// Hàm kiểm tra xem server đã sẵn sàng chưa
async function waitForServer(url, maxRetries = 30, delay = 1000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const isReady = await new Promise((resolve) => {
                const req = http_1.default.get(url, (res) => {
                    resolve(res.statusCode === 200);
                    res.on('data', () => { }); // Consume response
                    res.on('end', () => { });
                });
                req.on('error', () => resolve(false));
                req.setTimeout(1000, () => {
                    req.destroy();
                    resolve(false);
                });
            });
            if (isReady) {
                return true;
            }
        }
        catch (error) {
            // Server chưa sẵn sàng, đợi thêm
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return false;
}
async function createWindow() {
    // Đảm bảo chỉ tạo 1 window
    if (win) {
        win.focus();
        return;
    }
    win = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
        },
        show: false, // Ẩn window cho đến khi load xong
    });
    // Đợi server sẵn sàng trước khi load
    const serverReady = await waitForServer('http://localhost:5178');
    if (serverReady) {
        try {
            await win.loadURL('http://localhost:5178');
            win.show(); // Hiện window sau khi load xong
        }
        catch (error) {
            console.error('Failed to load URL:', error);
            win.show(); // Vẫn hiện window để user thấy lỗi
        }
    }
    else {
        console.error('Vite dev server is not ready after 30 seconds');
        win.show(); // Vẫn hiện window
    }
    win.on('closed', () => {
        win = null;
    });
}
electron_1.app.whenReady().then(createWindow);
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
electron_1.app.on('activate', () => {
    if (win === null) {
        createWindow();
    }
});
electron_1.ipcMain.handle('open-browser', async (_event, url) => {
    console.log('📂 Opening browser for URL:', url);
    await electron_1.shell.openExternal(url);
    return { success: true };
});
electron_1.ipcMain.handle('scan-page', async (_event, url) => {
    console.log(' IPC handler called with URL:', url);
    try {
        const result = await runScan(url);
        console.log(' IPC handler returning result, length:', result.length);
        console.log(' IPC handler result type:', Array.isArray(result) ? 'Array' : typeof result);
        if (result.length > 0) {
            console.log('First result item:', JSON.stringify(result[0]));
        }
        return result;
    }
    catch (error) {
        console.error(' IPC handler error:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('validate-page', async (_event, url, jsonObj, browserOpened) => {
    console.log('📥 IPC handler validate-page called with URL:', url);
    console.log('JSON object:', JSON.stringify(jsonObj).substring(0, 200));
    console.log('Browser already opened:', browserOpened);
    try {
        // Dùng cách mới: BrowserWindow + executeJavaScript thay vì Playwright spawn
        const result = await runValidateInBrowserWindow(url, jsonObj, browserOpened);
        console.log('✅ IPC handler validate-page returning result:', result);
        return result;
    }
    catch (error) {
        console.error('❌ IPC handler validate-page error:', error);
        throw error;
    }
});
// Hàm mới: Validate bằng BrowserWindow + executeJavaScript (không dùng Playwright spawn)
async function runValidateInBrowserWindow(url, jsonObj, browserOpened) {
    // Tạo hoặc reuse BrowserWindow
    if (!testWindow || testWindow.isDestroyed()) {
        console.log('🆕 Creating new test BrowserWindow...');
        testWindow = new electron_1.BrowserWindow({
            width: 1400,
            height: 900,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                webSecurity: true,
            },
            show: true,
        });
        testWindow.on('closed', () => {
            testWindow = null;
            console.log('🔒 Test window closed');
        });
        console.log('✅ Test BrowserWindow created');
    }
    else {
        console.log('♻️ Reusing existing test BrowserWindow');
        testWindow.focus();
    }
    // Load URL vào window (chỉ load nếu URL khác với URL hiện tại)
    const currentURL = testWindow.webContents.getURL();
    if (currentURL !== url && !currentURL.includes(url.split('?')[0])) {
        console.log(`📂 Loading URL: ${url}`);
        await testWindow.loadURL(url);
        // Đợi page load xong
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    else {
        console.log(`♻️ URL already loaded: ${currentURL}`);
        // Đợi một chút để đảm bảo page sẵn sàng
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    // Inject và chạy validation script
    const validationScript = generateValidationScript(jsonObj);
    try {
        const result = await testWindow.webContents.executeJavaScript(validationScript);
        return result;
    }
    catch (error) {
        console.error('❌ Error executing validation script:', error);
        throw error;
    }
}
// Tạo validation script để chạy trong browser context
function generateValidationScript(jsonObj) {
    const jsonStr = JSON.stringify(jsonObj);
    return `
    (async function() {
      const expected = ${jsonStr};
      const errors = [];
      
      // Clear form inputs
      const inputs = document.querySelectorAll('input, textarea, select');
      inputs.forEach((el) => {
        if (el instanceof HTMLInputElement) {
          if (el.type === 'checkbox' || el.type === 'radio') {
            el.checked = false;
          } else {
            el.value = '';
          }
        } else if (el instanceof HTMLTextAreaElement) {
          el.value = '';
        } else if (el instanceof HTMLSelectElement) {
          el.selectedIndex = 0;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Fill form với dữ liệu từ JSON
      for (const key of Object.keys(expected)) {
        const value = String(expected[key] || '');
        const selector = '#' + key.replace(/[!"#$%&'()*+,.\\/:;<=>?@[\\\\\\]^\\\`{|}~]/g, '\\\\$&');
        let element = document.querySelector(selector);
        
        if (!element) {
          // Thử các selector khác
          const altSelectors = [
            \`input[name="\${key}"]\`,
            \`input[id="\${key}"]\`,
            \`[id="\${key}"]\`,
          ];
          for (const altSel of altSelectors) {
            element = document.querySelector(altSel);
            if (element) break;
          }
        }
        
        if (!element) continue;
        
        // Kiểm tra xem có phải wrapper không
        if (!(element instanceof HTMLInputElement) && 
            !(element instanceof HTMLTextAreaElement) && 
            !(element instanceof HTMLSelectElement)) {
          const innerInput = element.querySelector('input, textarea, select');
          if (innerInput) element = innerInput;
        }
        
        // Fill giá trị
        if (element instanceof HTMLInputElement) {
          if (element.type === 'checkbox') {
            const shouldCheck = value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'on';
            element.checked = shouldCheck;
          } else {
            element.value = value;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } else if (element instanceof HTMLTextAreaElement) {
          element.value = value;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (element instanceof HTMLSelectElement) {
          // Tìm option với text matching value
          for (let i = 0; i < element.options.length; i++) {
            if (element.options[i].text.trim() === value) {
              element.selectedIndex = i;
              break;
            }
          }
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Validate các giá trị TRƯỚC KHI submit (để đảm bảo form đã được fill đúng)
      const urlBeforeSubmit = window.location.href;
      for (const key of Object.keys(expected)) {
        const expectedValue = String(expected[key] || '').trim();
        const selector = '#' + key.replace(/[!"#$%&'()*+,.\\/:;<=>?@[\\\\\\]^\\\`{|}~]/g, '\\\\$&');
        let element = document.querySelector(selector);
        
        if (!element) {
          // Thử các selector khác
          const altSelectors = [
            \`input[name="\${key}"]\`,
            \`input[id="\${key}"]\`,
            \`[id="\${key}"]\`,
          ];
          for (const altSel of altSelectors) {
            element = document.querySelector(altSel);
            if (element) break;
          }
        }
        
        if (!element) {
          errors.push({ key, type: 'missing', message: 'Element not found before submit' });
          continue;
        }
        
        // Kiểm tra wrapper
        if (!(element instanceof HTMLInputElement) && 
            !(element instanceof HTMLTextAreaElement) && 
            !(element instanceof HTMLSelectElement)) {
          const innerInput = element.querySelector('input, textarea, select');
          if (innerInput) element = innerInput;
        }
        
        let actualValue = '';
        
        if (element instanceof HTMLInputElement) {
          if (element.type === 'checkbox') {
            const isChecked = element.checked;
            const expectedIsTruthy = expectedValue.toLowerCase() === 'true' || 
                                    expectedValue === '1' || 
                                    expectedValue.toLowerCase() === 'on';
            actualValue = isChecked ? 'true' : 'false';
            
            if (isChecked !== expectedIsTruthy) {
              errors.push({
                key,
                type: 'mismatch',
                expected: expectedValue,
                actual: actualValue
              });
              
              // Highlight
              const el = document.getElementById(key);
              if (el) {
                el.style.outline = '3px solid red';
                el.style.background = 'rgba(255,0,0,0.15)';
                el.style.border = '2px solid red';
                el.setAttribute('title', \`⚠️ i18n mismatch\\nExpected: "\${expectedValue}"\\nActual: "\${actualValue}"\`);
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }
            continue;
          } else if (element.type === 'password' && !element.value && expectedValue) {
            // Password có thể bị clear sau submit, skip
            continue;
          } else {
            actualValue = (element.value || '').trim();
          }
        } else if (element instanceof HTMLTextAreaElement) {
          actualValue = (element.value || '').trim();
        } else if (element instanceof HTMLSelectElement) {
          actualValue = (element.options[element.selectedIndex]?.text || '').trim();
        } else {
          actualValue = (element.innerText || element.textContent || '').trim();
        }
        
        if (actualValue !== expectedValue) {
          errors.push({
            key,
            type: 'mismatch',
            expected: expectedValue,
            actual: actualValue
          });
          
          // Highlight
          const el = document.getElementById(key);
          if (el) {
            el.style.outline = '3px solid red';
            el.style.background = 'rgba(255,0,0,0.15)';
            el.style.border = '2px solid red';
            el.setAttribute('title', \`⚠️ i18n mismatch\\nExpected: "\${expectedValue}"\\nActual: "\${actualValue}"\`);
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }
      
      // Submit form nếu có submit button
      const submitButton = document.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
      if (submitButton) {
        submitButton.click();
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Kiểm tra xem có redirect không (redirect = success)
        const urlAfterSubmit = window.location.href;
        const urlChanged = urlAfterSubmit !== urlBeforeSubmit;
        const stillOnLoginPage = urlAfterSubmit.includes('login') || urlAfterSubmit.includes('auth/login');
        const isSuccessRedirect = urlChanged && !stillOnLoginPage;
        
        if (isSuccessRedirect) {
          // Redirect thành công - loại bỏ các lỗi "missing" vì element không còn tồn tại là bình thường
          // Chỉ giữ lại các lỗi "mismatch" (nếu có) từ validation trước khi submit
          // Filter errors array bằng cách tạo array mới
          const filteredErrors = [];
          for (let i = 0; i < errors.length; i++) {
            const err = errors[i];
            // Giữ lại lỗi nếu không phải "missing" hoặc nếu là "missing" nhưng không phải do redirect
            if (err.type !== 'missing' || err.message !== 'Element not found before submit') {
              filteredErrors.push(err);
            }
          }
          // Clear và refill errors array
          errors.length = 0;
          errors.push(...filteredErrors);
          console.log('✅ Redirect successful - login page elements no longer exist (this is expected)');
          console.log('✅ Removed "missing" errors for elements that no longer exist after redirect');
        } else {
          // Vẫn ở trang login - validate lại để đảm bảo giá trị vẫn đúng
          // (có thể form không submit được hoặc có lỗi)
          for (const key of Object.keys(expected)) {
            const expectedValue = String(expected[key] || '').trim();
            const selector = '#' + key.replace(/[!"#$%&'()*+,.\\/:;<=>?@[\\\\\\]^\\\`{|}~]/g, '\\\\$&');
            let element = document.querySelector(selector);
            
            if (!element) {
              const altSelectors = [
                \`input[name="\${key}"]\`,
                \`input[id="\${key}"]\`,
                \`[id="\${key}"]\`,
              ];
              for (const altSel of altSelectors) {
                element = document.querySelector(altSel);
                if (element) break;
              }
            }
            
            if (!element) continue; // Element không tồn tại sau submit - có thể đã redirect
            
            // Kiểm tra wrapper
            if (!(element instanceof HTMLInputElement) && 
                !(element instanceof HTMLTextAreaElement) && 
                !(element instanceof HTMLSelectElement)) {
              const innerInput = element.querySelector('input, textarea, select');
              if (innerInput) element = innerInput;
            }
            
            let actualValue = '';
            
            if (element instanceof HTMLInputElement) {
              if (element.type === 'checkbox') {
                const isChecked = element.checked;
                const expectedIsTruthy = expectedValue.toLowerCase() === 'true' || 
                                        expectedValue === '1' || 
                                        expectedValue.toLowerCase() === 'on';
                actualValue = isChecked ? 'true' : 'false';
                
                if (isChecked !== expectedIsTruthy) {
                  // Chỉ thêm lỗi nếu chưa có trong errors
                  const existingError = errors.find(e => e.key === key);
                  if (!existingError) {
                    errors.push({
                      key,
                      type: 'mismatch',
                      expected: expectedValue,
                      actual: actualValue
                    });
                  }
                }
                continue;
              } else if (element.type === 'password' && !element.value && expectedValue) {
                // Password có thể bị clear sau submit, skip
                continue;
              } else {
                actualValue = (element.value || '').trim();
              }
            } else if (element instanceof HTMLTextAreaElement) {
              actualValue = (element.value || '').trim();
            } else if (element instanceof HTMLSelectElement) {
              actualValue = (element.options[element.selectedIndex]?.text || '').trim();
            } else {
              actualValue = (element.innerText || element.textContent || '').trim();
            }
            
            if (actualValue !== expectedValue) {
              // Chỉ thêm lỗi nếu chưa có trong errors
              const existingError = errors.find(e => e.key === key);
              if (!existingError) {
                errors.push({
                  key,
                  type: 'mismatch',
                  expected: expectedValue,
                  actual: actualValue
                });
              }
            }
          }
        }
      } else {
        // Không có submit button - chỉ validate giá trị đã fill
        // (đã validate ở trên)
      }
      
      // Hiển thị overlay kết quả
      const existingOverlay = document.getElementById('i18n-validate-overlay');
      if (existingOverlay) existingOverlay.remove();
      
      const overlay = document.createElement('div');
      overlay.id = 'i18n-validate-overlay';
      overlay.style.cssText = \`
        position: fixed;
        top: 20px;
        right: 20px;
        background: \${errors.length === 0 ? '#28a745' : '#dc3545'};
        color: white;
        padding: 16px 24px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 999999;
        font-family: Arial, sans-serif;
        font-size: 14px;
        max-width: 400px;
        max-height: 80vh;
        overflow-y: auto;
      \`;
      
      const title = document.createElement('div');
      title.style.cssText = 'font-weight: bold; font-size: 16px; margin-bottom: 12px;';
      title.textContent = errors.length === 0 ? '✅ Validation PASSED' : \`❌ Validation FAILED (\${errors.length} errors)\`;
      overlay.appendChild(title);
      
      if (errors.length > 0) {
        const errorList = document.createElement('div');
        errorList.style.cssText = 'font-size: 12px; line-height: 1.6;';
        errors.forEach((err, idx) => {
          const errDiv = document.createElement('div');
          errDiv.style.cssText = 'margin-bottom: 8px; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 4px;';
          errDiv.innerHTML = \`
            <strong>\${idx + 1}. \${err.key}</strong><br>
            <span style="font-size: 11px;">
              \${err.type === 'missing' ? '⚠️ Element not found' : err.type === 'mismatch' ? '⚠️ Value mismatch' : '⚠️ Error'}<br>
              \${err.expected ? \`Expected: "\${err.expected}"\` : ''}<br>
              \${err.actual ? \`Actual: "\${err.actual}"\` : ''}
            </span>
          \`;
          errorList.appendChild(errDiv);
        });
        overlay.appendChild(errorList);
      }
      
      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'Close';
      closeBtn.style.cssText = \`
        margin-top: 12px;
        padding: 8px 16px;
        background: rgba(255,255,255,0.2);
        border: 1px solid rgba(255,255,255,0.3);
        color: white;
        border-radius: 4px;
        cursor: pointer;
        width: 100%;
      \`;
      closeBtn.onclick = () => overlay.remove();
      overlay.appendChild(closeBtn);
      
      document.body.appendChild(overlay);
      
      // Scroll đến phần tử đầu tiên có lỗi
      if (errors.length > 0 && errors[0].key) {
        const firstErrorEl = document.getElementById(errors[0].key);
        if (firstErrorEl) {
          firstErrorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
      
      return { pass: errors.length === 0, errors };
    })()
  `;
}
// Hàm cũ: Validate bằng Playwright spawn (deprecated - giữ lại để backup)
function runValidate(url, jsonObj, browserOpened) {
    return new Promise(async (resolve, reject) => {
        const runnerPath = path_1.default.join(__dirname, '../electron/runners/validatePage.cjs');
        const jsonText = JSON.stringify(jsonObj);
        console.log('📌 Starting validate for URL:', url);
        console.log('📌 Runner path:', runnerPath);
        console.log('📌 JSON length:', jsonText.length);
        // ✅ tạo file temp để truyền JSON
        const tempFile = path_1.default.join((0, os_1.tmpdir)(), `validate-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
        try {
            (0, fs_1.writeFileSync)(tempFile, jsonText, 'utf8');
            console.log('✅ JSON written to temp file:', tempFile);
        }
        catch (err) {
            return reject(new Error(`Failed to write temp file: ${err instanceof Error ? err.message : String(err)}`));
        }
        // ✅ check file temp tồn tại
        if (!(0, fs_1.existsSync)(tempFile)) {
            return reject(new Error(`Temp file does not exist: ${tempFile}`));
        }
        console.log('✅ Temp file size:', (0, fs_1.statSync)(tempFile).size, 'bytes');
        // ✅ Kiểm tra runner file tồn tại
        if (!(0, fs_1.existsSync)(runnerPath)) {
            try {
                (0, fs_1.unlinkSync)(tempFile);
            }
            catch { }
            return reject(new Error(`Runner file not found: ${runnerPath}`));
        }
        // Không kill process cũ - để giữ browser mở và có thể test nhiều lần
        // Browser sẽ tự động reuse nếu dùng cùng userDataDir (persistent context)
        // Process cũ sẽ tiếp tục chạy để giữ browser mở
        if (currentValidateProcess && !currentValidateProcess.killed) {
            console.log('ℹ️ Previous validate process still running (PID:', currentValidateProcess.pid, ')');
            console.log('ℹ️ Browser is still open - new test will reuse the same browser instance');
            console.log('ℹ️ Previous browser tab will stay open for comparison');
            // KHÔNG kill process cũ - để giữ browser mở
            // User có thể test nhiều lần và so sánh kết quả
        }
        // ✅ fork runner (dùng fork thay vì spawn để tránh crash trong Electron)
        // fork() tự động dùng Node.js thay vì electron.exe
        // Truyền browserOpened flag để runner biết có nên reuse tab không
        const child = (0, child_process_1.fork)(runnerPath, [url, tempFile, browserOpened ? 'reuse' : 'new'], {
            cwd: path_1.default.join(__dirname, '../..'), // Set về root project để tìm đúng node_modules
            env: {
                ...process.env,
            },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });
        // Lưu reference đến process hiện tại
        currentValidateProcess = child;
        console.log('✅ Process spawned, PID:', child.pid);
        // Kiểm tra process có spawn thành công không
        if (!child.pid) {
            try {
                (0, fs_1.unlinkSync)(tempFile);
            }
            catch { }
            return reject(new Error('Failed to spawn validate process (no PID)'));
        }
        let out = '';
        let err = '';
        let resultResolved = false; // Flag để đảm bảo chỉ resolve một lần
        const timeout = setTimeout(() => {
            if (!resultResolved) {
                console.error('⚠️ Validate timeout, killing process...');
                try {
                    child.kill('SIGTERM');
                }
                catch { }
                setTimeout(() => {
                    try {
                        child.kill('SIGKILL');
                    }
                    catch { }
                }, 1500);
                try {
                    (0, fs_1.unlinkSync)(tempFile);
                }
                catch { }
                resultResolved = true;
                reject(new Error('Validate timeout after 90 seconds'));
            }
        }, 90000);
        if (child.stdout) {
            child.stdout.on('data', (d) => {
                const chunk = d.toString();
                out += chunk;
                // Thử parse JSON ngay khi có đủ dữ liệu
                // Nếu có kết quả hợp lệ, resolve ngay (không đợi process exit)
                if (!resultResolved && out.trim()) {
                    try {
                        const trimmedOut = out.trim();
                        // Kiểm tra xem có phải JSON hợp lệ không
                        if (trimmedOut.startsWith('{') && trimmedOut.includes('"pass"')) {
                            const data = JSON.parse(trimmedOut);
                            if (data.pass !== undefined) {
                                // Đã có kết quả hợp lệ, resolve ngay
                                console.log('✅ Got result from stdout, resolving immediately (process will continue in background)');
                                clearTimeout(timeout);
                                resultResolved = true;
                                // Cleanup
                                try {
                                    (0, fs_1.unlinkSync)(tempFile);
                                }
                                catch { }
                                // KHÔNG clear reference nếu browser đã mở (browserOpened = true)
                                // Để giữ browser mở cho các lần test tiếp theo
                                // Chỉ clear reference khi không phải reuse mode
                                if (!browserOpened && currentValidateProcess === child) {
                                    currentValidateProcess = null;
                                }
                                return resolve(data);
                            }
                        }
                    }
                    catch (e) {
                        // Chưa có đủ dữ liệu, tiếp tục đợi
                    }
                }
            });
        }
        if (child.stderr) {
            child.stderr.on('data', (d) => {
                const text = d.toString();
                err += text;
                // Log toàn bộ stderr để debug
                console.error('Runner stderr:', text);
            });
        }
        child.on('error', (error) => {
            clearTimeout(timeout);
            try {
                (0, fs_1.unlinkSync)(tempFile);
            }
            catch { }
            reject(new Error(`Failed to start validate process: ${error.message}`));
        });
        child.on('close', (code, signal) => {
            // Nếu đã resolve rồi (từ stdout), không làm gì thêm
            if (resultResolved) {
                console.log('Process closed (result already resolved from stdout)');
                return;
            }
            clearTimeout(timeout);
            console.log('=== Validate Exit Info ===');
            console.log('Exit code:', code);
            console.log('Signal:', signal);
            console.log('stdout length:', out.length);
            console.log('stderr length:', err.length);
            console.log('=========================');
            // ✅ luôn xoá file temp
            try {
                (0, fs_1.unlinkSync)(tempFile);
            }
            catch { }
            // ✅ nếu runner lỗi
            if (code !== 0) {
                resultResolved = true;
                // Log đầy đủ thông tin lỗi
                console.error('=== Validate Runner Error Details ===');
                console.error('Exit code:', code);
                console.error('Signal:', signal);
                console.error('Stderr output:', err);
                console.error('Stdout output:', out.substring(0, 1000));
                console.error('=====================================');
                // Kiểm tra lỗi phổ biến
                if (err.includes('Executable doesn\'t exist') || err.includes('Browser not found') || err.includes('chromium')) {
                    return reject(new Error('Playwright browser chưa được cài đặt. Vui lòng chạy: npx playwright install chromium'));
                }
                // Mã lỗi 4294967295 (0xFFFFFFFF) trên Windows thường là do process bị kill
                if (code === 4294967295 || code === -1) {
                    const errorHint = err
                        ? `Process bị kill hoặc crash. Chi tiết: ${err.substring(0, 500)}`
                        : 'Process bị kill hoặc crash. Có thể do: Playwright browser chưa được cài đặt, hoặc thiếu bộ nhớ, hoặc bị antivirus chặn.';
                    return reject(new Error(errorHint));
                }
                const msg = (err || `Runner failed with code ${code}`).trim();
                return reject(new Error(msg));
            }
            // ✅ stdout rỗng
            if (!out.trim()) {
                resultResolved = true;
                return reject(new Error('No data returned from validate runner'));
            }
            // ✅ parse JSON output
            try {
                const data = JSON.parse(out.trim());
                resultResolved = true;
                // KHÔNG clear reference nếu browser đã mở (browserOpened = true)
                // Để giữ browser mở cho các lần test tiếp theo
                // Chỉ clear reference khi không phải reuse mode
                if (!browserOpened && currentValidateProcess === child) {
                    currentValidateProcess = null;
                }
                return resolve(data);
            }
            catch (e) {
                console.error('Invalid runner JSON output:', out.slice(0, 500));
                return reject(new Error(`Runner output is not valid JSON: ${e instanceof Error ? e.message : String(e)}`));
            }
        });
    });
}
function runScan(url) {
    return new Promise((resolve, reject) => {
        const runnerPath = path_1.default.join(__dirname, '../electron/runners/scanPage.cjs');
        console.log('Starting scan for URL:', url);
        console.log('Runner path:', runnerPath);
        // ✅ fork runner (dùng fork thay vì spawn để tránh crash trong Electron)
        // fork() tự động dùng Node.js thay vì electron.exe
        const child = (0, child_process_1.fork)(runnerPath, [url], {
            cwd: path_1.default.join(__dirname, '../..'), // Set về root project để tìm đúng node_modules
            env: {
                ...process.env,
            },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });
        let out = '';
        let err = '';
        if (child.stdout) {
            child.stdout.on('data', (d) => {
                const text = d.toString();
                out += text;
                // Chỉ log một phần để tránh spam
                if (out.length < 500) {
                    console.log('Runner stdout chunk:', text.substring(0, 100));
                }
            });
        }
        if (child.stderr) {
            child.stderr.on('data', (d) => {
                const text = d.toString();
                err += text;
                // Log stderr để debug
                console.log('Runner stderr (info):', text.trim());
            });
        }
        child.on('error', (error) => {
            console.error('❌ Failed to spawn runner:', error);
            clearTimeout(timeout);
            reject(new Error(`Failed to start scan process: ${error.message}`));
        });
        // Thêm timeout để tránh đợi quá lâu
        const timeout = setTimeout(() => {
            child.kill();
            reject(new Error('Scan timeout after 60 seconds'));
        }, 60000);
        child.on('close', (code, signal) => {
            clearTimeout(timeout);
            console.log('✅ Runner exited with code:', code, 'signal:', signal);
            console.log('Runner stdout length:', out.length);
            console.log('Runner stderr length:', err.length);
            if (err) {
                console.log('Runner stderr content:', err);
            }
            if (code !== 0) {
                const errorMsg = err || `Runner failed with code ${code}`;
                console.error('Scan failed:', errorMsg);
                return reject(new Error(errorMsg));
            }
            if (!out.trim()) {
                console.error('No output from runner');
                return reject(new Error('No data returned from scan. Make sure the page has elements with id attributes.'));
            }
            try {
                // Trim output để loại bỏ whitespace
                const trimmedOut = out.trim();
                console.log('Parsing JSON, length:', trimmedOut.length);
                console.log('First 200 chars:', trimmedOut.substring(0, 200));
                const data = JSON.parse(trimmedOut);
                console.log('✅ Scan successful, found', data.length, 'items');
                console.log('Data type:', Array.isArray(data) ? 'Array' : typeof data);
                if (data.length > 0) {
                    console.log('First item:', JSON.stringify(data[0]));
                }
                if (!Array.isArray(data)) {
                    console.error('❌ Data is not an array:', typeof data);
                    return reject(new Error('Data returned is not an array'));
                }
                console.log('✅ Resolving with', data.length, 'items');
                resolve(data);
            }
            catch (e) {
                console.error('❌ Failed to parse JSON:', e);
                console.error('Raw output length:', out.length);
                console.error('Raw output (first 500 chars):', out.substring(0, 500));
                reject(new Error(`Runner output is not valid JSON: ${e instanceof Error ? e.message : String(e)}`));
            }
        });
        child.on('error', (error) => {
            console.error('Failed to spawn runner:', error);
            reject(new Error(`Failed to start scan process: ${error.message}`));
        });
    });
}

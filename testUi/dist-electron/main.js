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
let currentValidateProcess = null; // Lưu reference đến validate process hiện tại
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
electron_1.ipcMain.handle('validate-page', async (_event, url, jsonObj) => {
    console.log('📥 IPC handler validate-page called with URL:', url);
    console.log('JSON object:', JSON.stringify(jsonObj).substring(0, 200));
    try {
        const result = await runValidate(url, jsonObj);
        console.log('✅ IPC handler validate-page returning result:', result);
        return result;
    }
    catch (error) {
        console.error('❌ IPC handler validate-page error:', error);
        throw error;
    }
});
function runValidate(url, jsonObj) {
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
        // Kill process cũ nếu có (để có thể test nhiều lần mà không cần đóng browser)
        if (currentValidateProcess && !currentValidateProcess.killed) {
            console.log('⚠️ Killing previous validate process (PID:', currentValidateProcess.pid, ') to start new test...');
            try {
                currentValidateProcess.kill('SIGTERM');
                // Đợi một chút để process cũ có thời gian cleanup
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            catch (e) {
                console.log('⚠️ Error killing previous process:', e);
            }
        }
        // ✅ fork runner (dùng fork thay vì spawn để tránh crash trong Electron)
        // fork() tự động dùng Node.js thay vì electron.exe
        const child = (0, child_process_1.fork)(runnerPath, [url, tempFile], {
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
                                // Clear reference
                                if (currentValidateProcess === child) {
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
                // Clear reference
                if (currentValidateProcess === child) {
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

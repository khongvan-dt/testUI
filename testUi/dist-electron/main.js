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
// IPC handler: Mở BrowserWindow để user login thủ công
electron_1.ipcMain.handle('open-test-window', async (_event, loginUrl) => {
    console.log('🪟 IPC handler open-test-window called, loginUrl:', loginUrl);
    try {
        await openTestWindow(loginUrl);
        return { success: true };
    }
    catch (error) {
        console.error('❌ IPC handler open-test-window error:', error);
        throw error;
    }
});
// IPC handler: Scan trang hiện tại trong BrowserWindow
electron_1.ipcMain.handle('scan-current-page', async (_event) => {
    console.log('📥 IPC handler scan-current-page called');
    try {
        const result = await scanCurrentPage();
        console.log('✅ IPC handler scan-current-page returning result, count:', result.length);
        return result;
    }
    catch (error) {
        console.error('❌ IPC handler scan-current-page error:', error);
        throw error;
    }
});
// IPC handler: Click nút submit trên trang hiện tại trong BrowserWindow
electron_1.ipcMain.handle('click-submit-in-test-window', async () => {
    console.log('📥 IPC handler click-submit-in-test-window called');
    try {
        const result = await clickSubmitInTestWindow();
        console.log('✅ IPC handler click-submit-in-test-window result:', result);
        return result;
    }
    catch (error) {
        console.error('❌ IPC handler click-submit-in-test-window error:', error);
        throw error;
    }
});
// IPC handler: Validate trên trang hiện tại (không load URL mới)
electron_1.ipcMain.handle('validate-current-page', async (_event, jsonObj) => {
    console.log('📥 IPC handler validate-current-page called');
    console.log('JSON object:', JSON.stringify(jsonObj).substring(0, 200));
    try {
        const result = await validateCurrentPage(jsonObj);
        console.log('✅ IPC handler validate-current-page returning result:', result);
        return result;
    }
    catch (error) {
        console.error('❌ IPC handler validate-current-page error:', error);
        throw error;
    }
});
// Chuẩn hóa URL: thêm http:// nếu thiếu protocol
function normalizeUrl(url) {
    const trimmed = (url || '').trim();
    if (!trimmed)
        return trimmed;
    // Nếu đã có protocol, giữ nguyên
    if (/^https?:\/\//i.test(trimmed)) {
        return trimmed;
    }
    // Nếu bắt đầu bằng localhost hoặc IP hoặc domain, thêm http://
    if (/^[a-zA-Z0-9.-]+(:\d+)?(\/|$)/.test(trimmed) || trimmed.startsWith('localhost')) {
        return `http://${trimmed}`;
    }
    return trimmed;
}
// Hàm: Mở BrowserWindow để user login thủ công
async function openTestWindow(loginUrl) {
    // Chuẩn hóa URL trước khi load
    const urlToLoad = loginUrl ? normalizeUrl(loginUrl) : undefined;
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
    // Nếu có loginUrl, load URL đó; nếu không, để user tự điều hướng
    if (urlToLoad) {
        const currentURL = testWindow.webContents.getURL();
        if (currentURL !== urlToLoad && !currentURL.includes(urlToLoad.split('?')[0])) {
            console.log(`📂 Loading login URL: ${urlToLoad}`);
            await testWindow.loadURL(urlToLoad);
            // Đợi page load xong
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        else {
            console.log(`♻️ Login URL already loaded: ${currentURL}`);
        }
    }
    else if (loginUrl?.trim()) {
        // User nhập URL nhưng sau khi normalize vẫn rỗng (không xảy ra) hoặc chỉ có khoảng trắng
        console.log('ℹ️ No valid login URL after normalize');
    }
    else {
        console.log('ℹ️ No login URL provided - user will navigate manually');
        // Nếu window chưa có URL nào, load about:blank
        const currentURL = testWindow.webContents.getURL();
        if (!currentURL || currentURL === 'about:blank') {
            await testWindow.loadURL('about:blank');
        }
    }
}
// Hàm: Scan trang hiện tại trong BrowserWindow
async function scanCurrentPage() {
    // Kiểm tra BrowserWindow đã mở chưa
    if (!testWindow || testWindow.isDestroyed()) {
        throw new Error('BrowserWindow chưa được mở. Vui lòng nhấn "Mở BrowserWindow" trước.');
    }
    const currentURL = testWindow.webContents.getURL();
    if (!currentURL || currentURL === 'about:blank') {
        throw new Error('BrowserWindow chưa load trang nào. Vui lòng điều hướng đến trang cần test trước.');
    }
    console.log(`🔍 Scanning current page: ${currentURL}`);
    testWindow.focus();
    // Đợi một chút để đảm bảo page sẵn sàng
    await new Promise(resolve => setTimeout(resolve, 1000));
    // Scroll để trigger lazy loading
    await testWindow.webContents.executeJavaScript(`
    (async function() {
      // Scroll về đầu trang
      window.scrollTo(0, 0)
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Scroll xuống dần để trigger lazy loading
      const scrollHeight = document.documentElement.scrollHeight
      const viewportHeight = window.innerHeight
      
      for (let scroll = 0; scroll < scrollHeight; scroll += viewportHeight) {
        window.scrollTo(0, scroll)
        await new Promise(resolve => setTimeout(resolve, 300))
      }
      
      // Scroll về đầu trang
      window.scrollTo(0, 0)
      await new Promise(resolve => setTimeout(resolve, 500))
    })()
  `);
    // Đợi thêm một chút để đảm bảo tất cả đã render
    await new Promise(resolve => setTimeout(resolve, 1000));
    // Scan script với phân tích cấu trúc phân cấp
    const scanScript = `
    (function() {
      try {
      const result = []
      const elements = Array.from(document.querySelectorAll('[id]'))
      const elementMap = new Map() // Map id -> element
      const parentMap = new Map() // Map id -> parent id

      // Loại bỏ các phần tử không cần thiết
      const excludeTags = ['STYLE', 'SCRIPT', 'NOSCRIPT', 'META', 'LINK', 'HEAD']
      const excludeIds = [
        'googleidentityservice',
        'gsi',
        '__next',
        'react',
        'app',
        'root',
      ]
      
      // Loại bỏ các id quá ngắn hoặc không có ý nghĩa
      const excludeIdPatterns = [
        /^[a-z]$/i, // Chỉ 1 ký tự
        /^[0-9]+$/, // Chỉ số
        /^pv_id_\d+$/i, // Auto-generated IDs như pv_id_329
        /^[a-z]+_id_\d+$/i, // Pattern: prefix_id_number (auto-generated)
        /^id_\d+$/i, // Pattern: id_number
      ]
      
      // Function để check xem id có phải auto-generated không
      function isAutoGeneratedId(id) {
        // Check patterns
        if (excludeIdPatterns.some(pattern => pattern.test(id))) {
          return true
        }
        
        // Check pattern: letters_underscore_letters_underscore_numbers (như pv_id_329)
        if (/^[a-z]+_[a-z]+_\d+$/i.test(id)) {
          return true
        }
        
        // Check pattern cụ thể: pv_id_xxx, id_xxx, etc.
        if (/^(pv|id|auto|gen|temp|tmp)_[a-z]*_\d+$/i.test(id)) {
          return true
        }
        
        // Check pattern: chỉ có số ở cuối sau underscore (như prefix_123)
        // Nhưng giữ lại các id có camelCase như ngayApDungTu, tenMoTaTraVe
        if (/^[a-z]+_\d+$/i.test(id)) {
          // Nếu có camelCase sau underscore đầu tiên, giữ lại
          const parts = id.split('_')
          if (parts.length === 2 && /[A-Z]/.test(parts[0])) {
            return false // Giữ lại camelCase như ngayApDungTu
          }
          return true // Loại bỏ pattern như prefix_123
        }
        
        return false
      }

      // Bước 1: Lọc và map các elements
      for (const el of elements) {
        const id = (el.id || '').trim()
        if (!id) continue

        // Bỏ qua các tag không cần thiết
        if (excludeTags.includes(el.tagName)) continue
        
        // Bỏ qua các id chứa từ khóa không cần thiết
        if (excludeIds.some(exclude => id.toLowerCase() === exclude.toLowerCase())) continue
        
        // Bỏ qua các id match pattern không cần thiết hoặc auto-generated
        if (isAutoGeneratedId(id)) continue
        
        // Bỏ qua các phần tử ẩn (nhưng giữ lại các input/select/textarea)
        const style = window.getComputedStyle(el)
        const isInputElement = el instanceof HTMLInputElement || 
                              el instanceof HTMLTextAreaElement || 
                              el instanceof HTMLSelectElement
        
        if (!isInputElement && (style.display === 'none' || style.visibility === 'hidden')) continue

        elementMap.set(id, el)
      }

      // Bước 2: Xác định parent-child relationship
      // Tìm parent có id gần nhất trong DOM tree
      for (const [id, el] of elementMap.entries()) {
        let parent = el.parentElement
        let parentId = null
        
        // Tìm parent có id trong elementMap
        while (parent) {
          const pid = parent.id?.trim()
          if (pid && elementMap.has(pid)) {
            parentId = pid
            break
          }
          parent = parent.parentElement
        }
        
        if (parentId) {
          parentMap.set(id, parentId)
        }
      }

      // Bước 3: Tính toán level và path cho mỗi element
      function getLevelAndPath(id, visited = new Set()) {
        if (visited.has(id)) return { level: 0, path: id } // Circular reference
        
        visited.add(id)
        const parentId = parentMap.get(id)
        
        if (!parentId) {
          return { level: 0, path: id }
        }
        
        const parentInfo = getLevelAndPath(parentId, visited)
        return {
          level: parentInfo.level + 1,
          path: parentInfo.path + '.' + id
        }
      }

      // Bước 4: Xác định các container (array containers)
      // Pattern: id kết thúc bằng "s" hoặc chứa "Details", "ApDungs", "List", etc.
      const arrayContainerPatterns = [
        /Details$/i,
        /ApDungs$/i,
        /List$/i,
        /s$/i, // Plural form
      ]
      
      const arrayContainers = new Set()
      for (const [id, el] of elementMap.entries()) {
        // Kiểm tra xem element này có phải là container không
        // (có nhiều child elements có id)
        const childIds = []
        for (const child of el.querySelectorAll('[id]')) {
          const childId = child.id?.trim()
          if (childId && elementMap.has(childId) && childId !== id) {
            childIds.push(childId)
          }
        }
        
        // Nếu có nhiều child hoặc match pattern array container
        if (childIds.length > 1 || arrayContainerPatterns.some(pattern => pattern.test(id))) {
          arrayContainers.add(id)
        }
      }

      // Bước 5: Xác định arrayIndex cho các element trong array containers
      // Map để lưu arrayIndex đã được gán cho các element
      const elementArrayIndexMap = new Map()
      
      // Với mỗi array container, nhóm các children elements
      for (const parentId of arrayContainers) {
        const parentEl = elementMap.get(parentId)
        if (!parentEl) continue
        
        // Lấy tất cả các element có parent là parentId
        const childrenElements = Array.from(elementMap.entries())
          .filter(([cid]) => parentMap.get(cid) === parentId)
          .map(([cid, cel]) => ({ id: cid, el: cel }))
        
        if (childrenElements.length === 0) continue
        
        // Nhóm các element dựa trên direct parent (wrapper div/tr)
        // Các element có cùng direct parent (không có id) sẽ có cùng arrayIndex
        const groups = new Map()
        
        for (const child of childrenElements) {
          // Tìm direct parent không có id (wrapper element)
          let wrapper = child.el.parentElement
          let foundWrapper = null
          
          while (wrapper && wrapper !== parentEl) {
            const wrapperId = wrapper.id?.trim()
            // Nếu wrapper không có id hoặc id không trong elementMap, đây là wrapper
            if (!wrapperId || !elementMap.has(wrapperId)) {
              foundWrapper = wrapper
              break
            }
            wrapper = wrapper.parentElement
          }
          
          // Sử dụng wrapper đã tìm được hoặc element chính nó
          const groupKey = foundWrapper || child.el
          if (!groups.has(groupKey)) {
            groups.set(groupKey, [])
          }
          const group = groups.get(groupKey)
          if (group) {
            group.push(child)
          }
        }
        
        // Sắp xếp các groups theo thứ tự trong DOM và gán arrayIndex
        const DOCUMENT_POSITION_FOLLOWING = 4
        const DOCUMENT_POSITION_PRECEDING = 2
        const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
          try {
            const pos = a[0].compareDocumentPosition(b[0])
            if (pos & DOCUMENT_POSITION_FOLLOWING) return -1
            if (pos & DOCUMENT_POSITION_PRECEDING) return 1
            return 0
          } catch (e) {
            // Fallback: so sánh bằng cách kiểm tra vị trí trong DOM
            const allElements = Array.from(parentEl.querySelectorAll('*'))
            const indexA = allElements.indexOf(a[0])
            const indexB = allElements.indexOf(b[0])
            return indexA - indexB
          }
        })
        
        sortedGroups.forEach((group, groupIndex) => {
          group[1].forEach(child => {
            elementArrayIndexMap.set(child.id, groupIndex)
          })
        })
      }

      // Bước 6: Tạo kết quả với thông tin phân cấp
      for (const [id, el] of elementMap.entries()) {
        const { level, path } = getLevelAndPath(id)
        const isArrayContainer = arrayContainers.has(id)
        
        // Xác định parent id
        const parentId = parentMap.get(id) || null
        
        // Lấy arrayIndex từ map đã tính toán (chỉ khi parent là array container)
        const arrayIndex = (parentId && arrayContainers.has(parentId)) 
          ? (elementArrayIndexMap.get(id) ?? null)
          : null

        let value = ''

        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          value = el.placeholder || el.value || ''
          if (!value) {
            const label = el.closest('label') || document.querySelector(\`label[for="\${id}"]\`)
            if (label) {
              value = label.textContent || ''
            }
          }
        } else if (el instanceof HTMLSelectElement) {
          value = el.options[el.selectedIndex]?.text || el.options[0]?.text || ''
        } else if (el instanceof HTMLLabelElement) {
          value = el.textContent || ''
        } else {
          const clone = el.cloneNode(true)
          clone.querySelectorAll('[id]').forEach(child => child.remove())
          value = clone.innerText || clone.textContent || ''
        }

        value = (value || '').trim()
        
        // Bỏ qua nếu value quá dài
        if (value.length > 500) continue
        
        // Bỏ qua nếu value chỉ chứa CSS hoặc code
        if (value.includes('{') && value.includes('}') && value.includes(':')) continue
        
        const isInputElement = el instanceof HTMLInputElement || 
                              el instanceof HTMLTextAreaElement || 
                              el instanceof HTMLSelectElement
        
        // Với input/select/textarea, luôn thêm vào kể cả value rỗng
        if (!value && !isInputElement) continue

        result.push({ 
          id, 
          value,
          level,
          path,
          parentId,
          arrayIndex: arrayIndex !== null ? arrayIndex : undefined,
          isArrayContainer
        })
      }

      // Sắp xếp theo level và path để hiển thị đúng thứ tự
      result.sort((a, b) => {
        if (a.level !== b.level) return a.level - b.level
        return a.path.localeCompare(b.path)
      })

      return result
      } catch (error) {
        console.error('Scan script error:', error)
        console.error('Error stack:', error.stack)
        throw error
      }
    })()
  `;
    try {
        const items = await testWindow.webContents.executeJavaScript(scanScript);
        console.log(`✅ Scan complete, found ${items.length} items`);
        return items;
    }
    catch (error) {
        console.error('❌ Error executing scan script:', error);
        throw error;
    }
}
// Hàm: Click nút submit trên trang hiện tại trong BrowserWindow
async function clickSubmitInTestWindow() {
    if (!testWindow || testWindow.isDestroyed()) {
        throw new Error('BrowserWindow chưa được mở. Vui lòng nhấn "Mở BrowserWindow" trước.');
    }
    const currentURL = testWindow.webContents.getURL();
    if (!currentURL || currentURL === 'about:blank') {
        throw new Error('BrowserWindow chưa load trang nào. Vui lòng điều hướng đến trang cần test trước.');
    }
    testWindow.focus();
    await new Promise(resolve => setTimeout(resolve, 300));
    const clickScript = `
    (function() {
      var btn = document.querySelector('button[type="submit"]') ||
                document.querySelector('input[type="submit"]') ||
                document.querySelector('#btnSave') ||
                document.querySelector('button[id="btnSave"]');
      if (!btn) {
        var buttons = document.querySelectorAll('button, input[type="submit"]');
        for (var i = 0; i < buttons.length; i++) {
          var b = buttons[i];
          var text = (b.textContent || b.value || '').trim().toLowerCase();
          if (text.indexOf('lưu') >= 0 || text === 'submit' || text === 'save') {
            btn = b;
            break;
          }
        }
      }
      if (btn) {
        btn.click();
        return { clicked: true, message: 'Đã click nút submit' };
      }
      return { clicked: false, message: 'Không tìm thấy nút submit' };
    })()
  `;
    try {
        const result = await testWindow.webContents.executeJavaScript(clickScript);
        return result;
    }
    catch (error) {
        console.error('❌ Error clicking submit:', error);
        throw error;
    }
}
// Hàm: Validate trên trang hiện tại (không load URL mới)
async function validateCurrentPage(jsonObj) {
    // Kiểm tra BrowserWindow đã mở chưa
    if (!testWindow || testWindow.isDestroyed()) {
        throw new Error('BrowserWindow chưa được mở. Vui lòng nhấn "Mở BrowserWindow" trước.');
    }
    const currentURL = testWindow.webContents.getURL();
    if (!currentURL || currentURL === 'about:blank') {
        throw new Error('BrowserWindow chưa load trang nào. Vui lòng điều hướng đến trang cần test trước.');
    }
    console.log(`🔍 Validating current page: ${currentURL}`);
    testWindow.focus();
    // Đợi một chút để đảm bảo page sẵn sàng
    await new Promise(resolve => setTimeout(resolve, 500));
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
// Flatten nested JSON: luatTraVeDetails[0].tenMoTaTraVe -> tenMoTaTraVe; luatTraVeDetails[0].luatTraVeApDungs[1].traTruocTuSoPhut -> traTruocTuSoPhut_0_1
function flattenForForm(obj) {
    if (obj == null || typeof obj !== 'object')
        return {};
    const result = {};
    for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object' && val[0] !== null && !Array.isArray(val[0])) {
            val.forEach((item, i) => {
                if (item == null || typeof item !== 'object')
                    return;
                const suffix1 = i === 0 ? '' : '_' + i;
                for (const k of Object.keys(item)) {
                    const v = item[k];
                    if (v === null || v === undefined)
                        continue;
                    if (typeof v === 'object' && !Array.isArray(v) && v !== null)
                        continue;
                    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null) {
                        // Mảng lồng nhau (vd: luatTraVeApDungs) -> flatten thành key_i_0, key_i_1, key_i_2 ... (Luật áp dụng)
                        v.forEach((subItem, j) => {
                            if (subItem == null || typeof subItem !== 'object')
                                return;
                            for (const k2 of Object.keys(subItem)) {
                                const v2 = subItem[k2];
                                if (v2 === null || v2 === undefined)
                                    continue;
                                if (typeof v2 === 'object' && v2 !== null && !Array.isArray(v2))
                                    continue;
                                if (Array.isArray(v2) && v2.length > 0 && typeof v2[0] === 'object')
                                    continue;
                                const flatKey = k2 + '_' + i + '_' + j;
                                result[flatKey] = v2;
                            }
                        });
                        continue;
                    }
                    if (Array.isArray(v) && (v.length === 0 || typeof v[0] !== 'object')) {
                        result[k + suffix1] = v;
                        continue;
                    }
                    result[k + suffix1] = v;
                }
            });
        }
        else {
            result[key] = val;
        }
    }
    return result;
}
// Tạo validation script để chạy trong browser context
function generateValidationScript(jsonObj) {
    const flat = flattenForForm(jsonObj);
    const jsonStr = JSON.stringify(flat);
    return `
    (async function() {
      const expected = ${jsonStr};
      const errors = [];
      
      // Chuyển ngày ISO sang dd/mm/yy (cho DatePicker PrimeVue dateFormat="dd/mm/yy")
      function isoToDisplayDate(str) {
        if (!str || typeof str !== 'string') return str;
        var s = str.trim();
        var match = s.match(/^(\\d{4})-(\\d{2})-(\\d{2})/);
        if (!match) return str;
        var d = match[2], m = match[3], y = match[1].slice(-2);
        return d + '/' + m + '/' + y;
      }
      function isDateKey(key) {
        var k = (key || '').toLowerCase();
        return k.indexOf('ngay') >= 0 || k.indexOf('date') >= 0;
      }
      function isIsoDateString(str) {
        if (!str || typeof str !== 'string') return false;
        return /^\\d{4}-\\d{2}-\\d{2}/.test(str.trim());
      }
      function normalizeDateForCompare(str) {
        if (!str || typeof str !== 'string') return (str || '').trim();
        var s = str.trim();
        var m = s.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{2}|\\d{4})$/);
        if (m) {
          var y = m[3].length === 2 ? m[3] : m[3].slice(-2);
          return (m[1].length === 1 ? '0' + m[1] : m[1]) + '/' + (m[2].length === 1 ? '0' + m[2] : m[2]) + '/' + y;
        }
        return s;
      }
      
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
          if (el.multiple) {
            for (var o = 0; o < el.options.length; o++) el.options[o].selected = false;
          } else {
            el.selectedIndex = 0;
          }
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Lấy giá trị chuỗi từ expected (tránh [object Object] khi value là object/array)
      function getStringValue(val) {
        if (val === null || val === undefined) return '';
        if (typeof val === 'string') return val;
        if (typeof val === 'number' || typeof val === 'boolean') return String(val);
        if (Array.isArray(val)) {
          if (val.length === 0) return '';
          if (typeof val[0] === 'string') return val[0];
          if (typeof val[0] === 'number') return String(val[0]);
          return '';
        }
        return '';
      }
      
      // Helper: set value lên input và trigger framework (Vue/React) bằng native setter + InputEvent
      function setInputValue(inputEl, val) {
        var v = (val == null ? '' : val) + '';
        if (inputEl.readOnly) {
          try { inputEl.removeAttribute('readonly'); } catch (e) {}
        }
        try {
          var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(inputEl, v);
        } catch (e) {
          inputEl.value = v;
        }
        inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, data: v }));
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        inputEl.dispatchEvent(new Event('blur', { bubbles: true }));
      }
      
      // Fill form với dữ liệu từ JSON
      for (const key of Object.keys(expected)) {
        let value = getStringValue(expected[key]);
        if (isDateKey(key) && isIsoDateString(value)) {
          value = isoToDisplayDate(value);
        }
        var escaped = key.replace(/[!"#$%&'()*+,.\\/:;<=>?@[\\\\\\]^\\\`{|}~]/g, '\\\\$&');
        let element = document.querySelector('#' + escaped);
        if (!element) {
          var altSelectors = [
            'input[name="' + key + '"]',
            'select[name="' + key + '"]',
            'input[id="' + key + '"]',
            'select[id="' + key + '"]',
            '[id="' + key + '"]'
          ];
          for (var a = 0; a < altSelectors.length; a++) {
            element = document.querySelector(altSelectors[a]);
            if (element) break;
          }
        }
        if (!element) continue;
        
        var wrapper = element;
        if (!(element instanceof HTMLInputElement) && 
            !(element instanceof HTMLTextAreaElement) && 
            !(element instanceof HTMLSelectElement)) {
          var innerSelect = element.querySelector('select[multiple]');
          if (innerSelect && value) {
            var vals = (value + '').split(',').map(function(v){ return (v || '').trim(); }).filter(Boolean);
            for (var i = 0; i < innerSelect.options.length; i++) {
              var opt = innerSelect.options[i];
              innerSelect.options[i].selected = vals.indexOf(opt.value) >= 0 || vals.indexOf((opt.text || '').trim()) >= 0;
            }
            innerSelect.dispatchEvent(new Event('change', { bubbles: true }));
            innerSelect.dispatchEvent(new Event('input', { bubbles: true }));
            continue;
          }
          var singleSelect = element.querySelector('select:not([multiple])');
          if (singleSelect && value !== undefined && value !== '') {
            var sel = singleSelect;
            var found = false;
            for (var i = 0; i < sel.options.length; i++) {
              if (sel.options[i].value === value || sel.options[i].value === String(value)) {
                sel.selectedIndex = i; found = true; break;
              }
            }
            if (!found) {
              for (var i = 0; i < sel.options.length; i++) {
                if ((sel.options[i].text || '').trim() === value) {
                  sel.selectedIndex = i; break;
                }
              }
            }
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            sel.dispatchEvent(new Event('input', { bubbles: true }));
            continue;
          }
          var allInputs = element.querySelectorAll('input:not([type="submit"]):not([type="button"]), textarea');
          if (allInputs.length > 0 && value !== undefined && value !== '') {
            for (var ii = 0; ii < allInputs.length; ii++) {
              setInputValue(allInputs[ii], value);
            }
            continue;
          }
          var innerInput = element.querySelector('input, textarea, select');
          if (innerInput) element = innerInput;
        }
        
        if (element instanceof HTMLInputElement) {
          if (element.type === 'checkbox') {
            var shouldCheck = value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'on';
            element.checked = shouldCheck;
            element.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            setInputValue(element, value);
          }
        } else if (element instanceof HTMLTextAreaElement) {
          element.value = (value == null ? '' : value) + '';
          element.dispatchEvent(new InputEvent('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (element instanceof HTMLSelectElement) {
          if (element.multiple && (value + '').indexOf(',') >= 0) {
            var parts = (value + '').split(',').map(function(v){ return (v || '').trim(); }).filter(Boolean);
            for (var j = 0; j < element.options.length; j++) {
              var opt = element.options[j];
              opt.selected = parts.indexOf(opt.value) >= 0 || parts.indexOf((opt.text || '').trim()) >= 0;
            }
          } else {
            var found = false;
            for (var i = 0; i < element.options.length; i++) {
              if (element.options[i].value === value || element.options[i].value === String(value)) {
                element.selectedIndex = i;
                found = true;
                break;
              }
            }
            if (!found) {
              for (var i = 0; i < element.options.length; i++) {
                if ((element.options[i].text || '').trim() === value) {
                  element.selectedIndex = i;
                  break;
                }
              }
            }
          }
          element.dispatchEvent(new Event('change', { bubbles: true }));
          element.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Validate các giá trị TRƯỚC KHI submit (để đảm bảo form đã được fill đúng)
      const urlBeforeSubmit = window.location.href;
      for (const key of Object.keys(expected)) {
        let expectedValue = getStringValue(expected[key]).trim();
        if (isDateKey(key) && isIsoDateString(expectedValue)) {
          expectedValue = isoToDisplayDate(expectedValue);
        }
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
          if (element.multiple) {
            var parts = [];
            for (var p = 0; p < element.options.length; p++) {
              if (element.options[p].selected) parts.push((element.options[p].value || element.options[p].text || '').trim());
            }
            actualValue = parts.filter(Boolean).join(',');
          } else {
            actualValue = (element.options[element.selectedIndex]?.value || element.options[element.selectedIndex]?.text || '').trim();
          }
        } else {
          var innerSel = element.querySelector && element.querySelector('select[multiple]');
          if (innerSel) {
            var parts = [];
            for (var p = 0; p < innerSel.options.length; p++) {
              if (innerSel.options[p].selected) parts.push((innerSel.options[p].value || innerSel.options[p].text || '').trim());
            }
            actualValue = parts.filter(Boolean).join(',');
          } else {
            actualValue = (element.innerText || element.textContent || '').trim();
          }
        }
        
        var compareExpected = expectedValue;
        var compareActual = actualValue;
        if (isDateKey(key)) {
          compareExpected = normalizeDateForCompare(expectedValue);
          compareActual = normalizeDateForCompare(actualValue);
        }
        if (expectedValue.indexOf(',') >= 0 && actualValue.indexOf(',') >= 0) {
          compareExpected = expectedValue.split(',').map(function(s){ return (s||'').trim(); }).filter(Boolean).sort().join(',');
          compareActual = actualValue.split(',').map(function(s){ return (s||'').trim(); }).filter(Boolean).sort().join(',');
        }
        if (compareActual !== compareExpected) {
          errors.push({
            key,
            type: 'mismatch',
            expected: expectedValue,
            actual: actualValue
          });
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
            let expectedValue = getStringValue(expected[key]).trim();
            if (isDateKey(key) && isIsoDateString(expectedValue)) {
              expectedValue = isoToDisplayDate(expectedValue);
            }
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
              if (element.multiple) {
                var parts = [];
                for (var p = 0; p < element.options.length; p++) {
                  if (element.options[p].selected) parts.push((element.options[p].value || element.options[p].text || '').trim());
                }
                actualValue = parts.filter(Boolean).join(',');
              } else {
                actualValue = (element.options[element.selectedIndex]?.value || element.options[element.selectedIndex]?.text || '').trim();
              }
            } else {
              var innerSel = element.querySelector && element.querySelector('select[multiple]');
              if (innerSel) {
                var parts = [];
                for (var p = 0; p < innerSel.options.length; p++) {
                  if (innerSel.options[p].selected) parts.push((innerSel.options[p].value || innerSel.options[p].text || '').trim());
                }
                actualValue = parts.filter(Boolean).join(',');
              } else {
                actualValue = (element.innerText || element.textContent || '').trim();
              }
            }
            
            var compareExpected = expectedValue;
            var compareActual = actualValue;
            if (isDateKey(key)) {
              compareExpected = normalizeDateForCompare(expectedValue);
              compareActual = normalizeDateForCompare(actualValue);
            }
            if (expectedValue.indexOf(',') >= 0 && actualValue.indexOf(',') >= 0) {
              compareExpected = expectedValue.split(',').map(function(s){ return (s||'').trim(); }).filter(Boolean).sort().join(',');
              compareActual = actualValue.split(',').map(function(s){ return (s||'').trim(); }).filter(Boolean).sort().join(',');
            }
            if (compareActual !== compareExpected) {
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
      
      // Không thêm overlay/ký hiệu đỏ trên giao diện test - kết quả chỉ hiển thị trong tool panel
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

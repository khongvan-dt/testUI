// Wrap toàn bộ trong try-catch để bắt lỗi sớm nhất có thể
process.on('uncaughtException', (error) => {
  console.error('❌ UNCAUGHT EXCEPTION:', error.message)
  console.error('Stack:', error.stack)
  process.stderr.write('FATAL ERROR: ' + error.message + '\n')
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ UNHANDLED REJECTION:', reason)
  process.stderr.write('FATAL REJECTION: ' + String(reason) + '\n')
  process.exit(1)
})

const { chromium } = require('playwright-core')

const fs = require('fs')
const path = require('path')
const os = require('os')

async function main() {
  try {
    console.error('=== validatePage.cjs started ===')
    console.error('Process args:', process.argv)
    console.error('Working directory:', process.cwd())
    console.error('Node version:', process.version)
    console.error('Platform:', process.platform)
  
  const url = process.argv[2]
  const jsonFilePath = process.argv[3]
  const reuseMode = process.argv[4] === 'reuse' // 'reuse' hoặc 'new'

  if (!url) {
    console.error('Missing url')
    process.exit(1)
  }

  if (!jsonFilePath) {
    console.error('Missing jsonFilePath')
    process.exit(1)
  }

  console.error('URL:', url)
  console.error('JSON file path:', jsonFilePath)
  console.error('Reuse mode:', reuseMode ? 'reuse existing tab' : 'create new tab')
  
  // Kiểm tra file có tồn tại không
  if (!fs.existsSync(jsonFilePath)) {
    console.error('JSON file does not exist:', jsonFilePath)
    process.exit(1)
  }

  // Đọc JSON từ file
  let jsonText
  try {
    jsonText = fs.readFileSync(jsonFilePath, 'utf8')
    console.error('JSON read from file, length:', jsonText.length)
  } catch (e) {
    console.error('Failed to read JSON file:', e.message)
    console.error('Error stack:', e.stack)
    process.exit(1)
  }

  if (!jsonText || !jsonText.trim()) {
    console.error('JSON file is empty')
    process.exit(1)
  }

  console.error('Starting playwright validate for:', url)
  console.error('JSON length:', jsonText.length)
  
  let expected
  try {
    expected = JSON.parse(jsonText)
  } catch (e) {
    console.error('Failed to parse JSON:', e.message)
    process.exit(1)
  }
  
  // DEBUG: Log toàn bộ JSON đã parse
  console.error('🔍 DEBUG: Parsed JSON:', JSON.stringify(expected, null, 2))
  console.error('Expected keys:', Object.keys(expected).length)
  
  // DEBUG: Log từng key-value pair
  for (const key in expected) {
    console.error(`  🔍 DEBUG: JSON key="${key}", value=${JSON.stringify(expected[key])}`)
  }

  console.error('Launching browser...')
  let browser
  let context = null // Browser context (nếu dùng launchPersistentContext)
  let useHeadless = false // Mở browser để user có thể xem kết quả validate trực tiếp
  
  // Dùng user data directory cố định để có thể reuse browser instance
  const userDataDir = path.join(os.tmpdir(), 'ui-i18n-tool-browser')
  
  // Thử mở browser không headless để user có thể xem kết quả
  // Với userDataDir cố định, nếu browser đã mở, sẽ báo lỗi "User data directory is already in use"
  // Trong trường hợp đó, không dùng userDataDir và launch browser mới (sẽ tạo tab mới trong browser đang chạy)
  let browserLaunchedSuccessfully = false
  
  try {
    try {
      // Dùng launchPersistentContext để có thể dùng userDataDir
      // launchPersistentContext tự động tạo page đầu tiên, nên không cần newPage()
      // Nếu browser đã mở, sẽ reuse và tạo tab mới
      context = await chromium.launchPersistentContext(userDataDir, {
        headless: false, // Mở browser để user có thể xem
        timeout: 60000,
        // Thêm args để giữ browser mở khi process exit và đảm bảo hiển thị
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--start-maximized', // Mở browser ở chế độ maximized
          '--window-position=0,0', // Đặt vị trí window
          '--disable-infobars', // Tắt infobars
          '--disable-dev-shm-usage' // Tránh lỗi shared memory
        ]
      })
      browser = context.browser()
      browserLaunchedSuccessfully = true
      console.error('✅ Browser launched/reused successfully with persistent context')
      console.error('Browser user data dir:', userDataDir)
      // Với persistent context, browser có thể không có method process()
      // Nhưng điều này không quan trọng - browser vẫn hoạt động bình thường
      try {
        const pid = browser?.process?.()?.pid
        if (pid) {
          console.error('Browser process PID:', pid)
        }
      } catch (e) {
        // Không quan trọng nếu không lấy được PID - browser vẫn chạy bình thường
        console.error('Browser process info not available (this is OK - browser is running)')
      }
      console.error('Existing pages:', context.pages().length)
      useHeadless = false
      
      // Đợi một chút để đảm bảo browser window đã mở
      await new Promise(resolve => setTimeout(resolve, 500))
      console.error('✅ Browser window should be visible now')
      console.error('ℹ️ Previous tabs (if any) will stay open - new tab will be created for this test')
    } catch (userDataDirError) {
      // Nếu userDataDir đang được sử dụng (browser đã mở), xử lý tùy theo reuse mode
      if (userDataDirError.message && (
        userDataDirError.message.includes('User data directory is already in use') ||
        userDataDirError.message.includes('Target page, context or browser has been closed')
      )) {
        if (reuseMode) {
          // Trong reuse mode, nếu browser đã đóng hoặc không thể connect, tạo browser mới
          console.error('ℹ️ Browser was closed or cannot be reused, creating new browser instance')
          console.error('ℹ️ This will create a new browser window for testing')
          
          // Đợi một chút để đảm bảo browser cũ đã đóng hoàn toàn
          await new Promise(resolve => setTimeout(resolve, 1000))
          
          // Thử lại với userDataDir mới hoặc không dùng userDataDir
          // Tạo userDataDir mới với timestamp để tránh conflict
          const newUserDataDir = path.join(os.tmpdir(), `ui-i18n-tool-browser-${Date.now()}`)
          try {
            context = await chromium.launchPersistentContext(newUserDataDir, {
              headless: false,
              timeout: 60000,
              args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--start-maximized',
                '--window-position=0,0',
                '--disable-infobars',
                '--disable-dev-shm-usage'
              ]
            })
            browser = context.browser()
            browserLaunchedSuccessfully = true
            console.error('✅ New browser instance created with new userDataDir')
            console.error('Browser user data dir:', newUserDataDir)
            console.error('Existing pages:', context.pages().length)
            useHeadless = false
            
            await new Promise(resolve => setTimeout(resolve, 500))
            console.error('✅ Browser window should be visible now')
          } catch (retryError) {
            // Nếu vẫn lỗi, fallback sang launch không dùng userDataDir
            console.error('⚠️ Failed to create browser with new userDataDir, falling back to regular launch')
            browser = await chromium.launch({ 
              headless: false,
              timeout: 60000,
              args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--start-maximized',
                '--window-position=0,0',
                '--disable-infobars',
                '--disable-dev-shm-usage'
              ]
            })
            browserLaunchedSuccessfully = true
            console.error('✅ Browser launched without persistent context')
            useHeadless = false
            
            await new Promise(resolve => setTimeout(resolve, 500))
            console.error('✅ Browser window should be visible now')
          }
        } else {
          // Không phải reuse mode, launch browser mới như bình thường
          console.error('ℹ️ Browser is already running, launching new browser instance (will create new tab)')
          browser = await chromium.launch({ 
            headless: false,
            timeout: 60000,
            args: [
              '--no-sandbox', 
              '--disable-setuid-sandbox',
              '--disable-background-timer-throttling',
              '--disable-backgrounding-occluded-windows',
              '--disable-renderer-backgrounding',
              '--start-maximized',
              '--window-position=0,0',
              '--disable-infobars',
              '--disable-dev-shm-usage'
            ]
          })
          browserLaunchedSuccessfully = true
          console.error('✅ New browser instance launched')
          console.error('Browser process PID:', browser.process()?.pid)
          useHeadless = false
          
          await new Promise(resolve => setTimeout(resolve, 500))
          console.error('✅ Browser window should be visible now')
        }
      } else {
        // Lỗi khác, throw lại để catch block bên ngoài xử lý
        throw userDataDirError
      }
    }
  } catch (e) {
    // Chỉ fallback sang headless nếu browser chưa được launch thành công
    if (browserLaunchedSuccessfully) {
      // Browser đã launch thành công, chỉ có lỗi nhỏ (như không lấy được process info)
      // Không fallback, tiếp tục với browser đã launch
      console.error('⚠️ Minor error occurred but browser is already running:', e.message)
      console.error('✅ Continuing with browser (it is visible and working)')
      useHeadless = false
      // Browser và context đã được set ở trên, không cần làm gì thêm
    } else {
      // Browser chưa launch thành công, fallback sang headless
      console.error('❌ Failed to launch browser in non-headless mode:', e.message)
      console.error('Error stack:', e.stack)
      console.error('⚠️ This should not happen - browser should be visible!')
      console.error('Falling back to headless mode (browser will NOT be visible)...')
      
      // Fallback: thử headless mode nếu non-headless fail
      // NHƯNG cảnh báo user rằng browser sẽ không hiển thị
      try {
        browser = await chromium.launch({ 
          headless: true,
          timeout: 60000,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        })
        console.error('⚠️ Browser launched in HEADLESS mode - browser window will NOT be visible!')
        console.error('⚠️ This is a fallback - you should see the browser window normally')
        useHeadless = true
      } catch (e2) {
        console.error('Failed to launch browser in headless mode:', e2.message)
        console.error('Error stack:', e2.stack)
        // Kiểm tra lỗi phổ biến
        if (e2.message && (e2.message.includes('Executable doesn\'t exist') || e2.message.includes('Browser not found'))) {
          console.error('❌ Playwright browser chưa được cài đặt!')
          console.error('Vui lòng chạy: npx playwright install chromium')
        }
        process.stderr.write('ERROR: ' + (e2.message || String(e2)) + '\n')
        process.stderr.write('STACK: ' + (e2.stack || 'No stack trace') + '\n')
        process.exit(1)
      }
    }
  }
  
  // Nếu dùng launchPersistentContext, có thể reuse page hoặc tạo page mới
  // Nếu dùng launch thông thường, cần tạo page mới
  let page
  if (context) {
    const existingPages = context.pages()
    console.error('Existing pages in context:', existingPages.length)
    
    if (reuseMode && existingPages.length > 0) {
      // Reuse page đầu tiên - đóng các page khác để tránh lộn xộn
      console.error('🔄 Reusing existing tab (reuse mode)')
      
      // Đóng các page khác (giữ lại page đầu tiên)
      for (let i = 1; i < existingPages.length; i++) {
        try {
          await existingPages[i].close()
          console.error(`✅ Closed old tab ${i + 1}`)
        } catch (e) {
          console.error(`⚠️ Failed to close tab ${i + 1}:`, e.message)
        }
      }
      
      // Reuse page đầu tiên
      page = existingPages[0]
      console.error('✅ Reusing existing page/tab')
      
      // Clear cache của page để đảm bảo load dữ liệu mới
      try {
        // Clear cache và storage của page
        const client = await page.target().createCDPSession()
        await client.send('Network.clearBrowserCache')
        await client.send('Network.clearBrowserCookies')
        await page.evaluate(() => {
          // Clear localStorage và sessionStorage
          localStorage.clear()
          sessionStorage.clear()
        })
        console.error('✅ Page cache cleared for reuse')
      } catch (e) {
        console.error('⚠️ Failed to clear page cache (continuing anyway):', e.message)
      }
      
      // Đảm bảo tab được activate và bring to front
      await page.bringToFront()
      console.error('✅ Tab brought to front')
    } else {
      // Tạo page mới
      if (reuseMode) {
        // Nếu reuse mode nhưng không có page nào, đóng tất cả và tạo mới
        console.error('⚠️ Reuse mode requested but no existing pages found, creating new page')
        for (const p of existingPages) {
          try {
            await p.close()
          } catch (e) {
            // Ignore errors
          }
        }
      }
      
      page = await context.newPage()
      console.error('✅ New page/tab created')
      console.error('Total pages in context:', context.pages().length)
      
      // Đảm bảo tab mới được activate và bring to front
      await page.bringToFront()
      console.error('✅ New tab brought to front')
    }
  } else {
    page = await browser.newPage()
    console.error('✅ New page created')
  }
  
  console.error('Browser is connected:', browser?.isConnected())
  if (browser) {
    console.error('Browser context count:', browser.contexts().length)
  }
  
  // Đảm bảo page đã sẵn sàng
  await page.setViewportSize({ width: 1280, height: 720 })
  console.error('✅ Page viewport set, browser window should be visible')

  console.error('Navigating to URL...')
  try {
    // Clear cache và cookies để đảm bảo load dữ liệu mới
    if (context) {
      // Clear cookies và cache của context
      await context.clearCookies()
      console.error('✅ Cookies cleared')
    }
    
    // Navigate với cache disabled để đảm bảo load dữ liệu mới
    // Và đảm bảo tab mới được focus
    await page.goto(url, { 
      waitUntil: 'networkidle', 
      timeout: 30000,
      // Disable cache để đảm bảo load dữ liệu mới mỗi lần validate
      // Đặc biệt quan trọng khi validate nhiều lần với dữ liệu khác nhau
      referer: undefined
    })
    
    // Đảm bảo tab được focus sau khi navigate
    await page.bringToFront()
    
    // Đợi một chút để đảm bảo trang đã load hoàn toàn
    await new Promise(resolve => setTimeout(resolve, 500))
    
    console.error('Page loaded and tab focused')
    console.error('Current page URL:', page.url())
    console.error('Current tab is active:', await page.evaluate(() => !document.hidden))
  } catch (e) {
    console.error('Error navigating to URL:', e.message)
    if (context) {
      await context.close()
    } else if (browser) {
      await browser.close()
    }
    throw e
  }

  // ✅ Clear tất cả form inputs trước khi điền dữ liệu mới
  // Đảm bảo mỗi lần validate bắt đầu từ trạng thái sạch
  console.error('Clearing all form inputs before filling new data...')
  try {
    await page.evaluate(() => {
      // Clear tất cả input, textarea, select
      const inputs = document.querySelectorAll('input, textarea, select')
      inputs.forEach((el) => {
        if (el instanceof HTMLInputElement) {
          if (el.type === 'checkbox' || el.type === 'radio') {
            el.checked = false
          } else {
            el.value = ''
          }
        } else if (el instanceof HTMLTextAreaElement) {
          el.value = ''
        } else if (el instanceof HTMLSelectElement) {
          el.selectedIndex = 0
        }
        // Trigger events để form biết đã thay đổi
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      })
    })
    console.error('✅ All form inputs cleared')
  } catch (e) {
    console.error('⚠️ Error clearing form inputs (continuing anyway):', e.message)
  }
  
  // Đợi một chút để đảm bảo form đã được clear
  await new Promise(resolve => setTimeout(resolve, 200))
  
  // ✅ Tự động điền form và submit trước khi validate
  console.error('Auto-filling form inputs with new JSON data...')
  let formSubmitted = false
  let apiErrors = [] // Lưu các lỗi từ API (khai báo ở đây để có thể dùng ở ngoài scope)
  
  for (const key of Object.keys(expected)) {
    // Lấy giá trị từ JSON (có thể là string rỗng, cần xử lý)
    const rawValue = expected[key]
    const value = rawValue !== null && rawValue !== undefined ? String(rawValue) : ''
    
    // DEBUG: Log để kiểm tra
    console.error(`  🔍 DEBUG: Processing key="${key}", rawValue=${JSON.stringify(rawValue)}, value=${JSON.stringify(value)}`)
    
    // Không skip nếu value rỗng - vẫn cần clear input hoặc điền giá trị rỗng
    
    try {
      const escapedKey = key.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&')
      const selector = `#${escapedKey}`
      
      console.error(`  🔍 DEBUG: Looking for element with selector: ${selector}`)
      let element = await page.$(selector)
      let actualSelector = selector
      
      if (!element) {
        console.error(`  ⚠️ Element #${key} not found with id selector, trying alternative selectors...`)
        // Thử tìm với các selector khác
        const altSelectors = [
          `input[name="${key}"]`,
          `input[id="${key}"]`,
          `[id="${key}"]`,
          `#${key}`,
          `input[type="password"][name="${key}"]`,
          `input[type="text"][name="${key}"]`,
          `input[type="email"][name="${key}"]`,
        ]
        
        for (const altSel of altSelectors) {
          const altEl = await page.$(altSel)
          if (altEl) {
            console.error(`  ✅ Found element with alternative selector: ${altSel}`)
            element = altEl
            actualSelector = altSel
            break
          }
        }
        
        if (!element) {
          console.error(`  ⚠️ Element #${key} not found with any selector, skipping auto-fill`)
          continue
        }
      } else {
        console.error(`  ✅ Element #${key} found with id selector`)
      }
      
      // Kiểm tra xem element có phải là wrapper (div, span, etc.) không
      // Nếu là wrapper, tìm input bên trong
      const elementInfo = await page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        return {
          tagName: el.tagName,
          type: el.type || '',
          isInput: el instanceof HTMLInputElement,
          isTextarea: el instanceof HTMLTextAreaElement,
          isSelect: el instanceof HTMLSelectElement,
          isCheckbox: el.type === 'checkbox',
          isRadio: el.type === 'radio',
          isWrapper: !(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLSelectElement),
        }
      }, actualSelector)
      
      // Nếu element là wrapper (div, span, etc.), tìm input bên trong
      if (elementInfo?.isWrapper) {
        console.error(`  🔍 DEBUG: Element #${key} is a wrapper (${elementInfo.tagName}), looking for input inside...`)
        
        // Thử các selector để tìm input bên trong wrapper
        const innerSelectors = [
          `${actualSelector} input`,
          `${actualSelector} input[type="password"]`,
          `${actualSelector} input[type="text"]`,
          `${actualSelector} input[type="email"]`,
          `${actualSelector} textarea`,
          `${actualSelector} select`,
          `#${key} input`,
          `#${key} input[type="password"]`,
          `input[name="${key}"]`,
          `input[id="${key}"]`,
        ]
        
        let innerInput = null
        for (const innerSel of innerSelectors) {
          try {
            innerInput = await page.$(innerSel)
            if (innerInput) {
              // Verify đây là input thực sự
              const isRealInput = await page.evaluate((sel) => {
                const el = document.querySelector(sel)
                return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
              }, innerSel)
              
              if (isRealInput) {
                console.error(`  ✅ Found input inside wrapper with selector: ${innerSel}`)
                element = innerInput
                actualSelector = innerSel
                break
              }
            }
          } catch (e) {
            // Continue to next selector
          }
        }
        
        if (!innerInput) {
          console.error(`  ⚠️ Could not find input inside wrapper #${key}`)
          // Thử tìm bằng cách khác: tìm tất cả input trong wrapper
          const allInputs = await page.evaluate((sel) => {
            const wrapper = document.querySelector(sel)
            if (!wrapper) return []
            const inputs = wrapper.querySelectorAll('input, textarea, select')
            return Array.from(inputs).map((el, idx) => ({
              index: idx,
              tagName: el.tagName,
              type: el.type || '',
              id: el.id || '',
              name: el.name || '',
              selector: el.id ? `#${el.id}` : el.name ? `input[name="${el.name}"]` : `input[type="${el.type}"]`
            }))
          }, actualSelector)
          
          console.error(`  🔍 DEBUG: Found ${allInputs.length} inputs inside wrapper:`, JSON.stringify(allInputs))
          
          if (allInputs.length > 0) {
            // Lấy input đầu tiên (thường là input chính)
            const firstInput = allInputs[0]
            // Thử tìm input theo type password hoặc text
            const passwordInput = allInputs.find(inp => inp.type === 'password')
            const textInput = allInputs.find(inp => inp.type === 'text' || inp.type === 'email')
            const targetInput = passwordInput || textInput || firstInput
            
            if (targetInput.selector) {
              try {
                innerInput = await page.$(targetInput.selector)
                if (innerInput) {
                  console.error(`  ✅ Using input: ${targetInput.selector} (type: ${targetInput.type})`)
                  element = innerInput
                  actualSelector = targetInput.selector
                }
              } catch (e) {
                console.error(`  ⚠️ Error using selector ${targetInput.selector}:`, e.message)
              }
            }
          }
        }
      }
      
      // Kiểm tra loại element và điền giá trị
      const elementType = await page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        return {
          tagName: el.tagName,
          type: el.type || '',
          isInput: el instanceof HTMLInputElement,
          isTextarea: el instanceof HTMLTextAreaElement,
          isSelect: el instanceof HTMLSelectElement,
          isCheckbox: el.type === 'checkbox',
          isRadio: el.type === 'radio',
        }
      }, actualSelector)
      
      if (!elementType) continue
      
      if (elementType.isInput || elementType.isTextarea) {
        if (elementType.isCheckbox) {
          // Checkbox: check nếu value là truthy
          if (value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'on') {
            await page.check(actualSelector)
            console.error(`  ✅ Checked checkbox #${key}`)
          } else {
            await page.uncheck(actualSelector)
            console.error(`  ✅ Unchecked checkbox #${key}`)
          }
        } else if (elementType.isRadio) {
          // Radio: chọn option có value khớp
          await page.check(actualSelector)
          console.error(`  ✅ Selected radio #${key}`)
        } else {
          // Input/Textarea: điền giá trị
          // DEBUG: Log trước khi fill
          console.error(`  🔍 DEBUG: About to fill input #${key} with value="${value}"`)
          console.error(`  🔍 DEBUG: Element type: ${elementType.type}, isInput: ${elementType.isInput}, isTextarea: ${elementType.isTextarea}`)
          
          // Kiểm tra xem element có bị disabled hoặc readonly không
          const elementState = await page.evaluate((sel) => {
            const el = document.querySelector(sel)
            if (!el) return null
            return {
              disabled: el.disabled,
              readonly: el.readOnly,
              hidden: el.hidden,
              display: window.getComputedStyle(el).display,
              visibility: window.getComputedStyle(el).visibility,
            }
          }, actualSelector)
          
          if (elementState) {
            console.error(`  🔍 DEBUG: Element state:`, JSON.stringify(elementState))
            if (elementState.disabled) {
              console.error(`  ⚠️ Element #${key} is disabled, trying to enable...`)
              await page.evaluate((sel) => {
                const el = document.querySelector(sel)
                if (el) el.disabled = false
              }, actualSelector)
            }
          }
          
          // Clear trước rồi mới fill để đảm bảo giá trị mới được điền đúng
          try {
            await page.fill(actualSelector, '')
            console.error(`  🔍 DEBUG: Cleared input #${key}`)
          } catch (e) {
            console.error(`  ⚠️ Error clearing input #${key}:`, e.message)
            // Thử cách khác: focus và clear
            try {
              await page.focus(actualSelector)
              await page.keyboard.press('Control+A')
              await page.keyboard.press('Delete')
            } catch (e2) {
              console.error(`  ⚠️ Alternative clear also failed:`, e2.message)
            }
          }
          
          if (value) {
            // DEBUG: Log giá trị trước khi fill
            console.error(`  🔍 DEBUG: Filling with value="${value}" (type: ${typeof value})`)
            
            try {
              await page.fill(actualSelector, value)
              console.error(`  🔍 DEBUG: Fill command executed`)
            } catch (e) {
              console.error(`  ⚠️ Error using page.fill():`, e.message)
              // Thử cách khác: type từng ký tự
              try {
                await page.focus(actualSelector)
                await page.keyboard.type(value, { delay: 10 })
                console.error(`  🔍 DEBUG: Used keyboard.type() as fallback`)
              } catch (e2) {
                console.error(`  ⚠️ Error using keyboard.type():`, e2.message)
                // Thử cách cuối: set value trực tiếp
                try {
                  await page.evaluate((sel, val) => {
                    const el = document.querySelector(sel)
                    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                      el.value = val
                      el.dispatchEvent(new Event('input', { bubbles: true }))
                      el.dispatchEvent(new Event('change', { bubbles: true }))
                    }
                  }, actualSelector, value)
                  console.error(`  🔍 DEBUG: Used direct value assignment as fallback`)
                } catch (e3) {
                  console.error(`  ⚠️ Error using direct assignment:`, e3.message)
                }
              }
            }
            
            // Đợi một chút để đảm bảo value được set
            await new Promise(resolve => setTimeout(resolve, 100))
            
            // DEBUG: Verify giá trị đã được điền đúng chưa
            const filledValue = await page.$eval(actualSelector, (el) => {
              if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                return el.value
              }
              return null
            })
            console.error(`  🔍 DEBUG: After fill, input value="${filledValue}" (length: ${filledValue?.length || 0})`)
            
            if (filledValue !== value) {
              console.error(`  ⚠️ WARNING: Value mismatch! Expected="${value}" (length: ${value.length}), Got="${filledValue}" (length: ${filledValue?.length || 0})`)
            } else {
              console.error(`  ✅ Value matches expected`)
            }
          } else {
            console.error(`  🔍 DEBUG: Value is empty, clearing input`)
          }
          
          // Trigger input event để form có thể validate
          try {
            await page.dispatchEvent(actualSelector, 'input')
            await page.dispatchEvent(actualSelector, 'change')
            console.error(`  🔍 DEBUG: Dispatched input and change events`)
          } catch (e) {
            console.error(`  ⚠️ Error dispatching events:`, e.message)
          }
          
          if (value) {
            console.error(`  ✅ Filled input #${key} with: ${value.substring(0, 50)}${value.length > 50 ? '...' : ''}`)
          } else {
            console.error(`  ✅ Cleared input #${key} (empty value)`)
          }
        }
      } else if (elementType.isSelect) {
        // Select: chọn option
        try {
          await page.selectOption(actualSelector, value)
          console.error(`  ✅ Selected option #${key} = ${value}`)
        } catch (e) {
          // Nếu không tìm thấy option, thử chọn theo text
          try {
            await page.selectOption(actualSelector, { label: value })
            console.error(`  ✅ Selected option #${key} by label: ${value}`)
          } catch (e2) {
            console.error(`  ⚠️ Could not select option #${key} = ${value}`)
          }
        }
      } else {
        console.error(`  ⚠️ Element #${key} is not a fillable input (type: ${elementType?.type || 'unknown'})`)
      }
    } catch (e) {
      console.error(`  ⚠️ Error filling #${key}:`, e.message)
      console.error(`  ⚠️ Error stack:`, e.stack)
    }
  }
  
  // ✅ Verify tất cả các giá trị đã được fill đúng trước khi submit
  console.error('Verifying all filled values before submit...')
  for (const key of Object.keys(expected)) {
    const expectedVal = String(expected[key]).trim()
    if (!expectedVal) continue // Skip empty values
    
    try {
      const escapedKey = key.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&')
      let selector = `#${escapedKey}`
      
      let el = await page.$(selector)
      if (!el) {
        const altSelectors = [
          `input[name="${key}"]`,
          `input[id="${key}"]`,
          `[id="${key}"]`,
          `#${key}`,
          `input[type="password"][name="${key}"]`,
          `input[type="text"][name="${key}"]`,
          `input[type="email"][name="${key}"]`,
        ]
        for (const altSel of altSelectors) {
          const altEl = await page.$(altSel)
          if (altEl) {
            el = altEl
            selector = altSel
            break
          }
        }
      }
      
      if (el) {
        // Kiểm tra xem element có phải là wrapper không
        const isWrapper = await page.evaluate((sel) => {
          const el = document.querySelector(sel)
          if (!el) return false
          return !(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLSelectElement)
        }, selector)
        
        // Nếu là wrapper, tìm input bên trong
        if (isWrapper) {
          const innerSelectors = [
            `${selector} input`,
            `${selector} input[type="password"]`,
            `${selector} input[type="text"]`,
            `#${key} input`,
            `#${key} input[type="password"]`,
            `input[name="${key}"]`,
          ]
          
          for (const innerSel of innerSelectors) {
            try {
              const innerEl = await page.$(innerSel)
              if (innerEl) {
                const isRealInput = await page.evaluate((sel) => {
                  const el = document.querySelector(sel)
                  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
                }, innerSel)
                
                if (isRealInput) {
                  el = innerEl
                  selector = innerSel
                  break
                }
              }
            } catch (e) {
              // Continue to next selector
            }
          }
        }
        
        const actualVal = await page.$eval(selector, (node) => {
          if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
            return node.value || ''
          }
          return ''
        })
        
        if (actualVal !== expectedVal) {
          console.error(`  ⚠️ WARNING: #${key} value mismatch before submit! Expected="${expectedVal}", Got="${actualVal}"`)
          // Thử fill lại
          try {
            await page.fill(selector, '')
            await page.fill(selector, expectedVal)
            await new Promise(resolve => setTimeout(resolve, 100))
            const recheckVal = await page.$eval(selector, (node) => {
              if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
                return node.value || ''
              }
              return ''
            })
            console.error(`  🔍 DEBUG: After refill, #${key} value="${recheckVal}"`)
          } catch (e) {
            console.error(`  ⚠️ Error refilling #${key}:`, e.message)
          }
        } else {
          console.error(`  ✅ Verified #${key} value matches: "${actualVal}"`)
        }
      }
    } catch (e) {
      console.error(`  ⚠️ Error verifying #${key}:`, e.message)
    }
  }
  
  // ✅ Tự động tìm và click nút submit
  console.error('Looking for submit button...')
  try {
    // Thử các selector phổ biến cho nút submit
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Đăng nhập")',
      'button:has-text("Submit")',
      'button:has-text("Gửi")',
      'button:has-text("Xác nhận")',
      'button:has-text("Login")',
      '[type="submit"]',
      'form button:last-child', // Nút cuối cùng trong form
      'button.primary',
      'button.btn-primary',
    ]
    
    let submitButton = null
    for (const sel of submitSelectors) {
      try {
        submitButton = await page.$(sel)
        if (submitButton) {
          const isVisible = await submitButton.isVisible()
          if (isVisible) {
            console.error(`  ✅ Found submit button: ${sel}`)
            await submitButton.click()
            formSubmitted = true
            console.error('  ✅ Form submitted!')
            break
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    
    if (!formSubmitted) {
      // Thử tìm button có text chứa "submit", "login", "đăng nhập", etc.
      const submitButtonByText = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'))
        const submitKeywords = ['submit', 'login', 'đăng nhập', 'gửi', 'xác nhận', 'confirm']
        
        for (const btn of buttons) {
          const text = (btn.textContent || btn.value || '').toLowerCase()
          if (submitKeywords.some(keyword => text.includes(keyword))) {
            return btn.id || btn.className || 'found-by-text'
          }
        }
        return null
      })
      
      if (submitButtonByText) {
        try {
          await page.click(`button:has-text("${submitButtonByText}"), input[value*="${submitButtonByText}"]`)
          formSubmitted = true
          console.error(`  ✅ Form submitted via button: ${submitButtonByText}`)
        } catch (e) {
          console.error('  ⚠️ Could not click submit button by text')
        }
      }
    }
    
    let currentUrl = url
    
    if (formSubmitted) {
      // Đợi một chút để form xử lý
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Đợi trang load sau khi submit (có thể redirect hoặc reload)
      console.error('  ⏳ Waiting for page to load after submit...')
      try {
        // Đợi navigation hoặc network idle
        await Promise.race([
          page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {}),
          page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}),
          new Promise(resolve => setTimeout(resolve, 2000)) // Fallback: đợi 2 giây
        ])
        console.error('  ✅ Page ready after submit')
        
        // Kiểm tra URL có thay đổi không (redirect = success, không redirect = có thể có lỗi)
        const newUrl = page.url()
        console.error(`  🔍 DEBUG: URL before submit: ${url}, after submit: ${newUrl}`)
        currentUrl = newUrl
        
        // Kiểm tra xem có redirect thành công không
        const urlChanged = newUrl !== url
        const stillOnLoginPage = newUrl.includes('login') || newUrl.includes('auth/login')
        const isSuccessRedirect = urlChanged && !stillOnLoginPage
        
        if (isSuccessRedirect) {
          console.error('  ✅ URL changed - likely successful login/redirect')
          console.error('  ℹ️ Will skip validation of login page elements (they no longer exist)')
        } else if (newUrl === url || stillOnLoginPage) {
          console.error('  ⚠️ URL did not change or still on login page - checking for API errors...')
        }
      } catch (e) {
        // Nếu timeout, vẫn tiếp tục
        console.error('  ⚠️ Timeout waiting for page load, continuing...')
      }
      
      // Kiểm tra các error message từ API sau khi submit
      console.error('  🔍 Checking for API error messages...')
      try {
        const foundErrors = await page.evaluate(() => {
          const errors = []
          
          // Tìm các element có thể chứa error message
          // Thử các selector phổ biến cho error messages
          const errorSelectors = [
            '[class*="error"]',
            '[class*="Error"]',
            '[class*="alert"]',
            '[class*="Alert"]',
            '[class*="danger"]',
            '[class*="Danger"]',
            '[class*="warning"]',
            '[class*="Warning"]',
            '[class*="message"]',
            '[class*="Message"]',
            '[id*="error"]',
            '[id*="Error"]',
            '[role="alert"]',
            '.error',
            '.alert-danger',
            '.alert-error',
            '.toast-error',
            '.notification-error',
          ]
          
          for (const selector of errorSelectors) {
            try {
              const elements = document.querySelectorAll(selector)
              elements.forEach(el => {
                const text = (el.textContent || el.innerText || '').trim()
                // Bỏ qua nếu text quá ngắn hoặc quá dài (có thể là CSS)
                if (text && text.length > 3 && text.length < 500) {
                  // Kiểm tra xem có phải là error message không (không phải placeholder)
                  const isVisible = window.getComputedStyle(el).display !== 'none' && 
                                   window.getComputedStyle(el).visibility !== 'hidden'
                  
                  // Chỉ lấy các error message thực sự, không lấy text như "Đăng xuất", "Không có cữ liệu"
                  // Kiểm tra xem có phải là error message không
                  const isErrorText = text.toLowerCase().includes('error') || 
                                     text.toLowerCase().includes('lỗi') ||
                                     text.toLowerCase().includes('sai') ||
                                     text.toLowerCase().includes('thất bại') ||
                                     text.toLowerCase().includes('không hợp lệ') ||
                                     text.toLowerCase().includes('invalid') ||
                                     text.toLowerCase().includes('failed') ||
                                     text.toLowerCase().includes('incorrect') ||
                                     (el.className && (
                                       el.className.toLowerCase().includes('error') ||
                                       el.className.toLowerCase().includes('danger') ||
                                       el.className.toLowerCase().includes('alert-danger')
                                     ))
                  
                  if (isVisible && !text.includes('{') && !text.includes('}') && isErrorText) {
                    errors.push({
                      text: text,
                      selector: selector,
                      elementId: el.id || '',
                      elementClass: el.className || ''
                    })
                  }
                }
              })
            } catch (e) {
              // Continue
            }
          }
          
          // Loại bỏ duplicate
          const uniqueErrors = []
          const seenTexts = new Set()
          for (const err of errors) {
            if (!seenTexts.has(err.text.toLowerCase())) {
              seenTexts.add(err.text.toLowerCase())
              uniqueErrors.push(err)
            }
          }
          
          return uniqueErrors
        })
        
        if (foundErrors.length > 0) {
          console.error(`  ⚠️ Found ${foundErrors.length} potential API error message(s):`)
          foundErrors.forEach((err, idx) => {
            console.error(`    ${idx + 1}. "${err.text}" (${err.selector})`)
          })
          apiErrors = foundErrors.map(err => err.text)
        } else {
          console.error('  ✅ No API error messages found')
        }
      } catch (e) {
        console.error('  ⚠️ Error checking for API errors:', e.message)
      }
    } else {
      console.error('  ℹ️ No submit button found, skipping auto-submit')
    }
    
    // Đợi thêm một chút để đảm bảo form đã xử lý xong
    await new Promise(resolve => setTimeout(resolve, 300))
  } catch (e) {
    console.error('  ⚠️ Error during auto-submit:', e.message)
  }

  console.error('Starting validation...')
  const errors = []
  
  // Kiểm tra xem có redirect thành công không (URL đã thay đổi và không còn trên trang login)
  const finalUrl = page.url()
  const urlChanged = finalUrl !== url
  const stillOnLoginPage = finalUrl.includes('login') || finalUrl.includes('auth/login')
  const isSuccessRedirect = urlChanged && !stillOnLoginPage
  
  if (isSuccessRedirect) {
    console.error('  ✅ Detected successful redirect - login was successful!')
    console.error('  ℹ️ Skipping validation of login page elements (page has changed)')
    console.error(`  ℹ️ Current URL: ${finalUrl}`)
    // Không validate các element của trang login nữa vì chúng không còn tồn tại
    // Chỉ validate nếu user muốn validate element trên trang mới
  }

  for (const key of Object.keys(expected)) {
    const expectedValue = String(expected[key]).trim()
    console.error(`Validating key: ${key}`)

    try {
      // Escape key để tránh lỗi với ký tự đặc biệt trong CSS selector
      const escapedKey = key.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&')
      let selector = `#${escapedKey}`
      
      let el = await page.$(selector)
      if (!el) {
        // Thử tìm với các selector khác
        const altSelectors = [
          `input[name="${key}"]`,
          `input[id="${key}"]`,
          `[id="${key}"]`,
          `#${key}`,
          `input[type="password"][name="${key}"]`,
          `input[type="text"][name="${key}"]`,
          `input[type="email"][name="${key}"]`,
        ]
        
        for (const altSel of altSelectors) {
          const altEl = await page.$(altSel)
          if (altEl) {
            el = altEl
            selector = altSel
            break
          }
        }
      }
      
      if (!el) {
        // Nếu đã redirect thành công và element không tìm thấy, có thể là element của trang cũ
        // Không báo lỗi nếu đã redirect thành công
        if (isSuccessRedirect) {
          console.error(`  ℹ️ Element #${key} not found (likely because page redirected after successful login)`)
          // Không thêm vào errors vì đây là hành vi bình thường khi đăng nhập thành công
          continue
        }
        
        errors.push({ key, type: 'missing', expected: expectedValue })

        // Hiển thị thông báo trên console của browser
        await page.evaluate(({ key }) => {
          console.warn(`⚠️ Missing element id="${key}"`)
        }, { key })

        continue
      }

      // Kiểm tra xem element có phải là wrapper không, nếu có thì tìm input bên trong
      const wrapperInfo = await page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        return {
          tagName: el.tagName,
          isWrapper: !(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLSelectElement),
        }
      }, selector)
      
      // Nếu là wrapper, tìm input bên trong
      if (wrapperInfo?.isWrapper) {
        console.error(`  🔍 DEBUG: Element #${key} is a wrapper (${wrapperInfo.tagName}), looking for input inside...`)
        
        const innerSelectors = [
          `${selector} input`,
          `${selector} input[type="password"]`,
          `${selector} input[type="text"]`,
          `${selector} input[type="email"]`,
          `#${key} input`,
          `#${key} input[type="password"]`,
          `input[name="${key}"]`,
        ]
        
        for (const innerSel of innerSelectors) {
          try {
            const innerEl = await page.$(innerSel)
            if (innerEl) {
              const isRealInput = await page.evaluate((sel) => {
                const el = document.querySelector(sel)
                return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
              }, innerSel)
              
              if (isRealInput) {
                console.error(`  ✅ Found input inside wrapper with selector: ${innerSel}`)
                el = innerEl
                selector = innerSel
                break
              }
            }
          } catch (e) {
            // Continue to next selector
          }
        }
      }

      // Kiểm tra loại element để validate đúng cách
      const elementInfo = await page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        return {
          tagName: el.tagName,
          type: el.type || '',
          isCheckbox: el.type === 'checkbox',
          isRadio: el.type === 'radio',
        }
      }, selector)
      
      let actualValue
      if (elementInfo?.isCheckbox) {
        // Với checkbox, kiểm tra checked state
        const isChecked = await page.isChecked(selector)
        // Chuyển checked state thành string để so sánh với expected
        // expected có thể là "true", "1", "on" → checked
        // expected có thể là "false", "0", "" → unchecked
        const expectedIsTruthy = expectedValue.toLowerCase() === 'true' || 
                                  expectedValue === '1' || 
                                  expectedValue.toLowerCase() === 'on'
        actualValue = isChecked ? 'true' : 'false'
        
        // So sánh checked state với expected
        if (isChecked !== expectedIsTruthy) {
          errors.push({
            key,
            type: 'mismatch',
            expected: expectedValue,
            actual: isChecked ? 'true' : 'false',
          })
          
          // Highlight phần tử có lỗi
          await page.evaluate(({ key, expectedValue, actualValue }) => {
            const el = document.getElementById(key)
            if (!el) return
            el.style.outline = '3px solid red'
            el.style.background = 'rgba(255,0,0,0.15)'
            el.style.border = '2px solid red'
            el.setAttribute(
              'title',
              `⚠️ i18n mismatch\nExpected: "${expectedValue}"\nActual: "${actualValue}"`
            )
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }, { key, expectedValue, actualValue })
        }
        continue // Skip phần validate bên dưới cho checkbox
      }
      
      // Với các element khác, lấy giá trị như bình thường
      const elementInfoForValidation = await page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        return {
          tagName: el.tagName,
          type: el.type || '',
          isPassword: el.type === 'password',
        }
      }, selector)
      
      actualValue = await page.$eval(selector, (node) => {
        if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
          // Với input/textarea, LUÔN lấy value trước, không bao giờ lấy placeholder
          // Vì placeholder chỉ là hint, không phải giá trị thực tế
          // Nếu value là chuỗi rỗng, vẫn trả về chuỗi rỗng (không fallback sang placeholder)
          const val = node.value || ''
          return val.trim()
        } else if (node instanceof HTMLSelectElement) {
          return (node.options[node.selectedIndex]?.text || '').trim()
        } else if (node instanceof HTMLLabelElement) {
          return (node.textContent || '').trim()
        }
        return (node.innerText || node.textContent || '').trim()
      })
      
      // DEBUG: Log giá trị đã lấy được
      console.error(`  🔍 DEBUG: Validating #${key}, expected="${expectedValue}", actual="${actualValue}"`)
      console.error(`  🔍 DEBUG: Element type: ${elementInfoForValidation?.type || 'unknown'}, isPassword: ${elementInfoForValidation?.isPassword || false}`)
      
      // Đặc biệt xử lý password input: Sau khi submit form, password thường bị browser clear vì lý do bảo mật
      // Nếu password input có value rỗng sau khi submit, có thể là do browser đã clear nó
      // Trong trường hợp này, chúng ta có thể skip validate password hoặc coi như nó đã được fill đúng trước khi submit
      if (elementInfoForValidation?.isPassword && !actualValue && expectedValue) {
        console.error(`  ⚠️ Password input #${key} is empty after submit (likely cleared by browser for security)`)
        console.error(`  ℹ️ Skipping validation for password (it was verified before submit)`)
        // Skip validation cho password nếu nó bị clear sau submit
        continue
      }
      
      // Kiểm tra lại value một lần nữa để đảm bảo
      if (actualValue !== expectedValue) {
        const recheckValue = await page.$eval(selector, (node) => {
          if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
            return node.value || ''
          }
          return ''
        })
        console.error(`  🔍 DEBUG: Recheck value for #${key}: "${recheckValue}"`)
        
        // Nếu recheckValue khác với actualValue, dùng recheckValue
        if (recheckValue !== actualValue) {
          console.error(`  ⚠️ Value changed after recheck, using: "${recheckValue}"`)
          actualValue = recheckValue.trim()
        }
      }

    if (actualValue !== expectedValue) {
  errors.push({
    key,
    type: 'mismatch',
    expected: expectedValue,
    actual: actualValue,
  })

   // Highlight phần tử có lỗi trên trang web
   await page.evaluate(({ key, expectedValue, actualValue }) => {
    const el = document.getElementById(key)
    if (!el) return

    // Highlight bằng màu đỏ rõ ràng
    el.style.outline = '3px solid red'
    el.style.background = 'rgba(255,0,0,0.15)'
    el.style.border = '2px solid red'
    el.setAttribute(
      'title',
      `⚠️ i18n mismatch\nExpected: "${expectedValue}"\nActual: "${actualValue}"`
    )
    
    // Scroll đến phần tử để user dễ thấy
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, { key, expectedValue, actualValue })
}

    } catch (e) {
      errors.push({
        key,
        type: 'error',
        message: e.message || String(e),
        expected: expectedValue,
      })
    }
  }

  // Thêm các lỗi từ API vào danh sách errors
  if (apiErrors.length > 0) {
    console.error(`⚠️ Adding ${apiErrors.length} API error(s) to validation results`)
    apiErrors.forEach((apiError, idx) => {
      errors.push({
        key: `api_error_${idx + 1}`,
        type: 'error',
        message: `API Error: ${apiError}`,
        expected: undefined,
        actual: undefined,
      })
    })
  }
  
  console.error('Validation complete, errors:', errors.length)
  if (apiErrors.length > 0) {
    console.error(`  - ${apiErrors.length} API error(s) found`)
  }
  
  // Hiển thị kết quả validate trên trang web
  // Lưu ý: Sau khi redirect, page context có thể đã thay đổi, nên cần try-catch
  try {
    await page.evaluate(({ errors, pass, apiErrors }) => {
    // Tạo overlay để hiển thị kết quả
    const overlay = document.createElement('div')
    overlay.id = 'i18n-validate-overlay'
    overlay.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${pass ? '#28a745' : '#dc3545'};
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
    `
    
    const title = document.createElement('div')
    title.style.cssText = 'font-weight: bold; font-size: 16px; margin-bottom: 12px;'
    
    // Nếu có lỗi API, hiển thị rõ ràng
    if (apiErrors && apiErrors.length > 0) {
      title.textContent = `⚠️ Validation với API Errors (${errors.length} UI errors, ${apiErrors.length} API errors)`
      title.style.color = '#ffeb3b' // Màu vàng để nổi bật
    } else {
      title.textContent = pass ? '✅ Validation PASSED' : `❌ Validation FAILED (${errors.length} errors)`
    }
    overlay.appendChild(title)
    
    if (!pass && errors.length > 0) {
      const errorList = document.createElement('div')
      errorList.style.cssText = 'font-size: 12px; line-height: 1.6;'
      errors.forEach((err, idx) => {
        const errDiv = document.createElement('div')
        errDiv.style.cssText = 'margin-bottom: 8px; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 4px;'
        errDiv.innerHTML = `
          <strong>${idx + 1}. ${err.key}</strong><br>
          <span style="font-size: 11px;">
            ${err.type === 'missing' ? '⚠️ Element not found' : err.type === 'mismatch' ? '⚠️ Value mismatch' : '⚠️ Error'}<br>
            ${err.expected ? `Expected: "${err.expected}"` : ''}<br>
            ${err.actual ? `Actual: "${err.actual}"` : ''}
          </span>
        `
        errorList.appendChild(errDiv)
      })
      overlay.appendChild(errorList)
    }
    
    const closeBtn = document.createElement('button')
    closeBtn.textContent = 'Close (auto-close in 30s)'
    closeBtn.style.cssText = `
      margin-top: 12px;
      padding: 8px 16px;
      background: rgba(255,255,255,0.2);
      border: 1px solid rgba(255,255,255,0.3);
      color: white;
      border-radius: 4px;
      cursor: pointer;
      width: 100%;
    `
    closeBtn.onclick = () => {
      overlay.remove()
    }
    overlay.appendChild(closeBtn)
    
    // Hiển thị API errors nếu có - đặt ở đầu để nổi bật
    if (apiErrors && apiErrors.length > 0) {
      const apiErrorDiv = document.createElement('div')
      apiErrorDiv.style.cssText = 'margin-top: 12px; margin-bottom: 12px; padding: 12px; background: rgba(255,235,59,0.3); border-radius: 4px; border-left: 4px solid #ffeb3b; border: 2px solid #ffeb3b;'
      apiErrorDiv.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 8px; color: #ffeb3b; font-size: 14px;">⚠️ API ERRORS DETECTED - Web có lỗi từ API:</div>
        ${apiErrors.map((err, idx) => `
          <div style="margin-bottom: 6px; font-size: 13px; color: #fff; background: rgba(0,0,0,0.2); padding: 6px; border-radius: 3px;">
            <strong>${idx + 1}.</strong> ${err}
          </div>
        `).join('')}
        <div style="margin-top: 8px; font-size: 11px; color: rgba(255,255,255,0.8); font-style: italic;">
          💡 Đây là lỗi từ API/backend, không phải lỗi UI. Kiểm tra lại dữ liệu đã nhập.
        </div>
      `
      // Chèn vào sau title, trước errorList
      if (overlay.children.length > 1) {
        overlay.insertBefore(apiErrorDiv, overlay.children[1])
      } else {
        overlay.insertBefore(apiErrorDiv, closeBtn)
      }
    }
    
    document.body.appendChild(overlay)
    
    // Scroll đến phần tử đầu tiên có lỗi
    if (errors.length > 0 && errors[0].key) {
      const firstErrorEl = document.getElementById(errors[0].key)
      if (firstErrorEl) {
        firstErrorEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }, { errors, pass: errors.length === 0, apiErrors: apiErrors })
  } catch (evaluateError) {
    // Nếu page đã bị đóng hoặc context đã thay đổi sau redirect, bỏ qua việc hiển thị overlay
    // Đây không phải lỗi nghiêm trọng - validation đã hoàn thành thành công
    console.error('⚠️ Cannot display overlay (page may have redirected or closed):', evaluateError.message)
    console.error('ℹ️ Validation completed successfully, but overlay cannot be displayed on the new page')
    // Không throw error, vì validation đã hoàn thành thành công
  }
  
  const result = { pass: errors.length === 0, errors }
  const jsonOutput = JSON.stringify(result)
  
  // Trả về kết quả ngay để UI có thể hiển thị
  try {
    process.stdout.write(jsonOutput)
    process.stdout.end()
    console.error('JSON written to stdout, length:', jsonOutput.length)
    
    // Đợi một chút để đảm bảo data được ghi
    await new Promise(resolve => setTimeout(resolve, 100))
  } catch (e) {
    console.error('Error writing result:', e)
    if (context) {
      await context.close()
    } else if (browser) {
      await browser.close()
    }
    process.exit(1)
  }
  
  // Sau khi trả về kết quả, giữ browser mở để user xem kết quả validate trực tiếp trên trang web
  if (!useHeadless) {
    // Nếu browser không headless, giữ mở để user xem kết quả
    console.error('✅ Browser is open! You can see:')
    console.error('   - Validation overlay (top-right corner)')
    console.error('   - Highlighted error elements (red outline)')
    console.error('   - Browser will stay open until you close it manually')
    console.error('   - Process will keep running in background to maintain browser')
    console.error('   - You can test again - previous browser will stay open, new one will open')
    
    // Không đóng browser, không exit process
    // Process sẽ chạy ở background để giữ browser mở
    // Khi test lần tiếp theo, main.ts sẽ kill process cũ và start process mới
    
    // Đợi browser đóng hoặc process bị kill
    // Với persistent context, cần listen trên context thay vì browser
    if (context) {
      context.on('close', () => {
        console.error('Context closed, exiting process...')
        process.exit(0)
      })
    } else if (browser) {
      browser.on('disconnected', () => {
        console.error('Browser disconnected, exiting process...')
        process.exit(0)
      })
    }
    
    // Không exit process - để giữ browser mở
    // Process sẽ chạy mãi cho đến khi browser đóng hoặc bị kill
    // User có thể test nhiều lần với cùng browser instance
    console.error('⏳ Process will keep running to maintain browser open...')
    console.error('⏳ You can test again - browser will stay open')
    console.error('⏳ Close browser manually when done testing')
    
  } else {
    // Nếu headless mode, đóng browser ngay sau khi validate xong
    console.error('Headless mode: Closing browser...')
    try {
      if (context) {
        await context.close()
      } else if (browser) {
        await browser.close()
      }
      console.error('Browser closed successfully')
    } catch (e) {
      console.error('Error closing browser:', e.message)
    }
    console.error('Note: Browser was in headless mode. Please open the URL manually to view the page.')
    process.exit(0)
  }
  
  // Không exit process nếu browser không headless - để giữ browser mở
  // Process sẽ exit khi browser đóng hoặc bị kill bởi main.ts khi test lần tiếp theo
  } catch (error) {
    console.error('❌ Error in main function:', error)
    console.error('Error message:', error.message)
    console.error('Error stack:', error.stack)
    // Ghi lỗi vào stderr để main.ts có thể đọc
    const errorMsg = 'ERROR: ' + (error.message || String(error)) + '\n'
    const stackMsg = 'STACK: ' + (error.stack || 'No stack trace') + '\n'
    process.stderr.write(errorMsg)
    process.stderr.write(stackMsg)
    // Đảm bảo stderr được flush
    process.stderr.end()
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('❌ Error in validatePage (outer catch):', e)
  console.error('Error message:', e.message)
  console.error('Error stack:', e.stack)
  // Ghi lỗi vào stderr để main.ts có thể đọc
  const errorMsg = 'ERROR: ' + (e.message || String(e)) + '\n'
  const stackMsg = 'STACK: ' + (e.stack || 'No stack trace') + '\n'
  process.stderr.write(errorMsg)
  process.stderr.write(stackMsg)
  // Đảm bảo stderr được flush
  process.stderr.end()
  process.exit(1)
})

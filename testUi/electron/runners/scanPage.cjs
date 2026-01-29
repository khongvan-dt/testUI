const { chromium } = require('playwright-core')

async function main() {
  const url = process.argv[2]
  if (!url) {
    console.error('Missing url')
    process.exit(1)
  }

  console.error('Starting playwright scan for:', url)
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] // Thêm args chống sandbox để tránh crash
  })
  const context = await browser.newContext()
  const page = await context.newPage()

  console.error('Navigating to URL:', url)
  
  // Clear cache và cookies để đảm bảo load trang mới
  await context.clearCookies()
  await page.goto(url, { 
    waitUntil: 'networkidle', 
    timeout: 30000,
    // Disable cache để đảm bảo load trang mới
    referer: undefined
  })
  
  // Verify URL đã load đúng
  const currentUrl = page.url()
  console.error('Page loaded, current URL:', currentUrl)
  
  // Kiểm tra xem URL có khớp không (có thể có redirect)
  if (!currentUrl.includes(url.split('?')[0].split('#')[0])) {
    console.error('⚠️ WARNING: URL mismatch!')
    console.error('  Expected:', url)
    console.error('  Actual:', currentUrl)
    console.error('  Continuing with actual URL...')
  }
  
  console.error('Waiting for dynamic content...')
  
  // Đợi thêm một chút để các component Vue/React render xong
  await new Promise(resolve => setTimeout(resolve, 2000))
  
  // Scroll để trigger lazy loading và đảm bảo các element được render
  await page.evaluate(() => {
    window.scrollTo(0, 0)
  })
  await new Promise(resolve => setTimeout(resolve, 500))
  
  // Scroll xuống dần để trigger các element lazy load
  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight)
  const viewportHeight = await page.evaluate(() => window.innerHeight)
  
  for (let scroll = 0; scroll < scrollHeight; scroll += viewportHeight) {
    await page.evaluate((y) => {
      window.scrollTo(0, y)
    }, scroll)
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  
  // Scroll về đầu trang
  await page.evaluate(() => {
    window.scrollTo(0, 0)
  })
  await new Promise(resolve => setTimeout(resolve, 500))
  
  // Đợi thêm một chút để đảm bảo tất cả đã render
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  console.error('Scanning elements...')
  
  // Verify lại URL trước khi scan
  const finalUrl = page.url()
  console.error('Final URL before scan:', finalUrl)

  const items = await page.evaluate(() => {
    const result = []
    const elements = Array.from(document.querySelectorAll('[id]'))

    // Loại bỏ các phần tử không cần thiết
    const excludeTags = ['STYLE', 'SCRIPT', 'NOSCRIPT', 'META', 'LINK', 'HEAD']
    const excludeIds = [
      'googleidentityservice',
      'gsi',
      '__next',
      'react',
      'app', // Root app element thường không cần scan
      'root', // Root element
    ]
    
    // Loại bỏ các id quá ngắn hoặc không có ý nghĩa
    const excludeIdPatterns = [
      /^[a-z]$/i, // Chỉ 1 ký tự
      /^[0-9]+$/, // Chỉ số
    ]

    for (const el of elements) {
      const id = (el.id || '').trim()
      if (!id) continue

      // Bỏ qua các tag không cần thiết
      if (excludeTags.includes(el.tagName)) continue
      
      // Bỏ qua các id chứa từ khóa không cần thiết
      if (excludeIds.some(exclude => id.toLowerCase() === exclude.toLowerCase())) continue
      
      // Bỏ qua các id match pattern không cần thiết
      if (excludeIdPatterns.some(pattern => pattern.test(id))) continue
      
      // Bỏ qua các phần tử ẩn (nhưng giữ lại các input/select/textarea vì có thể cần validate)
      const style = window.getComputedStyle(el)
      const isInputElement = el instanceof HTMLInputElement || 
                            el instanceof HTMLTextAreaElement || 
                            el instanceof HTMLSelectElement
      
      if (!isInputElement && (style.display === 'none' || style.visibility === 'hidden')) continue

      let value = ''

      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        // Với input/textarea, ưu tiên placeholder, sau đó là value
        value = el.placeholder || el.value || ''
        // Nếu không có placeholder và value, thử lấy từ label gần đó
        if (!value) {
          const label = el.closest('label') || document.querySelector(`label[for="${id}"]`)
          if (label) {
            value = label.textContent || ''
          }
        }
      } else if (el instanceof HTMLSelectElement) {
        value = el.options[el.selectedIndex]?.text || el.options[0]?.text || ''
      } else if (el instanceof HTMLLabelElement) {
        value = el.textContent || ''
      } else {
        // Với các element khác, lấy text nhưng loại bỏ text từ các child element đã có id riêng
        const clone = el.cloneNode(true)
        // Xóa các child có id để tránh duplicate
        clone.querySelectorAll('[id]').forEach(child => child.remove())
        value = clone.innerText || clone.textContent || ''
      }

      value = (value || '').trim()
      
      // Bỏ qua nếu value quá dài (có thể là CSS hoặc script)
      if (value.length > 500) continue
      
      // Bỏ qua nếu value chỉ chứa CSS hoặc code
      if (value.includes('{') && value.includes('}') && value.includes(':')) continue
      
      // Với input/select/textarea, luôn thêm vào kể cả value rỗng (vì có thể cần validate)
      if (!value && !isInputElement) continue

      result.push({ id, value })
    }

    return result
  })

  console.error('Scan complete, found', items.length, 'items')
  
  // Log một vài items đầu tiên để debug
  if (items.length > 0) {
    console.error('First few items:', JSON.stringify(items.slice(0, 3)))
  }
  
  await context.close()
  await browser.close()
  console.error('Browser closed')

  // ✅ In JSON ra stdout để electron main đọc
  const jsonOutput = JSON.stringify(items)
  process.stdout.write(jsonOutput)
  console.error('JSON written to stdout, length:', jsonOutput.length)
  process.exit(0)
}

main().catch((e) => {
  console.error('Error in scanPage:', e)
  process.stderr.write('ERROR: ' + (e.message || String(e)))
  process.exit(1)
})

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
  const page = await browser.newPage()

  console.error('Navigating to URL...')
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
  console.error('Page loaded, scanning elements...')

  const items = await page.evaluate(() => {
    const result = []
    const elements = Array.from(document.querySelectorAll('[id]'))

    // Loại bỏ các phần tử không cần thiết
    const excludeTags = ['STYLE', 'SCRIPT', 'NOSCRIPT', 'META', 'LINK']
    const excludeIds = [
      'googleidentityservice',
      'gsi',
      '__next',
      'react',
    ]

    for (const el of elements) {
      const id = (el.id || '').trim()
      if (!id) continue

      // Bỏ qua các tag không cần thiết
      if (excludeTags.includes(el.tagName)) continue
      
      // Bỏ qua các id chứa từ khóa không cần thiết
      if (excludeIds.some(exclude => id.toLowerCase().includes(exclude.toLowerCase()))) continue
      
      // Bỏ qua các phần tử ẩn
      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') continue

      let value = ''

      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        value = el.placeholder || el.value || ''
      } else if (el instanceof HTMLSelectElement) {
        value = el.options[el.selectedIndex]?.text || ''
      } else if (el instanceof HTMLLabelElement) {
        value = el.textContent || ''
      } else {
        value = el.innerText || el.textContent || ''
      }

      value = (value || '').trim()
      
      // Bỏ qua nếu value quá dài (có thể là CSS hoặc script)
      if (value.length > 500) continue
      
      // Bỏ qua nếu value chỉ chứa CSS hoặc code
      if (value.includes('{') && value.includes('}') && value.includes(':')) continue
      
      if (!value) continue

      result.push({ id, value })
    }

    return result
  })

  console.error('Scan complete, found', items.length, 'items')
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

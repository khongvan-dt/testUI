// Script test để kiểm tra Playwright browsers đã cài đặt thành công
const { chromium } = require('playwright-core')

async function testPlaywright() {
  console.log('🧪 Testing Playwright browser installation...')
  
  try {
    console.log('📦 Attempting to launch Chromium...')
    const browser = await chromium.launch({ 
      headless: true,
      timeout: 30000 
    })
    
    console.log('✅ SUCCESS: Chromium browser launched successfully!')
    console.log('✅ Playwright browsers are properly installed.')
    
    const page = await browser.newPage()
    await page.goto('https://example.com', { timeout: 10000 })
    console.log('✅ SUCCESS: Browser can navigate to websites!')
    
    await browser.close()
    console.log('✅ All tests passed! Playwright is ready to use.')
    process.exit(0)
  } catch (error) {
    console.error('❌ FAILED: Error launching browser')
    console.error('Error message:', error.message)
    console.error('')
    console.error('💡 Solution: Run "npm run install:playwright" to install browsers')
    process.exit(1)
  }
}

testPlaywright()

// Test script để chạy validatePage.cjs trực tiếp
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const { tmpdir } = require('os')

const runnerPath = path.join(__dirname, 'electron/runners/validatePage.cjs')
const testUrl = 'https://example.com'
const testJson = { test: 'Test value' }

// Tạo temp file
const tempFile = path.join(tmpdir(), `test-validate-${Date.now()}.json`)
fs.writeFileSync(tempFile, JSON.stringify(testJson), 'utf8')

console.log('🧪 Testing validatePage.cjs directly...')
console.log('Runner path:', runnerPath)
console.log('Test URL:', testUrl)
console.log('Temp file:', tempFile)

const child = spawn(process.execPath, [runnerPath, testUrl, tempFile], {
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: path.dirname(runnerPath),
})

let out = ''
let err = ''

child.stdout.on('data', (d) => {
  const text = d.toString()
  out += text
  console.log('STDOUT:', text)
})

child.stderr.on('data', (d) => {
  const text = d.toString()
  err += text
  console.log('STDERR:', text)
})

child.on('error', (error) => {
  console.error('❌ Failed to spawn:', error.message)
  try { fs.unlinkSync(tempFile) } catch {}
  process.exit(1)
})

child.on('close', (code, signal) => {
  console.log('\n=== Process Exit ===')
  console.log('Exit code:', code)
  console.log('Signal:', signal)
  console.log('STDOUT length:', out.length)
  console.log('STDERR length:', err.length)
  
  if (code === 0) {
    console.log('✅ SUCCESS!')
    if (out) {
      try {
        const result = JSON.parse(out.trim())
        console.log('Result:', JSON.stringify(result, null, 2))
      } catch (e) {
        console.log('Output:', out)
      }
    }
  } else {
    console.error('❌ FAILED!')
    if (err) {
      console.error('STDERR:', err)
    }
    if (out) {
      console.error('STDOUT:', out)
    }
  }
  
  try { fs.unlinkSync(tempFile) } catch {}
  process.exit(code)
})

setTimeout(() => {
  console.error('⏱️ Timeout after 30 seconds, killing process...')
  child.kill()
  try { fs.unlinkSync(tempFile) } catch {}
  process.exit(1)
}, 30000)

import { useMemo, useState, useEffect } from 'react'
import './App.css'

type Item = { id: string; value: string }
type ValidateResult = {
  pass: boolean
  errors: Array<{
    key: string
    type: 'missing' | 'mismatch' | 'error'
    expected?: string
    actual?: string
    message?: string
  }>
} | null

export default function App() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [validateResult, setValidateResult] = useState<ValidateResult>(null)
  const [browserOpened, setBrowserOpened] = useState(false)

  const selectedJson = useMemo(() => {
    const obj: Record<string, string> = {}
    for (const it of items) {
      if (selected[it.id]) obj[it.id] = it.value
    }
    return obj
  }, [items, selected])

  // Cập nhật jsonText khi selectedJson thay đổi
  useEffect(() => {
    setJsonText(JSON.stringify(selectedJson, null, 2))
    setJsonError(null)
  }, [selectedJson])

  // Hàm apply JSON changes
  const applyJsonChanges = () => {
    try {
      const parsed = JSON.parse(jsonText)
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        setJsonError('JSON phải là một object')
        return
      }

      // Tạo selected state mới dựa trên JSON
      const newSelected: Record<string, boolean> = {}
      for (const key in parsed) {
        // Kiểm tra xem key có tồn tại trong items không
        const itemExists = items.some(item => item.id === key)
        if (itemExists) {
          newSelected[key] = true
        }
      }

      setSelected(newSelected)
      setJsonError(null)
    } catch (e) {
      setJsonError('JSON không hợp lệ: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  // Debug: Log khi items thay đổi
  useEffect(() => {
    console.log('Items updated:', items.length, items)
  }, [items])

  const onLoad = async () => {
    if (!url.trim()) return
    setLoading(true)
    try {
      console.log('Starting scan for:', url.trim())
      if (!window.api) {
        throw new Error('API not available. Make sure preload script is loaded.')
      }
      console.log('Calling window.api.scanPage...')
      console.log('window.api exists?', !!window.api)
      console.log('window.api.scanPage exists?', typeof window.api?.scanPage)

      const data = await window.api.scanPage(url.trim())
      console.log('Scan result received:', data)
      console.log('Data type:', Array.isArray(data) ? 'Array' : typeof data)
      console.log('Number of items:', data?.length || 0)
      console.log('Data stringified:', JSON.stringify(data).substring(0, 200))

      // Đảm bảo data là array
      if (Array.isArray(data)) {
        console.log('Setting items, count:', data.length)
        setItems(data)
        setSelected({})
        console.log('Items state should be updated now')
        if (data.length === 0) {
          alert('Không tìm thấy phần tử nào có id trên trang này. Vui lòng kiểm tra lại URL.')
        } else {
          console.log('Items set successfully:', data.length, 'items')
        }
      } else {
        console.error('Invalid data format:', data)
        console.error('Data value:', JSON.stringify(data))
        alert('Dữ liệu trả về không đúng định dạng: ' + typeof data)
      }
    } catch (e: any) {
      console.error('Scan error:', e)
      alert(e?.message || 'Load failed: ' + String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>UI i18n Tool</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          style={{ flex: 1, padding: 8 }}
          placeholder="Paste URL here..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button onClick={onLoad} disabled={loading}>
          {loading ? 'Loading...' : 'Load'}
        </button>
         {/* Validate & Test */}
        <button
          onClick={async () => {
            if (!url.trim()) {
              alert('Vui lòng nhập URL trước')
              return
            }
            
            // Parse JSON từ textarea để lấy giá trị thực tế mà user đã nhập
            let jsonToValidate: Record<string, string>
            try {
              const parsed = JSON.parse(jsonText)
              if (typeof parsed !== 'object' || Array.isArray(parsed)) {
                alert('JSON phải là một object')
                return
              }
              jsonToValidate = parsed
            } catch (e) {
              alert('JSON không hợp lệ: ' + (e instanceof Error ? e.message : String(e)))
              return
            }
            
            if (Object.keys(jsonToValidate).length === 0) {
              alert('Vui lòng nhập ít nhất một phần tử trong JSON để test')
              return
            }
            
            try {
              setLoading(true)
              setValidateResult(null)
              const result = await window.api.validatePage(url.trim(), jsonToValidate, browserOpened)
              setValidateResult(result)
              // Đánh dấu browser đã mở sau lần đầu tiên
              if (!browserOpened) {
                setBrowserOpened(true)
              }
              // BrowserWindow sẽ tự động mở (lần đầu) hoặc reuse (các lần sau)
              // Kết quả validate sẽ hiển thị trực tiếp trên trang web trong BrowserWindow
              if (result.pass) {
                // Có thể hiển thị thông báo thành công ngắn gọn
                console.log('PASS - Tất cả các phần tử đều đúng!')
              } else {
                console.log(' FAIL - Có', result.errors.length, 'lỗi. Xem chi tiết trong browser và panel bên dưới.')
              }
            } catch (e: any) {
              const errorMessage = e?.message || String(e)
              setValidateResult({ pass: false, errors: [{ key: 'system', type: 'error', message: errorMessage }] })
              
              // Hiển thị lỗi chung
              alert('Lỗi khi test: ' + errorMessage)
            } finally {
              setLoading(false)
            }
          }}
          disabled={loading || !url.trim() || !jsonText.trim()}
          style={{
            padding: '8px 16px',
            backgroundColor: loading || !url.trim() || !jsonText.trim() ? '#ccc' : '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: loading || !url.trim() || !jsonText.trim() ? 'not-allowed' : 'pointer'
          }}
          title="Chạy validate - BrowserWindow sẽ tự động mở/reuse để hiển thị kết quả"
        >
          {loading ? 'Testing...' : ' Validate & Test'}
        </button>
        <button
          onClick={() => {
            setValidateResult(null)
            // Có thể thêm thông báo ngắn gọn
          }}
          disabled={!validateResult}
          style={{
            padding: '8px 16px',
            backgroundColor: !validateResult ? '#ccc' : '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: !validateResult ? 'not-allowed' : 'pointer'
          }}
          title="Xóa kết quả test để chuẩn bị cho test case mới"
        >
           Clear Results
        </button>
        {browserOpened && (
          <div style={{
            padding: '6px 12px',
            backgroundColor: '#d1ecf1',
            color: '#0c5460',
            borderRadius: 4,
            fontSize: '0.85em',
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}>
            <span>✓</span>
            <span>BrowserWindow đã mở - các test tiếp theo sẽ chạy trên cùng window</span>
          </div>
        )}

      </div>

      <div style={{ display: 'flex', gap: 12, height: '75vh' }}>
        {/* LEFT */}
        <div style={{ flex: 1, border: '1px solid #ddd', padding: 12, overflow: 'auto' }}>
          <h3>Elements from page ({items.length} items)</h3>

          {items.length === 0 && <div>Chưa load dữ liệu</div>}

          {items.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <button
                onClick={() => setSelected({})}
                style={{ marginRight: 8, padding: '4px 8px' }}
              >
                Bỏ chọn tất cả
              </button>
              <button
                onClick={() => {
                  const allSelected: Record<string, boolean> = {}
                  items.forEach(item => { allSelected[item.id] = true })
                  setSelected(allSelected)
                }}
                style={{ padding: '4px 8px' }}
              >
                Chọn tất cả
              </button>
            </div>
          )}

          {items.map((it) => {
            // Kiểm tra xem phần tử này có lỗi trong validate result không
            const error = validateResult?.errors?.find(err => err.key === it.id)
            const hasError = !!error
            
            return (
              <label
                key={it.id}
                style={{
                  display: 'flex',
                  gap: 8,
                  padding: 8,
                  borderBottom: '1px solid #eee',
                  cursor: 'pointer',
                  backgroundColor: hasError ? '#ffe6e6' : 'transparent',
                  borderLeft: hasError ? '3px solid #dc3545' : 'none'
                }}
              >
                <input
                  type="checkbox"
                  checked={!!selected[it.id]}
                  onChange={(e) => setSelected((prev) => ({ ...prev, [it.id]: e.target.checked }))}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {it.id}
                    {hasError && (
                      <span style={{ 
                        fontSize: '0.75em', 
                        color: '#dc3545', 
                        fontWeight: 'normal',
                        padding: '2px 6px',
                        backgroundColor: '#fff',
                        borderRadius: 3
                      }}>
                         {error.type === 'missing' ? 'Missing' : error.type === 'mismatch' ? 'Mismatch' : 'Error'}
                      </span>
                    )}
                  </div>
                  <div style={{ color: '#666', fontSize: '0.9em', wordBreak: 'break-word' }}>
                    {it.value.length > 100 ? it.value.substring(0, 100) + '...' : it.value}
                  </div>
                  {hasError && error.type === 'mismatch' && (
                    <div style={{ marginTop: 4, fontSize: '0.85em', color: '#dc3545' }}>
                      <div>Expected: <strong>{error.expected}</strong></div>
                      <div>Actual: <strong>{error.actual}</strong></div>
                    </div>
                  )}
                  {hasError && error.type === 'missing' && (
                    <div style={{ marginTop: 4, fontSize: '0.85em', color: '#dc3545' }}>
                      Element không tồn tại trên trang
                    </div>
                  )}
                  {hasError && error.type === 'error' && error.message && (
                    <div style={{ marginTop: 4, fontSize: '0.85em', color: '#dc3545' }}>
                      {error.message}
                    </div>
                  )}
                </div>
              </label>
            )
          })}
        </div>

        {/* RIGHT */}
        <div style={{ flex: 1, border: '1px solid #ddd', padding: 12, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Selected JSON</h3>
            <button
              onClick={applyJsonChanges}
              disabled={!!jsonError}
              style={{
                padding: '6px 12px',
                backgroundColor: jsonError ? '#ccc' : '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: jsonError ? 'not-allowed' : 'pointer'
              }}
            >
              Áp dụng thay đổi
            </button>
          </div>

          {jsonError && (
            <div style={{
              padding: 8,
              marginBottom: 8,
              backgroundColor: '#fee',
              color: '#c33',
              borderRadius: 4,
              fontSize: '0.9em'
            }}>
              {jsonError}
            </div>
          )}

          <textarea
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value)
              // Validate JSON khi đang type
              try {
                JSON.parse(e.target.value)
                setJsonError(null)
              } catch (e) {
                // Chỉ set error khi user dừng typing, không set ngay
              }
            }}
            onBlur={() => {
              // Validate khi blur
              try {
                JSON.parse(jsonText)
                setJsonError(null)
              } catch (e) {
                setJsonError('JSON không hợp lệ: ' + (e instanceof Error ? e.message : String(e)))
              }
            }}
            style={{
              flex: 1,
              fontFamily: 'monospace',
              fontSize: '0.9em',
              padding: 8,
              border: `1px solid ${jsonError ? '#c33' : '#ddd'}`,
              borderRadius: 4,
              resize: 'none',
              whiteSpace: 'pre',
              overflow: 'auto'
            }}
            spellCheck={false}
          />

          <div style={{ marginTop: 8, fontSize: '0.85em', color: '#666' }}>
             Tip: Sửa JSON và nhấn "Áp dụng thay đổi" để cập nhật các checkbox bên trái
          </div>

          {/* Validate Result Panel */}
          {validateResult && (
            <div style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 4,
              backgroundColor: validateResult.pass ? '#d4edda' : '#f8d7da',
              border: `1px solid ${validateResult.pass ? '#c3e6cb' : '#f5c6cb'}`,
              maxHeight: '200px',
              overflow: 'auto'
            }}>
              <div style={{
                fontWeight: 'bold',
                marginBottom: 8,
                color: validateResult.pass ? '#155724' : '#721c24',
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}>
                {validateResult.pass ? ' Validation PASSED' : ` Validation FAILED (${validateResult.errors.length} errors)`}
              </div>
              
              {!validateResult.pass && validateResult.errors.length > 0 && (
                <div style={{ fontSize: '0.9em' }}>
                  <div style={{ fontWeight: 600, marginBottom: 6, color: '#721c24' }}>Chi tiết lỗi:</div>
                  {validateResult.errors.map((err, idx) => (
                    <div key={idx} style={{
                      marginBottom: 8,
                      padding: 8,
                      backgroundColor: '#fff',
                      borderRadius: 3,
                      borderLeft: '3px solid #dc3545'
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        {err.key}
                        <span style={{ marginLeft: 8, fontSize: '0.85em', color: '#666' }}>
                          ({err.type === 'missing' ? 'Element không tồn tại' : err.type === 'mismatch' ? 'Giá trị không khớp' : 'Lỗi'})
                        </span>
                      </div>
                      {err.expected && (
                        <div style={{ fontSize: '0.85em', marginTop: 2 }}>
                          <strong>Expected:</strong> {err.expected}
                        </div>
                      )}
                      {err.actual && (
                        <div style={{ fontSize: '0.85em', marginTop: 2 }}>
                          <strong>Actual:</strong> {err.actual}
                        </div>
                      )}
                      {err.message && (
                        <div style={{ fontSize: '0.85em', marginTop: 2, color: '#dc3545' }}>
                          {err.message}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              
              <div style={{ marginTop: 8, fontSize: '0.85em', color: '#666', fontStyle: 'italic' }}>
                 BrowserWindow đã mở để bạn xem kết quả validate trực tiếp trên trang web. Các phần tử có lỗi sẽ được highlight bằng màu đỏ.
              </div>
              
              <div style={{ marginTop: 12, padding: 8, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 4, fontSize: '0.85em' }}>
                <strong> Để test case mới:</strong>
                <ol style={{ margin: '4px 0 0 0', paddingLeft: 20 }}>
                  <li>Sửa JSON trong textarea phía trên (hoặc giữ nguyên nếu muốn test lại)</li>
                  <li>Nhấn " Validate & Test" để chạy test mới</li>
                  <li>Hoặc nhấn " Clear Results" để xóa kết quả này</li>
                </ol>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

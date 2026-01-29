import { useMemo, useState, useEffect } from 'react'
import './App.css'

type Item = { 
  id: string
  value: string
  level?: number
  path?: string
  parentId?: string | null
  arrayIndex?: number
  isArrayContainer?: boolean
}
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
  const [testWindowOpened, setTestWindowOpened] = useState(false)
  const [loginUrl, setLoginUrl] = useState('')

  // Generate nested JSON structure từ selected items - đơn giản hóa dựa trên path và arrayIndex
  const selectedJson = useMemo(() => {
    const nestedObj: any = {}
    const itemMap = new Map<string, Item>()
    
    // Tạo map để dễ lookup
    items.forEach(it => {
      if (selected[it.id]) {
        itemMap.set(it.id, it)
      }
    })
    
    // Helper: Set value vào nested object tại path cụ thể
    function setValue(obj: any, path: string[], arrayIndex: number | undefined, value: any, isArrayContainer: boolean) {
      let current = obj
      
      // Navigate đến vị trí trước item cuối cùng
      for (let i = 0; i < path.length - 1; i++) {
        const key = path[i]
        const nextKey = path[i + 1]
        const pathItem = itemMap.get(key)
        
        if (!current[key]) {
          current[key] = pathItem?.isArrayContainer ? [] : {}
        }
        
        // Nếu key tiếp theo có arrayIndex, cần xử lý array
        const nextItem = itemMap.get(nextKey)
        if (nextItem && nextItem.arrayIndex !== undefined && pathItem?.isArrayContainer) {
          // Convert thành array nếu chưa phải
          if (!Array.isArray(current[key])) {
            current[key] = []
          }
          // Đảm bảo array đủ lớn
          while (current[key].length <= nextItem.arrayIndex) {
            current[key].push({})
          }
          current = current[key][nextItem.arrayIndex]
        } else {
          current = current[key]
        }
      }
      
      // Set value cho item cuối cùng
      const lastKey = path[path.length - 1]
      if (arrayIndex !== undefined) {
        // Item nằm trong array
        const parentKey = path[path.length - 2]
        if (parentKey && current[parentKey] && Array.isArray(current[parentKey])) {
          // Parent đã là array
          while (current[parentKey].length <= arrayIndex) {
            current[parentKey].push({})
          }
          if (isArrayContainer) {
            current[parentKey][arrayIndex][lastKey] = []
          } else {
            current[parentKey][arrayIndex][lastKey] = value
          }
        } else {
          // Cần tạo array cho parent
          if (!current[lastKey] || !Array.isArray(current[lastKey])) {
            current[lastKey] = []
          }
          while (current[lastKey].length <= arrayIndex) {
            current[lastKey].push({})
          }
          // Không set value ở đây vì đây là container
        }
      } else {
        // Item không trong array
        if (isArrayContainer) {
          current[lastKey] = []
        } else {
          current[lastKey] = value
        }
      }
    }
    
    // Sắp xếp items theo level để xử lý từ root xuống
    const sortedItems = Array.from(itemMap.values()).sort((a, b) => {
      const levelA = a.level || 0
      const levelB = b.level || 0
      if (levelA !== levelB) return levelA - levelB
      // Nếu cùng level, sắp xếp theo arrayIndex để các item cùng index được xử lý cùng nhau
      const indexA = a.arrayIndex ?? -1
      const indexB = b.arrayIndex ?? -1
      if (indexA !== indexB) return indexA - indexB
      const pathA = a.path || a.id
      const pathB = b.path || b.id
      return pathA.localeCompare(pathB)
    })
    
    // Xây dựng nested structure
    for (const item of sortedItems) {
      const pathParts = (item.path || item.id).split('.')
      const arrayIndex = item.arrayIndex
      const isArrayContainer = item.isArrayContainer
      
      if (pathParts.length === 1) {
        // Root level
        if (isArrayContainer) {
          nestedObj[item.id] = []
        } else {
          nestedObj[item.id] = item.value
        }
      } else {
        // Có parent - build path và set value
        // Tìm parent trong path
        const parentId = item.parentId
        if (parentId) {
          const parentItem = itemMap.get(parentId)
          if (parentItem) {
            // Build full path từ root
            const fullPath: string[] = []
            let current: Item | undefined = item
            
            // Build path ngược từ item lên root
            const pathStack: Item[] = []
            while (current) {
              pathStack.unshift(current)
              current = current.parentId ? itemMap.get(current.parentId) : undefined
            }
            
            // Navigate và set value
            let target = nestedObj
            for (let i = 0; i < pathStack.length; i++) {
              const pathItem = pathStack[i]
              const isLast = i === pathStack.length - 1
              
              if (i === 0) {
                // Root level
                if (!target[pathItem.id]) {
                  target[pathItem.id] = pathItem.isArrayContainer ? [] : {}
                }
                target = target[pathItem.id]
              } else {
                // Check xem pathItem có trong array không
                const grandParent = pathStack[i - 1]
                if (grandParent.isArrayContainer && pathItem.arrayIndex !== undefined) {
                  // PathItem nằm trong array của grandParent
                  if (!Array.isArray(target)) {
                    target = nestedObj
                    // Navigate lại từ đầu đến grandParent
                    for (let j = 0; j < i - 1; j++) {
                      const prevItem = pathStack[j]
                      if (!target[prevItem.id]) {
                        target[prevItem.id] = prevItem.isArrayContainer ? [] : {}
                      }
                      target = target[prevItem.id]
                    }
                    target[grandParent.id] = []
                    target = target[grandParent.id]
                  }
                  // Đảm bảo array đủ lớn
                  while (target.length <= pathItem.arrayIndex) {
                    target.push({})
                  }
                  target = target[pathItem.arrayIndex]
                  
                  // Nếu là item cuối cùng, set value
                  if (isLast) {
                    if (isArrayContainer) {
                      target[pathItem.id] = []
                    } else {
                      target[pathItem.id] = item.value
                    }
                  } else {
                    // Chưa phải cuối, tiếp tục navigate
                    if (!target[pathItem.id]) {
                      target[pathItem.id] = pathItem.isArrayContainer ? [] : {}
                    }
                    target = target[pathItem.id]
                  }
                } else {
                  // PathItem không trong array
                  if (!target[pathItem.id]) {
                    target[pathItem.id] = pathItem.isArrayContainer ? [] : {}
                  }
                  if (isLast) {
                    if (isArrayContainer) {
                      target[pathItem.id] = []
                    } else {
                      target[pathItem.id] = item.value
                    }
                  } else {
                    target = target[pathItem.id]
                  }
                }
              }
            }
          }
        }
      }
    }
    
    return nestedObj
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
    const trimmedUrl = url.trim()
    if (!trimmedUrl) {
      alert('Vui lòng nhập URL trước khi load')
      return
    }
    
    // Clear state cũ khi load URL mới
    setItems([])
    setSelected({})
    setValidateResult(null)
    setJsonText('')
    setJsonError(null)
    
    setLoading(true)
    try {
      console.log('Starting scan for:', trimmedUrl)
      if (!window.api) {
        throw new Error('API not available. Make sure preload script is loaded.')
      }
      console.log('Calling window.api.scanPage...')
      console.log('window.api exists?', !!window.api)
      console.log('window.api.scanPage exists?', typeof window.api?.scanPage)

      const data = await window.api.scanPage(trimmedUrl)
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

      <div style={{ 
        marginBottom: 16, 
        padding: 12, 
        backgroundColor: '#f8f9fa', 
        borderRadius: 8,
        border: '1px solid #dee2e6'
      }}>
       
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            style={{ flex: 1, minWidth: 200, padding: 8 }}
            placeholder="URL trang login (tùy chọn)..."
            value={loginUrl}
            onChange={(e) => setLoginUrl(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && !loading && loginUrl.trim()) {
                try {
                  setLoading(true)
                  await window.api.openTestWindow(loginUrl.trim())
                  setTestWindowOpened(true)
                } catch (err: any) {
                  alert('Lỗi khi mở BrowserWindow: ' + (err?.message || String(err)))
                } finally {
                  setLoading(false)
                }
              }
            }}
          />
          <button
            onClick={async () => {
              try {
                setLoading(true)
                await window.api.openTestWindow(loginUrl.trim() || undefined)
                setTestWindowOpened(true)
                alert(' BrowserWindow đã mở! Vui lòng login và điều hướng đến trang cần test, sau đó nhấn "Bắt đầu test UI"')
              } catch (e: any) {
                alert('Lỗi khi mở BrowserWindow: ' + (e?.message || String(e)))
              } finally {
                setLoading(false)
              }
            }}
            disabled={loading}
            style={{
              padding: '8px 16px',
              backgroundColor: loading ? '#ccc' : '#17a2b8',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 'bold'
            }}
            title="Mở BrowserWindow để login thủ công"
          >
            {loading ? 'Đang mở...' : ' Mở tab test'}
          </button>
          <button
            onClick={async () => {
              try {
                setLoading(true)
                setValidateResult(null)
                
              
                const scannedItems = await window.api.scanCurrentPage()
                
                if (scannedItems.length === 0) {
                  alert('Không tìm thấy phần tử nào có id trên trang này. Vui lòng kiểm tra lại.')
                  return
                }
                
                // Update items và selected state
                setItems(scannedItems)
                setSelected({})
                
                // Tự động chọn tất cả items
                const allSelected: Record<string, boolean> = {}
                scannedItems.forEach(item => { allSelected[item.id] = true })
                setSelected(allSelected)
                
                // Update JSON text
                const jsonObj: Record<string, string> = {}
                scannedItems.forEach(item => { jsonObj[item.id] = item.value })
                setJsonText(JSON.stringify(jsonObj, null, 2))
                setJsonError(null)
                
                alert(` Đã scan ${scannedItems.length} phần tử từ trang hiện tại!`)
              } catch (e: any) {
                const errorMessage = e?.message || String(e)
                alert('Lỗi khi scan trang: ' + errorMessage)
              } finally {
                setLoading(false)
              }
            }}
            disabled={loading}
            style={{
              padding: '8px 16px',
              backgroundColor: loading ? '#ccc' : '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 'bold'
            }}
            title="Scan trang hiện tại để lấy danh sách các element có id"
          >
            {loading ? 'Đang scan...' : 'Scan trang hiện tại'}
          </button>
          <button
            onClick={async () => {
              // Bước 1: Click nút submit trên trang hiện tại trong BrowserWindow
              try {
                setLoading(true)
                const clickResult = await window.api.clickSubmitInTestWindow()
                if (clickResult.clicked) {
                  // Đợi trang xử lý submit (redirect, validation, etc.)
                  await new Promise(resolve => setTimeout(resolve, 1500))
                } else if (clickResult.message) {
                  console.log('', clickResult.message)
                }
              } catch (e: any) {
                setLoading(false)
                alert('Lỗi khi click submit: ' + (e?.message || String(e)))
                return
              }

              // Bước 2: Nếu có JSON thì validate
              if (!jsonText.trim()) {
                setLoading(false)
                return
              }
              
              // Parse JSON
              let jsonToValidate: Record<string, string>
              try {
                const parsed = JSON.parse(jsonText)
                if (typeof parsed !== 'object' || Array.isArray(parsed)) {
                  alert('JSON phải là một object')
                  setLoading(false)
                  return
                }
                jsonToValidate = parsed
              } catch (e) {
                alert('JSON không hợp lệ: ' + (e instanceof Error ? e.message : String(e)))
                setLoading(false)
                return
              }
              
              if (Object.keys(jsonToValidate).length === 0) {
                setLoading(false)
                return
              }
              
              try {
                setValidateResult(null)
                const result = await window.api.validateCurrentPage(jsonToValidate)
                setValidateResult(result)
                if (result.pass) {
                  console.log('✅ PASS - Tất cả các phần tử đều đúng!')
                } else {
                  console.log('❌ FAIL - Có', result.errors.length, 'lỗi')
                }
              } catch (e: any) {
                const errorMessage = e?.message || String(e)
                setValidateResult({ pass: false, errors: [{ key: 'system', type: 'error', message: errorMessage }] })
                alert('Lỗi khi test: ' + errorMessage)
              } finally {
                setLoading(false)
              }
            }}
            disabled={loading}
            style={{
              padding: '8px 16px',
              backgroundColor: loading ? '#ccc' : '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 'bold'
            }}
            title="Click nút submit trên trang hiện tại, sau đó validate (nếu có JSON)"
          >
            {loading ? 'Đang test...' : 'Test'}
          </button>
        </div>
        {testWindowOpened && (
          <div style={{
            marginTop: 8,
            padding: '8px 12px',
            backgroundColor: '#d1ecf1',
            color: '#0c5460',
            borderRadius: 4,
            fontSize: '0.9em',
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}>
            <span>✓</span>
            <span>
              BrowserWindow đã mở. Vui lòng login và điều hướng đến trang cần test, sau đó nhấn "Scan trang hiện tại" để lấy danh sách id.
            </span>
          </div>
        )}
        
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        
         
         
         
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
            const level = it.level || 0
            const indent = level * 24 // 24px per level
            
            return (
              <label
                key={it.id}
                style={{
                  display: 'flex',
                  gap: 8,
                  padding: 8,
                  paddingLeft: 8 + indent,
                  borderBottom: '1px solid #eee',
                  cursor: 'pointer',
                  backgroundColor: hasError ? '#ffe6e6' : (level % 2 === 0 ? 'transparent' : '#f9f9f9'),
                  borderLeft: hasError ? '3px solid #dc3545' : (level > 0 ? `2px solid #e0e0e0` : 'none'),
                  position: 'relative'
                }}
              >
                <input
                  type="checkbox"
                  checked={!!selected[it.id]}
                  onChange={(e) => setSelected((prev) => ({ ...prev, [it.id]: e.target.checked }))}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ 
                      fontFamily: 'monospace',
                      fontSize: level > 0 ? '0.9em' : '1em',
                      color: level > 0 ? '#555' : '#000'
                    }}>
                      {it.id}
                    </span>
                    {it.isArrayContainer && (
                      <span style={{ 
                        fontSize: '0.7em', 
                        color: '#007bff', 
                        fontWeight: 'normal',
                        padding: '2px 6px',
                        backgroundColor: '#e7f3ff',
                        borderRadius: 3
                      }}>
                        [Array]
                      </span>
                    )}
                    {it.arrayIndex !== undefined && (
                      <span style={{ 
                        fontSize: '0.7em', 
                        color: '#28a745', 
                        fontWeight: 'normal',
                        padding: '2px 6px',
                        backgroundColor: '#d4edda',
                        borderRadius: 3
                      }}>
                        [{it.arrayIndex}]
                      </span>
                    )}
                    {it.parentId && (
                      <span style={{ 
                        fontSize: '0.7em', 
                        color: '#6c757d', 
                        fontWeight: 'normal',
                        fontStyle: 'italic'
                      }}>
                        ← {it.parentId}
                      </span>
                    )}
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
                  {it.path && it.path !== it.id && (
                    <div style={{ color: '#999', fontSize: '0.75em', marginBottom: 2, fontFamily: 'monospace' }}>
                      Path: {it.path}
                    </div>
                  )}
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

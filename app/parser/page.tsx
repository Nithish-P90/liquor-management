'use client'
import { useState } from 'react'

export default function ParserTestPage() {
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setError('')
    setResult(null)
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/indents/parse-only', { method: 'POST', body: fd })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) setError(data.error)
    else setResult(data)
  }

  return (
    <div style={{ fontFamily: 'monospace', padding: 32, maxWidth: 900 }}>
      <h2 style={{ marginBottom: 16 }}>PDF Parser Test</h2>
      <input type="file" accept=".pdf" onChange={handleFile} />
      {loading && <p>Parsing...</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {result && (
        <div style={{ marginTop: 24 }}>
          <p><b>Indent:</b> {result.header?.indentNumber} | <b>Retailer:</b> {result.header?.retailerName}</p>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 12, fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f0f0f0' }}>
                {['SR','Item','Code','Rate','Indent CBS','Indent BTLS','Indent Amt','CNF CBS','CNF BTLS','CNF Amt'].map(h => (
                  <th key={h} style={{ border: '1px solid #ccc', padding: '4px 8px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.items?.map((item: any) => (
                <tr key={item.srNo}>
                  <td style={{ border: '1px solid #ccc', padding: '4px 8px' }}>{item.srNo}</td>
                  <td style={{ border: '1px solid #ccc', padding: '4px 8px' }}>{item.itemName}</td>
                  <td style={{ border: '1px solid #ccc', padding: '4px 8px' }}>{item.itemCode}</td>
                  <td style={{ border: '1px solid #ccc', padding: '4px 8px' }}>{item.ratePerCase}</td>
                  <td style={{ border: '1px solid #ccc', padding: '4px 8px', background: '#fff9c4' }}>{item.indentCases}</td>
                  <td style={{ border: '1px solid #ccc', padding: '4px 8px' }}>{item.indentBottles}</td>
                  <td style={{ border: '1px solid #ccc', padding: '4px 8px' }}>{item.indentAmount}</td>
                  <td style={{ border: '1px solid #ccc', padding: '4px 8px', background: item.cnfCases > 0 ? '#c8f7c5' : '#ffc8c8' }}>{item.cnfCases}</td>
                  <td style={{ border: '1px solid #ccc', padding: '4px 8px' }}>{item.cnfBottles}</td>
                  <td style={{ border: '1px solid #ccc', padding: '4px 8px' }}>{item.cnfAmount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: 'pointer' }}>Raw JSON</summary>
            <pre style={{ background: '#f5f5f5', padding: 12, overflow: 'auto', fontSize: 11 }}>
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { io } from 'socket.io-client'
import './App.css'

function App() {
  // Core state
  const [config, setConfig] = useState({ hasApiKey: false, hasChats: false })
  const [showApiKeyForm, setShowApiKeyForm] = useState(true)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [chats, setChats] = useState([])
  const [uploadStatus, setUploadStatus] = useState({ text: '', type: '' })
  const [uploading, setUploading] = useState(false)
  const [qrUrl, setQrUrl] = useState(null)
  const [ready, setReady] = useState(false)
  const socketRef = useRef(null)

  // Activity log
  const [activityLog, setActivityLog] = useState([])
  const activityRef = useRef(null)

  // Selected contact
  const [selectedContact, setSelectedContact] = useState('__all__')
  const [dbContacts, setDbContacts] = useState([])

  // Overlay: 'bulk' | 'settings' | null
  const [overlay, setOverlay] = useState(null)

  // Bulk send
  const [bulkNumbers, setBulkNumbers] = useState('')
  const [bulkMessage, setBulkMessage] = useState('')
  const [bulkSending, setBulkSending] = useState(false)
  const [bulkProgress, setBulkProgress] = useState(null)
  const [bulkResult, setBulkResult] = useState(null)
  const [bulkError, setBulkError] = useState('')

  // Persona
  const [personaInput, setPersonaInput] = useState('')
  const [personaSaved, setPersonaSaved] = useState(false)

  // --- Data loading ---
  const checkConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config')
      const data = await res.json()
      setConfig({ hasApiKey: !!data.hasApiKey, hasChats: !!data.hasChats })
      setShowApiKeyForm(!data.hasApiKey)
    } catch {
      setShowApiKeyForm(true)
    }
  }, [])

  const loadChats = useCallback(async () => {
    try {
      const res = await fetch('/api/chats')
      const data = await res.json()
      setChats(data.files || [])
    } catch { setChats([]) }
  }, [])

  useEffect(() => {
    checkConfig()
    loadChats()
    fetch('/api/persona').then(r => r.json()).then(d => setPersonaInput(d.persona || '')).catch(() => {})

    // Load persisted activity from DB
    fetch('/api/activity?limit=500').then(r => r.json()).then(data => {
      if (data.messages && data.messages.length) {
        const logs = data.messages.map(m => ({
          type: m.type,
          from: m.contact_id,
          fromName: m.contact_name || m.contact_id,
          body: m.body || '',
          incomingBody: m.body || '',
          reply: m.reply || '',
          error: m.error || '',
          ts: new Date(m.created_at + 'Z').getTime(),
          dbId: m.id,
        }))
        setActivityLog(logs)
      }
    }).catch(() => {})

    // Load contact names from DB
    fetch('/api/contacts-list').then(r => r.json()).then(data => {
      if (data.contacts) {
        setDbContacts(data.contacts)
      }
    }).catch(() => {})
  }, [checkConfig, loadChats])

  // --- Socket ---
  useEffect(() => {
    const socket = io()
    socketRef.current = socket
    socket.on('qr', d => { setReady(false); setQrUrl(d?.dataUrl || null) })
    socket.on('ready', () => { setQrUrl(null); setReady(true) })
    socket.on('disconnected', () => setReady(false))
    socket.on('message', msg => setActivityLog(p => [...p, { type: 'incoming', ...msg, ts: Date.now() }]))
    socket.on('bot-reply', d => setActivityLog(p => [...p, { type: 'reply', ...d, ts: Date.now() }]))
    socket.on('bot-error', d => setActivityLog(p => [...p, { type: 'error', ...d, ts: Date.now() }]))
    socket.on('bulk-progress', d => setBulkProgress(d))
    socket.on('bulk-done', d => { setBulkSending(false); setBulkProgress(null); setBulkResult(d) })
    return () => socket.disconnect()
  }, [])

  useEffect(() => {
    const el = activityRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [activityLog.length, selectedContact])

  // --- Derived data ---
  const contacts = useMemo(() => {
    const map = new Map()
    // Pre-compute counts per contact to avoid O(n²)
    const countMap = new Map()
    for (const e of activityLog) {
      const id = e.from || 'unknown'
      countMap.set(id, (countMap.get(id) || 0) + 1)
    }
    // Populate from DB contacts
    for (const dc of dbContacts) {
      map.set(dc.id, { id: dc.id, name: dc.name || dc.id, count: dc.message_count || 0, lastTs: new Date(dc.last_active + 'Z').getTime(), lastMsg: dc.last_msg || '', hasError: false })
    }
    // Overlay with activity log data
    for (const e of activityLog) {
      const id = e.from || 'unknown'
      if (!map.has(id)) {
        map.set(id, { id, name: e.fromName || e.from || '?', count: 0, lastTs: e.ts, lastMsg: '', hasError: false })
      }
      const c = map.get(id)
      c.count = Math.max(c.count, countMap.get(id) || 0)
      if (e.ts > c.lastTs) c.lastTs = e.ts
      if (e.type === 'incoming') c.lastMsg = e.body || ''
      if (e.type === 'reply') c.lastMsg = '🤖 ' + (e.reply || '')
      if (e.type === 'error') { c.lastMsg = '❌ Error'; c.hasError = true }
      if (e.fromName && e.fromName !== e.from) c.name = e.fromName
    }
    return Array.from(map.values()).sort((a, b) => b.lastTs - a.lastTs)
  }, [activityLog, dbContacts])

  const filteredLog = useMemo(() => {
    if (selectedContact === '__all__') return activityLog
    return activityLog.filter(e => (e.from || 'unknown') === selectedContact)
  }, [activityLog, selectedContact])

  // --- Handlers ---
  const saveApiKey = async () => {
    const key = apiKeyInput.trim()
    if (!key) return
    try {
      const res = await fetch('/api/set-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: key }) })
      const data = await res.json()
      if (data.ok) { setApiKeyInput(''); setShowApiKeyForm(false); checkConfig() }
    } catch { }
  }

  const handleUpload = async (e) => {
    e.preventDefault()
    const form = e.target, fi = form.querySelector('input[type="file"]')
    const asClosest = form.querySelector('input[name="asClosest"]')?.checked ?? false
    if (!fi?.files?.[0]) { setUploadStatus({ text: 'Choose a file.', type: 'error' }); return }
    const fd = new FormData(); fd.append('chat', fi.files[0]); fd.append('asClosest', asClosest ? 'true' : 'false')
    setUploading(true); setUploadStatus({ text: 'Uploading…', type: '' })
    try {
      const res = await fetch('/api/upload-chat', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.ok) { setUploadStatus({ text: 'Uploaded!', type: 'success' }); form.reset(); loadChats(); checkConfig() }
      else setUploadStatus({ text: data.error || 'Failed.', type: 'error' })
    } catch { setUploadStatus({ text: 'Failed.', type: 'error' }) }
    setUploading(false)
  }

  const handleBulkSend = async () => {
    setBulkError(''); setBulkResult(null); setBulkProgress(null)
    const lines = bulkNumbers.split(/[\n,;]+/).map(l => l.trim()).filter(Boolean)
    if (!lines.length) { setBulkError('Enter phone numbers.'); return }
    if (!bulkMessage.trim()) { setBulkError('Enter a message.'); return }
    setBulkSending(true)
    try {
      const res = await fetch('/api/bulk-send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ numbers: lines, message: bulkMessage.trim() }) })
      const data = await res.json()
      if (!data.ok) { setBulkError(data.error || 'Failed.'); setBulkSending(false) }
    } catch { setBulkError('Network error.'); setBulkSending(false) }
  }

  const bulkPercent = bulkProgress ? Math.round(((bulkProgress.sent + bulkProgress.failed) / bulkProgress.total) * 100) : 0

  const selectedName = selectedContact === '__all__'
    ? 'All Contacts'
    : contacts.find(c => c.id === selectedContact)?.name || selectedContact

  return (
    <div className="dashboard">
      {/* === TOP BAR === */}
      <header className="topbar">
        <div className="topbar-left">
          <span className="brand">💬 TrulyChat</span>
          <div className={`conn-badge ${ready ? 'on' : 'off'}`}>
            <span className="conn-dot" />
            {ready ? 'Connected' : 'Disconnected'}
          </div>
          {ready && (
            <button className="btn-sm btn-red" onClick={async () => {
              if (!confirm('Logout WhatsApp?')) return
              try { await fetch('/api/wa-logout', { method: 'POST' }); setReady(false) } catch {}
            }}>Logout</button>
          )}
        </div>
        <div className="topbar-right">
          <button className={`btn-topbar ${overlay === 'bulk' ? 'active' : ''}`} onClick={() => setOverlay(overlay === 'bulk' ? null : 'bulk')}>📨 Bulk Send</button>
          <button className={`btn-topbar ${overlay === 'settings' ? 'active' : ''}`} onClick={() => setOverlay(overlay === 'settings' ? null : 'settings')}>⚙️ Settings</button>
        </div>
      </header>

      {/* === QR BANNER === */}
      {qrUrl && (
        <div className="qr-banner">
          <img src={qrUrl} alt="QR" />
          <div><strong>Scan QR</strong> with WhatsApp to connect</div>
        </div>
      )}

      {/* === MAIN BODY === */}
      <div className="body-wrap">
        {/* --- Contact List --- */}
        <aside className="contacts-panel">
          <div className="contacts-header">
            <span className="contacts-title">Contacts</span>
            <span className="contacts-count">{contacts.length}</span>
          </div>
          <div className="contacts-list">
            <button className={`contact-item ${selectedContact === '__all__' ? 'active' : ''}`} onClick={() => setSelectedContact('__all__')}>
              <div className="contact-avatar all">All</div>
              <div className="contact-info">
                <div className="contact-name">All Activity</div>
                <div className="contact-last">{activityLog.length} events</div>
              </div>
            </button>
            {contacts.map(c => (
              <button key={c.id} className={`contact-item ${selectedContact === c.id ? 'active' : ''}`} onClick={() => setSelectedContact(c.id)}>
                <div className="contact-avatar">{(c.name || '?').charAt(0).toUpperCase()}</div>
                <div className="contact-info">
                  <div className="contact-name">{c.name}</div>
                  <div className="contact-last">{c.lastMsg.substring(0, 40)}{c.lastMsg.length > 40 ? '…' : ''}</div>
                </div>
                <div className="contact-meta">
                  <span className="contact-time">{new Date(c.lastTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="contact-badge">{c.count}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* --- Activity Feed --- */}
        <main className="feed-panel">
          <div className="feed-header">
            <h2>{selectedName}</h2>
            {selectedContact !== '__all__' && <span className="feed-id">{selectedContact}</span>}
            {filteredLog.length > 0 && <button className="btn-link" onClick={async () => {
              if (selectedContact === '__all__') {
                await fetch('/api/clear-activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }).catch(() => {})
                setActivityLog([])
              } else {
                await fetch('/api/clear-activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contactId: selectedContact }) }).catch(() => {})
                setActivityLog(p => p.filter(e => (e.from || 'unknown') !== selectedContact))
              }
            }}>Clear</button>}
          </div>
          <div className="feed-body" ref={activityRef}>
            {filteredLog.length === 0 && (
              <div className="empty">
                <div className="empty-icon">💬</div>
                <p>{selectedContact === '__all__' ? 'No activity yet. Messages will appear here.' : 'No messages from this contact yet.'}</p>
              </div>
            )}
            {filteredLog.map((e, i) => (
              <div key={`${e.ts}-${i}`} className={`msg msg-${e.type}`}>
                <div className="msg-bubble">
                  <div className="msg-head">
                    <span className={`msg-tag tag-${e.type}`}>{e.type === 'incoming' ? '📩 IN' : e.type === 'reply' ? '🤖 REPLY' : '❌ ERR'}</span>
                    {selectedContact === '__all__' && <span className="msg-from">{e.fromName || e.from || '?'}</span>}
                    <span className="msg-time">{new Date(e.ts).toLocaleTimeString()}</span>
                  </div>
                  {e.type === 'incoming' && <div className="msg-text">{e.body || '(no text)'}</div>}
                  {e.type === 'reply' && (<><div className="msg-text msg-dim">↩ "{e.incomingBody}"</div><div className="msg-text msg-reply-text">{e.reply}</div></>)}
                  {e.type === 'error' && (<>{e.incomingBody && <div className="msg-text msg-dim">↩ "{e.incomingBody}"</div>}<div className="msg-text msg-err-text">{e.error}</div></>)}
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>

      {/* === OVERLAYS === */}
      {overlay && <div className="overlay-bg" onClick={() => setOverlay(null)} />}

      {overlay === 'bulk' && (
        <div className="overlay-panel">
          <div className="overlay-head">
            <h2>📨 Bulk Send</h2>
            <button className="btn-close" onClick={() => setOverlay(null)}>✕</button>
          </div>
          <div className="overlay-body">
            <div className="ovr-row">
              <div className="ovr-col">
                <label>Phone Numbers</label>
                <textarea rows={6} placeholder={"919876543210\n918765432109"} value={bulkNumbers} onChange={e => setBulkNumbers(e.target.value)} disabled={bulkSending} />
                <span className="hint">One per line, with country code (no +)</span>
              </div>
              <div className="ovr-col">
                <label>Message</label>
                <textarea rows={4} placeholder="Hey! Just checking in…" value={bulkMessage} onChange={e => setBulkMessage(e.target.value)} disabled={bulkSending} />
                <button className="btn btn-accent btn-full" onClick={handleBulkSend} disabled={bulkSending || !ready}>
                  {bulkSending ? '⏳ Sending…' : '🚀 Send Messages'}
                </button>
                {!ready && <span className="warn-text">⚠ Connect WhatsApp first</span>}
              </div>
            </div>
            {bulkError && <div className="alert alert-error">{bulkError}</div>}
            {bulkSending && bulkProgress && (
              <div className="progress-section">
                <div className="pbar-outer"><div className="pbar-inner" style={{ width: `${bulkPercent}%` }} /></div>
                <div className="pbar-stats"><span>✅ {bulkProgress.sent}</span><span>❌ {bulkProgress.failed}</span><span>📊 {bulkProgress.sent + bulkProgress.failed}/{bulkProgress.total}</span></div>
              </div>
            )}
            {bulkResult && !bulkSending && (
              <div className="alert alert-success">
                <strong>✅ Done — {bulkResult.sent} sent · {bulkResult.failed} failed</strong>
                <button className="btn-link" onClick={() => setBulkResult(null)}>Dismiss</button>
              </div>
            )}
          </div>
        </div>
      )}

      {overlay === 'settings' && (
        <div className="overlay-panel">
          <div className="overlay-head">
            <h2>⚙️ Settings</h2>
            <button className="btn-close" onClick={() => setOverlay(null)}>✕</button>
          </div>
          <div className="overlay-body settings-body">
            {/* API Key */}
            <div className="scard">
              <h3>🔑 API Key</h3>
              {showApiKeyForm ? (
                <div className="scard-row">
                  <input type="password" placeholder="sk-..." value={apiKeyInput} onChange={e => setApiKeyInput(e.target.value)} />
                  <button className="btn btn-accent" onClick={saveApiKey}>Save</button>
                </div>
              ) : (
                <div className="scard-row"><span className="text-green">✓ Saved</span>
                  <button className="btn-link" onClick={() => setShowApiKeyForm(true)}>Change</button>
                  <button className="btn-link" onClick={async () => { await fetch('/api/clear-key', { method: 'POST' }); setShowApiKeyForm(true); checkConfig() }}>Clear</button>
                </div>
              )}
            </div>
            {/* Persona */}
            <div className="scard">
              <h3>🧠 Bot Persona</h3>
              <p className="scard-hint">Describe who the bot should be (e.g. dental clinic receptionist).</p>
              <textarea rows={4} placeholder={'You are a receptionist at SmileCare Dental.\nTimings: Mon-Sat 9-7.\nServices: cleaning, filling, root canal.'} value={personaInput} onChange={e => { setPersonaInput(e.target.value); setPersonaSaved(false) }} />
              <div className="scard-row">
                <button className="btn btn-accent" onClick={async () => {
                  const res = await fetch('/api/persona', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona: personaInput }) })
                  const d = await res.json(); if (d.ok) setPersonaSaved(true)
                }}>Save Persona</button>
                {personaInput && <button className="btn-link" onClick={async () => { await fetch('/api/persona', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona: '' }) }); setPersonaInput(''); setPersonaSaved(false) }}>Clear</button>}
                {personaSaved && <span className="text-green">✓ Saved!</span>}
              </div>
            </div>
            {/* Memory */}
            <div className="scard">
              <h3>💾 Memory</h3>
              <p className="scard-hint">Bot remembers last 20 messages per contact.</p>
              <button className="btn btn-outline" onClick={async () => { await fetch('/api/clear-memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }); alert('Memory cleared!') }}>🗑️ Clear All</button>
            </div>
            {/* Upload */}
            <div className="scard">
              <h3>📄 Reference Chats</h3>
              <form onSubmit={handleUpload}>
                <input type="file" accept=".txt" required />
                <label className="cb"><input type="checkbox" name="asClosest" /> Closest person</label>
                <button type="submit" className="btn btn-accent" disabled={uploading}>{uploading ? 'Uploading…' : 'Upload'}</button>
              </form>
              {uploadStatus.text && <div className={`upmsg ${uploadStatus.type}`}>{uploadStatus.text}</div>}
              {chats.length > 0 && <div className="file-tags">{chats.map(f => <span key={f.name} className={`ftag ${f.isClosest ? 'pri' : ''}`}>{f.name}</span>)}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App

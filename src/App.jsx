import { useState, useEffect, useRef } from 'react'
import './App.css'
import { ImportWizard } from './ImportWizard'
import DNAHelix from './DNAHelix'
import BlackHole from './uploads/BlackHole'
import { supabase } from './supabase'

// ── Constants ──────────────────────────────────────────────────────
const STORAGE_KEY = 'einkunnabok_v1'

const ASSESSMENT_TYPES = [
  'Lokapróf','Miðmisserisspróf','Hlutapróf','Smápróf',
  'Heimadæmi','Verkefni','Dæmatími','Stöðumat','Annað',
]

const COURSE_COLORS = [
  '#ec3013','#f97316','#eab308','#22c55e','#06b6d4','#4f8ef7','#a855f7','#ec4899',
]

const TYPE_COLORS = {
  'Lokapróf':         '#ef4444',
  'Miðmisserisspróf': '#f97316',
  'Hlutapróf':        '#eab308',
  'Smápróf':          '#84cc16',
  'Heimadæmi':        '#22c55e',
  'Verkefni':         '#06b6d4',
  'Dæmatími':         '#8b5cf6',
  'Stöðumat':         '#ec4899',
  'Annað':            '#6b7280',
}

const IS_MONTHS = ['jan','feb','mar','apr','maí','jún','júl','ágú','sep','okt','nóv','des']

// ── Helpers ────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2) }

function fmt(n, d = 2) {
  if (n === null || n === undefined || isNaN(n)) return '—'
  return n.toFixed(d).replace('.', ',')
}

function parseNum(s) {
  if (s === '' || s === null || s === undefined) return NaN
  return parseFloat(String(s).replace(',', '.'))
}

function gradeColor(g) {
  if (g === null || g === undefined || isNaN(g)) return 'var(--muted)'
  if (g >= 7) return 'var(--pass)'
  if (g >= 5) return '#d97706'
  return 'var(--accent)'
}

function newCourse(name = 'Nýr áfangi', colorIdx = 0) {
  return { id: uid(), name, color: COURSE_COLORS[colorIdx % COURSE_COLORS.length], assessments: [], bestOfRules: {}, lokaprófMin: 5, improvementRules: [] }
}

function newAssessment(overrides = {}) {
  return { id: uid(), type: 'Heimadæmi', label: '', grade: '', weight: '', date: '', ...overrides }
}

function fmtDate(dateStr) {
  const d = new Date(dateStr)
  return `${d.getDate()}. ${IS_MONTHS[d.getMonth()]}`
}

// ── Best-of logic ──────────────────────────────────────────────────
function getExcludedIds(assessments, bestOfRules) {
  const excluded = new Set()
  const byType = {}
  for (let i = 0; i < assessments.length; i++) {
    const a = assessments[i]
    if (!byType[a.type]) byType[a.type] = []
    byType[a.type].push({ a, originalIndex: i })
  }
  for (const [type, bestN] of Object.entries(bestOfRules)) {
    const items = byType[type] || []
    if (items.length <= bestN) continue
    const allGraded = items.every(({ a }) => {
      const g = parseNum(a.grade)
      return a.grade !== '' && !isNaN(g)
    })
    if (!allGraded) continue
    const sorted = [...items].sort((x, y) => {
      const ga = parseNum(x.a.grade)
      const gb = parseNum(y.a.grade)
      if (ga !== gb) return gb - ga
      return x.originalIndex - y.originalIndex
    })
    for (let i = bestN; i < sorted.length; i++) excluded.add(sorted[i].a.id)
  }
  return excluded
}

// ── Calc ───────────────────────────────────────────────────────────
function calcCourse(course) {
  const { assessments, bestOfRules = {}, lokaprófMin = 5, improvementRules = [] } = course
  const excluded = getExcludedIds(assessments, bestOfRules)

  let earnedPoints = 0, totalWeight = 0, completedWeight = 0, lokaprófGrade = null
  const improveGrades = {}

  for (const a of assessments) {
    const w = parseNum(a.weight)
    const g = parseNum(a.grade)
    for (const rule of improvementRules) {
      if (a.type === rule.improveType && a.grade !== '' && !isNaN(g)) {
        improveGrades[rule.improveType] = g
      }
    }
    if (!isNaN(w) && w > 0 && !excluded.has(a.id)) {
      totalWeight += w
      if (!isNaN(g) && a.grade !== '') {
        earnedPoints += g * (w / 100)
        completedWeight += w
      }
    }
    if (a.type === 'Lokapróf' && !isNaN(g) && a.grade !== '') {
      lokaprófGrade = lokaprófGrade === null ? g : Math.min(lokaprófGrade, g)
    }
  }

  for (const rule of improvementRules) {
    if (rule.type !== 'improvement') continue
    const finalA = assessments.find(a => a.type === rule.finalType && a.grade !== '' && !isNaN(parseNum(a.grade)))
    if (!finalA) continue
    const F  = parseNum(finalA.grade)
    const M  = improveGrades[rule.improveType] ?? -Infinity
    const iw = (rule.improveWeight ?? 0) / 100
    earnedPoints += iw * Math.max(M - F, 0)
  }

  const weightError = totalWeight > 100.01
    ? { total: totalWeight, excess: totalWeight - 100 }
    : null

  let currentAvg = completedWeight > 0 ? earnedPoints / (completedWeight / 100) : null
  let passStatus = null

  if (weightError) {
    currentAvg = null; passStatus = null
  } else if (currentAvg !== null) {
    const avgOk = currentAvg >= 5
    const lokaOk = lokaprófGrade === null || lokaprófGrade >= lokaprófMin
    passStatus = avgOk && lokaOk ? 'pass' : avgOk ? 'fail-loka' : 'fail-avg'
  }

  return { earnedPoints, totalWeight, completedWeight, currentAvg, excluded, passStatus, lokaprófGrade, weightError }
}

// ── Storage ────────────────────────────────────────────────────────
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      parsed.courses = parsed.courses.map((c, i) => ({
        bestOfRules: {}, lokaprófMin: 5, improvementRules: [], color: COURSE_COLORS[i % COURSE_COLORS.length], ...c,
        assessments: (c.assessments || []).map(({ group: _g, ...a }) => a)
      }))
      return parsed
    }
  } catch {}
  return { courses: [newCourse('Tölvunarfræði 1')] }
}

function saveData(d) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)) } catch {}
}

// ── Rules Panel ────────────────────────────────────────────────────
function RulesPanel({ assessments, bestOfRules, onChange, lokaprófMin, onLokaprófMinChange, lokaprófGrade }) {
  const [open, setOpen] = useState(false)
  const [minInput, setMinInput] = useState(String(lokaprófMin))

  useEffect(() => { setMinInput(String(lokaprófMin)) }, [lokaprófMin])

  const typeCounts = {}
  for (const a of assessments) typeCounts[a.type] = (typeCounts[a.type] || 0) + 1
  const multiTypes = Object.entries(typeCounts).filter(([, n]) => n >= 2)

  function commitMin(raw) {
    const v = parseNum(raw)
    if (!isNaN(v)) {
      const clamped = Math.max(0, Math.min(10, v))
      onLokaprófMinChange(clamped)
      setMinInput(String(clamped))
    } else {
      setMinInput(String(lokaprófMin))
    }
  }

  return (
    <div className="rules-panel">
      <button className="rules-toggle" onClick={() => setOpen(o => !o)}>
        <span className="rules-toggle-left">
          <svg className={`chevron${open ? ' open' : ''}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2,4 6,8 10,4" />
          </svg>
          Einkunnareglur
        </span>
      </button>
      {open && (
        <div className="rules-body">
          <div className="rule-row">
            <span className="rule-lbl" style={{ flex: 1 }}>Lágmarkseinkunn í lokaprófi</span>
            <input
              className="rule-num-inp"
              inputMode="decimal"
              value={minInput}
              onChange={e => setMinInput(e.target.value)}
              onBlur={e => commitMin(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && e.target.blur()}
            />
            {lokaprófGrade !== null && (
              <span className="rule-loka-status" style={{ color: gradeColor(lokaprófGrade) }}>
                {fmt(lokaprófGrade, 1)}{lokaprófGrade < lokaprófMin ? ' ⚠' : ' ✓'}
              </span>
            )}
          </div>
          {multiTypes.length > 0 && (
            <>
              <div className="rules-hint">Hæstu einkunnir gilda</div>
              {multiTypes.map(([type, count]) => {
                const bestN = bestOfRules[type] ?? count
                return (
                  <div key={type} className="rule-row">
                    <span className="rule-dot" style={{ background: TYPE_COLORS[type] || '#6b7280' }} />
                    <span className="rule-type">{type}</span>
                    <span className="rule-lbl">— Hæstu</span>
                    <select className="rule-sel" value={bestN} onChange={e => onChange(type, parseInt(e.target.value))}>
                      {Array.from({ length: count }, (_, i) => i + 1).map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                    <span className="rule-lbl">af {count} gilda</span>
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Assessment Row (Desktop) ───────────────────────────────────────
function AssessmentRow({ a, isExcluded, isDragOver, isDragging, onUpdate, onDelete, onDuplicate, onDragStart, onDragOver, onDragEnd, onDrop, onEnterLabel, onEnterGrade }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const g = parseNum(a.grade)
  const w = parseNum(a.weight)
  const contribution = (!isNaN(g) && !isNaN(w) && a.grade !== '' && a.weight !== '') ? g * w / 100 : null
  const dot = TYPE_COLORS[a.type] || '#6b7280'
  const gradeInvalid = a.grade !== '' && !isNaN(g) && (g < 0 || g > 10)

  useEffect(() => {
    if (!menuOpen) return
    function outside(e) { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false) }
    function esc(e) { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', esc) }
  }, [menuOpen])

  return (
    <tr
      className={['assess-row', isExcluded && 'excluded', isDragOver && 'drag-over', isDragging && 'dragging'].filter(Boolean).join(' ')}
      draggable
      onDragStart={onDragStart}
      onDragOver={e => { e.preventDefault(); onDragOver() }}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
    >
      <td className="drag-td"><span className="drag-hdl">⠿</span></td>
      <td>
        <div className="type-wrap">
          <span className="type-dot" style={{ background: dot }} />
          <select className="type-sel" value={a.type} onChange={e => onUpdate({ ...a, type: e.target.value })}>
            {ASSESSMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </td>
      <td>
        <input
          className="ri"
          placeholder="Nafn (valfrjálst)"
          value={a.label}
          data-field="label"
          data-id={a.id}
          onChange={e => onUpdate({ ...a, label: e.target.value })}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); onEnterLabel() }
            if (e.key === 'Escape') e.target.blur()
          }}
        />
      </td>
      <td>
        <input
          className={`ri ri-num${gradeInvalid ? ' invalid' : ''}`}
          inputMode="decimal"
          placeholder="0–10"
          value={a.grade}
          style={!gradeInvalid && a.grade !== '' && !isNaN(g) ? { color: gradeColor(g), fontWeight: 800 } : undefined}
          data-field="grade"
          data-id={a.id}
          onChange={e => onUpdate({ ...a, grade: e.target.value })}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); onEnterGrade() }
            if (e.key === 'Escape') e.target.blur()
          }}
        />
      </td>
      <td>
        <div className="w-wrap">
          <input
            className="ri ri-num"
            inputMode="decimal"
            placeholder="0"
            value={a.weight}
            onChange={e => onUpdate({ ...a, weight: e.target.value })}
            onKeyDown={e => { if (e.key === 'Escape') e.target.blur() }}
          />
          <span className="pct">%</span>
        </div>
      </td>
      <td>
        <input
          className="ri ri-date"
          type="date"
          value={a.date}
          onChange={e => onUpdate({ ...a, date: e.target.value })}
          onKeyDown={e => { if (e.key === 'Escape') e.target.blur() }}
        />
      </td>
      <td className="contrib-td">
        {isExcluded
          ? <span className="excl-badge">Gildir ekki</span>
          : contribution !== null
            ? <span className="contrib">{fmt(contribution)}</span>
            : <span className="contrib-nil">—</span>}
      </td>
      <td className="action-td">
        <div className="row-menu" ref={menuRef}>
          <button className="row-menu-trigger" onClick={() => setMenuOpen(o => !o)} aria-label="Fleiri aðgerðir">⋯</button>
          {menuOpen && (
            <div className="row-menu-dropdown">
              <button className="row-menu-item" onClick={() => { onDuplicate(); setMenuOpen(false) }}>Afrita röð</button>
              <button className="row-menu-item row-menu-item-del" onClick={() => { onDelete(); setMenuOpen(false) }}>Eyða</button>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Assessment Card (Mobile) ───────────────────────────────────────
function AssessmentCard({ a, isExcluded, onUpdate, onDelete, onDuplicate }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const g = parseNum(a.grade)
  const w = parseNum(a.weight)
  const contribution = (!isNaN(g) && !isNaN(w) && a.grade !== '' && a.weight !== '') ? g * w / 100 : null
  const dot = TYPE_COLORS[a.type] || '#6b7280'
  const gradeInvalid = a.grade !== '' && !isNaN(g) && (g < 0 || g > 10)

  useEffect(() => {
    if (!menuOpen) return
    function outside(e) { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false) }
    function esc(e) { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', esc) }
  }, [menuOpen])

  return (
    <div className={`ac${isExcluded ? ' ac-excluded' : ''}`}>
      <div className="ac-top">
        <span className="type-dot" style={{ background: dot, flexShrink: 0 }} />
        <select className="type-sel ac-type" value={a.type} onChange={e => onUpdate({ ...a, type: e.target.value })}>
          {ASSESSMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {isExcluded && <span className="excl-badge">Gildir ekki</span>}
        <div className="row-menu" ref={menuRef}>
          <button className="row-menu-trigger ac-menu-trigger" onClick={() => setMenuOpen(o => !o)} aria-label="Fleiri aðgerðir">⋯</button>
          {menuOpen && (
            <div className="row-menu-dropdown row-menu-dropdown-left">
              <button className="row-menu-item" onClick={() => { onDuplicate(); setMenuOpen(false) }}>Afrita röð</button>
              <button className="row-menu-item row-menu-item-del" onClick={() => { onDelete(); setMenuOpen(false) }}>Eyða</button>
            </div>
          )}
        </div>
      </div>
      <input className="ac-label" placeholder="Nafn (valfrjálst)" value={a.label} onChange={e => onUpdate({ ...a, label: e.target.value })} />
      <div className="ac-fields">
        <div className="ac-field">
          <span className="ac-flbl">Einkunn</span>
          <input
            className={`ac-finp${gradeInvalid ? ' invalid' : ''}`}
            inputMode="decimal" placeholder="0–10" value={a.grade}
            style={!gradeInvalid && a.grade !== '' && !isNaN(g) ? { color: gradeColor(g), fontWeight: 800 } : undefined}
            onChange={e => onUpdate({ ...a, grade: e.target.value })}
          />
        </div>
        <div className="ac-field">
          <span className="ac-flbl">Váegi</span>
          <div className="w-wrap">
            <input className="ac-finp" inputMode="decimal" placeholder="0" value={a.weight} onChange={e => onUpdate({ ...a, weight: e.target.value })} />
            <span className="pct">%</span>
          </div>
        </div>
        <div className="ac-field">
          <span className="ac-flbl">Dagsetning</span>
          <input className="ac-finp ac-date" type="date" value={a.date} onChange={e => onUpdate({ ...a, date: e.target.value })} />
        </div>
        <div className="ac-field">
          <span className="ac-flbl">Gildi</span>
          <span className="ac-contrib">{isExcluded ? '—' : (contribution !== null ? fmt(contribution) : '—')}</span>
        </div>
      </div>
    </div>
  )
}

// ── PROFILE MODAL ──────────────────────────────────────────────────
function ProfileModal({ user, onClose }) {
  const [displayName, setDisplayName] = useState(user.user_metadata?.display_name || '')
  const [avatarUrl, setAvatarUrl]     = useState(user.user_metadata?.avatar_url   || null)
  const [uploading, setUploading]     = useState(false)
  const [saving, setSaving]           = useState(false)
  const [msg, setMsg]                 = useState('')
  const fileRef = useRef(null)

  const initial = ((displayName || user.email) ?? '?')[0].toUpperCase()

  async function handleSave() {
    setSaving(true); setMsg('')
    const { error } = await supabase.auth.updateUser({ data: { display_name: displayName } })
    setMsg(error ? error.message : 'Vistað!')
    setSaving(false)
    setTimeout(() => setMsg(''), 2200)
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setMsg('')
    const ext  = file.name.split('.').pop().toLowerCase()
    const path = `${user.id}/avatar.${ext}`
    const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    if (error) { setMsg('Villa: ' + error.message); setUploading(false); return }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    const url = data.publicUrl + '?t=' + Date.now()
    await supabase.auth.updateUser({ data: { avatar_url: url } })
    setAvatarUrl(url)
    setMsg('Mynd uppfærð!')
    setUploading(false)
    setTimeout(() => setMsg(''), 2200)
  }

  return (
    <div className="profile-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="profile-modal">
        <div className="profile-modal-hdr">
          <span className="profile-modal-title">STILLINGAR // AÐGANGUR</span>
          <button className="profile-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="profile-avatar-section">
          <div className="profile-avatar-lg" onClick={() => fileRef.current?.click()} title="Skipta um mynd">
            {avatarUrl
              ? <img src={avatarUrl} alt="" className="profile-avatar-img" />
              : <span>{initial}</span>}
            <div className="profile-avatar-hover">{uploading ? '…' : '↑'}</div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display:'none' }} onChange={handleAvatarChange} />
          <div className="profile-avatar-hint">Smelltu á mynd til að skipta</div>
        </div>

        <div className="form-field">
          <label className="form-label">Nafn</label>
          <input className="form-input" value={displayName} onChange={e => setDisplayName(e.target.value)}
            placeholder={user.email} onKeyDown={e => e.key === 'Enter' && handleSave()} />
        </div>
        <div className="form-field">
          <label className="form-label">Tölvupóstur</label>
          <input className="form-input" value={user.email} disabled style={{ opacity: 0.45 }} />
        </div>

        {msg && <div className={`profile-msg${msg.startsWith('V') ? ' ok' : ' err'}`}>{msg}</div>}

        <div className="profile-modal-actions">
          <button className="login-guest-btn" style={{ flex:1, width:'auto' }} onClick={handleSave} disabled={saving}>
            {saving ? 'Vistar…' : 'Vista'}
          </button>
          <button className="btn-outline" onClick={onClose}>Loka</button>
        </div>
      </div>
    </div>
  )
}

// ── LOGO MARK ──────────────────────────────────────────────────────
function LogoMark({ fill = '#0a0a0a', accent = '#ec3013', size = 18 }) {
  const h = size
  const w = Math.round(size * 22 / 18)
  return (
    <svg width={w} height={h} viewBox="0 0 22 18" fill="none" aria-hidden="true">
      <rect x="0"  y="12" width="4" height="6"  fill={fill}/>
      <rect x="6"  y="8"  width="4" height="10" fill={fill}/>
      <rect x="12" y="3"  width="4" height="15" fill={accent}/>
      <rect x="18" y="0"  width="4" height="18" fill={fill}/>
    </svg>
  )
}

// ── TOP NAV ────────────────────────────────────────────────────────
function TopNav({ page, onNav, loggedIn, sessionAvg, supaUser, onLogout, onProfile }) {
  const TABS = [
    { key: 'forsida',    label: 'Forsíða' },
    { key: 'innskraning', label: 'Innskráning', hideWhen: loggedIn },
    { key: 'afangar',   label: 'Áfangar',    requireAuth: true },
    { key: 'reiknivel', label: 'Reiknivél',  requireAuth: true },
    { key: 'namsferill',label: 'Námsferill', requireAuth: true },
  ].filter(t => !t.hideWhen && (!t.requireAuth || loggedIn))

  return (
    <nav className="top-nav">
      <div className="top-nav-brand">
        <LogoMark fill="#f3f2f2" size={15}/>
        EINKUNNIR.IS
      </div>
      <div className="top-nav-tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`top-nav-tab${page === t.key ? ' active' : ''}`}
            onClick={() => onNav(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {loggedIn && (
        <div className="top-nav-session">
          {supaUser
            ? (supaUser.user_metadata?.display_name || supaUser.email.split('@')[0]).toUpperCase()
            : 'GESTUR'}
          {sessionAvg !== null ? ` // ${fmt(sessionAvg, 2)}` : ''}
        </div>
      )}
      {supaUser && onProfile && (
        <button className="top-nav-avatar" onClick={onProfile} title="Stillingar">
          {supaUser.user_metadata?.avatar_url
            ? <img src={supaUser.user_metadata.avatar_url} className="top-nav-avatar-img" alt="" />
            : ((supaUser.user_metadata?.display_name || supaUser.email) ?? '?')[0].toUpperCase()
          }
        </button>
      )}
      {loggedIn && onLogout && (
        <button className="top-nav-logout" onClick={onLogout}>ÚTSKRÁ</button>
      )}
    </nav>
  )
}

// ── FORSÍÐA ────────────────────────────────────────────────────────
function ForsidaPage({ onLogin, onOpen, loggedIn }) {
  const grades = [8, 7, 6, 4.5, 9, 5, 3, 8.5, 7, 6.5, 4, 9, 7, 5, 8, 6, 4, 9]

  return (
    <div className="forsida">
      <div className="forsida-grain" />
      <div className="forsida-left">
        <div className="forsida-title-block">
          <div className="forsida-logo-mark">
            <LogoMark fill="#0a0a0a" size={28}/>
          </div>
          <h1 className="forsida-headline">EINKUNNIR.IS</h1>
          <p className="forsida-tagline">Reiknaðu út hvar þú stendur.</p>
          <p className="forsida-tagline-sub">Skráðu námsmat, fylgstu með stöðunni og sjáðu hvað þú þarft úr því sem eftir er.</p>
        </div>
        <div className="forsida-lower">
          <div className="forsida-features-col">
            <div className="forsida-kicker">KJARNAAÐGERÐIR // MISSERI-SEQUENCE_01</div>
            <div className="forsida-features">
              {[
                ['[ÁFANGI.NÝR]', 'Skráðu áfanga og einingafjölda — kerfið býr til grind fyrir matspætti'],
                ['[VÁEGI.100%]', 'Kerfið varar við ef summan fer yfir 100%'],
                ['[EINKUNN.LIVE]', 'Sláðu inn tölu og lokaeinkunnin uppfærist samstundis'],
                ['[HÆSTU.N]', 'Reglur um hvaða skil gilda — hæstu N af M'],
                ['[LOKA.MIN5]', 'Lágmark í lokaprófi fylgir eftir sjálfkrafa'],
                ['[SIM.TARGET]', 'Reiknivél segir hvað þarf í eftirstandandi mati'],
              ].map(([key, val]) => (
                <div key={key} className="forsida-feature">
                  <span className="forsida-feature-key">{key}</span>
                  <span className="forsida-feature-val">{val}</span>
                </div>
              ))}
            </div>
            <div className="forsida-cta-row">
              {loggedIn
                ? <button className="btn-primary" onClick={onOpen}>OPNA ÁFANGA →</button>
                : <button className="btn-primary" onClick={onLogin}>SKRÁ INN →</button>
              }
            </div>
          </div>
          <div className="forsida-spec-col">
            {[
              ['STAÐA', 'Gestaaðgangur virkur — fullur aðgangur krefst netfangs (í vinnslu)'],
              ['MARKMIÐ', 'Einkunnakerfi sem styður við allar íslenskar skólareglur'],
              ['AÐGERÐ', 'Opnaðu, skráðu inn og byrjaðu að nota strax'],
              ['GEYMSLA', 'Staðbundin — gögnin fara aldrei í neinn þjón'],
            ].map(([k, v]) => (
              <div key={k} className="forsida-spec-block">
                <div className="forsida-spec-key">{k}</div>
                <div className="forsida-spec-val">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="forsida-right">
        <div className="forsida-helix">
          <DNAHelix tone="light" accent="#ec3013" marks={grades} speed={26} radius={1.15} turns={3.4} thickness={1} />
          <div className="forsida-grade-plate">
            <div className="forsida-grade-label">MEÐALTAL</div>
            <div className="forsida-grade-num">7,51</div>
            <div className="forsida-grade-sub">6 áfangar · hvert brep er eitt mat</div>
          </div>
        </div>
      </div>
      <div className="forsida-ghost-strip" aria-hidden="true">
        <span className="forsida-ghost-inner">
          EINKUNNIR.IS · SKRÁÐU · REIKNAÐU · SJÁÐU STÖÐUNA ·&ensp;&ensp;
          EINKUNNIR.IS · SKRÁÐU · REIKNAÐU · SJÁÐU STÖÐUNA ·&ensp;&ensp;
          EINKUNNIR.IS · SKRÁÐU · REIKNAÐU · SJÁÐU STÖÐUNA ·&ensp;&ensp;
        </span>
      </div>
      <footer className="forsida-footer">
        <span>◎ EINKUNNIR.IS</span>
        <span>TÖLVUNARFRÆÐI</span>
        <span>NÁMSMATSKERFI</span>
        <span>2026</span>
        <span>v.02</span>
      </footer>
    </div>
  )
}

// ── INNSKRÁNING ────────────────────────────────────────────────────
function InnskraningPage({ onLogin }) {
  const [mode, setMode]       = useState('login')
  const [email, setEmail]     = useState('')
  const [password, setPass]   = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  function switchMode(m) { setMode(m); setError(''); setSuccess('') }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true); setError(''); setSuccess('')
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    } else if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
      else setSuccess('Staðfestingarpóstur sendur — athugaðu inbox og smelltu á hlekkinn.')
    } else if (mode === 'reset') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/reset-password',
      })
      if (error) setError(error.message)
      else setSuccess('Endurstillingarpóstur sendur — athugaðu inbox.')
    }
    setLoading(false)
  }

  return (
    <div className="innskraning">
      <div className="innskraning-helix">
        <BlackHole tone="dark" accent="#ec3013" speed={1.2} lobeIntensity={0.5} />
      </div>
      <div className="innskraning-form-wrap">
        <div className="innskraning-brand">
          <LogoMark fill="#f3f2f2" size={16}/>
          <span>EINKUNNIR.IS</span>
        </div>
        <div className="innskraning-kicker">// ACCESS_01</div>

        <div className="innskraning-tabs">
          <button className={`innskraning-tab${mode === 'login' ? ' active' : ''}`} onClick={() => switchMode('login')}>Innskráning</button>
          <button className={`innskraning-tab${mode === 'signup' ? ' active' : ''}`} onClick={() => switchMode('signup')}>Nýr aðgangur</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label">Tölvupóstur</label>
            <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="nafn@dæmi.is" required autoComplete="email" />
          </div>
          {mode !== 'reset' && (
            <div className="form-field">
              <label className="form-label">Lykilorð</label>
              <div className="pass-wrap">
                <input className="form-input" type={showPass ? 'text' : 'password'} value={password} onChange={e => setPass(e.target.value)} placeholder="••••••••" required minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
                <button type="button" className="pass-toggle" onClick={() => setShowPass(v => !v)} tabIndex={-1}>
                  {showPass ? '🙈' : '👁'}
                </button>
              </div>
            </div>
          )}
          {error   && <div className="login-error">{error}</div>}
          {success && <div className="login-success">{success}</div>}
          <button className="login-guest-btn" type="submit" disabled={loading}>
            {loading ? 'Augnablik...' : mode === 'login' ? 'Skrá inn →' : mode === 'signup' ? 'Stofna aðgang →' : 'Senda endurstillingarpóst →'}
          </button>
          {mode === 'login' && (
            <button type="button" className="login-forgot" onClick={() => switchMode('reset')}>
              Gleymt lykilorð?
            </button>
          )}
          {mode === 'reset' && (
            <button type="button" className="login-forgot" onClick={() => switchMode('login')}>
              ← Til baka
            </button>
          )}
        </form>

        <div className="login-divider"><span>eða</span></div>

        <button className="btn-outline" style={{ width: '100%', justifyContent: 'center' }} onClick={onLogin}>
          Halda áfram sem gestur
        </button>

        <div className="login-coming-soon">
          Með aðgangi fylgja gögn þín á milli tækja í gegnum Supabase.
        </div>
      </div>
    </div>
  )
}

// ── COURSE DETAIL (inner component) ───────────────────────────────
function CourseDetail({ course, onChange, onOpenCalc }) {
  const [dragId, setDragId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [undoItem, setUndoItem] = useState(null)
  const undoTimer = useRef(null)

  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current) }, [])

  const stats = calcCourse(course)
  const weightOver = stats.totalWeight > 100.01

  function updateA(id, updated) { onChange({ ...course, assessments: course.assessments.map(a => a.id === id ? updated : a) }) }
  function deleteA(id) {
    const snapshot = { ...course, assessments: [...course.assessments] }
    onChange({ ...course, assessments: course.assessments.filter(a => a.id !== id) })
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndoItem(snapshot)
    undoTimer.current = setTimeout(() => setUndoItem(null), 4500)
  }
  function handleUndo() {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    if (undoItem) onChange(undoItem)
    setUndoItem(null)
  }
  function duplicateA(id) {
    const src = course.assessments.find(a => a.id === id)
    if (!src) return
    const copy = { ...src, id: uid(), grade: '' }
    const idx = course.assessments.findIndex(a => a.id === id)
    const list = [...course.assessments]
    list.splice(idx + 1, 0, copy)
    onChange({ ...course, assessments: list })
  }
  function addA() { onChange({ ...course, assessments: [...course.assessments, newAssessment()] }) }
  function handleDrop(targetId) {
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return }
    const list = [...course.assessments]
    const from = list.findIndex(a => a.id === dragId)
    const to = list.findIndex(a => a.id === targetId)
    const [item] = list.splice(from, 1)
    list.splice(to, 0, item)
    onChange({ ...course, assessments: list })
    setDragId(null); setDragOverId(null)
  }

  function handleEnterGrade(currentId) {
    const idx = course.assessments.findIndex(a => a.id === currentId)
    const next = course.assessments[idx + 1]
    if (!next) return
    requestAnimationFrame(() => { document.querySelector(`[data-field="grade"][data-id="${next.id}"]`)?.focus() })
  }
  function handleEnterLabel(currentId, currentLabel) {
    const idx = course.assessments.findIndex(a => a.id === currentId)
    const next = course.assessments[idx + 1]
    if (!next) return
    const match = currentLabel.trim().match(/^([\s\S]*\D)(\d+)$/)
    if (match && !next.label.trim()) {
      const nextLabel = match[1] + (parseInt(match[2]) + 1)
      const newList = course.assessments.map(a => a.id === next.id ? { ...a, label: nextLabel } : a)
      onChange({ ...course, assessments: newList })
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.querySelector(`[data-field="label"][data-id="${next.id}"]`)?.focus()
      }))
    } else {
      requestAnimationFrame(() => { document.querySelector(`[data-field="label"][data-id="${next.id}"]`)?.focus() })
    }
  }

  const pctDone = Math.min(stats.completedWeight, 100)
  const pctPend = Math.min(Math.max(0, stats.totalWeight - stats.completedWeight), 100 - pctDone)

  const passLabel = stats.passStatus === null
    ? (stats.weightError ? 'Leiðrétta þarf váegi' : 'Engin einkunn enn')
    : stats.passStatus === 'pass' ? '✓ Staðið'
    : stats.passStatus === 'fail-loka' ? `✗ Fallið — lokapróf undir ${fmt(course.lokaprófMin, 1)}`
    : '✗ Fallið'

  // Óskráð váegi derived values
  const unregisteredWeight = Math.max(0, 100 - stats.totalWeight)

  return (
    <>
      {/* Stats row */}
      <div className="stats-row">
        <div className="stat-cell">
          <div className="stat-label">Lokaeinkunn</div>
          {stats.weightError
            ? <div className="stat-value" style={{ color: 'var(--muted)', fontSize: 28 }}>—</div>
            : <div className="stat-value" style={{ color: gradeColor(stats.currentAvg) }}>{fmt(stats.currentAvg)}</div>
          }
          <div className="stat-sub" style={{ color: stats.passStatus === 'pass' ? 'var(--pass)' : stats.passStatus ? 'var(--accent)' : 'var(--muted-dk)' }}>{passLabel}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Metið</div>
          <div className="stat-value">{fmt(stats.completedWeight, 0)}<span className="stat-unit">%</span></div>
          <div className="stat-sub">af námskeiðinu metið</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Ómetið</div>
          <div className="stat-value">{fmt(Math.max(0, 100 - stats.completedWeight), 0)}<span className="stat-unit">%</span></div>
          <div className="stat-sub">eftir ómetið</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Óskráð váegi</div>
          <div className="stat-value" style={{ color: weightOver ? 'var(--accent)' : undefined }}>
            {fmt(unregisteredWeight, 0)}<span className="stat-unit">%</span>
          </div>
          <div className="stat-sub" style={{ color: weightOver ? 'var(--accent)' : stats.totalWeight >= 100 ? 'var(--pass)' : undefined }}>
            {weightOver
              ? 'váegi yfir 100% — leiðrétta'
              : stats.totalWeight === 0
                ? 'ekkert váegi skráð'
                : stats.totalWeight >= 100
                  ? 'allt váegi skráð ✓'
                  : `${fmt(unregisteredWeight, 0)}% eftir óskráð`}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="prog-wrap">
        <div className="prog-track">
          <div className="pb pb-done" style={{ width: `${pctDone}%` }} />
          <div className="pb pb-pend" style={{ left: `${pctDone}%`, width: `${pctPend}%` }} />
        </div>
        <div className="prog-labels">
          <span style={{ color: 'var(--pass)' }}>Metið {fmt(stats.completedWeight, 0)}%</span>
          <span>Skráð {fmt(stats.totalWeight, 0)}%</span>
          <span>100%</span>
        </div>
      </div>

      {stats.weightError && (
        <div className="weight-error">
          ⚠ Samanlagt váegi er {fmt(stats.weightError.total, 0)}%. Lækkaðu váegi um {fmt(stats.weightError.excess, 0)}%.
        </div>
      )}

      <RulesPanel
        assessments={course.assessments}
        bestOfRules={course.bestOfRules}
        onChange={(type, n) => onChange({ ...course, bestOfRules: { ...course.bestOfRules, [type]: n } })}
        lokaprófMin={course.lokaprófMin}
        onLokaprófMinChange={v => onChange({ ...course, lokaprófMin: v })}
        lokaprófGrade={stats.lokaprófGrade}
      />

      <div className="section-hdr">
        <span className="section-title">Matspættir</span>
        <span className="section-hint">Sláðu inn einkunn → reikniast sjálfkrafa</span>
      </div>

      {/* Desktop table */}
      <div className="assess-tbl-wrap">
        <table className="assess-tbl">
          <thead>
            <tr>
              <th className="th-drag" />
              <th>Tegund</th>
              <th>Nafn</th>
              <th>Einkunn</th>
              <th>Váegi</th>
              <th>Dagsetning</th>
              <th>Gildi</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {course.assessments.length === 0 ? (
              <tr><td colSpan={8} className="empty-row">Engar einkunnir skráðar — smelltu á „+ Bæta við mati"</td></tr>
            ) : course.assessments.map(a => (
              <AssessmentRow
                key={a.id} a={a}
                isExcluded={stats.excluded.has(a.id)}
                isDragOver={dragOverId === a.id}
                isDragging={dragId === a.id}
                onUpdate={updated => updateA(a.id, updated)}
                onDelete={() => deleteA(a.id)}
                onDuplicate={() => duplicateA(a.id)}
                onDragStart={() => setDragId(a.id)}
                onDragOver={() => setDragOverId(a.id)}
                onDragEnd={() => { setDragId(null); setDragOverId(null) }}
                onDrop={() => handleDrop(a.id)}
                onEnterGrade={() => handleEnterGrade(a.id)}
                onEnterLabel={() => handleEnterLabel(a.id, a.label)}
              />
            ))}
          </tbody>
          {course.assessments.length > 0 && (
            <tfoot>
              <tr className="tfoot-row">
                <td colSpan={3} />
                <td />
                <td><span className={weightOver ? 'tot-w over' : 'tot-w'}>{fmt(stats.totalWeight, 0)}%</span></td>
                <td />
                <td><span className="tot-e">{fmt(stats.earnedPoints)}</span></td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Mobile cards */}
      <div className="assess-cards-wrap">
        {course.assessments.length === 0 ? (
          <div className="empty-cards">Engar einkunnir skráðar — smelltu á „+ Bæta við mati"</div>
        ) : course.assessments.map(a => (
          <AssessmentCard
            key={a.id} a={a}
            isExcluded={stats.excluded.has(a.id)}
            onUpdate={updated => updateA(a.id, updated)}
            onDelete={() => deleteA(a.id)}
            onDuplicate={() => duplicateA(a.id)}
          />
        ))}
      </div>

      <button className="add-btn" onClick={addA}>+ Bæta við mati</button>
      {onOpenCalc && (
        <button className="print-btn" onClick={onOpenCalc}>Opna reiknivél</button>
      )}
      <button className="print-btn" onClick={() => window.print()}>⎙ Prenta / Vista sem PDF</button>

      {undoItem && (
        <div className="undo-toast">
          <span>Mati eytt</span>
          <button className="undo-btn" onClick={handleUndo}>Afturkalla</button>
        </div>
      )}
    </>
  )
}

// ── ÁFANGAR PAGE ───────────────────────────────────────────────────
function AfangarPage({ data, setData, activeId, setActiveId, onOpenCalc, onImport, showImport, setShowImport }) {
  function addCourse() {
    const c = newCourse(`Áfangi ${data.courses.length + 1}`, data.courses.length)
    setData(d => ({ ...d, courses: [...d.courses, c] }))
    setActiveId(c.id)
  }
  function deleteCourse(id) {
    const target = data.courses.find(c => c.id === id)
    const n = target?.assessments?.length ?? 0
    const msg = `Eyða áfanganum „${target?.name}"?\n\n${n > 0 ? `Allir ${n} matar verða einnig eytt.` : 'Áfanginn er tómur.'}`
    if (!window.confirm(msg)) return
    const idx = data.courses.findIndex(c => c.id === id)
    const rest = data.courses.filter(c => c.id !== id)
    setData(d => ({ ...d, courses: rest }))
    setActiveId(rest[Math.max(0, idx - 1)]?.id)
  }
  function renameCourse(id, name) {
    setData(d => ({ ...d, courses: d.courses.map(c => c.id === id ? { ...c, name } : c) }))
  }
  function updateCourse(updated) {
    setData(d => ({ ...d, courses: d.courses.map(c => c.id === updated.id ? updated : c) }))
  }

  const activeCourse = data.courses.find(c => c.id === activeId)
  const activeCourseStats = activeCourse ? calcCourse(activeCourse) : null

  // Session average
  const allStats = data.courses.map(c => calcCourse(c))
  const graded = allStats.filter(s => s.currentAvg !== null)
  const sessionAvg = graded.length > 0 ? graded.reduce((sum, s) => sum + s.currentAvg, 0) / graded.length : null

  return (
    <div className="afangar">
      {/* Left panel */}
      <div className="afangar-panel">
        <div className="afangar-panel-hdr">
          <div className="afangar-panel-title">Áfangar // {data.courses.length} skráðir</div>
        </div>
        <div className="afangar-list">
          {data.courses.length === 0 && (
            <div className="afangar-list-empty">Engir áfangar enn — bættu við hér að neðan.</div>
          )}
          {data.courses.map(c => {
            const s = calcCourse(c)
            const isActive = c.id === activeId
            return (
              <div key={c.id} className={`afangar-item${isActive ? ' active' : ''}`} onClick={() => setActiveId(c.id)}>
                <span className="afangar-item-bullet">■</span>
                <div className="afangar-item-info">
                  <div className="afangar-item-name" title={c.name}>{c.name}</div>
                </div>
                <span className="afangar-item-grade" style={{ color: gradeColor(s.currentAvg) }}>
                  {s.currentAvg !== null ? fmt(s.currentAvg, 1) : '—'}
                </span>
                <button
                  className="afangar-del-btn"
                  onClick={e => { e.stopPropagation(); deleteCourse(c.id) }}
                  aria-label="Eyða"
                >×</button>
              </div>
            )
          })}
        </div>
        {sessionAvg !== null && (
          <div className="afangar-session-avg">
            <div className="afangar-session-avg-label">Misserismeðaltal</div>
            <div className="afangar-session-avg-val" style={{ color: gradeColor(sessionAvg) }}>
              {fmt(sessionAvg, 2)}
            </div>
          </div>
        )}
        <div className="afangar-panel-footer">
          <button className="panel-btn" onClick={addCourse}>+ Nýr áfangi</button>
          <button className="panel-btn" onClick={() => setShowImport(true)}>↓ Flytja inn</button>
        </div>
      </div>

      {/* Right panel: course detail */}
      <div className="course-detail">
        {activeCourse ? (
          <>
            <div className="course-detail-hdr">
              <div className="course-detail-kicker">
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--accent)', fontSize: 10 }}>■</span>
                {activeCourse.name.toUpperCase()} // {activeCourseStats.totalWeight.toFixed(0)} VÁEGI
              </div>
              <div className="course-detail-hdr-main">
                <input
                  className="course-title-input"
                  value={activeCourse.name}
                  onChange={e => renameCourse(activeCourse.id, e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                />
              </div>
            </div>
            <div className="course-detail-body">
              <CourseDetail
                course={activeCourse}
                onChange={updateCourse}
                onOpenCalc={onOpenCalc}
              />
            </div>
          </>
        ) : (
          <div className="afangar-no-select">
            {data.courses.length === 0 ? 'Bættu við áfanga til að byrja.' : 'Veldu áfanga til vinstri.'}
          </div>
        )}
      </div>

      {showImport && (
        <ImportWizard
          onClose={() => setShowImport(false)}
          onImport={onImport}
          onManual={addCourse}
          existingCourses={data.courses}
        />
      )}
    </div>
  )
}

// ── REIKNIVÉL PAGE ─────────────────────────────────────────────────
function ReiknivélPage({ data, activeId }) {
  const [targetGrade, setTargetGrade] = useState(5)
  const [targetStr, setTargetStr] = useState('5,0')
  const [whatIf, setWhatIf] = useState(false)
  const [whatIfStr, setWhatIfStr] = useState('')

  const course = data.courses.find(c => c.id === activeId) || data.courses[0]
  if (!course) return null

  const stats = calcCourse(course)
  const ungradedWeight = Math.max(0, stats.totalWeight - stats.completedWeight)
  const needed = ungradedWeight > 0.01
    ? (targetGrade - stats.earnedPoints) / (ungradedWeight / 100)
    : null
  const maxAchievable = ungradedWeight > 0.01
    ? (stats.earnedPoints + 10 * (ungradedWeight / 100)) / (stats.totalWeight / 100)
    : null
  const whatIfG = parseNum(whatIfStr)
  const whatIfFinal = !isNaN(whatIfG) && stats.totalWeight > 0
    ? (stats.earnedPoints + whatIfG * (ungradedWeight / 100)) / (stats.totalWeight / 100)
    : null

  const scenarios = [
    { label: 'Fall forðast', grade: 5 },
    { label: 'Góð einkunn', grade: 8 },
    { label: 'Toppur', grade: 9.5 },
  ]

  // Check if course is fully assessed
  const courseComplete = stats.totalWeight >= 99.9 && ungradedWeight < 0.01 && stats.currentAvg !== null

  return (
    <div className="reiknivel">
      <div className="reiknivel-main">
        <div className="reiknivel-kicker">// SIM.TARGET — {course.name.toUpperCase()}</div>
        <h1 className="reiknivel-title">Hvað þarftu?</h1>

        <div className="calc-block">
          <div className="calc-block-title">Núverandi staða</div>
          <div className="calc-score-row">
            <div>
              <div className="calc-score-label">Safnað núna</div>
              <div className="calc-score-big" style={{ color: gradeColor(stats.currentAvg) }}>
                {stats.weightError ? '—' : fmt(stats.currentAvg)}
              </div>
            </div>
            {stats.totalWeight > 0 ? (
              <div className="calc-score-meta">
                <div>{fmt(stats.completedWeight, 0)}% metið</div>
                <div>{fmt(ungradedWeight, 0)}% eftir</div>
              </div>
            ) : (
              <div className="calc-score-meta">
                <div>Engin váegi skráð</div>
              </div>
            )}
          </div>
        </div>

        {courseComplete && (
          <div className="calc-block">
            <div className="calc-block-title">NÁMSKEIÐ LOKIÐ</div>
            <div className="calc-needed-big" style={{ color: gradeColor(stats.currentAvg) }}>
              {fmt(stats.currentAvg)}
            </div>
            <div className="calc-needed-sub">Námskeið lokið — öll mat skráð.</div>
          </div>
        )}

        {!courseComplete && !stats.weightError && course.assessments.length > 0 && ungradedWeight > 0.01 && (
          <>
            <div className="calc-block">
              <div className="calc-block-title">ÞÚ ÞARFT AÐ MEÐALTALI</div>
              <div className="calc-target-wrap">
                <span className="calc-lbl">Ég vil enda með</span>
                <input
                  className="calc-target-input"
                  inputMode="decimal"
                  value={targetStr}
                  onChange={e => {
                    setTargetStr(e.target.value)
                    const v = parseNum(e.target.value)
                    if (!isNaN(v) && v >= 0 && v <= 10) setTargetGrade(v)
                  }}
                  onBlur={() => setTargetStr(targetGrade.toFixed(1).replace('.', ','))}
                />
              </div>
              <input
                type="range"
                min="0" max="10" step="0.1"
                value={targetGrade}
                className="calc-slider"
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  setTargetGrade(v)
                  setTargetStr(v.toFixed(1).replace('.', ','))
                }}
              />
              <div className="calc-needed-big" style={{ color: needed === null ? 'var(--pass)' : needed <= 0 ? 'var(--pass)' : needed > 10 ? 'var(--accent)' : gradeColor(needed) }}>
                {needed === null || needed <= 0
                  ? 'Þegar náð ✓'
                  : needed > 10
                    ? 'Ekki mögulegt'
                    : fmt(needed)}
              </div>
              {needed !== null && needed > 0 && needed <= 10 && (
                <div className="calc-needed-sub">í eftirstandandi {fmt(ungradedWeight, 0)}%</div>
              )}
              {needed !== null && needed > 10 && maxAchievable !== null && (
                <div className="calc-needed-sub">Hæst mögulegt: {fmt(maxAchievable)}</div>
              )}
            </div>

            <div className="calc-block">
              <div className="calc-block-title">ATBURÐARÁSIR</div>
              <div className="calc-scenarios">
                {scenarios.map(sc => {
                  const scNeeded = (sc.grade - stats.earnedPoints) / (ungradedWeight / 100)
                  return (
                    <div key={sc.label} className="calc-scenario" onClick={() => { setTargetGrade(sc.grade); setTargetStr(sc.grade.toFixed(1).replace('.', ',')) }}>
                      <div className="calc-scenario-label">{sc.label}</div>
                      <div className="calc-scenario-target">{sc.grade.toFixed(1).replace('.', ',')}</div>
                      <div className="calc-scenario-needed" style={{ color: scNeeded > 10 ? 'var(--accent)' : scNeeded <= 0 ? 'var(--pass)' : gradeColor(scNeeded) }}>
                        {scNeeded <= 0 ? 'Þegar náð' : scNeeded > 10 ? 'Ómögulegt' : fmt(scNeeded)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="calc-block">
              <div className="calc-block-title">HVAÐ EF?</div>
              <div className="calc-row">
                <span className="calc-lbl">Ef ég fæ</span>
                <input
                  className="calc-input"
                  inputMode="decimal"
                  placeholder="0–10"
                  value={whatIfStr}
                  onChange={e => setWhatIfStr(e.target.value)}
                />
                <span className="calc-lbl">í eftirstandandi {fmt(ungradedWeight, 0)}%</span>
                {whatIfFinal !== null && (
                  <span className="whatif-result" style={{ color: gradeColor(whatIfFinal) }}>
                    → {fmt(whatIfFinal)}
                  </span>
                )}
              </div>
              <div className="whatif-note">framreikningur — geymt ekki</div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── NÁMSFERILL PAGE ────────────────────────────────────────────────
function NamsferillPage({ data }) {
  const allStats = data.courses.map(c => ({ c, s: calcCourse(c) }))
  const gradedCourses = allStats.filter(({ s }) => s.currentAvg !== null)
  const sessionAvg = gradedCourses.length > 0
    ? gradedCourses.reduce((sum, { s }) => sum + s.currentAvg, 0) / gradedCourses.length
    : null

  const allGrades = gradedCourses.map(({ s }) => s.currentAvg)

  // Histogram buckets 1–10
  const buckets = Array.from({ length: 10 }, (_, i) => {
    const lo = i + 1, hi = i + 2
    return gradedCourses.filter(({ s }) => s.currentAvg >= lo && (i === 9 ? s.currentAvg <= 10 : s.currentAvg < hi)).length
  })
  const maxBucket = Math.max(...buckets, 1)

  return (
    <div className="namsferill">
      <div className="namsferill-main">
        <div className="nf-kicker">// NEMANDI_GESTUR</div>
        <h1 className="nf-title">Námsferill</h1>

        <div className="nf-stats-row">
          <div className="nf-stat">
            <div className="nf-stat-label">Meðaltal</div>
            <div className="nf-stat-val" style={{ color: gradeColor(sessionAvg) }}>{fmt(sessionAvg, 2)}</div>
          </div>
          <div className="nf-stat">
            <div className="nf-stat-label">Einingar</div>
            <div className="nf-stat-val">{data.courses.reduce((s, c) => s + c.assessments.length, 0)}</div>
          </div>
          <div className="nf-stat">
            <div className="nf-stat-label">Áfangar</div>
            <div className="nf-stat-val">{data.courses.length}</div>
          </div>
        </div>

        <div className="nf-section-title">Áfangar // Haust 2026</div>
        <div className="nf-course-list">
          {data.courses.map(c => {
            const s = calcCourse(c)
            const avg = s.currentAvg
            const barPct = avg !== null ? (avg / 10) * 100 : 0
            return (
              <div key={c.id} className="nf-course-row">
                <div>
                  <div className="nf-course-code">{c.name.slice(0, 10).toUpperCase()}</div>
                  <div className="nf-course-name">{c.name}</div>
                </div>
                <div className="nf-bar-wrap">
                  <div
                    className={`nf-bar-fill${avg !== null && avg < 5 ? ' low' : ''}`}
                    style={{ width: `${barPct}%` }}
                  />
                </div>
                <span className="nf-course-grade" style={{ color: gradeColor(avg) }}>
                  {avg !== null ? fmt(avg, 1) : '—'}
                </span>
              </div>
            )
          })}
        </div>

        <div className="nf-histogram">
          <div className="nf-section-title">Dreifing einkunna</div>
          <div className="nf-hist-bars">
            {buckets.map((count, i) => (
              <div key={i} className="nf-hist-bar-wrap">
                {count > 0 && <div className="nf-hist-count">{count}</div>}
                <div
                  className={`nf-hist-bar${count === 0 ? ' empty' : ''}${i + 1 < 5 ? ' accent' : ''}`}
                  style={{ height: count > 0 ? `${(count / maxBucket) * 100}%` : undefined }}
                />
              </div>
            ))}
            <div className="nf-hist-accent-line" style={{ width: '40%' }} />
          </div>
          <div className="nf-hist-axis">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="nf-hist-tick">{i + 1}</div>
            ))}
          </div>
          <div className="nf-hist-x-label">Einkunn</div>
        </div>
      </div>

      <div className="namsferill-sidebar">
        <div className="nf-info-box">
          {[
            ['Nemandi', 'Gestur_0417'],
            ['Braut', 'Tölvunarfræði'],
            ['Misseri', 'Haust 2026'],
            ['Geymsla', 'Staðbundin'],
          ].map(([k, v]) => (
            <div key={k} className="nf-info-row">
              <span className="nf-info-key">{k}</span>
              <span className="nf-info-val">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── APP ────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState('forsida')
  const [loggedIn, setLoggedIn] = useState(false)
  const [data, setData] = useState(loadData)
  const [activeId, setActiveId] = useState(() => loadData().courses[0]?.id)
  const [showImport, setShowImport] = useState(false)
  const [importToast, setImportToast] = useState(null)
  const [supaUser, setSupaUser]       = useState(null)
  const [showProfile, setShowProfile] = useState(false)

  useEffect(() => { saveData(data) }, [data])
  useEffect(() => {
    if (!data.courses.find(c => c.id === activeId)) setActiveId(data.courses[0]?.id)
  }, [data.courses, activeId])

  // Supabase auth listener
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user ?? null
      if (event === 'INITIAL_SESSION') {
        if (user) { setSupaUser(user); setLoggedIn(true); setPage('afangar'); loadSupaData(user.id) }
      } else if (event === 'SIGNED_IN') {
        setSupaUser(user); setLoggedIn(true); setPage('afangar'); loadSupaData(user.id)
      } else if (event === 'SIGNED_OUT') {
        setSupaUser(null); setLoggedIn(false); setPage('forsida'); setData(loadData())
      } else if (event === 'USER_UPDATED') {
        setSupaUser(user)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // User-specific localStorage key — backup so data survives Supabase hiccups
  const userKey = supaUser ? `einkunnabok_u_${supaUser.id}` : null

  // Save to user-specific localStorage immediately on every change
  useEffect(() => {
    if (!userKey) return
    try { localStorage.setItem(userKey, JSON.stringify(data.courses)) } catch {}
  }, [data.courses, userKey])

  // Auto-save to Supabase (debounced 600ms)
  useEffect(() => {
    if (!supaUser) return
    const t = setTimeout(() => {
      supabase.from('user_data').upsert({ id: supaUser.id, courses: data.courses, updated_at: new Date().toISOString() })
    }, 600)
    return () => clearTimeout(t)
  }, [data.courses, supaUser])

  // Save immediately when tab closes
  useEffect(() => {
    if (!supaUser || !userKey) return
    function onUnload() {
      try { localStorage.setItem(userKey, JSON.stringify(data.courses)) } catch {}
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [supaUser, userKey, data.courses])

  async function loadSupaData(userId) {
    const { data: row, error } = await supabase.from('user_data').select('courses').eq('id', userId).single()
    const localKey = `einkunnabok_u_${userId}`

    if (!error && row?.courses?.length) {
      // Supabase has data — use it as source of truth
      setData({ courses: row.courses })
      setActiveId(row.courses[0]?.id)
      localStorage.setItem(localKey, JSON.stringify(row.courses))
    } else if (error?.code === 'PGRST116') {
      // No Supabase row — check user-specific local backup
      try {
        const backup = localStorage.getItem(localKey)
        if (backup) {
          const courses = JSON.parse(backup)
          setData({ courses }); setActiveId(courses[0]?.id)
        } else {
          // Truly new user — start clean
          setData({ courses: [] }); setActiveId(null)
        }
      } catch { setData({ courses: [] }); setActiveId(null) }
    }
    // Other errors (network etc.) — keep current data unchanged
  }

  function handleLogin() {
    setLoggedIn(true)
    setPage('afangar')
  }

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  function handleNav(key) {
    if ((key === 'afangar' || key === 'reiknivel' || key === 'namsferill') && !loggedIn) {
      setPage('innskraning')
    } else {
      setPage(key)
    }
  }

  function handleImport(importedCourses, targetCourseId) {
    const COLORS = COURSE_COLORS
    let firstNewId = null
    setData(d => {
      if (targetCourseId) {
        const updated = d.courses.map(c => {
          if (c.id !== targetCourseId) return c
          return { ...c, assessments: [...c.assessments, ...(importedCourses[0]?.assessments ?? [])] }
        })
        return { ...d, courses: updated }
      }
      const newCourses = importedCourses.map((ic, i) => {
        const id = uid()
        if (i === 0) firstNewId = id
        return { id, name: ic.name, color: COLORS[(d.courses.length + i) % COLORS.length], assessments: ic.assessments, bestOfRules: ic.bestOfRules ?? {}, lokaprófMin: ic.lokaprófMin ?? 5, improvementRules: ic.improvementRules ?? [] }
      })
      return { ...d, courses: [...d.courses, ...newCourses] }
    })
    const navId = targetCourseId ?? firstNewId
    if (navId) setActiveId(navId)
    setShowImport(false)
    const label = targetCourseId
      ? 'Mati bætt við áfanga'
      : `${importedCourses.length === 1 ? importedCourses[0].name : `${importedCourses.length} áfangar`} flutt inn`
    setImportToast(label)
    setTimeout(() => setImportToast(null), 3500)
  }

  // Session average
  const allStats = loggedIn ? data.courses.map(c => calcCourse(c)) : []
  const graded = allStats.filter(s => s.currentAvg !== null)
  const sessionAvg = graded.length > 0 ? graded.reduce((sum, s) => sum + s.currentAvg, 0) / graded.length : null

  return (
    <div className="app">
      <TopNav page={page} onNav={handleNav} loggedIn={loggedIn} sessionAvg={sessionAvg} supaUser={supaUser} onLogout={supaUser ? handleLogout : null} onProfile={supaUser ? () => setShowProfile(true) : null} />
      {showProfile && supaUser && <ProfileModal user={supaUser} onClose={() => setShowProfile(false)} />}

      {page === 'forsida' && (
        <ForsidaPage
          onLogin={() => setPage('innskraning')}
          onOpen={() => setPage('afangar')}
          loggedIn={loggedIn}
        />
      )}

      {page === 'innskraning' && <InnskraningPage onLogin={handleLogin} />}

      {loggedIn && page === 'afangar' && (
        <AfangarPage
          data={data}
          setData={setData}
          activeId={activeId}
          setActiveId={setActiveId}
          onOpenCalc={() => setPage('reiknivel')}
          onImport={handleImport}
          showImport={showImport}
          setShowImport={setShowImport}
        />
      )}

      {loggedIn && page === 'reiknivel' && (
        <ReiknivélPage data={data} activeId={activeId} />
      )}

      {loggedIn && page === 'namsferill' && (
        <NamsferillPage data={data} />
      )}

      {importToast && <div className="import-success-toast">✓ {importToast}</div>}
    </div>
  )
}

import { useState, useEffect } from 'react'
import './App.css'

// ── Constants ──────────────────────────────────────────────────────
const STORAGE_KEY = 'einkunnabok_v1'

const ASSESSMENT_TYPES = [
  'Lokapróf','Miðmisserisspróf','Hlutapróf','Smápróf',
  'Heimadæmi','Verkefni','Dæmatími','Stöðumat','Annað',
]

const COURSE_COLORS = [
  '#3DDC97','#4f8ef7','#f97316','#a855f7','#ec4899','#eab308','#06b6d4','#f43f5e',
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
  if (g === null || g === undefined || isNaN(g)) return 'var(--text-dim)'
  if (g >= 7) return '#4ade80'
  if (g >= 5) return '#fbbf24'
  return '#f87171'
}

function newCourse(name = 'Nýr áfangi', colorIdx = 0) {
  return { id: uid(), name, color: COURSE_COLORS[colorIdx % COURSE_COLORS.length], assessments: [], bestOfRules: {}, lokaprófMin: 5 }
}

function newAssessment(overrides = {}) {
  return { id: uid(), type: 'Heimadæmi', label: '', grade: '', weight: '', date: '', ...overrides }
}

// ── Best-of logic ──────────────────────────────────────────────────
// Groups by type automatically. Returns Set of excluded IDs.
// Only applies exclusion if ALL items of that type are graded.
// When all are graded: sort by grade descending (stable — break ties by
// original array index, lower index wins). Items beyond bestN are excluded.
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

    // Only apply exclusion if ALL items of this type have a valid grade
    const allGraded = items.every(({ a }) => {
      const g = parseNum(a.grade)
      return a.grade !== '' && !isNaN(g)
    })
    if (!allGraded) continue

    // Sort by grade descending, break ties by original index (lower index = wins)
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
  const { assessments, bestOfRules = {}, lokaprófMin = 5 } = course
  const excluded = getExcludedIds(assessments, bestOfRules)

  let earnedPoints = 0, totalWeight = 0, completedWeight = 0, lokaprófGrade = null

  for (const a of assessments) {
    const w = parseNum(a.weight)
    const g = parseNum(a.grade)
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

  const weightError = totalWeight > 100.01
    ? { total: totalWeight, excess: totalWeight - 100 }
    : null

  let currentAvg = completedWeight > 0 ? earnedPoints / (completedWeight / 100) : null
  let passStatus = null

  if (weightError) {
    currentAvg = null
    passStatus = null
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
        bestOfRules: {}, lokaprófMin: 5, color: COURSE_COLORS[i % COURSE_COLORS.length], ...c,
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

// ── Assessment Row ─────────────────────────────────────────────────
function AssessmentRow({ a, isExcluded, isDragOver, isDragging, onUpdate, onDelete, onDuplicate, onDragStart, onDragOver, onDragEnd, onDrop, onEnterLabel, onEnterGrade }) {
  const g = parseNum(a.grade)
  const w = parseNum(a.weight)
  const contribution = (!isNaN(g) && !isNaN(w) && a.grade !== '' && a.weight !== '') ? g * w / 100 : null
  const dot = TYPE_COLORS[a.type] || '#6b7280'
  const gradeInvalid = a.grade !== '' && !isNaN(g) && (g < 0 || g > 10)

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
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnterLabel() } }}
        />
      </td>
      <td>
        <input
          className={`ri ri-num${gradeInvalid ? ' invalid' : ''}`}
          inputMode="decimal"
          placeholder="0–10"
          value={a.grade}
          data-field="grade"
          data-id={a.id}
          onChange={e => onUpdate({ ...a, grade: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnterGrade() } }}
        />
      </td>
      <td>
        <div className="w-wrap">
          <input className="ri ri-num" inputMode="decimal" placeholder="0" value={a.weight} onChange={e => onUpdate({ ...a, weight: e.target.value })} />
          <span className="pct">%</span>
        </div>
      </td>
      <td>
        <input className="ri ri-date" type="date" value={a.date} onChange={e => onUpdate({ ...a, date: e.target.value })} />
      </td>
      <td className="contrib-td">
        {isExcluded
          ? <span className="excl-badge">Gildir ekki</span>
          : contribution !== null
            ? <span className="contrib" style={{ color: gradeColor(g) }}>{fmt(contribution)}</span>
            : <span className="contrib-nil">—</span>}
      </td>
      <td className="action-td">
        <button className="ibtn dup" onClick={onDuplicate} title="Afrita röð">⧉</button>
        <button className="ibtn del" onClick={onDelete} title="Eyða">×</button>
      </td>
    </tr>
  )
}

// ── Rules Panel ────────────────────────────────────────────────────
// Collapsible panel that appears when any type has 2+ assessments.
function RulesPanel({ assessments, bestOfRules, onChange }) {
  const [open, setOpen] = useState(false)

  const typeCounts = {}
  for (const a of assessments) typeCounts[a.type] = (typeCounts[a.type] || 0) + 1
  const multiTypes = Object.entries(typeCounts).filter(([, n]) => n >= 2)
  if (multiTypes.length === 0) return null

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
          <div style={{ padding: '6px 14px 2px', fontSize: '11px', color: 'var(--text-faint)' }}>
            Hæstu einkunnir gilda
          </div>
          {multiTypes.map(([type, count]) => {
            const bestN = bestOfRules[type] ?? count
            return (
              <div key={type} className="rule-row">
                <span className="rule-dot" style={{ background: TYPE_COLORS[type] || '#6b7280' }} />
                <span className="rule-type">{type}</span>
                <span className="rule-lbl">— Hæstu</span>
                <select
                  className="rule-sel"
                  value={bestN}
                  onChange={e => onChange(type, parseInt(e.target.value))}
                >
                  {Array.from({ length: count }, (_, i) => i + 1).map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <span className="rule-lbl">af {count} gilda</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Course Page ────────────────────────────────────────────────────
function CoursePage({ course, onChange }) {
  const [dragId, setDragId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [targetGrade, setTargetGrade] = useState(5)

  const stats = calcCourse(course)
  const weightOver = stats.totalWeight > 100.01

  function updateA(id, updated) {
    onChange({ ...course, assessments: course.assessments.map(a => a.id === id ? updated : a) })
  }
  function deleteA(id) {
    onChange({ ...course, assessments: course.assessments.filter(a => a.id !== id) })
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
  function addA() {
    onChange({ ...course, assessments: [...course.assessments, newAssessment()] })
  }
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
  function updateBestOf(type, n) {
    onChange({ ...course, bestOfRules: { ...course.bestOfRules, [type]: n } })
  }

  // Enter in grade → focus grade in next row
  function handleEnterGrade(currentId) {
    const idx = course.assessments.findIndex(a => a.id === currentId)
    const next = course.assessments[idx + 1]
    if (!next) return
    requestAnimationFrame(() => {
      document.querySelector(`[data-field="grade"][data-id="${next.id}"]`)?.focus()
    })
  }

  // Enter in label → auto-increment name + focus label in next row
  function handleEnterLabel(currentId, currentLabel) {
    const idx = course.assessments.findIndex(a => a.id === currentId)
    const next = course.assessments[idx + 1]
    if (!next) return

    // If label ends with a number and next label is empty, auto-fill with +1
    const match = currentLabel.trim().match(/^([\s\S]*\D)(\d+)$/)
    if (match && !next.label.trim()) {
      const nextLabel = match[1] + (parseInt(match[2]) + 1)
      const newList = course.assessments.map(a => a.id === next.id ? { ...a, label: nextLabel } : a)
      onChange({ ...course, assessments: newList })
      // Wait two frames so React re-renders the input value before focusing
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.querySelector(`[data-field="label"][data-id="${next.id}"]`)?.focus()
      }))
    } else {
      requestAnimationFrame(() => {
        document.querySelector(`[data-field="label"][data-id="${next.id}"]`)?.focus()
      })
    }
  }

  const pctDone = Math.min(stats.completedWeight, 100)
  const pctPend = Math.min(Math.max(0, stats.totalWeight - stats.completedWeight), 100 - pctDone)

  const passLabel = stats.passStatus === null
    ? (stats.weightError ? 'Leiðrétta þarf vægi' : 'Engin einkunn enn')
    : stats.passStatus === 'pass' ? '✓ Staðið'
    : stats.passStatus === 'fail-loka' ? `✗ Fallið — lokapróf undir ${fmt(course.lokaprófMin, 1)}`
    : '✗ Fallið'
  const passColor = stats.weightError ? '#f87171'
    : stats.passStatus === 'pass' ? '#4ade80'
    : stats.passStatus !== null ? '#f87171'
    : 'var(--text-faint)'

  return (
    <div className="course-page">
      {/* Summary */}
      <div className="sum-grid">
        <div className="sum-card card-main">
          <div className="s-lbl">Lokaeinkunn</div>
          {stats.weightError
            ? <>
                <div className="s-grade" style={{ color: 'var(--text-dim)' }}>—</div>
                <div className="s-sub" style={{ color: '#f87171' }}>Leiðrétta þarf vægi</div>
              </>
            : <>
                <div className="s-grade" style={{ color: gradeColor(stats.currentAvg) }}>{fmt(stats.currentAvg)}</div>
                <div className="s-sub" style={{ color: passColor }}>{passLabel}</div>
              </>
          }
        </div>
        <div className="sum-card">
          <div className="s-lbl">Lokið</div>
          <div className="s-val">{fmt(stats.completedWeight, 0)}<span className="s-unit">%</span></div>
          <div className="s-sub">af námskeiðinu metið</div>
        </div>
        <div className="sum-card">
          <div className="s-lbl">Ómetið</div>
          <div className="s-val">{fmt(Math.max(0, 100 - stats.completedWeight), 0)}<span className="s-unit">%</span></div>
          <div className="s-sub">eftir ómetið</div>
        </div>
        <div className="sum-card">
          <div className="s-lbl">Óskráð vægi</div>
          <div className="s-val" style={{ color: weightOver ? '#f87171' : undefined }}>
            {fmt(Math.max(0, 100 - stats.totalWeight), 0)}
            <span className="s-unit">%</span>
          </div>
          <div className="s-sub" style={{ color: weightOver ? '#f87171' : undefined }}>
            {weightOver ? 'vægi yfir 100%' : 'ekki skráð enn'}
          </div>
        </div>
      </div>

      {/* Weight error banner */}
      {stats.weightError && (
        <div className="weight-error">
          ⚠ Samanlagt vægi er {fmt(stats.weightError.total, 0)}%. Hámarkið er 100%. Lækkaðu vægi um {fmt(stats.weightError.excess, 0)}%.
        </div>
      )}

      {/* Progress */}
      <div className="prog-wrap">
        <div className="prog-bar">
          <div className="pb pb-done" style={{ width: `${pctDone}%` }} />
          <div className="pb pb-pend" style={{ left: `${pctDone}%`, width: `${pctPend}%` }} />
        </div>
        <div className="prog-labels">
          <span style={{ color: '#4ade80' }}>Metið: {fmt(stats.completedWeight, 0)}%</span>
          <span>Skráð: {fmt(stats.totalWeight, 0)}%</span>
          <span>100%</span>
        </div>
      </div>

      {/* Settings bar */}
      <div className="settings-bar">
        <label className="sb-label">
          Lágmarkseinkunn í lokaprófi
          <input
            className="sb-input"
            type="number" min="0" max="10" step="0.5"
            value={course.lokaprófMin}
            onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange({ ...course, lokaprófMin: v }) }}
          />
        </label>
        {stats.lokaprófGrade !== null && (
          <span className="sb-status" style={{ color: gradeColor(stats.lokaprófGrade) }}>
            Lokapróf: {fmt(stats.lokaprófGrade, 1)}{stats.lokaprófGrade < course.lokaprófMin ? ' ⚠' : ' ✓'}
          </span>
        )}
      </div>

      {/* Rules panel — collapsible, auto-appears when any type has 2+ rows */}
      <RulesPanel assessments={course.assessments} bestOfRules={course.bestOfRules} onChange={updateBestOf} />

      {/* Grade calculator */}
      {!stats.weightError && course.assessments.length > 0 && (() => {
        const ungradedWeight = Math.max(0, stats.totalWeight - stats.completedWeight)
        if (ungradedWeight < 0.01) return null
        const needed = (targetGrade - stats.earnedPoints) / (ungradedWeight / 100)
        const impossible = needed > 10
        const alreadyDone = needed <= 0
        return (
          <div className="calc-bar">
            <span className="calc-lbl">Til að ná</span>
            <input
              className="calc-input"
              type="number" min="0" max="10" step="0.5"
              value={targetGrade}
              onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setTargetGrade(v) }}
            />
            <span className="calc-lbl">þarftu að meðaltali</span>
            {impossible
              ? <span className="calc-result impossible">Ekki mögulegt</span>
              : alreadyDone
              ? <span className="calc-result done">Þegar náð ✓</span>
              : <span className="calc-result" style={{ color: gradeColor(needed) }}>{fmt(needed)}</span>
            }
            {!impossible && !alreadyDone && <span className="calc-lbl">í eftirstandandi {fmt(ungradedWeight, 0)}%</span>}
          </div>
        )
      })()}

      {/* Table */}
      <div className="table-wrap">
        <table className="assess-tbl">
          <thead>
            <tr>
              <th className="th-drag" />
              <th>Tegund</th>
              <th>Nafn</th>
              <th>Einkunn</th>
              <th>Vægi</th>
              <th>Dagsetning</th>
              <th>Framlag</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {course.assessments.length === 0 ? (
              <tr><td colSpan={8} className="empty-row">Engar einkunnir skráðar — smelltu á „+ Bæta við mati"</td></tr>
            ) : course.assessments.map(a => (
              <AssessmentRow
                key={a.id}
                a={a}
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

      <button className="add-btn" onClick={addA}>+ Bæta við mati</button>
      <button className="print-btn" onClick={() => window.print()}>⎙ Prenta / Vista sem PDF</button>
    </div>
  )
}

// ── Login Screen ───────────────────────────────────────────────────
function LoginScreen({ onGuest }) {
  const [tab, setTab] = useState('login') // 'login' | 'register'
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [notice] = useState('Innskráning með tölvupósti kemur fljótlega.')

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <svg className="login-icon" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="48" height="48" rx="12" fill="#101A15"/>
            <rect x="10" y="30" width="7" height="10" rx="2.5" fill="#2F6B52"/>
            <rect x="20.5" y="22" width="7" height="18" rx="2.5" fill="#2F9D74"/>
            <rect x="31" y="10" width="7" height="30" rx="2.5" fill="#3DDC97"/>
          </svg>
          <span className="login-title">Einkunnir.is</span>
          <span className="login-sub">Einkunnakerfið þitt</span>
        </div>

        <div className="login-tabs">
          <button className={`ltab${tab === 'login' ? ' active' : ''}`} onClick={() => setTab('login')}>Innskráning</button>
          <button className={`ltab${tab === 'register' ? ' active' : ''}`} onClick={() => setTab('register')}>Stofna aðgang</button>
        </div>

        <div className="login-fields">
          <div className="lfield">
            <label className="lfield-lbl">Netfang</label>
            <input className="lfield-inp" type="email" placeholder="nafn@hi.is" value={email} onChange={e => setEmail(e.target.value)} disabled />
          </div>
          <div className="lfield">
            <label className="lfield-lbl">Lykilorð</label>
            <input className="lfield-inp" type="password" placeholder="••••••••" value={pw} onChange={e => setPw(e.target.value)} disabled />
          </div>
          {tab === 'register' && (
            <div className="lfield">
              <label className="lfield-lbl">Staðfesta lykilorð</label>
              <input className="lfield-inp" type="password" placeholder="••••••••" disabled />
            </div>
          )}
        </div>

        <div className="login-notice">{notice}</div>

        <button className="login-btn" disabled>
          {tab === 'login' ? 'Skrá inn' : 'Stofna aðgang'}
        </button>

        <div className="login-divider"><span>eða</span></div>

        <button className="guest-btn" onClick={onGuest}>
          Prófa sem gestur
        </button>
      </div>
    </div>
  )
}

// ── App ────────────────────────────────────────────────────────────
export default function App() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [data, setData] = useState(loadData)
  const [activeId, setActiveId] = useState(() => loadData().courses[0]?.id)
  const [editingId, setEditingId] = useState(null)
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => { saveData(data) }, [data])
  useEffect(() => {
    if (!data.courses.find(c => c.id === activeId)) setActiveId(data.courses[0]?.id)
  }, [data.courses, activeId])

  if (!loggedIn) return <LoginScreen onGuest={() => setLoggedIn(true)} />

  function addCourse() {
    const c = newCourse(`Áfangi ${data.courses.length + 1}`, data.courses.length)
    setData(d => ({ ...d, courses: [...d.courses, c] }))
    setActiveId(c.id); setEditingId(c.id)
  }
  function deleteCourse(id) {
    if (data.courses.length <= 1) return
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

  return (
    <div className="app">
      <header className="app-hdr">
        <button className="hamburger" onClick={() => setSidebarOpen(o => !o)} aria-label="Valmynd">
          <span /><span /><span />
        </button>
        <div className="brand">
          <svg className="brand-icon" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
            <rect width="48" height="48" rx="12" fill="#101A15"/>
            <rect x="10" y="30" width="7" height="10" rx="2.5" fill="#2F6B52"/>
            <rect x="20.5" y="22" width="7" height="18" rx="2.5" fill="#2F9D74"/>
            <rect x="31" y="10" width="7" height="30" rx="2.5" fill="#3DDC97"/>
          </svg>
          <span>Einkunnir<span style={{ color: 'var(--accent)' }}>.is</span></span>
        </div>
        <div className="hdr-right">
          <button className="theme-toggle" onClick={() => setDark(d => !d)} title={dark ? 'Ljóst þema' : 'Dökkt þema'}>
            {dark ? '☀' : '☽'}
          </button>
          <span className="hdr-guest">Gestur</span>
          <button className="hdr-logout" onClick={() => setLoggedIn(false)}>Útskrá</button>
        </div>
      </header>

      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <div className="layout">
        <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
          <nav className="course-list">
            {data.courses.map(c => {
              const stats = calcCourse(c)
              const isActive = c.id === activeId
              return (
                <div key={c.id} className={`c-item ${isActive ? 'active' : ''}`} onClick={() => { setActiveId(c.id); setSidebarOpen(false) }}>
                  {editingId === c.id ? (
                    <input
                      className="c-name-edit" autoFocus value={c.name}
                      onChange={e => renameCourse(c.id, e.target.value)}
                      onBlur={() => setEditingId(null)}
                      onKeyDown={e => e.key === 'Enter' && setEditingId(null)}
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <span className="c-dot" style={{ background: c.color || '#3DDC97' }} />
                      <span className="c-name" onDoubleClick={e => { e.stopPropagation(); setEditingId(c.id) }}>{c.name}</span>
                      <span className="c-grade" style={{ color: gradeColor(stats.currentAvg) }}>
                        {stats.currentAvg !== null ? fmt(stats.currentAvg, 1) : '—'}
                      </span>
                    </>
                  )}
                  {data.courses.length > 1 && (
                    <button className="c-del" onClick={e => { e.stopPropagation(); deleteCourse(c.id) }}>×</button>
                  )}
                </div>
              )
            })}
          </nav>
          <button className="add-course-btn" onClick={addCourse}>+ Nýr áfangi</button>
        </aside>

        <main className="content">
          {activeCourse && (
            <>
              <div className="title-row">
                {editingId === activeCourse.id ? (
                  <input
                    className="title-edit" autoFocus value={activeCourse.name}
                    onChange={e => renameCourse(activeCourse.id, e.target.value)}
                    onBlur={() => setEditingId(null)}
                    onKeyDown={e => e.key === 'Enter' && setEditingId(null)}
                  />
                ) : (
                  <h2 className="course-title" onDoubleClick={() => setEditingId(activeCourse.id)}>
                    {activeCourse.name}<span className="edit-hint">✎</span>
                  </h2>
                )}
              </div>
              <CoursePage course={activeCourse} onChange={updateCourse} />
            </>
          )}
        </main>
      </div>
    </div>
  )
}

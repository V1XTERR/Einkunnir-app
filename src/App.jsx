import { useState, useEffect, useRef } from 'react'
import './App.css'
import { ImportWizard } from './ImportWizard'

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
  if (g === null || g === undefined || isNaN(g)) return 'var(--text-dim)'
  if (g >= 7) return 'var(--pass)'
  if (g >= 5) return '#f59e0b'
  return 'var(--fail)'
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

  // Grades for improvement-rule lookups (collected during main loop)
  const improveGrades = {}

  for (const a of assessments) {
    const w = parseNum(a.weight)
    const g = parseNum(a.grade)
    // Track grades needed by improvement rules
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

  // Apply improvement rules: max(baseWeight×F + improveWeight×M, totalWeight×F)
  // Equivalent to adding improveWeight × max(M - F, 0) on top of the normal F×totalWeight
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
          style={!gradeInvalid && a.grade !== '' && !isNaN(g) ? { color: gradeColor(g), fontWeight: 700 } : undefined}
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
          <button
            className="row-menu-trigger"
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Fleiri aðgerðir"
            aria-expanded={menuOpen}
          >⋯</button>
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
          <button
            className="row-menu-trigger ac-menu-trigger"
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Fleiri aðgerðir"
            aria-expanded={menuOpen}
          >⋯</button>
          {menuOpen && (
            <div className="row-menu-dropdown row-menu-dropdown-left">
              <button className="row-menu-item" onClick={() => { onDuplicate(); setMenuOpen(false) }}>Afrita röð</button>
              <button className="row-menu-item row-menu-item-del" onClick={() => { onDelete(); setMenuOpen(false) }}>Eyða</button>
            </div>
          )}
        </div>
      </div>
      <input
        className="ac-label"
        placeholder="Nafn (valfrjálst)"
        value={a.label}
        onChange={e => onUpdate({ ...a, label: e.target.value })}
      />
      <div className="ac-fields">
        <div className="ac-field">
          <span className="ac-flbl">Einkunn</span>
          <input
            className={`ac-finp${gradeInvalid ? ' invalid' : ''}`}
            inputMode="decimal"
            placeholder="0–10"
            value={a.grade}
            style={!gradeInvalid && a.grade !== '' && !isNaN(g) ? { color: gradeColor(g), fontWeight: 700 } : undefined}
            onChange={e => onUpdate({ ...a, grade: e.target.value })}
          />
        </div>
        <div className="ac-field">
          <span className="ac-flbl">Váegi</span>
          <div className="w-wrap">
            <input
              className="ac-finp"
              inputMode="decimal"
              placeholder="0"
              value={a.weight}
              onChange={e => onUpdate({ ...a, weight: e.target.value })}
            />
            <span className="pct">%</span>
          </div>
        </div>
        <div className="ac-field">
          <span className="ac-flbl">Dagsetning</span>
          <input
            className="ac-finp ac-date"
            type="date"
            value={a.date}
            onChange={e => onUpdate({ ...a, date: e.target.value })}
          />
        </div>
        <div className="ac-field">
          <span className="ac-flbl">Gildi</span>
          <span className="ac-contrib">{isExcluded ? '—' : (contribution !== null ? fmt(contribution) : '—')}</span>
        </div>
      </div>
    </div>
  )
}

// ── Rules Panel (includes lokaprófMin) ────────────────────────────
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
          {/* lokaprófMin setting */}
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

          {/* Best-of rules */}
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
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Overview Page ──────────────────────────────────────────────────
function OverviewPage({ data, onSelect }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const upcoming = []
  for (const c of data.courses) {
    for (const a of c.assessments) {
      if (!a.date || a.grade !== '') continue
      const d = new Date(a.date)
      if (d >= today) upcoming.push({ ...a, courseName: c.name, courseColor: c.color, courseId: c.id, dateObj: d })
    }
  }
  upcoming.sort((a, b) => a.dateObj - b.dateObj)

  return (
    <div className="overview-page">
      <h2 className="ov-title">Yfirlit</h2>
      <div className="ov-grid">
        {data.courses.map(c => {
          const stats = calcCourse(c)
          const passLabel = stats.passStatus === null
            ? (stats.weightError ? 'Leiðrétta váegi' : 'Engin einkunn')
            : stats.passStatus === 'pass' ? '✓ Staðið'
            : stats.passStatus === 'fail-loka' ? '✗ Lokapróf'
            : '✗ Fallið'
          const passColor = stats.weightError ? 'var(--fail)'
            : stats.passStatus === 'pass' ? 'var(--pass)'
            : stats.passStatus !== null ? 'var(--fail)'
            : 'var(--text-faint)'

          return (
            <div key={c.id} className="ov-card" onClick={() => onSelect(c.id)}>
              <div className="ov-card-top">
                <span className="c-dot" style={{ background: c.color }} />
                <span className="ov-name">{c.name}</span>
                <span className="ov-grade" style={{ color: gradeColor(stats.currentAvg) }}>
                  {stats.currentAvg !== null ? fmt(stats.currentAvg) : '—'}
                </span>
              </div>
              <div className="ov-card-stats">
                <span className="ov-stat">
                  <span className="ov-stat-lbl">Metið</span>
                  <span className="ov-stat-val">{fmt(stats.completedWeight, 0)}%</span>
                </span>
                <span className="ov-stat">
                  <span className="ov-stat-lbl">Skráð</span>
                  <span className="ov-stat-val">{fmt(stats.totalWeight, 0)}%</span>
                </span>
                <span className="ov-status" style={{ color: passColor }}>{passLabel}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="ov-section">
        <h3 className="ov-section-title">Næstu mat</h3>
        {upcoming.length === 0 ? (
          <p className="ov-empty">Engin skráð mat á næstunni.</p>
        ) : (
          <div className="ov-upcoming-list">
            {upcoming.slice(0, 10).map(a => (
              <div key={a.id} className="ov-upcoming-item" onClick={() => onSelect(a.courseId)}>
                <span className="ov-up-date">{fmtDate(a.date)}</span>
                <span className="c-dot" style={{ background: a.courseColor, flexShrink: 0 }} />
                <span className="ov-up-course">{a.courseName}</span>
                <span className="ov-up-type">{a.type}{a.label ? ` · ${a.label}` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Course Page ────────────────────────────────────────────────────
function CoursePage({ course, onChange }) {
  const [dragId, setDragId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [targetGradeStr, setTargetGradeStr] = useState('5')
  const [whatIf, setWhatIf] = useState(false)
  const [whatIfStr, setWhatIfStr] = useState('')
  const [undoItem, setUndoItem] = useState(null)
  const undoTimer = useRef(null)

  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current) }, [])

  const stats = calcCourse(course)
  const weightOver = stats.totalWeight > 100.01

  function updateA(id, updated) {
    onChange({ ...course, assessments: course.assessments.map(a => a.id === id ? updated : a) })
  }
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
  function updateLokaprófMin(v) {
    onChange({ ...course, lokaprófMin: v })
  }

  function handleEnterGrade(currentId) {
    const idx = course.assessments.findIndex(a => a.id === currentId)
    const next = course.assessments[idx + 1]
    if (!next) return
    requestAnimationFrame(() => {
      document.querySelector(`[data-field="grade"][data-id="${next.id}"]`)?.focus()
    })
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
      requestAnimationFrame(() => {
        document.querySelector(`[data-field="label"][data-id="${next.id}"]`)?.focus()
      })
    }
  }

  const pctDone = Math.min(stats.completedWeight, 100)
  const pctPend = Math.min(Math.max(0, stats.totalWeight - stats.completedWeight), 100 - pctDone)

  const passLabel = stats.passStatus === null
    ? (stats.weightError ? 'Leiðrétta þarf váegi' : 'Engin einkunn enn')
    : stats.passStatus === 'pass' ? '✓ Staðið'
    : stats.passStatus === 'fail-loka' ? `✗ Fallið — lokapróf undir ${fmt(course.lokaprófMin, 1)}`
    : '✗ Fallið'
  const passColor = stats.weightError ? 'var(--fail)'
    : stats.passStatus === 'pass' ? 'var(--pass)'
    : stats.passStatus !== null ? 'var(--fail)'
    : 'var(--text-faint)'

  // Calculator
  const targetGrade = Math.max(0, Math.min(10, parseNum(targetGradeStr) || 5))
  const ungradedWeight = Math.max(0, stats.totalWeight - stats.completedWeight)
  const needed = ungradedWeight > 0.01
    ? (targetGrade - stats.earnedPoints) / (ungradedWeight / 100)
    : null

  // Highest achievable grade (if impossible)
  const maxAchievable = ungradedWeight > 0.01
    ? (stats.earnedPoints + 10 * (ungradedWeight / 100)) / (stats.totalWeight / 100)
    : null

  // What-if projected grade
  const whatIfG = parseNum(whatIfStr)
  const whatIfFinal = !isNaN(whatIfG) && stats.totalWeight > 0
    ? (stats.earnedPoints + whatIfG * (ungradedWeight / 100)) / (stats.totalWeight / 100)
    : null

  const showCalc = !stats.weightError && course.assessments.length > 0

  return (
    <div className="course-page">
      {/* Summary — DO NOT CHANGE */}
      <div className="sum-grid">
        <div className="sum-card card-main">
          <div className="s-lbl">Lokaeinkunn</div>
          {stats.weightError
            ? <>
                <div className="s-grade" style={{ color: 'var(--text-dim)' }}>—</div>
                <div className="s-sub" style={{ color: 'var(--fail)' }}>Leiðrétta þarf váegi</div>
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
          <div className="s-lbl">Óskráð váegi</div>
          <div className="s-val" style={{ color: weightOver ? 'var(--fail)' : undefined }}>
            {fmt(Math.max(0, 100 - stats.totalWeight), 0)}
            <span className="s-unit">%</span>
          </div>
          <div className="s-sub" style={{ color: weightOver ? 'var(--fail)' : undefined }}>
            {weightOver ? 'váegi yfir 100%' : 'ekki skráð enn'}
          </div>
        </div>
      </div>

      {/* Weight error banner */}
      {stats.weightError && (
        <div className="weight-error">
          ⚠ Samanlagt váegi er {fmt(stats.weightError.total, 0)}%. Hámarkið er 100%. Lækkaðu váegi um {fmt(stats.weightError.excess, 0)}%.
        </div>
      )}

      {/* Progress — DO NOT CHANGE */}
      <div className="prog-wrap">
        <div className="prog-bar">
          <div className="pb pb-done" style={{ width: `${pctDone}%` }} />
          <div className="pb pb-pend" style={{ left: `${pctDone}%`, width: `${pctPend}%` }} />
        </div>
        <div className="prog-labels">
          <span style={{ color: 'var(--pass)' }}>Metið: {fmt(stats.completedWeight, 0)}%</span>
          <span>Skráð: {fmt(stats.totalWeight, 0)}%</span>
          <span>100%</span>
        </div>
      </div>

      {/* Rules panel — now includes lokaprófMin */}
      <RulesPanel
        assessments={course.assessments}
        bestOfRules={course.bestOfRules}
        onChange={updateBestOf}
        lokaprófMin={course.lokaprófMin}
        onLokaprófMinChange={updateLokaprófMin}
        lokaprófGrade={stats.lokaprófGrade}
      />

      {/* Grade calculator */}
      {showCalc && (
        <div className="calc-bar">
          <div className="calc-main-row">
            <span className="calc-lbl">Til að ná</span>
            <input
              className="calc-input"
              inputMode="decimal"
              value={targetGradeStr}
              onChange={e => setTargetGradeStr(e.target.value)}
              onBlur={e => {
                const v = parseNum(e.target.value)
                setTargetGradeStr(isNaN(v) ? '5' : String(Math.max(0, Math.min(10, v))))
              }}
            />
            <span className="calc-lbl">þarftu að meðaltali</span>
            {needed === null ? (
              <span className="calc-result done">Öll mat skráð ✓</span>
            ) : needed <= 0 ? (
              <span className="calc-result done">Þegar náð ✓</span>
            ) : needed > 10 ? (
              <span className="calc-result impossible">
                Ekki mögulegt
                {maxAchievable !== null && <span className="calc-max"> — hæst {fmt(maxAchievable)}</span>}
              </span>
            ) : (
              <>
                <span className="calc-result" style={{ color: gradeColor(needed) }}>{fmt(needed)}</span>
                <span className="calc-lbl">í eftirstandandi {fmt(ungradedWeight, 0)}%</span>
              </>
            )}
            {ungradedWeight > 0.01 && (
              <button
                className={`whatif-toggle${whatIf ? ' active' : ''}`}
                onClick={() => { setWhatIf(w => !w); setWhatIfStr('') }}
              >
                Hvað ef?
              </button>
            )}
          </div>

          {whatIf && ungradedWeight > 0.01 && (
            <div className="whatif-row">
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
              <span className="whatif-note">framreikningur — geymt ekki</span>
            </div>
          )}
        </div>
      )}

      {/* Desktop table */}
      <div className="table-wrap assess-tbl-wrap">
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

      {/* Mobile cards */}
      <div className="assess-cards-wrap">
        {course.assessments.length === 0 ? (
          <p className="empty-cards">Engar einkunnir skráðar — smelltu á „+ Bæta við mati"</p>
        ) : course.assessments.map(a => (
          <AssessmentCard
            key={a.id}
            a={a}
            isExcluded={stats.excluded.has(a.id)}
            onUpdate={updated => updateA(a.id, updated)}
            onDelete={() => deleteA(a.id)}
            onDuplicate={() => duplicateA(a.id)}
          />
        ))}
      </div>

      <button className="add-btn" onClick={addA}>+ Bæta við mati</button>
      <button className="print-btn" onClick={() => window.print()}>⎙ Prenta / Vista sem PDF</button>

      {/* Undo toast */}
      {undoItem && (
        <div className="undo-toast">
          <span>Mati eytt</span>
          <button className="undo-btn" onClick={handleUndo}>Afturkalla</button>
        </div>
      )}
    </div>
  )
}

// ── Login Screen ───────────────────────────────────────────────────
function LoginScreen({ onGuest }) {
  const [guestMode, setGuestMode] = useState(false)
  const [passcode, setPasscode] = useState('')
  const [passcodeError, setPasscodeError] = useState(false)

  function handlePasscode(e) {
    e.preventDefault()
    if (passcode === '9999') {
      onGuest()
    } else {
      setPasscodeError(true)
      setPasscode('')
    }
  }

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

        {guestMode ? (
          <form onSubmit={handlePasscode} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="lfield">
              <label className="lfield-lbl">Sláðu inn aðgangskóða</label>
              <input
                className={`lfield-inp${passcodeError ? ' inp-error' : ''}`}
                type="number"
                inputMode="numeric"
                placeholder="0000"
                value={passcode}
                autoFocus
                onChange={e => { setPasscode(e.target.value); setPasscodeError(false) }}
              />
              {passcodeError && <span style={{ fontSize: 12, color: 'var(--fail)', fontWeight: 600 }}>Rangur kóði — reyndu aftur</span>}
            </div>
            <button className="login-btn" type="submit">Staðfesta</button>
            <button className="guest-btn" type="button" onClick={() => { setGuestMode(false); setPasscode(''); setPasscodeError(false) }}>← Til baka</button>
          </form>
        ) : (
          <>
            <div className="login-notice">
              Innskráning með netfangi er í vinnslu. Notaðu gestaðgang í bili.
            </div>
            <button className="guest-btn guest-btn-primary" onClick={() => setGuestMode(true)}>
              Halda áfram sem gestur
            </button>
            <p className="login-storage-note">Gögn eru vistuð í þessum vafra eingöngu.</p>
          </>
        )}
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
  const [view, setView] = useState('course') // 'course' | 'overview'
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark')
  const [showImport, setShowImport] = useState(false)
  const [importToast, setImportToast] = useState(null)

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
    setActiveId(c.id)
    setView('course')
  }

  function handleImport(importedCourses, targetCourseId) {
    const COLORS = ['#3DDC97','#4f8ef7','#f97316','#a855f7','#ec4899','#eab308','#06b6d4','#f43f5e']
    let firstNewId = null

    setData(d => {
      if (targetCourseId) {
        // Append assessments to existing course
        const updated = d.courses.map(c => {
          if (c.id !== targetCourseId) return c
          const existing = c.assessments
          const newItems = importedCourses[0]?.assessments ?? []
          return { ...c, assessments: [...existing, ...newItems] }
        })
        return { ...d, courses: updated }
      }
      // Create new courses
      const newCourses = importedCourses.map((ic, i) => {
        const id = uid()
        if (i === 0) firstNewId = id
        return {
          id,
          name: ic.name,
          color: COLORS[(d.courses.length + i) % COLORS.length],
          assessments: ic.assessments,
          bestOfRules: ic.bestOfRules ?? {},
          lokaprófMin: ic.lokaprófMin ?? 5,
          improvementRules: ic.improvementRules ?? [],
        }
      })
      return { ...d, courses: [...d.courses, ...newCourses] }
    })

    const navId = targetCourseId ?? firstNewId
    if (navId) { setActiveId(navId); setView('course') }
    setShowImport(false)

    const label = targetCourseId
      ? 'Mati bætt við áfanga'
      : `${importedCourses.length === 1 ? importedCourses[0].name : `${importedCourses.length} áfangar`} flutt inn`
    setImportToast(label)
    setTimeout(() => setImportToast(null), 3500)
  }
  function deleteCourse(id) {
    if (data.courses.length <= 1) return
    const target = data.courses.find(c => c.id === id)
    const n = target?.assessments?.length ?? 0
    const msg = `Eyða áfanganum „${target?.name}"?\n\n${n > 0 ? `Allir ${n} matar í áfanganum verða einnig eytt.` : 'Áfanginn er tómur.'}`
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
          <button className="theme-toggle" onClick={() => setDark(d => !d)}>
            {dark ? 'Ljóst' : 'Dökkt'}
          </button>
          <span className="hdr-guest">Gestur</span>
          <button className="hdr-logout" onClick={() => setLoggedIn(false)}>Útskrá</button>
        </div>
      </header>

      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <div className="layout">
        <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
          {/* Overview nav item */}
          <div
            className={`c-item sb-overview${view === 'overview' ? ' active' : ''}`}
            onClick={() => { setView('overview'); setSidebarOpen(false) }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="1" y="1" width="5" height="5" rx="1" /><rect x="8" y="1" width="5" height="5" rx="1" />
              <rect x="1" y="8" width="5" height="5" rx="1" /><rect x="8" y="8" width="5" height="5" rx="1" />
            </svg>
            <span className="c-name" style={{ fontWeight: 600 }}>Yfirlit</span>
          </div>

          <div className="sb-divider" />

          <nav className="course-list">
            {data.courses.map(c => {
              const stats = calcCourse(c)
              const isActive = c.id === activeId && view === 'course'
              return (
                <div
                  key={c.id}
                  className={`c-item${isActive ? ' active' : ''}`}
                  onClick={() => { if (!isActive) { setActiveId(c.id); setView('course'); setSidebarOpen(false) } }}
                >
                  <span className="c-dot" style={{ background: c.color || '#3DDC97' }} />
                  {isActive ? (
                    <input
                      className="c-name-inline"
                      value={c.name}
                      onChange={e => renameCourse(c.id, e.target.value)}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                    />
                  ) : (
                    <span className="c-name">{c.name}</span>
                  )}
                  <span className="c-grade" style={{ color: gradeColor(stats.currentAvg) }}>
                    {stats.currentAvg !== null ? fmt(stats.currentAvg, 1) : '—'}
                  </span>
                  {data.courses.length > 1 && (
                    <button className="c-del" onClick={e => { e.stopPropagation(); deleteCourse(c.id) }}>×</button>
                  )}
                </div>
              )
            })}
          </nav>
          <button className="add-course-btn" onClick={addCourse}>+ Nýr áfangi</button>
          <button className="import-course-btn" onClick={() => setShowImport(true)}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M6.5 1v8M3 6.5l3.5 3.5L10 6.5" /><path d="M1 11h11" />
            </svg>
            Flytja inn
          </button>
        </aside>

        <main className="content">
          {view === 'overview' ? (
            <OverviewPage
              data={data}
              onSelect={id => { setActiveId(id); setView('course'); setSidebarOpen(false) }}
            />
          ) : activeCourse ? (
            <>
              <div className="title-row">
                <input
                  className="course-title-input"
                  value={activeCourse.name}
                  onChange={e => renameCourse(activeCourse.id, e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                />
              </div>
              <CoursePage course={activeCourse} onChange={updateCourse} />
            </>
          ) : null}
        </main>
      </div>

      {showImport && (
        <ImportWizard
          onClose={() => setShowImport(false)}
          onImport={handleImport}
          onManual={addCourse}
          existingCourses={data.courses}
        />
      )}

      {importToast && (
        <div className="import-success-toast">✓ {importToast}</div>
      )}
    </div>
  )
}

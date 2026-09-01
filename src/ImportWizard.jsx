import { useState, useRef, useEffect } from 'react'
import {
  extractPdfText, parseSyllabus, parseIcs,
  findDuplicates, fingerprintItem,
  IMPORT_ASSESSMENT_TYPES,
} from './importParsers'
import './import.css'

// ── Helpers ────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2) }
function parseNum(s) { return parseFloat(String(s ?? '').replace(',', '.')) }

// ── Drop zone ──────────────────────────────────────────────────────
function DropZone({ accept, onFile, children }) {
  const [over, setOver] = useState(false)
  const inputRef = useRef(null)

  function handleDrop(e) {
    e.preventDefault(); setOver(false)
    const f = e.dataTransfer?.files?.[0]
    if (f) onFile(f)
  }

  return (
    <div
      className={`drop-zone${over ? ' dz-over' : ''}`}
      role="button"
      tabIndex={0}
      aria-label="Veldu skrá"
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={e => { if (e.target.files?.[0]) onFile(e.target.files[0]) }}
      />
      {children}
    </div>
  )
}

// ── Weight meter ───────────────────────────────────────────────────
function WeightMeter({ items }) {
  const total = items
    .filter(i => i.selected)
    .reduce((s, a) => { const w = parseNum(a.weight); return s + (isNaN(w) ? 0 : w) }, 0)

  const bar = Math.min(total, 100)
  const status = total > 100.01 ? 'over' : total >= 99.9 ? 'exact' : 'under'

  return (
    <div className="weight-meter">
      <div className="wm-bar">
        <div className={`wm-fill wm-${status}`} style={{ width: `${bar}%` }} />
      </div>
      <div className="wm-labels">
        <span className={`wm-total wm-${status}`}>
          {status === 'over' ? '⚠ ' : status === 'exact' ? '✓ ' : ''}
          {total % 1 === 0 ? total : total.toFixed(1)}% váegi skráð
        </span>
        {status === 'under' && <span className="wm-hint">{(100 - total).toFixed(0)}% eftir</span>}
        {status === 'over'  && <span className="wm-hint">Hámarkið er 100% — leiðrétta þarf</span>}
      </div>
    </div>
  )
}

// ── Review row ─────────────────────────────────────────────────────
function ReviewRow({ item, onChange, onRemove }) {
  const w = parseNum(item.weight)
  const invalid = !isNaN(w) && (w < 0 || w > 100)

  const dupLabel = item._dupStatus === 'unchanged' ? 'Þegar flutt'
    : item._dupStatus === 'changed' ? 'Breytt'
    : null

  const confLabel = dupLabel
    ?? (item.confidence === 'sure' ? 'Öruggt' : 'Yfirfara')

  const confClass = dupLabel
    ? (item._dupStatus === 'unchanged' ? 'rv-badge-dim' : 'rv-badge-warn')
    : (item.confidence === 'sure' ? 'rv-badge-sure' : 'rv-badge-review')

  return (
    <div className={`rv-row${item.selected ? '' : ' rv-off'}${item._dupStatus === 'unchanged' ? ' rv-dup' : ''}`}>
      <input
        type="checkbox"
        className="rv-check"
        checked={item.selected !== false}
        onChange={e => onChange({ ...item, selected: e.target.checked })}
        aria-label="Taka með"
      />
      <select
        className="rv-type-sel"
        value={item.type}
        onChange={e => onChange({ ...item, type: e.target.value })}
        disabled={!item.selected}
      >
        {IMPORT_ASSESSMENT_TYPES.map(t => <option key={t}>{t}</option>)}
      </select>
      <input
        className="rv-name-inp"
        value={item.name}
        onChange={e => onChange({ ...item, name: e.target.value })}
        placeholder="Nafn mats"
        disabled={!item.selected}
      />
      <div className="rv-w-wrap">
        <input
          className={`rv-weight-inp${invalid ? ' rv-invalid' : ''}`}
          inputMode="decimal"
          value={item.weight}
          onChange={e => onChange({ ...item, weight: e.target.value })}
          placeholder="—"
          disabled={!item.selected}
        />
        {item.weight !== '' && <span className="rv-pct">%</span>}
      </div>
      <input
        className="rv-date-inp"
        type="date"
        value={item.date}
        onChange={e => onChange({ ...item, date: e.target.value })}
        disabled={!item.selected}
      />
      <span className={`rv-badge ${confClass}`}>{confLabel}</span>
      <button className="rv-del" onClick={onRemove} aria-label="Fjarlægja">×</button>
    </div>
  )
}

// ── Step 1 ─────────────────────────────────────────────────────────
function Step1Choose({ onParsed, onManual }) {
  const [tab, setTab]           = useState('syllabus')
  const [paste, setPaste]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  function setErr(msg) { setLoading(false); setError(msg) }

  async function handlePdf(file) {
    if (!file.name.match(/\.pdf$/i) && file.type !== 'application/pdf') {
      setErr('Aðeins PDF-skrár eru studdar hér.'); return
    }
    if (file.size > 25 * 1024 * 1024) {
      setErr('Skráin er of stór (hámark 25 MB).'); return
    }
    setLoading(true); setError(null)
    try {
      const text = await extractPdfText(file)
      if (!text || text.trim().length < 40) {
        setErr('Enginn texti fannst í PDF-skránni. Skráin gæti verið skönnuð — límdu textann handvirkt í stað þess.')
        return
      }
      onParsed([parseSyllabus(text)])
    } catch {
      setErr('Ekki tókst að opna skrána. Límdu textann handvirkt.')
    }
    setLoading(false)
  }

  function handlePaste() {
    if (!paste.trim()) { setError('Límdu kennsluáætlunina í reitinn hér að neðan.'); return }
    if (paste.trim().length < 30) { setError('Textinn virðist of stuttur til að greina.'); return }
    onParsed([parseSyllabus(paste)])
  }

  async function handleIcs(file) {
    if (!file.name.match(/\.ics$/i)) {
      setErr('Aðeins .ics dagatalsskrár eru studdar.'); return
    }
    setLoading(true); setError(null)
    try {
      const text = await file.text()
      if (!text.includes('BEGIN:VCALENDAR')) {
        setErr('Þetta lítur ekki út eins og gilt .ics dagatalsskrá. Prófaðu að flytja dagatalið aftur út úr Canvas.')
        return
      }
      const courses = parseIcs(text)
      const hasItems = courses.some(c => c.assessments.length > 0)
      if (!hasItems) {
        setErr('Engin mat eða skilafresti fundust í dagatalsskránni.')
        return
      }
      onParsed(courses)
    } catch {
      setErr('Ekki tókst að lesa dagatalsskrána. Reyndu aftur.')
    }
    setLoading(false)
  }

  return (
    <div className="wiz-step">
      <div className="wiz-tabs" role="tablist">
        {[['syllabus','Kennsluáætlun'],['ics','Canvas-dagatal'],['manual','Handvirkt']].map(([v,l]) => (
          <button
            key={v}
            role="tab"
            aria-selected={tab === v}
            className={`wiz-tab${tab === v ? ' wiz-tab-active' : ''}`}
            onClick={() => { setTab(v); setError(null) }}
          >{l}</button>
        ))}
      </div>

      {tab === 'syllabus' && (
        <div className="wiz-pane">
          <p className="wiz-hint">Hladdu upp kennsluáætlun sem PDF-skrá eða límdu textann handvirkt. Skráin er greind beint í vafranum — ekkert er sent á netið.</p>
          <DropZone accept=".pdf,application/pdf" onFile={handlePdf}>
            <span className="dz-icon">↑</span>
            <span className="dz-label">Dragðu PDF-skrá hingað eða smelltu til að velja</span>
            <span className="dz-sub">.pdf · Hámark 25 MB</span>
          </DropZone>
          <div className="wiz-or"><span>eða límdu textann</span></div>
          <textarea
            className="wiz-paste"
            rows={5}
            placeholder="Límdu kennsluáætlunina hér..."
            value={paste}
            onChange={e => { setPaste(e.target.value); setError(null) }}
          />
          {paste.trim().length > 0 && (
            <button className="wiz-btn-primary" onClick={handlePaste}>Greina texta →</button>
          )}
        </div>
      )}

      {tab === 'ics' && (
        <div className="wiz-pane">
          <div className="wiz-instructions">
            <p className="wiz-instr-title">Hvernig á að sækja Canvas-dagatal</p>
            <ol className="wiz-instr-list">
              <li>Opnaðu <strong>Canvas</strong> og veldu <strong>Dagatal</strong> í hliðarborðanum</li>
              <li>Smelltu á <strong>Dagatalfærsla</strong> neðst í hliðarborðanum (Calendar Feed)</li>
              <li>Smelltu á <strong>Hlaða niður</strong> eða opnaðu slóðina í nýrri flipu og vistaðu síðuna</li>
              <li>Hladdu þessari <code>.ics</code> skrá upp hér að neðan</li>
            </ol>
          </div>
          <DropZone accept=".ics,text/calendar" onFile={handleIcs}>
            <span className="dz-icon">📅</span>
            <span className="dz-label">Dragðu .ics skrána hingað eða smelltu til að velja</span>
            <span className="dz-sub">.ics · Canvas dagatalsskrá</span>
          </DropZone>
          <p className="wiz-privacy">🔒 Skráin er lesin eingöngu í vafranum þínum og er ekki send á netið.</p>
        </div>
      )}

      {tab === 'manual' && (
        <div className="wiz-pane wiz-pane-center">
          <p className="wiz-hint">Búðu til nýjan tóman áfanga og skráðu mat handvirkt.</p>
          <button className="wiz-btn-primary" onClick={onManual}>+ Búa til tóman áfanga</button>
        </div>
      )}

      {error && <div className="wiz-error" role="alert">{error}</div>}
      {loading && (
        <div className="wiz-loading" aria-live="polite">
          <span className="wiz-spinner" />
          Greini skrá…
        </div>
      )}
    </div>
  )
}

// ── Group row ──────────────────────────────────────────────────────
function GroupRow({ grp, onChange, onRemove }) {
  const totalW = parseNum(grp.totalWeight)
  const invalid = !isNaN(totalW) && (totalW < 0 || totalW > 100)
  const perItem = !isNaN(totalW) && grp.count > 0
    ? (totalW / (grp.bestOf ?? grp.count)).toFixed(2)
    : '—'

  return (
    <div className={`rv-row rv-group-row${grp.selected !== false ? '' : ' rv-off'}`}>
      <input
        type="checkbox"
        className="rv-check"
        checked={grp.selected !== false}
        onChange={e => onChange({ ...grp, selected: e.target.checked })}
        aria-label="Taka með"
      />
      <select
        className="rv-type-sel"
        value={grp.type}
        onChange={e => onChange({ ...grp, type: e.target.value })}
        disabled={!grp.selected}
      >
        {IMPORT_ASSESSMENT_TYPES.map(t => <option key={t}>{t}</option>)}
      </select>
      <input
        className="rv-name-inp"
        value={grp.name}
        onChange={e => onChange({ ...grp, name: e.target.value })}
        placeholder="Nafn hóps"
        disabled={!grp.selected}
      />
      <div className="rv-group-meta">
        <span className="rv-group-tag">
          {grp.count} stk. · {perItem}% hver
          {grp.bestOf ? ` · bestu ${grp.bestOf}` : ''}
        </span>
        <div className="rv-w-wrap">
          <input
            className={`rv-weight-inp${invalid ? ' rv-invalid' : ''}`}
            inputMode="decimal"
            value={grp.totalWeight}
            onChange={e => onChange({ ...grp, totalWeight: e.target.value })}
            placeholder="—"
            disabled={!grp.selected}
            style={{ width: '4rem' }}
          />
          <span className="rv-pct">%</span>
        </div>
      </div>
      <span className="rv-badge rv-badge-sure">Hópur</span>
      <button className="rv-del" onClick={onRemove} aria-label="Fjarlægja">×</button>
    </div>
  )
}

// ── Step 2 ─────────────────────────────────────────────────────────
function Step2Review({ courses, existingCourses, onBack, onNext }) {
  const [idx, setIdx] = useState(0)
  const [underConfirmed, setUnderConfirmed] = useState(false)
  const [edited, setEdited] = useState(() =>
    courses.map(c => ({
      ...c,
      groups: c.groups ?? [],
      assessments: findDuplicates(
        c.assessments,
        existingCourses.flatMap(ec => ec.assessments)
      ),
    }))
  )

  const course = edited[idx]

  function updateCourse(patch) {
    setEdited(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c))
    setUnderConfirmed(false)
  }

  function updateItem(id, patch) {
    updateCourse({
      assessments: course.assessments.map(a => a.id === id ? { ...a, ...patch } : a)
    })
  }

  function removeItem(id) {
    updateCourse({ assessments: course.assessments.filter(a => a.id !== id) })
  }

  function updateGroup(id, patch) {
    updateCourse({
      groups: course.groups.map(g => g.id === id ? { ...g, ...patch } : g)
    })
  }

  function removeGroup(id) {
    updateCourse({ groups: course.groups.filter(g => g.id !== id) })
  }

  function addItem() {
    updateCourse({
      assessments: [...course.assessments, {
        id: uid(), name: '', type: 'Heimadæmi',
        weight: '', date: '', confidence: 'review', selected: true,
        _importMeta: { source: 'manual', fingerprint: uid(), importedAt: new Date().toISOString() },
      }],
    })
  }

  // Total weight = groups + assessments (excluding improvement-only weight=0 ones)
  const selectedGroups = (course.groups ?? []).filter(g => g.selected !== false)
  const groupW = selectedGroups.reduce((s, g) => { const w = parseNum(g.totalWeight); return s + (isNaN(w) ? 0 : w) }, 0)
  const selected = course.assessments.filter(a => a.selected)
  const assessW = selected.reduce((s, a) => { const w = parseNum(a.weight); return s + (isNaN(w) ? 0 : w) }, 0)
  const totalW = groupW + assessW

  const overWeight  = totalW > 100.01
  const underWeight = totalW < 99 && (totalW > 0)
  const canNext = !overWeight && (!underWeight || underConfirmed)

  // Build fake items list for WeightMeter (groups contribute their totalWeight as items)
  const meterItems = [
    ...selectedGroups.map(g => ({ selected: true, weight: String(g.totalWeight) })),
    ...course.assessments,
  ]

  const hasGroups = (course.groups ?? []).length > 0
  const hasImprovementRule = course.rules?.improvementRule != null
  const hasMustPass = course.rules?.mustPassFinal

  return (
    <div className="wiz-step">
      {edited.length > 1 && (
        <div className="rv-course-tabs">
          {edited.map((c, i) => (
            <button
              key={i}
              className={`rv-ctab${i === idx ? ' active' : ''}`}
              onClick={() => setIdx(i)}
            >{c.courseName || `Áfangi ${i + 1}`}</button>
          ))}
        </div>
      )}

      {/* Course metadata */}
      <div className="rv-meta">
        <div className="rv-meta-row">
          <label className="rv-lbl">Nafn áfanga</label>
          <div className="rv-name-row">
            <input
              className={`rv-course-name${course.nameConfidence === 'review' ? ' rv-uncertain' : ''}`}
              value={course.courseName}
              onChange={e => updateCourse({ courseName: e.target.value })}
              placeholder="Nafn áfanga"
            />
            {course.courseCode && <span className="rv-code">{course.courseCode}</span>}
            {course.nameConfidence === 'review' && (
              <span className="rv-badge rv-badge-review">Yfirfara</span>
            )}
          </div>
        </div>

        {course.rules?.lokaprófMin != null && (
          <div className="rv-meta-row">
            <label className="rv-lbl">Lágmarkseinkunn í lokaprófi</label>
            <input
              className="rv-weight-inp rv-loka-inp"
              inputMode="decimal"
              value={course.rules.lokaprófMin ?? ''}
              onChange={e => {
                const v = parseFloat(e.target.value.replace(',', '.'))
                updateCourse({ rules: { ...course.rules, lokaprófMin: isNaN(v) ? null : v } })
              }}
            />
          </div>
        )}

        {hasMustPass && (
          <div className="rv-meta-row rv-rule-row">
            <span className="rv-rule-icon">⚠</span>
            <span className="rv-rule-text">Þarf að ná lokaprófi til að standast áfangann</span>
          </div>
        )}

        {hasImprovementRule && (
          <div className="rv-meta-row rv-rule-row">
            <span className="rv-rule-icon">↑</span>
            <span className="rv-rule-text">
              {course.rules.improvementRule.improveType} gildir aðeins ef það hækkar lokaeinkunn
              {course.rules.improvementRule.baseWeight != null
                ? ` (${course.rules.improvementRule.baseWeight}% + ${course.rules.improvementRule.improveWeight}% = ${course.rules.improvementRule.finalWeight}%)`
                : ''}
            </span>
          </div>
        )}
      </div>

      {/* Groups section */}
      {hasGroups && (
        <>
          <p className="rv-section-hdr">Matshópar</p>
          {course.groups.map(g => (
            <GroupRow
              key={g.id}
              grp={g}
              onChange={patch => updateGroup(g.id, patch)}
              onRemove={() => removeGroup(g.id)}
            />
          ))}
        </>
      )}

      {/* Assessment table header */}
      <p className="rv-section-hdr">{hasGroups ? 'Einstaklingsmat' : 'Mat'}</p>
      <div className="rv-tbl-hdr">
        <span className="rv-h-chk" />
        <span className="rv-h-type">Tegund</span>
        <span className="rv-h-name">Nafn</span>
        <span className="rv-h-w">Váegi</span>
        <span className="rv-h-date">Dagsetning</span>
        <span className="rv-h-conf" />
        <span className="rv-h-del" />
      </div>

      {course.assessments.length === 0 ? (
        <p className="rv-empty">Engar einkunnaritfærslur fundust — bættu þeim við handvirkt.</p>
      ) : (
        course.assessments.map(a => (
          <ReviewRow
            key={a.id}
            item={a}
            onChange={patch => updateItem(a.id, patch)}
            onRemove={() => removeItem(a.id)}
          />
        ))
      )}

      <button className="rv-add" onClick={addItem}>+ Bæta við mati</button>

      <WeightMeter items={meterItems} />

      {overWeight && (
        <p className="wiz-error">
          Heildarváegi er {totalW % 1 === 0 ? totalW : totalW.toFixed(1)}%. Hámarkið er 100% — leiðrétta þarf áður en hægt er að flytja inn.
        </p>
      )}

      {underWeight && !overWeight && (
        <label className="rv-under-confirm">
          <input
            type="checkbox"
            checked={underConfirmed}
            onChange={e => setUnderConfirmed(e.target.checked)}
          />
          <span>
            Heildarváegi er {totalW % 1 === 0 ? totalW : totalW.toFixed(1)}% — flytja inn þótt váegi sé óklárað
          </span>
        </label>
      )}

      <div className="wiz-nav">
        <button className="wiz-btn-sec" onClick={onBack}>← Til baka</button>
        <button
          className="wiz-btn-primary"
          onClick={() => onNext(edited)}
          disabled={!canNext}
        >Staðfesta →</button>
      </div>
    </div>
  )
}

// ── Step 3 ─────────────────────────────────────────────────────────
function Step3Confirm({ courses, existingCourses, onBack, onImport }) {
  const [targetMode, setTargetMode] = useState('new')
  const [targetId, setTargetId]     = useState(existingCourses[0]?.id ?? null)

  const totalA = courses.reduce((s, c) => s + c.assessments.filter(a => a.selected).length, 0)
  const multiCourse = courses.length > 1

  return (
    <div className="wiz-step">
      <div className="wiz-confirm-box">
        <span className="wiz-confirm-icon">✓</span>
        <div>
          <p className="wiz-confirm-title">Tilbúið til innflutnings</p>
          <p className="wiz-confirm-sub">
            {multiCourse
              ? `${courses.length} áfangar — ${totalA} mat`
              : `${courses[0]?.courseName || 'Áfangi'} — ${totalA} mat`}
          </p>
        </div>
      </div>

      {/* Course summary */}
      <div className="wiz-summary">
        {courses.map((c, i) => {
          const sel = c.assessments.filter(a => a.selected)
          if (sel.length === 0) return null
          const tw = sel.reduce((s, a) => { const w = parseNum(a.weight); return s + (isNaN(w) ? 0 : w) }, 0)
          return (
            <div key={i} className="wiz-sum-course">
              <span className="wiz-sum-name">{c.courseName}</span>
              <span className="wiz-sum-stats">{sel.length} mat · {tw % 1 === 0 ? tw : tw.toFixed(1)}% váegi</span>
            </div>
          )
        })}
      </div>

      {/* Target selection — only when one source course and existing courses exist */}
      {!multiCourse && existingCourses.length > 0 && (
        <div className="wiz-target">
          <label className="rv-lbl">Flytja inn sem</label>
          <div className="wiz-radio-group">
            <label className="wiz-radio">
              <input type="radio" name="target" value="new"
                checked={targetMode === 'new'}
                onChange={() => setTargetMode('new')}
              />
              <span>Nýr áfangi</span>
            </label>
            <label className="wiz-radio">
              <input type="radio" name="target" value="existing"
                checked={targetMode === 'existing'}
                onChange={() => setTargetMode('existing')}
              />
              <span>Bæta við áfanga sem er til</span>
            </label>
          </div>
          {targetMode === 'existing' && (
            <select
              className="wiz-target-sel"
              value={targetId ?? ''}
              onChange={e => setTargetId(e.target.value)}
            >
              {existingCourses.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="wiz-nav">
        <button className="wiz-btn-sec" onClick={onBack}>← Til baka</button>
        <button
          className="wiz-btn-primary"
          onClick={() => onImport(courses, targetMode === 'existing' ? targetId : null)}
          disabled={totalA === 0}
        >Flytja inn</button>
      </div>
    </div>
  )
}

// ── Main wizard ────────────────────────────────────────────────────
export function ImportWizard({ onClose, onImport, existingCourses, onManual }) {
  const [step, setStep]         = useState(1)
  const [parsed, setParsed]     = useState(null)
  const [reviewed, setReviewed] = useState(null)

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleParsed(courses) { setParsed(courses); setStep(2) }
  function handleReviewed(courses) { setReviewed(courses); setStep(3) }

  function handleImport(courses, targetCourseId) {
    const mapped = courses.map(rc => {
      const bestOfRules = { ...(rc.rules?.bestOf ?? {}) }

      // Expand groups into individual assessments
      const groupAssessments = []
      for (const grp of rc.groups ?? []) {
        if (grp.selected === false) continue
        const totalW = parseNum(grp.totalWeight)
        const count  = Math.max(1, parseInt(grp.count) || 1)
        const bestOf = grp.bestOf ? parseInt(grp.bestOf) : null
        const divisor = bestOf ?? count
        const perW = !isNaN(totalW) && divisor > 0 ? (totalW / divisor).toFixed(2) : ''
        if (bestOf) bestOfRules[grp.type] = bestOf
        for (let i = 1; i <= count; i++) {
          groupAssessments.push({
            id: uid(), type: grp.type,
            label: count > 1 ? `${grp.name} ${i}` : grp.name,
            grade: '', weight: perW, date: '',
            _importMeta: { ...grp._importMeta, groupId: grp.id },
          })
        }
      }

      // Individual assessments (weight '0' improvement-only ones become dedicated grade inputs)
      const indivAssessments = rc.assessments
        .filter(a => a.selected)
        .map(a => ({
          id: uid(), type: a.type,
          label: a.name,
          grade: '', weight: a.weight,
          date: a.date, _importMeta: a._importMeta,
        }))

      // Build improvement rules for the course model
      const improvRules = []
      const ir = rc.rules?.improvementRule
      if (ir) {
        improvRules.push({
          type: 'improvement',
          finalType: 'Lokapróf',
          improveType: ir.improveType,
          baseWeight: ir.baseWeight ?? null,
          improveWeight: ir.improveWeight ?? null,
        })
      }

      return {
        name: rc.courseName || 'Innfluttur áfangi',
        assessments: [...groupAssessments, ...indivAssessments],
        bestOfRules,
        lokaprófMin: rc.rules?.lokaprófMin ?? 5,
        improvementRules: improvRules,
      }
    })
    onImport(mapped, targetCourseId)
  }

  const STEP_LABELS = ['Velja gögn', 'Yfirfara', 'Flytja inn']

  return (
    <div
      className="import-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      aria-modal="true"
      role="dialog"
      aria-label="Flytja inn gögn"
    >
      <div className="import-modal">
        {/* Header */}
        <div className="import-hdr">
          <div className="import-steps">
            {STEP_LABELS.map((lbl, i) => {
              const n = i + 1
              const done   = n < step
              const active = n === step
              return (
                <span key={n} className={`ist${active ? ' ist-active' : done ? ' ist-done' : ''}`}>
                  <span className="ist-num">{done ? '✓' : n}</span>
                  <span className="ist-lbl">{lbl}</span>
                  {n < STEP_LABELS.length && <span className="ist-sep" />}
                </span>
              )
            })}
          </div>
          <button className="import-close" onClick={onClose} aria-label="Loka">×</button>
        </div>

        {/* Body */}
        <div className="import-body">
          {step === 1 && (
            <Step1Choose
              onParsed={handleParsed}
              onManual={() => { onClose(); onManual?.() }}
            />
          )}
          {step === 2 && parsed && (
            <Step2Review
              courses={parsed}
              existingCourses={existingCourses}
              onBack={() => setStep(1)}
              onNext={handleReviewed}
            />
          )}
          {step === 3 && reviewed && (
            <Step3Confirm
              courses={reviewed}
              existingCourses={existingCourses}
              onBack={() => setStep(2)}
              onImport={handleImport}
            />
          )}
        </div>
      </div>
    </div>
  )
}

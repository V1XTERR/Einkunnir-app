// importParsers.js
// All parsing is done locally in the browser.
// No document contents are sent to external services.

// ── Constants ──────────────────────────────────────────────────────
export const IMPORT_ASSESSMENT_TYPES = [
  'Lokapróf','Miðmisserisspróf','Hlutapróf','Smápróf',
  'Heimadæmi','Verkefni','Dæmatími','Stöðumat','Annað',
]

const TYPE_KEYWORDS = {
  'Lokapróf':         ['lokapróf', 'lokaprof', 'final exam', 'final examination'],
  'Miðmisserisspróf': ['miðmisseri', 'midterm', 'mid-term', 'midsemester'],
  'Hlutapróf':        ['hlutapróf', 'hlutaprof', 'quiz', 'quizzes', 'könnun', 'kannanir'],
  'Smápróf':          ['smápróf', 'smaprof', 'pop quiz'],
  'Heimadæmi':        ['heimadæmi', 'homework', 'home assignment'],
  'Verkefni':         ['verkefni', 'assignment', 'assignments', 'project', 'projects', 'ritgerð'],
  'Dæmatími':         ['dæmatími', 'tutorial', 'discussion section'],
  'Stöðumat':         ['stöðumat', 'þátttaka', 'mæting', 'participation', 'attendance'],
}

const SKIP_PATTERNS = [
  /^(?:bls?|page|hluti|kafli|chapter|section)\s*\.?\s*\d/i,
  /^(?:kennsla|tímar|vikur|vika|week|lecture)/i,
  /^\d+\s*(?:einingar|ects|credits)/i,
  /^(?:námskeið|course\s+id|kennitala|kennarar?)/i,
]

// ── Helpers ────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2) }

function parsePercent(s) {
  return parseFloat(String(s).replace(',', '.'))
}

export function detectType(text) {
  const lower = text.toLowerCase()
  if (/\bfinal\b/.test(lower) && !lower.includes('midterm')) {
    return 'Lokapróf'
  }
  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return type
    }
  }
  return 'Heimadæmi'
}

// ── Date normalizer ────────────────────────────────────────────────
const IS_MONTH_MAP = {
  jan:1,feb:2,mar:3,apr:4,maí:5,mai:5,jún:6,jun:6,
  júl:7,jul:7,ágú:8,agu:8,sep:9,okt:10,nóv:11,nov:11,des:12,
}
const EN_MONTH_MAP = {
  january:1,february:2,march:3,april:4,may:5,june:6,july:7,
  august:8,september:9,october:10,november:11,december:12,
  jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,
}

function normalizeDate(s) {
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const dmy = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`
  const is = s.match(/(\d{1,2})\.\s*(jan|feb|mar|apr|maí|mai|jún|jun|júl|jul|ágú|agu|sep|okt|nóv|nov|des)\w*\.?\s*(\d{4})/i)
  if (is) {
    const m = IS_MONTH_MAP[is[2].toLowerCase().slice(0,3)]
    if (m) return `${is[3]}-${String(m).padStart(2,'0')}-${is[1].padStart(2,'0')}`
  }
  const en1 = s.match(/(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2}),?\s*(\d{4})/i)
  if (en1) {
    const m = EN_MONTH_MAP[en1[1].toLowerCase().slice(0,3)]
    if (m) return `${en1[3]}-${String(m).padStart(2,'0')}-${en1[2].padStart(2,'0')}`
  }
  const en2 = s.match(/(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\w*\s+(\d{4})/i)
  if (en2) {
    const m = EN_MONTH_MAP[en2[2].toLowerCase().slice(0,3)]
    if (m) return `${en2[3]}-${String(m).padStart(2,'0')}-${en2[1].padStart(2,'0')}`
  }
  return ''
}

// ── Fingerprint ────────────────────────────────────────────────────
export function fingerprintItem({ name, date }) {
  const norm = `${(name || '').toLowerCase().replace(/\s+/g, '').replace(/[^a-záéíóúýðþæö0-9]/g, '')}-${date || ''}`
  let h = 0
  for (const c of norm) { h = Math.imul(31, h) + c.charCodeAt(0) | 0 }
  return String(Math.abs(h))
}

// ── PDF extraction ─────────────────────────────────────────────────
export async function extractPdfText(file) {
  const { getDocument, GlobalWorkerOptions, version } = await import('pdfjs-dist')
  // Worker script loads from CDN; the PDF document itself never leaves the browser
  GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`

  const buffer = await file.arrayBuffer()
  const pdf = await getDocument({ data: buffer }).promise

  let text = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const byY = {}
    for (const item of content.items) {
      if (!item.str) continue
      const y = Math.round(item.transform[5] / 4) * 4
      byY[y] = byY[y] ? byY[y] + ' ' + item.str : item.str
    }
    const ys = Object.keys(byY).map(Number).sort((a, b) => b - a)
    for (const y of ys) text += byY[y] + '\n'
  }
  return text.trim()
}

// ── Syllabus parser ────────────────────────────────────────────────
const ASSESS_PATTERNS = [
  /^(.{3,70}?)\s*[:\-–—]\s*(\d+(?:[.,]\d+)?)\s*%\s*(?:af\s+heildareinkunn)?/,
  /^(.{3,50})\s{2,}(\d+(?:[.,]\d+)?)\s*%\s*$/,
  /^(.{3,70}?)[.]{2,}\s*(\d+(?:[.,]\d+)?)\s*%/,
]

// Group line: "Name (N stk.): 30%" or "Homework (5 items): 25%"
const GROUP_LINE_RE = /^(.{2,50}?)\s*\(\s*(\d+)(?:\s+(?:stk\.?|items?|verkefni|dæmi|atriði|assignments?|labs?|quizzes?|próf|hlutapróf|smápróf|skiladæmi)\.?)?\s*\)\s*[:\-–—]\s*(\d+(?:[.,]\d+)?)\s*%/i

// Improvement marker: "aðeins ef það hækkar" or "only if it improves"
const IMPROVE_RE = /aðeins\s+ef\s+(?:það\s+)?hækkar(?:\s+einkunnina)?|only\s+if\s+(?:it\s+)?improves?(?:\s+(?:the\s+)?grade)?/i

// Must pass final exam
const MUST_PASS_RE = /(?:þarf\s+að\s+(?:lúka|ná|standast)\s+(?:lokaprófi?|prófinum?))|(?:must\s+(?:pass|complete)\s+(?:the\s+)?(?:final|exam))/i

// Informational percentage describing a portion of the exam (not a standalone course weight)
const INFORMATIONAL_SUFFIX_RE = /\d+(?:[.,]\d+)?%\s+(?:er\s+)?af\s+(?:lokaprófi?|prófinu|prófi)\b/i

const COURSE_CODE_RE = /\b([A-ZÁÉÍÓÚÝÐÞÆÖ]{2,5}\d{3}[A-Z]?(?:-[A-Z0-9]+)?)\b/
const BEST_OF_RE    = /(?:bestu|hæstu|best)\s+(\d+)\s+(?:af|of)\s+(\d+)/i
const MIN_LOKA_RE   = /(?:lágmarkseinkunn\s+(?:í\s+)?(?:lokaprófi?|final)?|minimum\s+(?:final\s+)?(?:exam\s+)?grade)[:\s]+(\d+(?:[.,]\d+)?)/i
const DATE_IN_LINE  = /(\d{1,2}[./]\d{1,2}[./]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\.\s*(?:jan|feb|mar|apr|maí|jún|júl|ágú|sep|okt|nóv|des)\w*\.?\s*\d{4})/i

export function parseSyllabus(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 1)

  // ── Detect course name and code ──
  let courseName = ''
  let courseCode = ''
  let nameConfidence = 'review'

  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    const line = lines[i]
    if (!courseCode) {
      const cm = line.match(COURSE_CODE_RE)
      if (cm) courseCode = cm[1]
    }
    if (/^(?:áfangi|námskeið|course|subject|course\s*name|course\s*title|heiti)\s*[:\s]/i.test(line)) {
      const rest = line.replace(/^[^\s:]+\s*[:\s]\s*/, '').trim()
      if (rest.length > 2 && rest.length < 100) {
        courseName = rest
        nameConfidence = 'sure'
        break
      }
    }
  }

  if (!courseName) {
    for (const line of lines.slice(0, 8)) {
      if (line.length < 5 || line.length > 100) continue
      if (/^\d+/.test(line)) continue
      if (ASSESS_PATTERNS.some(p => p.test(line))) continue
      if (GROUP_LINE_RE.test(line)) continue
      if (SKIP_PATTERNS.some(p => p.test(line))) continue
      courseName = line
      nameConfidence = 'review'
      break
    }
  }

  if (courseCode && courseName.includes(courseCode)) {
    courseName = courseName.replace(courseCode, '').replace(/^[\s\-–—():]+|[\s\-–—():]+$/g, '').trim()
  }

  // ── Multi-pass parsing ──
  const assessments = []
  const groups      = []
  const informational = []
  const unresolved  = []
  let lokaprófMin   = null
  let mustPassFinal = false
  let improvementRule = null
  const bestOfRules = {}
  const seen        = new Set()

  for (const line of lines) {
    if (line.length < 4) continue
    if (/^[-=_*#▪●·•]{3,}$/.test(line)) continue
    if (SKIP_PATTERNS.some(p => p.test(line))) continue

    // Minimum final exam grade
    const minM = line.match(MIN_LOKA_RE)
    if (minM) {
      const v = parsePercent(minM[1])
      if (!isNaN(v) && v >= 0 && v <= 10) lokaprófMin = v
      continue
    }

    // Must-pass final exam
    if (MUST_PASS_RE.test(line)) {
      mustPassFinal = true
      unresolved.push({ type: 'mustPassFinal', description: 'Þarf að ná lokaprófi', evidence: line })
      continue
    }

    // Best-of rule
    const bestM = line.match(BEST_OF_RE)
    if (bestM) {
      const n = parseInt(bestM[1])
      const total = parseInt(bestM[2])
      const type = detectType(line)
      if (n < total && type !== 'Annað') {
        bestOfRules[type] = n
        const grp = groups.find(g => g.type === type)
        if (grp && grp.bestOf === null) grp.bestOf = n
      }
      continue
    }

    // Informational percentage (e.g. "25% af prófi" — a proportion of exam, not a course weight)
    if (INFORMATIONAL_SUFFIX_RE.test(line)) {
      informational.push({ text: line, evidence: line })
      continue
    }

    // Standalone improvement marker (no percentage on this line)
    if (IMPROVE_RE.test(line) && !/\d+(?:[.,]\d+)?%/.test(line)) {
      if (assessments.length > 0) {
        const last = assessments[assessments.length - 1]
        last.improvementOnly = true
        if (!improvementRule && last.type === 'Miðmisserisspróf') {
          const iw = parsePercent(last.weight)
          improvementRule = {
            improveType: last.type,
            improveWeight: isNaN(iw) ? null : iw,
            finalWeight: null, baseWeight: null,
            evidence: line,
          }
          unresolved.push({
            type: 'improvementRule',
            description: `${last.name} gildir aðeins ef það hækkar lokaeinkunn`,
            evidence: line,
          })
        }
      }
      continue
    }

    // ── Group line (e.g. "Heimadæmi (10 stk.): 10%") ──
    const grpM = line.match(GROUP_LINE_RE)
    if (grpM) {
      const rawName = grpM[1].trim().replace(/^[•●·▪\-–—*]+\s*/, '')
      const count   = parseInt(grpM[2])
      const pct     = parsePercent(grpM[3])
      if (!isNaN(pct) && pct >= 1 && pct <= 100 && rawName.length >= 2 && count >= 2) {
        const type = detectType(rawName)
        const grp = {
          id: uid(), name: rawName, type,
          totalWeight: pct, count,
          bestOf: bestOfRules[type] ?? null,
          selected: true,
          evidence: line,
          _importMeta: {
            source: 'syllabus',
            fingerprint: fingerprintItem({ name: rawName, date: '' }),
            importedAt: new Date().toISOString(),
          },
        }
        groups.push(grp)
        continue
      }
    }

    // ── Individual assessment line ──
    let matched = null
    for (const pattern of ASSESS_PATTERNS) {
      const m = line.match(pattern)
      if (m) { matched = m; break }
    }
    if (!matched) continue

    const rawName = matched[1].trim().replace(/^[•●·▪\-–—*]+\s*/, '')
    const pct     = parsePercent(matched[2])

    if (isNaN(pct) || pct < 1 || pct > 100) continue
    if (rawName.length < 2) continue
    if (SKIP_PATTERNS.some(p => p.test(rawName))) continue

    const key = rawName.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) continue
    seen.add(key)

    const type    = detectType(rawName)
    const dateM   = line.match(DATE_IN_LINE)
    const date    = dateM ? normalizeDate(dateM[0]) : ''
    const hasImprovementMarker = IMPROVE_RE.test(line)

    const assessment = {
      id: uid(), name: rawName, type,
      weight: String(pct), date, confidence: 'sure',
      selected: true, evidence: line,
      _importMeta: {
        source: 'syllabus',
        fingerprint: fingerprintItem({ name: rawName, date }),
        importedAt: new Date().toISOString(),
      },
    }

    if (hasImprovementMarker) {
      assessment.improvementOnly = true
      if (!improvementRule && type === 'Miðmisserisspróf') {
        improvementRule = {
          improveType: type,
          improveWeight: pct,
          finalWeight: null, baseWeight: null,
          evidence: line,
        }
        unresolved.push({
          type: 'improvementRule',
          description: `${rawName} (${pct}%) gildir aðeins ef það hækkar lokaeinkunn`,
          evidence: line,
        })
      }
    }

    assessments.push(assessment)
  }

  // Post-process: fill improvementRule base/final weights from lokapróf assessment
  if (improvementRule) {
    const loka = assessments.find(a => a.type === 'Lokapróf')
    if (loka) {
      const total = parsePercent(loka.weight)
      const iw    = improvementRule.improveWeight
      if (!isNaN(total) && !isNaN(iw) && total >= iw) {
        improvementRule.finalWeight = total
        improvementRule.baseWeight  = total - iw
      }
    }
    // Mark the improvementOnly assessment with weight '0' so totalWeight stays correct
    for (const a of assessments) {
      if (a.improvementOnly) a.weight = '0'
    }
  }

  return {
    courseName: courseName || 'Innfluttur áfangi',
    courseCode,
    nameConfidence,
    assessments,
    groups,
    informational,
    unresolved,
    rules: { lokaprófMin, bestOf: bestOfRules, mustPassFinal, improvementRule },
  }
}

// ── ICS parser ─────────────────────────────────────────────────────
function unfoldIcs(text) {
  return text
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '')
}

function parseIcsDate(val) {
  const clean = val.includes(':') ? val.split(':').slice(1).join(':') : val
  const m = clean.match(/^(\d{4})(\d{2})(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}

function mapIcsType(title) {
  const lower = title.toLowerCase()
  if (/\bfinal\s+exam\b|\blokapróf\b/.test(lower)) return 'Lokapróf'
  if (/\bmidterm\b|\bmiðmisseri\b/.test(lower))     return 'Miðmisserisspróf'
  if (/\bquiz\b|\bkönnun\b|\bhlutapróf\b/.test(lower)) return 'Hlutapróf'
  if (/\bhomework\b|\bheimedæmi\b/.test(lower))     return 'Heimadæmi'
  if (/\bassignment\b|\bverkefni\b|\bproject\b/.test(lower)) return 'Verkefni'
  if (/\bparticipation\b|\bmæting\b|\bþátttaka\b/.test(lower)) return 'Stöðumat'
  return 'Heimadæmi'
}

function cleanIcsText(s) {
  return (s || '').replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim()
}

export function parseIcs(text) {
  const unfolded = unfoldIcs(text)
  const lines = unfolded.split('\n')

  let calName = ''
  const events = []
  let cur = null

  for (const rawLine of lines) {
    const colon = rawLine.indexOf(':')
    if (colon === -1) continue
    const rawKey = rawLine.slice(0, colon)
    const val = rawLine.slice(colon + 1)
    const keyBase = rawKey.split(';')[0].toUpperCase().trim()

    if (keyBase === 'BEGIN' && val.trim() === 'VEVENT') { cur = {}; continue }
    if (keyBase === 'END'   && val.trim() === 'VEVENT') { if (cur) events.push(cur); cur = null; continue }
    if (keyBase === 'X-WR-CALNAME') calName = cleanIcsText(val)

    if (!cur) continue

    switch (keyBase) {
      case 'SUMMARY':       cur.title        = cleanIcsText(val); break
      case 'DTSTART':       cur.date         = parseIcsDate(rawLine.slice(rawLine.indexOf(':') + 1)); break
      case 'UID':           cur.uid          = val.trim(); break
      case 'DESCRIPTION':   cur.description  = cleanIcsText(val); break
      case 'LAST-MODIFIED': cur.lastModified = val.trim(); break
      default: break
    }
  }

  const usable = events.filter(e => e.title && e.date)

  const groupsMap = {}
  for (const ev of usable) {
    const bracketM = ev.title.match(/\[([A-ZÁÉÍÓÚÝÐÞÆÖ]{2,5}\d{3}[A-Z]?)\]/)
    const groupKey = bracketM ? bracketM[1] : (calName || 'Dagatal')
    if (!groupsMap[groupKey]) groupsMap[groupKey] = []
    groupsMap[groupKey].push(ev)
  }

  return Object.entries(groupsMap).map(([groupName, evs]) => {
    const assessments = evs.map(ev => {
      const title = ev.title
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\s+/g, ' ').trim()

      return {
        id: uid(),
        name: title,
        type: mapIcsType(title),
        weight: '',
        date: ev.date,
        confidence: 'review',
        selected: true,
        _importMeta: {
          source: 'ics',
          uid: ev.uid || '',
          fingerprint: fingerprintItem({ name: title, date: ev.date }),
          importedAt: new Date().toISOString(),
        },
      }
    })

    const code = groupName.match(COURSE_CODE_RE)?.[1] || ''
    return {
      courseName: groupName,
      courseCode: code,
      nameConfidence: 'review',
      assessments,
      groups: [],
      informational: [],
      unresolved: [],
      rules: { lokaprófMin: null, bestOf: {}, mustPassFinal: false, improvementRule: null },
    }
  })
}

// ── Duplicate detection ────────────────────────────────────────────
export function findDuplicates(incoming, existing) {
  return incoming.map(inc => {
    const incFp  = inc._importMeta?.fingerprint
    const incUid = inc._importMeta?.uid

    const match = existing.find(ex => {
      if (incUid && ex._importMeta?.uid && incUid === ex._importMeta.uid) return true
      if (incFp  && ex._importMeta?.fingerprint === incFp) return true
      return false
    })

    if (!match) return { ...inc, _dupStatus: 'new' }

    const changed = match.label !== inc.name || match.date !== inc.date || match.type !== inc.type
    return { ...inc, _dupStatus: changed ? 'changed' : 'unchanged', _existingId: match.id }
  })
}

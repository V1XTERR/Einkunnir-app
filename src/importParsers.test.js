import { describe, it, expect } from 'vitest'
import { parseSyllabus, parseIcs, findDuplicates, fingerprintItem, detectType } from './importParsers'

// ── parseSyllabus ──────────────────────────────────────────────────
describe('parseSyllabus', () => {
  it('extracts Icelandic assessments with colon separator', () => {
    const text = `
TÖL101G Tölvunarfræði 1

Einkunnagjöf:
Heimadæmi: 25%
Hlutaprófar: 30%
Lokapróf: 45%
`
    const r = parseSyllabus(text)
    expect(r.assessments).toHaveLength(3)
    expect(r.assessments[0].name).toContain('Heimadæmi')
    expect(r.assessments[0].weight).toBe('25')
    expect(r.assessments[0].type).toBe('Heimadæmi')
    expect(r.assessments[2].type).toBe('Lokapróf')
    expect(r.assessments[2].weight).toBe('45')
  })

  it('extracts English assessments with dash separator', () => {
    const text = `
Course: Introduction to Computer Science

Grading:
Homework - 25%
Midterm Exam - 25%
Final Exam - 50%
`
    const r = parseSyllabus(text)
    expect(r.assessments.length).toBeGreaterThanOrEqual(3)
    const midterm = r.assessments.find(a => a.name.toLowerCase().includes('midterm'))
    expect(midterm).toBeDefined()
    expect(midterm.type).toBe('Miðmisserisspróf')
    const final = r.assessments.find(a => a.type === 'Lokapróf')
    expect(final).toBeDefined()
    expect(final.weight).toBe('50')
  })

  it('handles comma-decimal percentages', () => {
    const text = 'Verkefni: 33,5%\nHeimedæmi: 16,5%\nLokapróf: 50%'
    const r = parseSyllabus(text)
    expect(r.assessments[0].weight).toBe('33.5')
    expect(r.assessments[1].weight).toBe('16.5')
  })

  it('handles period-decimal percentages', () => {
    const text = 'Verkefni: 33.5%\nLokapróf: 66.5%'
    const r = parseSyllabus(text)
    expect(r.assessments[0].weight).toBe('33.5')
    expect(r.assessments[1].weight).toBe('66.5')
  })

  it('handles table format (space-separated)', () => {
    const text = `
Einkunnagjöf          Þyngd
Verkefni              30%
Miðmisserisspróf      20%
Lokapróf              50%
`
    const r = parseSyllabus(text)
    expect(r.assessments.length).toBeGreaterThanOrEqual(3)
    const loka = r.assessments.find(a => a.type === 'Lokapróf')
    expect(loka).toBeDefined()
    expect(loka.weight).toBe('50')
  })

  it('extracts best-X-of-Y rule', () => {
    const text = `
Heimadæmi (5 stk.): 25%
Bestu 4 af 5 heimadæmum gilda.
Lokapróf: 75%
`
    const r = parseSyllabus(text)
    expect(r.rules.bestOf['Heimadæmi']).toBe(4)
  })

  it('extracts English best-of rule', () => {
    const text = `
Homework (5 items): 25%
Best 3 of 5 homework count.
Final Exam: 75%
`
    const r = parseSyllabus(text)
    expect(r.rules.bestOf['Heimadæmi']).toBe(3)
  })

  it('extracts final-exam minimum grade', () => {
    const text = `
Lokapróf: 50%
Lágmarkseinkunn í lokaprófi: 5
`
    const r = parseSyllabus(text)
    expect(r.rules.lokaprófMin).toBe(5)
  })

  it('extracts final-exam minimum with comma decimal', () => {
    const text = `
Final Exam: 50%
Minimum final exam grade: 5,5
`
    const r = parseSyllabus(text)
    expect(r.rules.lokaprófMin).toBe(5.5)
  })

  it('returns empty assessments for text with no percentages', () => {
    const text = 'Þetta er kennsluáætlun án einkunnagjafar. Engar prósentutölur.\nLes bók kafla eitt til þrjú.'
    const r = parseSyllabus(text)
    expect(r.assessments).toHaveLength(0)
  })

  it('skips weights above 100 and below 1', () => {
    const text = `
Lokapróf: 150%
Heimadæmi: 0%
Verkefni: 50%
`
    const r = parseSyllabus(text)
    expect(r.assessments).toHaveLength(1)
    expect(r.assessments[0].weight).toBe('50')
  })

  it('deduplicates assessments with the same name', () => {
    const text = `
Heimadæmi: 25%
Heimadæmi: 25%
Lokapróf: 50%
`
    const r = parseSyllabus(text)
    const hd = r.assessments.filter(a => a.name === 'Heimadæmi')
    expect(hd).toHaveLength(1)
  })

  it('detects course code', () => {
    const text = 'TÖL101G - Tölvunarfræði 1\n\nLokapróf: 100%'
    const r = parseSyllabus(text)
    expect(r.courseCode).toBe('TÖL101G')
  })

  it('marks all assessments as selected by default', () => {
    const text = 'Heimadæmi: 25%\nLokapróf: 75%'
    const r = parseSyllabus(text)
    expect(r.assessments.every(a => a.selected)).toBe(true)
  })

  it('never creates grade values', () => {
    const text = 'Lokapróf: 50%\nHeimedæmi: 50%'
    const r = parseSyllabus(text)
    for (const a of r.assessments) {
      expect(a.grade).toBeUndefined()
    }
  })
})

// ── parseIcs ───────────────────────────────────────────────────────
describe('parseIcs', () => {
  const SAMPLE_ICS = `BEGIN:VCALENDAR
X-WR-CALNAME:TÖL101G
VERSION:2.0
BEGIN:VEVENT
SUMMARY:Final Exam
DTSTART:20240515T120000Z
UID:exam-001@canvas.instructure.com
END:VEVENT
BEGIN:VEVENT
SUMMARY:Homework 1
DTSTART:20240301T235900Z
UID:hw-001@canvas.instructure.com
END:VEVENT
BEGIN:VEVENT
SUMMARY:Midterm Exam
DTSTART:20240320T100000Z
UID:mid-001@canvas.instructure.com
END:VEVENT
END:VCALENDAR`

  it('parses a valid Canvas .ics file', () => {
    const courses = parseIcs(SAMPLE_ICS)
    expect(courses.length).toBeGreaterThanOrEqual(1)
    const allA = courses.flatMap(c => c.assessments)
    expect(allA.length).toBe(3)
  })

  it('maps Final Exam to Lokapróf', () => {
    const courses = parseIcs(SAMPLE_ICS)
    const allA = courses.flatMap(c => c.assessments)
    const exam = allA.find(a => a.name.toLowerCase().includes('final'))
    expect(exam?.type).toBe('Lokapróf')
  })

  it('maps Midterm to Miðmisserisspróf', () => {
    const courses = parseIcs(SAMPLE_ICS)
    const allA = courses.flatMap(c => c.assessments)
    const mid = allA.find(a => a.name.toLowerCase().includes('midterm'))
    expect(mid?.type).toBe('Miðmisserisspróf')
  })

  it('parses dates correctly', () => {
    const courses = parseIcs(SAMPLE_ICS)
    const allA = courses.flatMap(c => c.assessments)
    const exam = allA.find(a => a.name.toLowerCase().includes('final'))
    expect(exam?.date).toBe('2024-05-15')
  })

  it('stores UID in _importMeta', () => {
    const courses = parseIcs(SAMPLE_ICS)
    const allA = courses.flatMap(c => c.assessments)
    const exam = allA.find(a => a.name.toLowerCase().includes('final'))
    expect(exam?._importMeta?.uid).toBe('exam-001@canvas.instructure.com')
  })

  it('leaves weight empty (no invented weights)', () => {
    const courses = parseIcs(SAMPLE_ICS)
    const allA = courses.flatMap(c => c.assessments)
    for (const a of allA) {
      expect(a.weight).toBe('')
    }
  })

  it('returns [] for empty VCALENDAR', () => {
    const empty = 'BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR'
    const courses = parseIcs(empty)
    expect(courses.flatMap(c => c.assessments)).toHaveLength(0)
  })

  it('does not crash on malformed .ics', () => {
    expect(() => parseIcs('garbage data that is not ics format')).not.toThrow()
  })

  it('handles RFC 5545 line folding', () => {
    const folded = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Long assignment title that is fold
 ed across two lines
DTSTART:20240401T120000Z
UID:fold-001@test.com
END:VEVENT
END:VCALENDAR`
    const courses = parseIcs(folded)
    const allA = courses.flatMap(c => c.assessments)
    expect(allA[0].name).toContain('Long assignment title')
  })

  it('groups events by X-WR-CALNAME', () => {
    const courses = parseIcs(SAMPLE_ICS)
    expect(courses[0].courseName).toBe('TÖL101G')
  })
})

// ── findDuplicates ─────────────────────────────────────────────────
describe('findDuplicates', () => {
  const existing = [
    { id: 'e1', label: 'Heimadæmi 1', date: '2024-03-01', type: 'Heimadæmi',
      _importMeta: { uid: 'hw-001@canvas.com', fingerprint: '111' } },
  ]

  it('marks new items as "new"', () => {
    const inc = [{ id: 'i1', name: 'Lokapróf', date: '2024-05-15', type: 'Lokapróf',
      _importMeta: { uid: 'exam-001@canvas.com', fingerprint: '999' } }]
    const result = findDuplicates(inc, existing)
    expect(result[0]._dupStatus).toBe('new')
  })

  it('detects duplicate by UID', () => {
    const inc = [{ id: 'i2', name: 'Heimadæmi 1', date: '2024-03-01', type: 'Heimadæmi',
      _importMeta: { uid: 'hw-001@canvas.com', fingerprint: '222' } }]
    const result = findDuplicates(inc, existing)
    expect(result[0]._dupStatus).toBe('unchanged')
  })

  it('detects duplicate by fingerprint', () => {
    const inc = [{ id: 'i3', name: 'Heimadæmi 1', date: '2024-03-01', type: 'Heimadæmi',
      _importMeta: { uid: 'different-uid@canvas.com', fingerprint: '111' } }]
    const result = findDuplicates(inc, existing)
    expect(result[0]._dupStatus).toBe('unchanged')
  })

  it('marks changed event as "changed"', () => {
    const inc = [{ id: 'i4', name: 'Heimadæmi 1 - Breytt', date: '2024-03-05', type: 'Heimadæmi',
      _importMeta: { uid: 'hw-001@canvas.com', fingerprint: '111' } }]
    const result = findDuplicates(inc, existing)
    expect(result[0]._dupStatus).toBe('changed')
  })

  it('handles empty existing array', () => {
    const inc = [{ id: 'i5', name: 'Test', date: '2024-01-01', type: 'Verkefni',
      _importMeta: { uid: 'x', fingerprint: '0' } }]
    const result = findDuplicates(inc, [])
    expect(result[0]._dupStatus).toBe('new')
  })
})

// ── fingerprintItem ────────────────────────────────────────────────
describe('fingerprintItem', () => {
  it('returns a stable string for the same input', () => {
    const a = fingerprintItem({ name: 'Lokapróf', date: '2024-05-15' })
    const b = fingerprintItem({ name: 'Lokapróf', date: '2024-05-15' })
    expect(a).toBe(b)
  })

  it('returns different strings for different names', () => {
    const a = fingerprintItem({ name: 'Heimadæmi', date: '2024-03-01' })
    const b = fingerprintItem({ name: 'Lokapróf',  date: '2024-03-01' })
    expect(a).not.toBe(b)
  })

  it('returns different strings for different dates', () => {
    const a = fingerprintItem({ name: 'Heimadæmi', date: '2024-03-01' })
    const b = fingerprintItem({ name: 'Heimadæmi', date: '2024-04-01' })
    expect(a).not.toBe(b)
  })

  it('handles missing values without throwing', () => {
    expect(() => fingerprintItem({})).not.toThrow()
    expect(() => fingerprintItem({ name: 'Test' })).not.toThrow()
  })
})

// ── detectType ─────────────────────────────────────────────────────
describe('detectType', () => {
  it('detects lokapróf', () => { expect(detectType('Lokapróf')).toBe('Lokapróf') })
  it('detects final exam', () => { expect(detectType('Final Exam')).toBe('Lokapróf') })
  it('detects midterm', () => { expect(detectType('Midterm Exam')).toBe('Miðmisserisspróf') })
  it('detects quiz', () => { expect(detectType('Weekly Quiz')).toBe('Hlutapróf') })
  it('detects homework', () => { expect(detectType('Homework 3')).toBe('Heimadæmi') })
  it('detects assignment', () => { expect(detectType('Programming Assignment')).toBe('Verkefni') })
  it('detects participation', () => { expect(detectType('Participation grade')).toBe('Stöðumat') })
  it('defaults to Heimadæmi for unknown', () => { expect(detectType('Something else')).toBe('Heimadæmi') })
})

// ── parseSyllabus — regression: group detection ─────────────────────
describe('parseSyllabus group detection', () => {
  const TOLVU_SYLLABUS = `
TÖL102G Tölvutækni og forritun

Einkunnagjöf:
Heimadæmi (10 stk.): 10%
Bestu 8 af 10 heimadæmum gilda.
Verkefni (3 stk.): 15%
Miðmisserisspróf: 20% - aðeins ef það hækkar einkunnina
Lokapróf: 75%
25% af prófi er miðmisserisspróf þegar M > L
Þarf að ná lokaprófi til að standast áfangann.
`

  it('detects two groups', () => {
    const r = parseSyllabus(TOLVU_SYLLABUS)
    expect(r.groups).toHaveLength(2)
  })

  it('first group is Heimadæmi with count 10 and weight 10', () => {
    const r = parseSyllabus(TOLVU_SYLLABUS)
    const hd = r.groups.find(g => g.type === 'Heimadæmi')
    expect(hd).toBeDefined()
    expect(hd.count).toBe(10)
    expect(hd.totalWeight).toBe(10)
  })

  it('associates bestOf with Heimadæmi group', () => {
    const r = parseSyllabus(TOLVU_SYLLABUS)
    const hd = r.groups.find(g => g.type === 'Heimadæmi')
    expect(hd?.bestOf).toBe(8)
  })

  it('also sets bestOfRules for Heimadæmi', () => {
    const r = parseSyllabus(TOLVU_SYLLABUS)
    expect(r.rules.bestOf['Heimadæmi']).toBe(8)
  })

  it('second group is Verkefni with count 3 and weight 15', () => {
    const r = parseSyllabus(TOLVU_SYLLABUS)
    const vk = r.groups.find(g => g.type === 'Verkefni')
    expect(vk).toBeDefined()
    expect(vk.count).toBe(3)
    expect(vk.totalWeight).toBe(15)
  })

  it('groups are not in assessments', () => {
    const r = parseSyllabus(TOLVU_SYLLABUS)
    const types = r.assessments.map(a => a.type)
    // Heimadæmi and Verkefni are in groups, not individual assessments
    expect(types).not.toContain('Verkefni')
    // (Heimadæmi may appear as Miðmisserisspróf detection won't create one)
  })

  it('detects lokapróf as individual assessment', () => {
    const r = parseSyllabus(TOLVU_SYLLABUS)
    const loka = r.assessments.find(a => a.type === 'Lokapróf')
    expect(loka).toBeDefined()
    expect(loka.weight).toBe('75')
  })

  it('detects midterm as improvementOnly', () => {
    const r = parseSyllabus(TOLVU_SYLLABUS)
    const mid = r.assessments.find(a => a.type === 'Miðmisserisspróf')
    expect(mid).toBeDefined()
    expect(mid.improvementOnly).toBe(true)
  })

  it('sets improvementOnly midterm weight to 0', () => {
    const r = parseSyllabus(TOLVU_SYLLABUS)
    const mid = r.assessments.find(a => a.type === 'Miðmisserisspróf')
    expect(mid?.weight).toBe('0')
  })

  it('does not include informational percentage as assessment', () => {
    const r = parseSyllabus(TOLVU_SYLLABUS)
    // "25% af prófi" line should go to informational, not assessments
    const withWeight25 = r.assessments.filter(a => a.weight === '25')
    expect(withWeight25).toHaveLength(0)
  })

  it('puts informational percentage line in informational array', () => {
    const r = parseSyllabus(TOLVU_SYLLABUS)
    expect(r.informational.length).toBeGreaterThanOrEqual(1)
  })

  it('detects mustPassFinal rule', () => {
    const r = parseSyllabus(TOLVU_SYLLABUS)
    expect(r.rules.mustPassFinal).toBe(true)
  })

  it('adds mustPassFinal to unresolved', () => {
    const r = parseSyllabus(TOLVU_SYLLABUS)
    expect(r.unresolved.some(u => u.type === 'mustPassFinal')).toBe(true)
  })

  it('detects improvementRule', () => {
    const r = parseSyllabus(TOLVU_SYLLABUS)
    expect(r.rules.improvementRule).not.toBeNull()
    expect(r.rules.improvementRule.improveType).toBe('Miðmisserisspróf')
  })

  it('improvementRule has correct improveWeight', () => {
    const r = parseSyllabus(TOLVU_SYLLABUS)
    expect(r.rules.improvementRule?.improveWeight).toBe(20)
  })

  it('improvementRule fills baseWeight and finalWeight from lokapróf', () => {
    const r = parseSyllabus(TOLVU_SYLLABUS)
    const ir = r.rules.improvementRule
    expect(ir?.finalWeight).toBe(75)
    expect(ir?.baseWeight).toBe(55)
  })

  it('adds improvementRule to unresolved', () => {
    const r = parseSyllabus(TOLVU_SYLLABUS)
    expect(r.unresolved.some(u => u.type === 'improvementRule')).toBe(true)
  })

  it('detects course code TÖL102G', () => {
    const r = parseSyllabus(TOLVU_SYLLABUS)
    expect(r.courseCode).toBe('TÖL102G')
  })

  it('groups are selected by default', () => {
    const r = parseSyllabus(TOLVU_SYLLABUS)
    expect(r.groups.every(g => g.selected !== false)).toBe(true)
  })

  it('assessments all have evidence field', () => {
    const r = parseSyllabus(TOLVU_SYLLABUS)
    for (const a of r.assessments) {
      expect(typeof a.evidence).toBe('string')
      expect(a.evidence.length).toBeGreaterThan(0)
    }
  })

  it('groups all have evidence field', () => {
    const r = parseSyllabus(TOLVU_SYLLABUS)
    for (const g of r.groups) {
      expect(typeof g.evidence).toBe('string')
      expect(g.evidence.length).toBeGreaterThan(0)
    }
  })
})

// ── parseSyllabus — English group detection ─────────────────────────
describe('parseSyllabus English group detection', () => {
  const EN_SYLLABUS = `
Introduction to Computer Science

Grading:
Homework (5 items): 25%
Best 3 of 5 homework count.
Midterm Exam: 25%
Final Exam: 50%
Must pass the final exam.
`

  it('detects homework group', () => {
    const r = parseSyllabus(EN_SYLLABUS)
    const grp = r.groups.find(g => g.type === 'Heimadæmi')
    expect(grp).toBeDefined()
    expect(grp.count).toBe(5)
    expect(grp.totalWeight).toBe(25)
    expect(grp.bestOf).toBe(3)
  })

  it('detects mustPassFinal from English', () => {
    const r = parseSyllabus(EN_SYLLABUS)
    expect(r.rules.mustPassFinal).toBe(true)
  })

  it('midterm and final are individual assessments', () => {
    const r = parseSyllabus(EN_SYLLABUS)
    const mid = r.assessments.find(a => a.type === 'Miðmisserisspróf')
    const fin = r.assessments.find(a => a.type === 'Lokapróf')
    expect(mid).toBeDefined()
    expect(fin).toBeDefined()
  })
})

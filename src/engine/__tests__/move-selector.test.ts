import { selectMove } from '@/engine/move-selector'
import type { Signal, Turn } from '@/types/domain'
import type { StateEstimate } from '@/engine/state-estimator'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEstimate(
  state: StateEstimate['state'],
  confidence = 0.70,
  rationale = '',
): StateEstimate {
  return { state, confidence, rationale, signals_used: [] }
}

function sig(
  type: Signal['type'],
  value: number,
  confidence = 0.70,
): Signal {
  return { type, value, confidence, evidence_spans: [], rationale: '' }
}

function allSignals(overrides: Partial<Record<Signal['type'], Signal>> = {}): Signal[] {
  const defaults: Signal[] = [
    sig('DEPTH_VS_CIRCLING', 0.0, 0.55),
    sig('CONCRETENESS_VS_ABSTRACTION', 0.0, 0.55),
    sig('AFFECT_TRAJECTORY', 0.0, 0.50),
    sig('CORRECTION_DETECTED', 0.0, 0.90),
    sig('FELT_SHIFT_DETECTED', 0.0, 0.88),
    sig('GUARDEDNESS', 0.2, 0.55),
  ]
  return defaults.map((s) => overrides[s.type] ?? s)
}

function buildHistory(entries: Array<{ speaker: 'USER' | 'AI'; text: string }>): Turn[] {
  return entries.map((e, i) => ({
    id: `t-${i}`,
    conversation_id: 'c1',
    index: i,
    speaker: e.speaker,
    text: e.text,
    ts: new Date().toISOString(),
  }))
}

const TEXT = "I just feel like everything is falling apart and I don't know what to do."

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('selectMove', () => {

  // ── Rule 2: Circling ────────────────────────────────────────────────────────

  test('depth < -0.30 with neutral affect → REFLECTION', () => {
    const signals = allSignals({ DEPTH_VS_CIRCLING: sig('DEPTH_VS_CIRCLING', -0.45, 0.70) })
    const directive = selectMove(makeEstimate('OPENING'), signals, [], TEXT)

    expect(directive.move).toBe('REFLECTION')
    expect(directive.alternatives_considered.some((a) => a.move === 'QUESTION')).toBe(true)
  })

  test('depth < -0.30 with closing affect → HOLDING', () => {
    const signals = allSignals({
      DEPTH_VS_CIRCLING: sig('DEPTH_VS_CIRCLING', -0.50, 0.70),
      AFFECT_TRAJECTORY: sig('AFFECT_TRAJECTORY', -0.20, 0.55),
    })
    const directive = selectMove(makeEstimate('HOLDING'), signals, [], TEXT)

    expect(directive.move).toBe('HOLDING')
  })

  // ── Rule 3: Abstract framing ─────────────────────────────────────────────────

  test('concreteness < -0.35 → CLARIFICATION', () => {
    const signals = allSignals({ CONCRETENESS_VS_ABSTRACTION: sig('CONCRETENESS_VS_ABSTRACTION', -0.50, 0.65) })
    const directive = selectMove(makeEstimate('OPENING'), signals, [], TEXT)

    expect(directive.move).toBe('CLARIFICATION')
  })

  test('persistent abstraction (≥3 AI turns) → HOLDING', () => {
    const signals = allSignals({ CONCRETENESS_VS_ABSTRACTION: sig('CONCRETENESS_VS_ABSTRACTION', -0.50, 0.65) })
    const history = buildHistory([
      { speaker: 'USER', text: 'Turn 1' },
      { speaker: 'AI', text: 'AI 1' },
      { speaker: 'USER', text: 'Turn 2' },
      { speaker: 'AI', text: 'AI 2' },
      { speaker: 'USER', text: 'Turn 3' },
      { speaker: 'AI', text: 'AI 3' },
    ])
    const directive = selectMove(makeEstimate('OPENING'), signals, history, TEXT)

    expect(directive.move).toBe('HOLDING')
  })

  // ── Rule 6: Correction ───────────────────────────────────────────────────────

  test('correction > 0.50 → REFLECTION with correction rationale', () => {
    const signals = allSignals({ CORRECTION_DETECTED: sig('CORRECTION_DETECTED', 0.80, 0.88) })
    const directive = selectMove(makeEstimate('OPENING'), signals, [], TEXT)

    expect(directive.move).toBe('REFLECTION')
    expect(directive.rationale).toMatch(/correction/i)
  })

  // ── Rule 7: Crystallizing ────────────────────────────────────────────────────

  test('CRYSTALLIZING state → SUMMARY', () => {
    const directive = selectMove(makeEstimate('CRYSTALLIZING'), allSignals(), [], TEXT)

    expect(directive.move).toBe('SUMMARY')
  })

  // ── Rule 9: Orienting outward ────────────────────────────────────────────────

  test('ORIENTING_OUTWARD (no prior orientation) → ORIENTATION', () => {
    const history = buildHistory([
      { speaker: 'USER', text: 'Turn 1' },
      { speaker: 'AI', text: 'That sounds hard.' },
    ])
    const directive = selectMove(makeEstimate('ORIENTING_OUTWARD'), allSignals(), history, TEXT)

    expect(directive.move).toBe('ORIENTATION')
  })

  test('ORIENTING_OUTWARD after prior orientation → EXIT', () => {
    const history = buildHistory([
      { speaker: 'USER', text: 'Turn 1' },
      { speaker: 'AI', text: 'What would that actually look like? — carry forward.' },
    ])
    const directive = selectMove(makeEstimate('ORIENTING_OUTWARD'), allSignals(), history, TEXT)

    expect(directive.move).toBe('EXIT')
  })

  // ── Rule 10: Holding state ───────────────────────────────────────────────────

  test('HOLDING state → HOLDING move', () => {
    const directive = selectMove(makeEstimate('HOLDING'), allSignals(), [], TEXT)

    expect(directive.move).toBe('HOLDING')
    expect(directive.alternatives_considered.some((a) => a.move === 'QUESTION')).toBe(true)
  })

  // ── Rules 4 & 5: OPENING and DEEPENING ──────────────────────────────────────

  test('OPENING + depth > 0.20 → QUESTION', () => {
    const signals = allSignals({ DEPTH_VS_CIRCLING: sig('DEPTH_VS_CIRCLING', 0.35, 0.55) })
    const directive = selectMove(makeEstimate('OPENING'), signals, [], TEXT)

    expect(directive.move).toBe('QUESTION')
  })

  test('DEEPENING + depth > 0.20 → REFLECTION (bias 2: reflection over interrogation)', () => {
    const signals = allSignals({ DEPTH_VS_CIRCLING: sig('DEPTH_VS_CIRCLING', 0.35, 0.55) })
    const directive = selectMove(makeEstimate('DEEPENING'), signals, [], TEXT)

    expect(directive.move).toBe('REFLECTION')
    expect(directive.rationale).toMatch(/bias 2|reflect|deepening/i)
  })

  test('DEEPENING + depth not high → REFLECTION (specific material)', () => {
    const signals = allSignals({ DEPTH_VS_CIRCLING: sig('DEPTH_VS_CIRCLING', 0.05, 0.55) })
    const directive = selectMove(makeEstimate('DEEPENING'), signals, [], TEXT)

    expect(directive.move).toBe('REFLECTION')
  })

  // ── ARRIVAL ─────────────────────────────────────────────────────────────────

  test('ARRIVAL with high guardedness → VALIDATION', () => {
    const signals = allSignals({ GUARDEDNESS: sig('GUARDEDNESS', 0.70, 0.60) })
    const directive = selectMove(makeEstimate('ARRIVAL'), signals, [], TEXT)

    expect(directive.move).toBe('VALIDATION')
  })

  test('ARRIVAL with normal guardedness → QUESTION', () => {
    const signals = allSignals({ GUARDEDNESS: sig('GUARDEDNESS', 0.20, 0.55) })
    const directive = selectMove(makeEstimate('ARRIVAL'), signals, [], TEXT)

    expect(directive.move).toBe('QUESTION')
  })

  // ── Philosophy bias 1: low confidence ───────────────────────────────────────

  test('confidence < 0.50 → VALIDATION (bias 1: safe move under uncertainty)', () => {
    const directive = selectMove(makeEstimate('OPENING', 0.40), allSignals(), [], TEXT)

    expect(directive.move).toBe('VALIDATION')
    expect(directive.rationale).toMatch(/confidence|bias 1|uncertainty/i)
  })

})

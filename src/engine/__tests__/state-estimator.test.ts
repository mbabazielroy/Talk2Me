import { estimateState } from '@/engine/state-estimator'
import type { Signal, SignalSet, Turn } from '@/types/domain'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSignalSet(overrides: Partial<Record<string, Partial<Signal>>> = {}): SignalSet {
  const defaults: Record<string, Signal> = {
    DEPTH_VS_CIRCLING: { type: 'DEPTH_VS_CIRCLING', value: 0.0, confidence: 0.55, evidence_spans: [], rationale: '' },
    CONCRETENESS_VS_ABSTRACTION: { type: 'CONCRETENESS_VS_ABSTRACTION', value: 0.0, confidence: 0.55, evidence_spans: [], rationale: '' },
    AFFECT_TRAJECTORY: { type: 'AFFECT_TRAJECTORY', value: 0.0, confidence: 0.50, evidence_spans: [], rationale: '' },
    CORRECTION_DETECTED: { type: 'CORRECTION_DETECTED', value: 0.0, confidence: 0.90, evidence_spans: [], rationale: '' },
    FELT_SHIFT_DETECTED: { type: 'FELT_SHIFT_DETECTED', value: 0.0, confidence: 0.88, evidence_spans: [], rationale: '' },
    GUARDEDNESS: { type: 'GUARDEDNESS', value: 0.2, confidence: 0.55, evidence_spans: [], rationale: '' },
  }

  const merged = { ...defaults }
  for (const [key, patch] of Object.entries(overrides)) {
    merged[key] = { ...defaults[key], ...patch } as Signal
  }

  return {
    turn_id: 'test-turn',
    signals: Object.values(merged),
    extracted_at: new Date().toISOString(),
  }
}

function buildHistory(turns: Array<{ speaker: 'USER' | 'AI'; text: string }>): Turn[] {
  return turns.map((t, i) => ({
    id: `t-${i}`,
    conversation_id: 'c1',
    index: i,
    speaker: t.speaker,
    text: t.text,
    ts: new Date().toISOString(),
  }))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('estimateState', () => {

  test('first user turn → ARRIVAL at confidence 0.90', () => {
    const signalSet = makeSignalSet()
    const estimate = estimateState(signalSet, [])

    expect(estimate.state).toBe('ARRIVAL')
    expect(estimate.confidence).toBe(0.90)
    expect(estimate.signals_used).toEqual([])
  })

  test('early turn (≤2) with high guardedness → ARRIVAL with GUARDEDNESS signal used', () => {
    const signalSet = makeSignalSet({
      GUARDEDNESS: { value: 0.65, confidence: 0.60 },
    })
    const history = buildHistory([
      { speaker: 'USER', text: "I'm not sure." },
      { speaker: 'AI', text: "What's on your mind?" },
    ])

    const estimate = estimateState(signalSet, history)

    expect(estimate.state).toBe('ARRIVAL')
    expect(estimate.signals_used).toContain('GUARDEDNESS')
  })

  test('felt shift > 0.65 + positive depth → CRYSTALLIZING', () => {
    const signalSet = makeSignalSet({
      FELT_SHIFT_DETECTED: { value: 0.9, confidence: 0.82 },
      DEPTH_VS_CIRCLING: { value: 0.3, confidence: 0.60 },
    })
    const history = buildHistory([
      { speaker: 'USER', text: 'Turn 1' },
      { speaker: 'AI', text: 'Response 1' },
      { speaker: 'USER', text: 'Turn 2' },
      { speaker: 'AI', text: 'Response 2' },
    ])

    const estimate = estimateState(signalSet, history)

    expect(estimate.state).toBe('CRYSTALLIZING')
    expect(estimate.signals_used).toContain('FELT_SHIFT_DETECTED')
    expect(estimate.signals_used).toContain('DEPTH_VS_CIRCLING')
    expect(estimate.confidence).toBeCloseTo(0.78)
  })

  test('depth < -0.35 with closing affect → HOLDING with both signals used', () => {
    const signalSet = makeSignalSet({
      DEPTH_VS_CIRCLING: { value: -0.50, confidence: 0.72 },
      AFFECT_TRAJECTORY: { value: -0.20, confidence: 0.55 },
    })
    const history = buildHistory([
      { speaker: 'USER', text: 'Turn 1' },
      { speaker: 'AI', text: 'Response 1' },
      { speaker: 'USER', text: 'Turn 2' },
      { speaker: 'AI', text: 'Response 2' },
    ])

    const estimate = estimateState(signalSet, history)

    expect(estimate.state).toBe('HOLDING')
    expect(estimate.signals_used).toContain('DEPTH_VS_CIRCLING')
    expect(estimate.signals_used).toContain('AFFECT_TRAJECTORY')
    expect(estimate.confidence).toBeCloseTo(0.72)
  })

  test('depth < -0.35 without closing affect → HOLDING with only DEPTH signal used', () => {
    const signalSet = makeSignalSet({
      DEPTH_VS_CIRCLING: { value: -0.55, confidence: 0.72 },
      AFFECT_TRAJECTORY: { value: 0.10, confidence: 0.55 },
    })
    const history = buildHistory([
      { speaker: 'USER', text: 'Turn 1' },
      { speaker: 'AI', text: 'Response 1' },
    ])

    const estimate = estimateState(signalSet, history)

    expect(estimate.state).toBe('HOLDING')
    expect(estimate.signals_used).toContain('DEPTH_VS_CIRCLING')
    expect(estimate.signals_used).not.toContain('AFFECT_TRAJECTORY')
    expect(estimate.confidence).toBeCloseTo(0.62)
  })

  test('turn ≥ 3 + depth > 0.25 + not deeply abstract → DEEPENING', () => {
    const signalSet = makeSignalSet({
      DEPTH_VS_CIRCLING: { value: 0.40, confidence: 0.60 },
      CONCRETENESS_VS_ABSTRACTION: { value: 0.10, confidence: 0.55 },
    })
    const history = buildHistory([
      { speaker: 'USER', text: 'Turn 1' },
      { speaker: 'AI', text: 'Response 1' },
      { speaker: 'USER', text: 'Turn 2' },
      { speaker: 'AI', text: 'Response 2' },
      { speaker: 'USER', text: 'Turn 3' },
      { speaker: 'AI', text: 'Response 3' },
    ])

    const estimate = estimateState(signalSet, history)

    expect(estimate.state).toBe('DEEPENING')
    expect(estimate.signals_used).toContain('DEPTH_VS_CIRCLING')
    expect(estimate.confidence).toBeCloseTo(0.68)
  })

  test('depth > 0.05 with manageable guardedness → OPENING', () => {
    const signalSet = makeSignalSet({
      DEPTH_VS_CIRCLING: { value: 0.15, confidence: 0.55 },
      GUARDEDNESS: { value: 0.30, confidence: 0.55 },
    })
    const history = buildHistory([
      { speaker: 'USER', text: 'Turn 1' },
      { speaker: 'AI', text: 'Response 1' },
    ])

    const estimate = estimateState(signalSet, history)

    expect(estimate.state).toBe('OPENING')
    expect(estimate.signals_used).toContain('DEPTH_VS_CIRCLING')
    expect(estimate.confidence).toBeCloseTo(0.62)
  })

  test('forward phrases ≥ 2 + turnIndex ≥ 4 → ORIENTING_OUTWARD', () => {
    const signalSet = makeSignalSet()
    // The estimator reads the last user turn text from history
    const history = buildHistory([
      { speaker: 'USER', text: 'Turn 1' },
      { speaker: 'AI', text: 'Response 1' },
      { speaker: 'USER', text: 'Turn 2' },
      { speaker: 'AI', text: 'Response 2' },
      { speaker: 'USER', text: 'Turn 3' },
      { speaker: 'AI', text: 'Response 3' },
      { speaker: 'USER', text: 'Turn 4' },
      { speaker: 'AI', text: 'Response 4' },
      // This is turn 5 (index 4) — "turnIndex" in estimator = userTurns count before this call
      { speaker: 'USER', text: "I want to talk to him tomorrow and I'll start differently this time." },
    ])

    const estimate = estimateState(signalSet, history)

    expect(estimate.state).toBe('ORIENTING_OUTWARD')
  })

  test('no strong signal → ARRIVAL at low confidence 0.35', () => {
    const signalSet = makeSignalSet({
      DEPTH_VS_CIRCLING: { value: -0.05, confidence: 0.55 },
      GUARDEDNESS: { value: 0.60, confidence: 0.60 },
    })
    // Turn 4 (past early-turn guardedness window)
    const history = buildHistory([
      { speaker: 'USER', text: 'Turn 1' },
      { speaker: 'AI', text: 'Response 1' },
      { speaker: 'USER', text: 'Turn 2' },
      { speaker: 'AI', text: 'Response 2' },
      { speaker: 'USER', text: 'Turn 3' },
      { speaker: 'AI', text: 'Response 3' },
    ])

    const estimate = estimateState(signalSet, history)

    expect(estimate.state).toBe('ARRIVAL')
    expect(estimate.confidence).toBeCloseTo(0.35)
  })

})

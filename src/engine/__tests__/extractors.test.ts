import {
  extractDepthVsCircling,
  extractConcretenessVsAbstraction,
  extractAffectTrajectory,
  extractCorrectionDetected,
  extractFeltShift,
  extractGuardedness,
} from '@/engine/signal-extractors'
import type { Turn } from '@/types/domain'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function userTurn(text: string, index = 0): Turn {
  return {
    id: `u-${index}`,
    conversation_id: 'c1',
    index,
    speaker: 'USER',
    text,
    ts: new Date().toISOString(),
  }
}

function aiTurn(text: string, index = 1): Turn {
  return {
    id: `a-${index}`,
    conversation_id: 'c1',
    index,
    speaker: 'AI',
    text,
    ts: new Date().toISOString(),
  }
}

// ─── DEPTH_VS_CIRCLING ────────────────────────────────────────────────────────

describe('extractDepthVsCircling', () => {
  test('explicit circling phrases → elevated confidence and recycling evidence', () => {
    // Use overlapping history so novelty ratio stays low and circling penalty dominates
    const history = [
      userTurn("I keep coming back to the same thing, going in circles.", 0),
      aiTurn("What does coming back feel like?", 1),
      userTurn("Same thing over and over. I can't stop thinking.", 2),
      aiTurn("Tell me more.", 3),
    ]
    const text = "I keep coming back to the same thing. It's like I'm going in circles and same thing over and over."
    const sig = extractDepthVsCircling(text, history)

    expect(sig.type).toBe('DEPTH_VS_CIRCLING')
    expect(sig.value).toBeLessThan(0.1)  // circling + repeated vocab should push value down
    expect(sig.confidence).toBeGreaterThanOrEqual(0.70)
    expect(sig.evidence_spans.some((s) => s.includes('recycling'))).toBe(true)
  })

  test('first turn with no history → low confidence (0.30)', () => {
    const text = "I've been feeling off lately and I want to understand why."
    const sig = extractDepthVsCircling(text, [])

    expect(sig.type).toBe('DEPTH_VS_CIRCLING')
    expect(sig.confidence).toBe(0.30)
    expect(sig.rationale).toMatch(/first turn/i)
  })

  test('fresh content after established history → positive value', () => {
    const history = [
      userTurn('I feel distant from my partner.', 0),
      aiTurn("What's that distance like?", 1),
    ]
    const text = "And actually I realize now it's about something completely different — it goes back to when I was young. I notice I hold my breath whenever someone gets quiet."
    const sig = extractDepthVsCircling(text, history)

    expect(sig.value).toBeGreaterThan(0.1)
  })
})

// ─── CONCRETENESS_VS_ABSTRACTION ──────────────────────────────────────────────

describe('extractConcretenessVsAbstraction', () => {
  test('abstract evaluative language → negative value', () => {
    const text = "Why am I always like this? Everything I do is wrong. I'm just broken and worthless."
    const sig = extractConcretenessVsAbstraction(text)

    expect(sig.type).toBe('CONCRETENESS_VS_ABSTRACTION')
    expect(sig.value).toBeLessThan(-0.1)
    expect(sig.evidence_spans.some((s) => s.includes('abstract'))).toBe(true)
  })

  test('concrete narrative with temporal markers → positive value', () => {
    const text = "Yesterday morning my manager called me in and told me I was being let go. I sat there and heard nothing else."
    const sig = extractConcretenessVsAbstraction(text)

    expect(sig.type).toBe('CONCRETENESS_VS_ABSTRACTION')
    expect(sig.value).toBeGreaterThan(0.0)
    expect(sig.evidence_spans.some((s) => s.includes('concrete'))).toBe(true)
  })

  test('neutral / mixed text → value near zero', () => {
    const text = "I've been feeling a bit uncertain about the situation."
    const sig = extractConcretenessVsAbstraction(text)

    expect(sig.type).toBe('CONCRETENESS_VS_ABSTRACTION')
    expect(sig.value).toBeGreaterThan(-0.4)
    expect(sig.value).toBeLessThan(0.4)
  })
})

// ─── AFFECT_TRAJECTORY ────────────────────────────────────────────────────────

describe('extractAffectTrajectory', () => {
  test('closing / deflecting phrases → negative value', () => {
    const history = [userTurn("I feel stuck.", 0)]
    const text = "Anyway, forget it. Whatever. It doesn't matter, I guess."
    const sig = extractAffectTrajectory(text, history)

    expect(sig.type).toBe('AFFECT_TRAJECTORY')
    expect(sig.value).toBeLessThan(0)
    expect(sig.evidence_spans.some((s) => s.includes('closing'))).toBe(true)
  })

  test('opening / elaboration markers → positive direction', () => {
    const history = [userTurn("I feel stuck.", 0)]
    const text = "Actually, I think maybe I realize something. Like, wait — it's interesting, this feels like something I've never noticed before."
    const sig = extractAffectTrajectory(text, history)

    expect(sig.type).toBe('AFFECT_TRAJECTORY')
    // Should not be strongly negative when opening markers are present
    expect(sig.value).toBeGreaterThan(-0.3)
  })

  test('much shorter message than prior average → negative length signal', () => {
    const long = "I've been really struggling with this for a while now and it feels like it's been going on forever and I can't figure out why it keeps happening to me no matter what I do."
    const history = [userTurn(long, 0), aiTurn("That sounds heavy.", 1)]
    const text = "Yeah."
    const sig = extractAffectTrajectory(text, history)

    expect(sig.value).toBeLessThan(0)
  })
})

// ─── CORRECTION_DETECTED ──────────────────────────────────────────────────────

describe('extractCorrectionDetected', () => {
  test('strong correction at message start → value 1.0, confidence 0.88', () => {
    const text = "No, that's not it. It's not fear — it's anger."
    const sig = extractCorrectionDetected(text)

    expect(sig.type).toBe('CORRECTION_DETECTED')
    expect(sig.value).toBe(1.0)
    expect(sig.confidence).toBe(0.88)
    expect(sig.evidence_spans.length).toBeGreaterThan(0)
  })

  test('medium correction phrase → value 0.75, confidence 0.72', () => {
    const text = "Well actually that's more like what's going on, yeah."
    const sig = extractCorrectionDetected(text)

    expect(sig.type).toBe('CORRECTION_DETECTED')
    expect(sig.value).toBe(0.75)
    expect(sig.confidence).toBe(0.72)
  })

  test('no correction markers → value 0.0, confidence 0.90', () => {
    const text = "Yeah, I think that's right. It really is about the relationship."
    const sig = extractCorrectionDetected(text)

    expect(sig.type).toBe('CORRECTION_DETECTED')
    expect(sig.value).toBe(0.0)
    expect(sig.confidence).toBe(0.90)
    expect(sig.evidence_spans.length).toBe(0)
  })
})

// ─── FELT_SHIFT_DETECTED ──────────────────────────────────────────────────────

describe('extractFeltShift', () => {
  test('resonance phrase + substantive follow-on → high value (0.9)', () => {
    const text = "Oh wait, yes — that's exactly it. I've never said that out loud before. It's about needing to feel in control and I realize now I never have been."
    const sig = extractFeltShift(text)

    expect(sig.type).toBe('FELT_SHIFT_DETECTED')
    expect(sig.value).toBe(0.9)
    expect(sig.confidence).toBeGreaterThanOrEqual(0.80)
    expect(sig.evidence_spans.some((s) => s.includes("that's exactly it"))).toBe(true)
  })

  test('resonance phrase + very short message → reduced value (0.6), agreement-without-movement note', () => {
    const text = "That's it. Yeah."
    const sig = extractFeltShift(text)

    expect(sig.type).toBe('FELT_SHIFT_DETECTED')
    expect(sig.value).toBe(0.6)
    expect(sig.confidence).toBeLessThan(0.80)
    expect(sig.rationale).toMatch(/agreement-without-movement/i)
  })

  test('agreement-only phrase → low value (0.25)', () => {
    const text = "Yes exactly, totally agree with that."
    const sig = extractFeltShift(text)

    expect(sig.type).toBe('FELT_SHIFT_DETECTED')
    expect(sig.value).toBe(0.25)
    expect(sig.rationale).toMatch(/blueprint §3/i)
  })

  test('no markers → value 0.0, high confidence', () => {
    const text = "I'm not sure. Let me think about that."
    const sig = extractFeltShift(text)

    expect(sig.type).toBe('FELT_SHIFT_DETECTED')
    expect(sig.value).toBe(0.0)
    expect(sig.confidence).toBeGreaterThanOrEqual(0.85)
  })
})

// ─── GUARDEDNESS ──────────────────────────────────────────────────────────────

describe('extractGuardedness', () => {
  test('social performance + minimization → high score', () => {
    const history = [userTurn("Had a rough week.", 0), aiTurn("Tell me more.", 1)]
    const text = "I'm fine honestly. It's not a big deal. I probably shouldn't complain — others have it worse."
    const sig = extractGuardedness(text, history)

    expect(sig.type).toBe('GUARDEDNESS')
    expect(sig.value).toBeGreaterThan(0.5)
    expect(sig.confidence).toBeGreaterThanOrEqual(0.60)
    expect(sig.evidence_spans.some((s) => s.includes('performance') || s.includes('minimize'))).toBe(true)
  })

  test('emotional precision words → reduce guardedness score', () => {
    const history: Turn[] = []
    // Precision words placed mid-sentence so tokenizer doesn't attach trailing punctuation
    const text = "I feel terrified and devastated and crushed by this grief I'm carrying around."
    const sig = extractGuardedness(text, history)

    expect(sig.type).toBe('GUARDEDNESS')
    expect(sig.value).toBeLessThan(0.5)
    expect(sig.evidence_spans.some((s) => s.includes('emotional precision'))).toBe(true)
  })

  test('first user turn → includes baseline guardedness bonus', () => {
    const text = "I want to talk about my relationship."
    const sig = extractGuardedness(text, [])

    expect(sig.type).toBe('GUARDEDNESS')
    // First-turn baseline adds 0.20
    expect(sig.value).toBeGreaterThan(0.1)
    expect(sig.rationale).toMatch(/first-turn/i)
  })
})

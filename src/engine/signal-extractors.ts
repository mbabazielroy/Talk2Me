/**
 * Signal Extractors — the perceptual layer.
 *
 * Blueprint §3: "Convert thin text into structured signals the engine reasons
 * over. Each extractor is independent, composable, and individually evaluable."
 *
 * M1 STATUS: Mock / lightweight heuristic implementations.
 * These produce plausible, varying output so the architecture can be inspected.
 * They are NOT accurate classifiers. Replace each independently against
 * human-labeled transcripts (blueprint §9.2 component evals).
 *
 * Contract: each extractor returns Signal { type, value, confidence, evidence_spans }.
 * The bundle for a turn is the SignalSet.
 */

import type { Signal, SignalSet, Turn } from '@/types/domain'

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function words(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean)
}

function findSpans(text: string, patterns: string[]): string[] {
  const lower = text.toLowerCase()
  return patterns.filter((p) => lower.includes(p))
}

// ── Individual extractors ─────────────────────────────────────────────────────

/**
 * DEPTH_VS_CIRCLING  [-1, +1]
 * -1 = person is recycling the same ground (looping)
 * +1 = genuinely new content, rising novelty
 *
 * Heuristic: compare word overlap with recent user turns; adjust for length.
 */
function extractDepthVsCircling(text: string, history: Turn[]): Signal {
  const ws = words(text)
  const recentUserWords = new Set(
    history
      .filter((t) => t.speaker === 'USER')
      .slice(-3)
      .flatMap((t) => words(t.text))
  )

  const repeated = ws.filter((w) => w.length > 3 && recentUserWords.has(w)).length
  const noveltyRatio = history.length === 0 ? 0.5 : 1 - repeated / Math.max(ws.length, 1)
  const lengthBonus = clamp((ws.length - 5) / 30, -0.3, 0.3)
  const value = clamp(noveltyRatio * 2 - 1 + lengthBonus, -1, 1)
  const confidence = history.length < 2 ? 0.3 : 0.55

  const evidence: string[] = []
  if (repeated > 3) evidence.push(`${repeated} repeated words from recent turns`)
  if (ws.length > 30) evidence.push('long message — likely new content')

  return {
    type: 'DEPTH_VS_CIRCLING',
    value: parseFloat(value.toFixed(3)),
    confidence,
    evidence_spans: evidence,
  }
}

/**
 * CONCRETENESS_VS_ABSTRACTION  [-1, +1]
 * -1 = very abstract / evaluative / past-focused (rumination signature)
 * +1 = concrete / specific / forward-looking
 */
function extractConcretenessVsAbstraction(text: string): Signal {
  const ws = words(text)
  const abstractSet = new Set([
    'why', 'always', 'never', 'everything', 'nothing', 'should', 'wrong',
    'bad', 'good', 'terrible', 'awful', 'broken', 'pointless', 'meaningless',
    'worthless', 'stupid', 'failure', 'problem',
  ])
  const concreteSet = new Set([
    'when', 'then', 'because', 'specifically', 'actually', 'happened',
    'said', 'did', 'felt', 'noticed', 'yesterday', 'today', 'morning',
    'suddenly', 'immediately', 'walked', 'called', 'wrote',
  ])

  const abstractCount = ws.filter((w) => abstractSet.has(w)).length
  const concreteCount = ws.filter((w) => concreteSet.has(w)).length
  const value = clamp((concreteCount - abstractCount) / Math.max(ws.length * 0.3, 1), -1, 1)

  const evidence = [
    ...ws.filter((w) => abstractSet.has(w)).slice(0, 3).map((w) => `abstract: "${w}"`),
    ...ws.filter((w) => concreteSet.has(w)).slice(0, 3).map((w) => `concrete: "${w}"`),
  ]

  return {
    type: 'CONCRETENESS_VS_ABSTRACTION',
    value: parseFloat(value.toFixed(3)),
    confidence: 0.6,
    evidence_spans: evidence,
  }
}

/**
 * AFFECT_TRAJECTORY  [-1, +1]
 * -1 = closing / withdrawing / shortening
 * +1 = opening / elaborating / present-tense shift
 */
function extractAffectTrajectory(text: string, history: Turn[]): Signal {
  const ws = words(text)
  const openingSet = new Set([
    'realized', 'think', 'feel', 'notice', 'wonder', 'maybe', 'sense',
    'actually', 'huh', 'interesting', 'suddenly', 'wait', 'like',
  ])
  const closingSet = new Set([
    'fine', 'ok', 'okay', 'whatever', 'anyway', 'guess', 'suppose',
    "doesn't matter", 'forget it', 'nevermind',
  ])

  const opening = ws.filter((w) => openingSet.has(w)).length
  const closing = ws.filter((w) => closingSet.has(w)).length

  // Short reply after longer ones = closing signal
  const prevUserTurns = history.filter((t) => t.speaker === 'USER')
  const avgPrevLength =
    prevUserTurns.length > 0
      ? prevUserTurns.reduce((s, t) => s + t.text.length, 0) / prevUserTurns.length
      : text.length
  const lengthRatio = text.length / Math.max(avgPrevLength, 1)
  const lengthSignal = clamp((lengthRatio - 0.5) * 0.4, -0.3, 0.3)

  const value = clamp((opening - closing) / Math.max(ws.length * 0.2, 1) + lengthSignal, -1, 1)

  const evidence = [
    ...ws.filter((w) => openingSet.has(w)).slice(0, 2).map((w) => `opening: "${w}"`),
    ...ws.filter((w) => closingSet.has(w)).slice(0, 2).map((w) => `closing: "${w}"`),
  ]

  return {
    type: 'AFFECT_TRAJECTORY',
    value: parseFloat(value.toFixed(3)),
    confidence: 0.5,
    evidence_spans: evidence,
  }
}

/**
 * CORRECTION_DETECTED  [0, 1]
 * 1 = person is explicitly pushing back on the prior AI reflection
 * High value = the mechanism working (blueprint §3: "healthy deepening signal")
 */
function extractCorrectionDetected(text: string): Signal {
  const lower = text.toLowerCase().trim()
  const strongPhrases = ["no,", "not quite", "actually,", "that's not", "that's not it", "not exactly"]
  const weakPhrases = ['well,', 'kind of', 'sort of', 'i mean', 'more like', 'rather', 'but actually']

  const strongMatch = strongPhrases.find((p) => lower.startsWith(p) || lower.includes(p))
  const weakMatch = !strongMatch && weakPhrases.find((p) => lower.startsWith(p))

  const value = strongMatch ? 1.0 : weakMatch ? 0.5 : 0.0
  const confidence = strongMatch ? 0.85 : weakMatch ? 0.55 : 0.4
  const evidence = strongMatch ? [strongMatch] : weakMatch ? [weakMatch] : []

  return {
    type: 'CORRECTION_DETECTED',
    value,
    confidence,
    evidence_spans: evidence,
  }
}

/**
 * FELT_SHIFT_DETECTED  [0, 1]
 * 1 = a reflection landed; person has arrived somewhere.
 * NOTE: "yes, exactly!" with NO new content is a WARNING sign, not a win
 * (comfortable mirroring). The state estimator handles this distinction.
 */
function extractFeltShift(text: string): Signal {
  const lower = text.toLowerCase()
  const shiftPhrases = [
    "that's it", "yeah, that's", "yes, exactly", "huh", "oh,", "wait,",
    "oh wow", "that actually", "yes that", "exactly yes", "you got it",
    "that's the thing",
  ]

  const match = shiftPhrases.find((p) => lower.includes(p))
  const value = match ? 0.9 : 0.0
  const confidence = match ? 0.8 : 0.3

  return {
    type: 'FELT_SHIFT_DETECTED',
    value,
    confidence,
    evidence_spans: match ? [match] : [],
  }
}

/**
 * GUARDEDNESS  [0, 1]
 * 0 = very open / trusting
 * 1 = hedging, deflecting, still on "presentable version"
 */
function extractGuardedness(text: string, history: Turn[]): Signal {
  const lower = text.toLowerCase()
  const ws = words(text)
  const hedgePhrases = ['maybe', 'kind of', 'sort of', 'i guess', 'probably', 'perhaps', "i'm not sure", 'not sure', 'i think maybe']
  const deflectionPhrases = ['anyway', 'it is what it is', "doesn't really matter", 'not a big deal', 'forget it']

  const hedgeCount = hedgePhrases.filter((p) => lower.includes(p)).length
  const deflectionCount = deflectionPhrases.filter((p) => lower.includes(p)).length

  // First turn is always somewhat guarded (arrival)
  const firstTurnBonus = history.filter((t) => t.speaker === 'USER').length === 0 ? 0.25 : 0
  // Very short messages can signal withholding
  const brevitySignal = ws.length < 8 ? 0.2 : 0
  const value = clamp(hedgeCount * 0.2 + deflectionCount * 0.3 + firstTurnBonus + brevitySignal, 0, 1)

  const evidence = [
    ...hedgePhrases.filter((p) => lower.includes(p)).slice(0, 3),
    ...deflectionPhrases.filter((p) => lower.includes(p)).slice(0, 2),
  ]

  return {
    type: 'GUARDEDNESS',
    value: parseFloat(value.toFixed(3)),
    confidence: 0.5,
    evidence_spans: evidence,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function extractSignals(turnId: string, text: string, history: Turn[]): SignalSet {
  return {
    turn_id: turnId,
    signals: [
      extractDepthVsCircling(text, history),
      extractConcretenessVsAbstraction(text),
      extractAffectTrajectory(text, history),
      extractCorrectionDetected(text),
      extractFeltShift(text),
      extractGuardedness(text, history),
    ],
    extracted_at: new Date().toISOString(),
  }
}

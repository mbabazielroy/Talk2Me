/**
 * State Estimator v1 — maps SignalSet + history → StateEstimate.
 *
 * Blueprint §4: "Transparent and heuristic. Designed to be replaced by a
 * learned model once the lab produces labels — but only against honest targets."
 *
 * States are REGIONS, not stages. People move backward. The estimator allows
 * that and the policy must not treat backward movement as regression.
 *
 * Confidence is load-bearing: it feeds directly into the philosophy bias
 * "when ambiguous between deepen and exit, bias to exit" (§5.3).
 *
 * signals_used: which signals drove the decision. Essential for the lab
 * to understand and evaluate the estimator independently.
 */

import type { ConversationState, Signal, SignalSet, SignalType, Turn } from '@/types/domain'

export interface StateEstimate {
  state: ConversationState
  confidence: number
  rationale: string
  signals_used: SignalType[]
}

function get(signals: Signal[], type: SignalType): Signal | undefined {
  return signals.find((s) => s.type === type)
}

/** Returns true if a signal exists, has confidence above threshold, and value above min. */
function above(sig: Signal | undefined, value: number, confMin = 0.0): boolean {
  return !!sig && sig.confidence >= confMin && sig.value > value
}

/** Returns true if a signal exists, has confidence above threshold, and value below max. */
function below(sig: Signal | undefined, value: number, confMin = 0.0): boolean {
  return !!sig && sig.confidence >= confMin && sig.value < value
}

export function estimateState(signalSet: SignalSet, history: Turn[]): StateEstimate {
  const { signals } = signalSet
  const userTurns = history.filter((t) => t.speaker === 'USER')
  const turnIndex = userTurns.length // 0 = first user turn in THIS conversation

  const depth = get(signals, 'DEPTH_VS_CIRCLING')
  const concreteness = get(signals, 'CONCRETENESS_VS_ABSTRACTION')
  const affect = get(signals, 'AFFECT_TRAJECTORY')
  const correction = get(signals, 'CORRECTION_DETECTED')
  const feltShift = get(signals, 'FELT_SHIFT_DETECTED')
  const guardedness = get(signals, 'GUARDEDNESS')

  // ── Rule 1: ARRIVAL ─────────────────────────────────────────────────────────
  // First turn: always ARRIVAL, high confidence.
  if (turnIndex === 0) {
    return {
      state: 'ARRIVAL',
      confidence: 0.90,
      rationale: 'First user turn — always ARRIVAL',
      signals_used: [],
    }
  }

  // Early turns with high guardedness: still in ARRIVAL.
  if (turnIndex <= 2 && above(guardedness, 0.55, 0.50)) {
    return {
      state: 'ARRIVAL',
      confidence: 0.70,
      rationale: `High guardedness (${guardedness!.value.toFixed(2)}) in early turn — person hasn't yet settled in`,
      signals_used: ['GUARDEDNESS'],
    }
  }

  // ── Rule 2: CRYSTALLIZING ────────────────────────────────────────────────────
  // Felt shift + substantive new content. NOT just agreement-without-movement.
  if (above(feltShift, 0.65, 0.65) && above(depth, 0.05)) {
    return {
      state: 'CRYSTALLIZING',
      confidence: 0.78,
      rationale: `Felt-shift detected (${feltShift!.value.toFixed(2)}) with new content (depth ${depth!.value.toFixed(2)}) — person has arrived somewhere`,
      signals_used: ['FELT_SHIFT_DETECTED', 'DEPTH_VS_CIRCLING'],
    }
  }

  // ── Rule 3: HOLDING ──────────────────────────────────────────────────────────
  // Circling + closing affect. Pain that doesn't want solving.
  // Also fires on heavy circling alone (depth very negative).
  if (below(depth, -0.35, 0.55)) {
    const withClosing = below(affect, -0.05)
    return {
      state: 'HOLDING',
      confidence: withClosing ? 0.72 : 0.62,
      rationale: withClosing
        ? `Circling (depth ${depth!.value.toFixed(2)}) with closing affect (${affect?.value.toFixed(2)}) — person needs presence, not excavation`
        : `Strong circling signal (depth ${depth!.value.toFixed(2)}) — do not dig deeper`,
      signals_used: withClosing
        ? ['DEPTH_VS_CIRCLING', 'AFFECT_TRAJECTORY']
        : ['DEPTH_VS_CIRCLING'],
    }
  }

  // ── Rule 4: ORIENTING_OUTWARD ────────────────────────────────────────────────
  // Forward-looking language in mid-to-late session.
  const currentText = userTurns.slice(-1)[0]?.text.toLowerCase() ?? ''
  const forwardPhrases = [
    'want to', 'going to', "i'll", 'will try', 'plan to', 'next week',
    'this week', 'tomorrow', 'going to try', 'start', 'begin', 'commit',
    'take that', 'bring that', 'do that',
  ]
  const forwardHits = forwardPhrases.filter((p) => currentText.includes(p))
  if (forwardHits.length >= 2 && turnIndex >= 4) {
    return {
      state: 'ORIENTING_OUTWARD',
      confidence: 0.65,
      rationale: `Forward-looking language in turn ${turnIndex + 1}: "${forwardHits.slice(0, 2).join('", "')}"`,
      signals_used: [],
    }
  }

  // ── Rule 5: DEEPENING ────────────────────────────────────────────────────────
  // Rising novelty + not strongly abstract + at least 3 prior turns.
  if (
    turnIndex >= 3 &&
    above(depth, 0.25, 0.50) &&
    !below(concreteness, -0.35, 0.55)  // not deeply abstract
  ) {
    return {
      state: 'DEEPENING',
      confidence: 0.68,
      rationale: `Rising novelty (depth ${depth!.value.toFixed(2)}) with sufficient concreteness (${concreteness?.value.toFixed(2) ?? 'n/a'}) in turn ${turnIndex + 1}`,
      signals_used: ['DEPTH_VS_CIRCLING', 'CONCRETENESS_VS_ABSTRACTION'],
    }
  }

  // ── Rule 6: OPENING ──────────────────────────────────────────────────────────
  // Some novelty, guardedness not dominant.
  if (above(depth, 0.05) && !above(guardedness, 0.55)) {
    return {
      state: 'OPENING',
      confidence: 0.62,
      rationale: `Novelty rising (depth ${depth!.value.toFixed(2)}), guardedness manageable (${guardedness?.value.toFixed(2) ?? 'n/a'}) — person is opening`,
      signals_used: ['DEPTH_VS_CIRCLING', 'GUARDEDNESS'],
    }
  }

  // ── Default: ARRIVAL at low confidence ──────────────────────────────────────
  // Philosophy: when in doubt, slow down / bias to exit.
  return {
    state: 'ARRIVAL',
    confidence: 0.35,
    rationale: 'No clear state signal — defaulting to ARRIVAL with low confidence (philosophy §5.3: when in doubt, slow down)',
    signals_used: [],
  }
}

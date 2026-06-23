/**
 * State Estimator — maps SignalSet + history → { state, confidence }.
 *
 * Blueprint §4: "Design stance for v1: transparent and heuristic. Start
 * rule-based so it is debuggable and auditable against the philosophy.
 * Designed to be replaced by a learned model once the lab produces labels —
 * but only against honest targets."
 *
 * States are regions, not stages. People move backward. A new thread can
 * drop someone from CRYSTALLIZING back to OPENING. The estimator must allow
 * that and the policy must not treat it as regression.
 *
 * Confidence is load-bearing: "when ambiguous between deepen and exit,
 * bias to exit" is a direct function of it (blueprint §5.3).
 */

import type { ConversationState, Signal, SignalSet, Turn } from '@/types/domain'

export interface StateEstimate {
  state: ConversationState
  confidence: number
  reasoning: string
}

function getSignal(signals: Signal[], type: Signal['type']): Signal | undefined {
  return signals.find((s) => s.type === type)
}

export function estimateState(signalSet: SignalSet, history: Turn[]): StateEstimate {
  const { signals } = signalSet
  const userTurns = history.filter((t) => t.speaker === 'USER')
  const turnIndex = userTurns.length // 0 = first user turn

  const depth = getSignal(signals, 'DEPTH_VS_CIRCLING')
  const concreteness = getSignal(signals, 'CONCRETENESS_VS_ABSTRACTION')
  const affect = getSignal(signals, 'AFFECT_TRAJECTORY')
  const correction = getSignal(signals, 'CORRECTION_DETECTED')
  const feltShift = getSignal(signals, 'FELT_SHIFT_DETECTED')
  const guardedness = getSignal(signals, 'GUARDEDNESS')

  // ── Rule 1: ARRIVAL (first turn or high guardedness) ─────────────────────
  if (turnIndex === 0 || (guardedness && guardedness.value > 0.6 && turnIndex < 3)) {
    return {
      state: 'ARRIVAL',
      confidence: turnIndex === 0 ? 0.9 : 0.65,
      reasoning:
        turnIndex === 0
          ? 'First user turn — defaulting to ARRIVAL'
          : `High guardedness (${guardedness!.value.toFixed(2)}) in early turns`,
    }
  }

  // ── Rule 2: CRYSTALLIZING (felt shift + new content) ─────────────────────
  if (
    feltShift && feltShift.value > 0.7 && feltShift.confidence > 0.6 &&
    depth && depth.value > 0.1 // must have some new content, not just agreement
  ) {
    return {
      state: 'CRYSTALLIZING',
      confidence: 0.75,
      reasoning: `Felt-shift detected (${feltShift.value.toFixed(2)}) with new content — person has arrived somewhere`,
    }
  }

  // ── Rule 3: HOLDING (circling + closing affect) ───────────────────────────
  if (
    depth && depth.value < -0.3 &&
    affect && affect.value < -0.1
  ) {
    return {
      state: 'HOLDING',
      confidence: 0.65,
      reasoning: `Circling detected (depth ${depth.value.toFixed(2)}) with closing affect (${affect.value.toFixed(2)})`,
    }
  }

  // ── Rule 4: ORIENTING_OUTWARD (crystallized + forward language) ──────────
  // Check previous traces for CRYSTALLIZING state
  const prevUserWords = userTurns.slice(-1)[0]?.text.toLowerCase() ?? ''
  const forwardMarkers = ['want to', 'going to', 'will', 'next', 'plan', 'try', 'start', 'take']
  const forwardCount = forwardMarkers.filter((m) => prevUserWords.includes(m)).length
  if (forwardCount >= 2 && turnIndex >= 4) {
    return {
      state: 'ORIENTING_OUTWARD',
      confidence: 0.6,
      reasoning: `Forward-looking language detected (${forwardCount} markers) in later session`,
    }
  }

  // ── Rule 5: DEEPENING (rising novelty + concrete language + established trust) ──
  if (
    turnIndex >= 3 &&
    depth && depth.value > 0.3 &&
    concreteness && concreteness.value > -0.2
  ) {
    return {
      state: 'DEEPENING',
      confidence: 0.65,
      reasoning: `Rising novelty (depth ${depth.value.toFixed(2)}) with concrete language in mid-session`,
    }
  }

  // ── Rule 6: OPENING (some novelty, guardedness dropping) ─────────────────
  if (
    turnIndex >= 1 &&
    depth && depth.value > 0 &&
    (!guardedness || guardedness.value < 0.5)
  ) {
    return {
      state: 'OPENING',
      confidence: 0.6,
      reasoning: `Novelty rising (${depth.value.toFixed(2)}) and guardedness low — person is opening`,
    }
  }

  // ── Default: ARRIVAL with low confidence (when unsure, slow down) ─────────
  return {
    state: 'ARRIVAL',
    confidence: 0.35,
    reasoning: 'No clear state signal — defaulting to ARRIVAL with low confidence (philosophy: when in doubt, slow down)',
  }
}

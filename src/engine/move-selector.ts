/**
 * Move Selector v1 — the Policy. The engine's core.
 *
 * Blueprint §5: "Maps (state, signals, safety constraints, history) →
 * MoveDirective. Encodes the philosophy as inspectable logic."
 *
 * Selection logic: 10-rule ordered sequence from §5.2.
 * Two hard-coded philosophy biases (§5.3):
 *   1. Bias to exit under uncertainty — when confidence is low and the
 *      choice is "deepen vs stop", choose stop.
 *   2. Reflection over interrogation — once the person is genuinely
 *      working, default to reflecting rather than stacking questions.
 *
 * policy_version tracks which rule set produced each logged decision.
 */

import type {
  AlternativeConsidered,
  MoveConstraints,
  MoveDirective,
  MoveType,
  Signal,
  SignalType,
  Turn,
} from '@/types/domain'
import type { StateEstimate } from './state-estimator'

export const POLICY_VERSION = 'rule-based-v2'

// ─── Constraints table ────────────────────────────────────────────────────────

/** Exported for contract tests (§9.2 move-fidelity). */
export function defaultConstraints(move: MoveType): MoveConstraints {
  const returnableMoves: MoveType[] = [
    'REFLECTION', 'NAMING', 'CLARIFICATION', 'GENTLE_CHALLENGE', 'SUMMARY', 'RECONNECTION',
  ]
  const noAdviceMoves: MoveType[] = [
    'REFLECTION', 'NAMING', 'HOLDING', 'CLARIFICATION', 'QUESTION',
  ]
  const halfStepMoves: MoveType[] = ['NAMING', 'GENTLE_CHALLENGE']

  const lengthMap: Record<MoveType, MoveConstraints['max_length_hint']> = {
    HOLDING: 'SHORT',
    EXIT: 'SHORT',
    VALIDATION: 'SHORT',
    REFLECTION: 'MEDIUM',
    QUESTION: 'MEDIUM',
    CLARIFICATION: 'MEDIUM',
    NAMING: 'MEDIUM',
    RECONNECTION: 'MEDIUM',
    SUMMARY: 'MEDIUM',
    GENTLE_CHALLENGE: 'MEDIUM',
    ORIENTATION: 'MEDIUM',
    HANDOFF: 'LONG',
  }

  return {
    returnable: returnableMoves.includes(move),
    use_user_vocabulary: true,
    no_diagnosis: true,
    no_advice: noAdviceMoves.includes(move),
    max_length_hint: lengthMap[move],
    half_step_only: halfStepMoves.includes(move),
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function get(signals: Signal[], type: SignalType): Signal | undefined {
  return signals.find((s) => s.type === type)
}

function above(sig: Signal | undefined, value: number, confMin = 0.0): boolean {
  return !!sig && sig.confidence >= confMin && sig.value > value
}

function below(sig: Signal | undefined, value: number, confMin = 0.0): boolean {
  return !!sig && sig.confidence >= confMin && sig.value < value
}

/** Extract verbatim user phrases for focus_spans, picking emotionally salient clauses first. */
function selectFocusSpans(userText: string): string[] {
  const EMOTIONAL_WORDS = new Set([
    'terrified', 'devastated', 'desperate', 'heartbroken', 'furious', 'crushed',
    'overwhelmed', 'stuck', 'lost', 'invisible', 'broken', 'numb', 'grief',
    'angry', 'scared', 'afraid', 'alone', 'empty', 'hopeless', 'tired', 'ashamed',
    'confused', 'hurt', 'betrayed', 'jealous', 'guilty', 'ashamed',
  ])

  const clauses = userText
    .split(/[.!?;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8)

  // Score each clause: how many emotional words does it contain?
  const scored = clauses.map((c) => {
    const words = c.toLowerCase().split(/\s+/)
    const score = words.filter((w) => EMOTIONAL_WORDS.has(w)).length
    return { clause: c, score }
  })

  // Return top-scored first, then rest; max 3
  return scored
    .sort((a, b) => b.score - a.score)
    .map((s) => s.clause)
    .slice(0, 3)
}

function buildDirective(
  move: MoveType,
  rationale: string,
  alternatives: AlternativeConsidered[],
  userText: string,
  focusSpans?: string[]
): MoveDirective {
  return {
    move,
    constraints: defaultConstraints(move),
    focus_spans: focusSpans ?? selectFocusSpans(userText),
    rationale,
    alternatives_considered: alternatives,
  }
}

// ─── Policy ───────────────────────────────────────────────────────────────────

export function selectMove(
  estimate: StateEstimate,
  signals: Signal[],
  history: Turn[],
  userText: string
): MoveDirective {
  const { state, confidence } = estimate
  const alts: AlternativeConsidered[] = []

  const depth = get(signals, 'DEPTH_VS_CIRCLING')
  const concreteness = get(signals, 'CONCRETENESS_VS_ABSTRACTION')
  const affect = get(signals, 'AFFECT_TRAJECTORY')
  const correction = get(signals, 'CORRECTION_DETECTED')
  const feltShift = get(signals, 'FELT_SHIFT_DETECTED')
  const guardedness = get(signals, 'GUARDEDNESS')

  const aiTurns = history.filter((t) => t.speaker === 'AI')
  const lastAiMove = aiTurns.length > 0 ? undefined : undefined // placeholder for move history

  // ── Rule 1: Safety overrides all ────────────────────────────────────────────
  // Handled by orchestrator before this is called. HANDOFF → orchestrator only.

  // ── Rule 2: Circling → REFLECTION or HOLDING (never excavate a loop) ────────
  if (below(depth, -0.30, 0.55)) {
    alts.push({ move: 'QUESTION', reason_rejected: 'Circling detected — questions excavate loops' })
    const move = below(affect, -0.05) ? 'HOLDING' : 'REFLECTION'
    return buildDirective(
      move,
      `Circling (depth ${depth!.value.toFixed(2)}, conf ${(depth!.confidence * 100).toFixed(0)}%) — shift away from questions; ${move === 'HOLDING' ? 'closing affect too, so hold' : 'reflect without digging'}`,
      alts,
      userText
    )
  }

  // ── Rule 3: Abstract framing → steer concrete ───────────────────────────────
  if (below(concreteness, -0.35, 0.55)) {
    alts.push({ move: 'REFLECTION', reason_rejected: 'Abstract frame — reflection without grounding reinforces the loop' })

    // Persistent abstraction across several AI turns → stop excavating
    const aiTurnCount = aiTurns.length
    if (aiTurnCount >= 3) {
      alts.push({ move: 'CLARIFICATION', reason_rejected: 'Abstract framing persisting — time to hold rather than dig' })
      return buildDirective(
        'HOLDING',
        `Abstract framing persisting after ${aiTurnCount} turns (concreteness ${concreteness!.value.toFixed(2)}) — stop digging (§5.2 rule 3)`,
        alts,
        userText
      )
    }
    return buildDirective(
      'CLARIFICATION',
      `Abstract / evaluative framing (concreteness ${concreteness!.value.toFixed(2)}) — invite specifics: when, where, what happened`,
      alts,
      userText
    )
  }

  // ── Rule 6: Correction detected → preserve; reflect the corrected version ───
  // Checked early because it overrides most state-based logic.
  if (above(correction, 0.50, 0.55)) {
    alts.push({ move: 'VALIDATION', reason_rejected: 'Smoothing a correction erases the mechanism working — never "you\'re absolutely right"' })
    return buildDirective(
      'REFLECTION',
      `Correction detected (value ${correction!.value.toFixed(2)}, conf ${(correction!.confidence * 100).toFixed(0)}%) — reflect the corrected version without smoothing (§5.2 rule 6)`,
      alts,
      userText
    )
  }

  // ── Rule 7: Crystallising → light summary ───────────────────────────────────
  if (state === 'CRYSTALLIZING') {
    alts.push({ move: 'REFLECTION', reason_rejected: 'Arrival moment — person deserves to hear their own clarity, not just more reflection' })
    return buildDirective(
      'SUMMARY',
      'Person crystallising — light summary so they hear their own arrival; clarity stays theirs (§5.2 rule 7)',
      alts,
      userText
    )
  }

  // ── Rule 9: Payload delivered → ORIENTATION, then EXIT ──────────────────────
  if (state === 'ORIENTING_OUTWARD') {
    // If we already gave ORIENTATION last turn, offer EXIT
    const prevAiTexts = aiTurns.slice(-2).map((t) => t.text)
    const alreadyOriented = prevAiTexts.some((t) =>
      t.includes('carry forward') || t.includes('look like') || t.includes('What would')
    )
    if (alreadyOriented) {
      alts.push({ move: 'ORIENTATION', reason_rejected: 'Already oriented last turn — time to exit cleanly' })
      return buildDirective(
        'EXIT',
        'Person is orienting outward and already received an orientation move — exit cleanly (§5.2 rule 9)',
        alts,
        userText
      )
    }
    alts.push({ move: 'REFLECTION', reason_rejected: 'Payload delivered — reflection pulls backward when person is ready to face outward' })
    return buildDirective(
      'ORIENTATION',
      'Payload delivered; person is orienting outward — bridge toward concrete next steps (§5.2 rule 9)',
      alts,
      userText
    )
  }

  // ── Rule 10: Pain not wanting solving → HOLDING ──────────────────────────────
  if (state === 'HOLDING') {
    alts.push({ move: 'QUESTION', reason_rejected: 'HOLDING state — questions are intrusive' })
    alts.push({ move: 'REFLECTION', reason_rejected: 'HOLDING — no question attached; presence over excavation' })
    return buildDirective(
      'HOLDING',
      'Person needs presence, not solutions. A conversation may legitimately run ARRIVAL→HOLDING→EXIT with no payload (§5.2 rule 10)',
      alts,
      userText
    )
  }

  // ── Rules 4 & 5: Person working + new content ────────────────────────────────
  if (state === 'OPENING' || state === 'DEEPENING') {
    if (above(depth, 0.20, 0.45)) {
      // Philosophy bias 2: reflection over interrogation once genuinely working
      if (state === 'DEEPENING') {
        alts.push({ move: 'QUESTION', reason_rejected: 'Person is already working deeply — stacking questions interrupts the process (§5.3 bias 2)' })
        return buildDirective(
          'REFLECTION',
          `DEEPENING with rising novelty (depth ${depth!.value.toFixed(2)}) — reflect rather than interrogate`,
          alts,
          userText
        )
      }
      return buildDirective(
        'QUESTION',
        `OPENING with new content (depth ${depth!.value.toFixed(2)}) — open question built from their words (§5.2 rule 4)`,
        alts,
        userText
      )
    }

    // Rule 5: specific material in DEEPENING → reflection / naming
    if (state === 'DEEPENING') {
      alts.push({ move: 'QUESTION', reason_rejected: 'Specific material offered in DEEPENING — one more question would interrogate rather than reflect' })
      return buildDirective(
        'REFLECTION',
        'Specific material offered with established depth — reflect, half a step ahead, returnable (§5.2 rule 5)',
        alts,
        userText
      )
    }
  }

  // ── Rule 8: GENTLE_CHALLENGE ─────────────────────────────────────────────────
  // Only from OPENING / DEEPENING with established trust; never on ARRIVAL.
  // Not auto-selected in v1 — requires a trust/depth threshold gate not yet
  // implemented. Excluded deliberately; included here as a marker.

  // ── ARRIVAL: choose move based on context ────────────────────────────────────
  if (state === 'ARRIVAL') {
    // High guardedness at arrival → VALIDATION (warmth before depth)
    if (above(guardedness, 0.50, 0.50)) {
      alts.push({ move: 'QUESTION', reason_rejected: 'Person is guarded — a question may feel interrogating; validation first' })
      return buildDirective(
        'VALIDATION',
        `ARRIVAL with high guardedness (${guardedness!.value.toFixed(2)}) — warm acknowledgment before any depth`,
        alts,
        userText
      )
    }
    return buildDirective(
      'QUESTION',
      'ARRIVAL — open question built entirely from their words; no steered destination',
      alts,
      userText
    )
  }

  // ── Philosophy bias 1: low confidence → safe move ──────────────────────────
  if (confidence < 0.50) {
    alts.push({
      move: 'QUESTION',
      reason_rejected: `Low state confidence (${confidence.toFixed(2)}) — §5.3 bias 1: when ambiguous, bias toward stopping rather than deepening`,
    })
    return buildDirective(
      'VALIDATION',
      `Low state confidence (${confidence.toFixed(2)}) — validation is the safest move under uncertainty`,
      alts,
      userText
    )
  }

  // ── Fallback ──────────────────────────────────────────────────────────────────
  return buildDirective(
    'QUESTION',
    'No specific rule fired — open question as default (built from their words)',
    alts,
    userText
  )
}

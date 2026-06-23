/**
 * Move Selector — the Policy. The engine's core.
 *
 * Blueprint §5: "Maps (state, signals, safety constraints, history) →
 * MoveDirective. Encodes the philosophy as inspectable logic."
 *
 * Selection logic follows the 10-rule ordered sequence from §5.2.
 * The two hard-coded philosophy biases (§5.3):
 *   1. Bias to exit under uncertainty — when state confidence is low and
 *      the choice is deepen vs orient/stop, choose orient/stop.
 *   2. Reflection over interrogation — once the person is genuinely working,
 *      default to reflecting rather than stacking questions.
 *
 * This is rule-based for v1. The policy_version label tracks which version
 * of these rules produced a given decision — essential for the lab.
 */

import type {
  AlternativeConsidered,
  ConversationState,
  MoveConstraints,
  MoveDirective,
  MoveType,
  Signal,
  Turn,
} from '@/types/domain'
import type { StateEstimate } from './state-estimator'

export const POLICY_VERSION = 'rule-based-v1'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSignal(signals: Signal[], type: Signal['type']): Signal | undefined {
  return signals.find((s) => s.type === type)
}

function defaultConstraints(move: MoveType): MoveConstraints {
  const isReturnable = ['REFLECTION', 'NAMING', 'CLARIFICATION', 'GENTLE_CHALLENGE', 'SUMMARY', 'RECONNECTION'].includes(move)
  const noAdvice = ['REFLECTION', 'NAMING', 'HOLDING', 'CLARIFICATION', 'QUESTION'].includes(move)
  const isHalfStep = ['NAMING', 'GENTLE_CHALLENGE'].includes(move)

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
    returnable: isReturnable,
    use_user_vocabulary: true,
    no_diagnosis: true,
    no_advice: noAdvice,
    max_length_hint: lengthMap[move],
    half_step_only: isHalfStep,
  }
}

function extractUserPhrases(userText: string): string[] {
  // Split on punctuation and return the first 2–3 meaningful clauses.
  // These are the verbatim phrases the generator should build responses from.
  return userText
    .split(/[.!?;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8)
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
    focus_spans: focusSpans ?? extractUserPhrases(userText),
    rationale,
    alternatives_considered: alternatives,
  }
}

// ── Policy ────────────────────────────────────────────────────────────────────

export function selectMove(
  estimate: StateEstimate,
  signals: Signal[],
  history: Turn[],
  userText: string
): MoveDirective {
  const { state, confidence } = estimate
  const alternatives: AlternativeConsidered[] = []

  const depth = getSignal(signals, 'DEPTH_VS_CIRCLING')
  const concreteness = getSignal(signals, 'CONCRETENESS_VS_ABSTRACTION')
  const affect = getSignal(signals, 'AFFECT_TRAJECTORY')
  const correction = getSignal(signals, 'CORRECTION_DETECTED')
  const feltShift = getSignal(signals, 'FELT_SHIFT_DETECTED')
  const guardedness = getSignal(signals, 'GUARDEDNESS')

  // ── Rule 1: Safety overrides all ─────────────────────────────────────────
  // Handled by the orchestrator *before* this function is called.
  // HANDOFF is only emitted by the orchestrator on ESCALATION.

  // ── Rule 2: Circling detected → REFLECTION or HOLDING (no excavation) ────
  if (depth && depth.value < -0.3 && depth.confidence > 0.5) {
    alternatives.push({
      move: 'QUESTION',
      reason_rejected: 'Circling detected — questions would excavate the loop further',
    })
    const move = affect && affect.value < -0.1 ? 'HOLDING' : 'REFLECTION'
    return buildDirective(
      move,
      `Circling detected (depth ${depth.value.toFixed(2)}, conf ${depth.confidence.toFixed(2)}) — shift away from questions, hold or reflect without digging`,
      alternatives,
      userText
    )
  }

  // ── Rule 3: Abstract framing → steer concrete ─────────────────────────────
  if (concreteness && concreteness.value < -0.4 && concreteness.confidence > 0.4) {
    alternatives.push({
      move: 'REFLECTION',
      reason_rejected: 'Person in abstract frame — grounding needed before reflecting content',
    })
    // Persists across multiple turns → HOLDING / ORIENTATION (stop digging)
    const abstractTurnCount = history
      .filter((t) => t.speaker === 'AI')
      .slice(-3).length // simplified: if we're 3 turns in and still abstract
    if (abstractTurnCount >= 2) {
      alternatives.push({
        move: 'CLARIFICATION',
        reason_rejected: 'Abstract framing persisting — time to stop excavating',
      })
      return buildDirective(
        'HOLDING',
        `Abstract framing persisting across turns (concreteness ${concreteness.value.toFixed(2)}) — stop digging per blueprint §5.2 rule 3`,
        alternatives,
        userText
      )
    }
    return buildDirective(
      'CLARIFICATION',
      `Abstract / evaluative framing (concreteness ${concreteness.value.toFixed(2)}) — invite concrete specifics`,
      alternatives,
      userText
    )
  }

  // ── Rule 6: Correction detected → preserve it (checked early) ─────────────
  // Blueprint: "Never smooth with 'you're absolutely right.' Treat as
  // healthy deepening signal; reflect the corrected version."
  if (correction && correction.value > 0.5 && correction.confidence > 0.5) {
    alternatives.push({
      move: 'VALIDATION',
      reason_rejected: 'Correction detected — smoothing would erase the mechanism working',
    })
    return buildDirective(
      'REFLECTION',
      `Correction detected (${correction.value.toFixed(2)}) — reflect the corrected version without smoothing per §5.2 rule 6`,
      alternatives,
      userText
    )
  }

  // ── Rule 7: Crystallizing → light summary ─────────────────────────────────
  if (state === 'CRYSTALLIZING') {
    alternatives.push({
      move: 'REFLECTION',
      reason_rejected: 'Crystallising moment — person deserves to hear their arrival, not just more reflection',
    })
    return buildDirective(
      'SUMMARY',
      'Person crystallising — light summary so they hear their own arrival; clarity stays theirs',
      alternatives,
      userText
    )
  }

  // ── Rule 9: Payload delivered → ORIENTATION ───────────────────────────────
  if (state === 'ORIENTING_OUTWARD') {
    alternatives.push({
      move: 'REFLECTION',
      reason_rejected: 'Payload delivered — reflection would pull backward instead of forward',
    })
    return buildDirective(
      'ORIENTATION',
      'Payload delivered; person is orienting outward — help bridge toward concrete next steps',
      alternatives,
      userText
    )
  }

  // ── Rule 10: Pain not wanting solving → HOLDING ───────────────────────────
  if (state === 'HOLDING') {
    alternatives.push({
      move: 'QUESTION',
      reason_rejected: 'HOLDING state — questions are intrusive',
    })
    alternatives.push({
      move: 'REFLECTION',
      reason_rejected: 'HOLDING — no question attached; hold without excavating',
    })
    return buildDirective(
      'HOLDING',
      'Person needs presence, not excavation. A conversation may legitimately run ARRIVAL→HOLDING→EXIT with no clarity payload (blueprint §5.2 rule 10)',
      alternatives,
      userText
    )
  }

  // ── Rule 4 & 5: Person working + new content ──────────────────────────────
  if (state === 'OPENING' || state === 'DEEPENING') {
    if (depth && depth.value > 0.2) {
      // Rule 4: bias to REFLECTION once genuinely working (§5.3 bias 2)
      if (state === 'DEEPENING') {
        alternatives.push({
          move: 'QUESTION',
          reason_rejected: 'Person already working deeply — reflection preferred over stacking questions (§5.3 bias 2)',
        })
        return buildDirective(
          'REFLECTION',
          `DEEPENING with rising novelty (depth ${depth.value.toFixed(2)}) — reflect rather than interrogate`,
          alternatives,
          userText
        )
      }
      // OPENING: question is appropriate, built from their words
      return buildDirective(
        'QUESTION',
        `OPENING with new content (depth ${depth.value.toFixed(2)}) — open question built from their words`,
        alternatives,
        userText
      )
    }

    // Rule 5: specific material + trust → REFLECTION / NAMING
    if (state === 'DEEPENING') {
      alternatives.push({
        move: 'QUESTION',
        reason_rejected: 'Specific material offered in DEEPENING — reflection is more appropriate than more questions',
      })
      return buildDirective(
        'REFLECTION',
        'Specific material offered with established depth — reflect and be half a step ahead',
        alternatives,
        userText
      )
    }
  }

  // ── Rule 8: GENTLE_CHALLENGE ──────────────────────────────────────────────
  // Only from OPENING/DEEPENING with established trust, never on ARRIVAL
  // (not auto-selected; included here for completeness — remove when we add
  //  a trust/depth threshold gate)

  // ── Philosophy bias 1: bias to exit under uncertainty ────────────────────
  if (confidence < 0.5) {
    alternatives.push({
      move: 'QUESTION',
      reason_rejected: `Low state confidence (${confidence.toFixed(2)}) — bias to safer move per §5.3 philosophy bias 1`,
    })
    return buildDirective(
      'VALIDATION',
      `Low state confidence (${confidence.toFixed(2)}) — bias to exit/slow rather than deepen; validation is the safest move`,
      alternatives,
      userText
    )
  }

  // ── Default for ARRIVAL: open question ────────────────────────────────────
  return buildDirective(
    'QUESTION',
    'ARRIVAL state — open question to invite elaboration; built entirely from their words',
    alternatives,
    userText
  )
}

/**
 * Research Logger — the lab's raw material.
 *
 * Blueprint §7: "Every turn writes a complete trace. Not transcripts —
 * architecture as data. This makes every engine decision queryable and
 * lets us evaluate perception, decision, and expression as separable layers."
 *
 * Per turn we persist: raw user text, raw AI text, full Signal Set (with
 * confidences + evidence spans), inferred state + confidence, selected move +
 * rationale + alternatives, generation metadata, both safety screen results,
 * and any retroactively-linked correction from the following turn.
 */

import { store } from '@/storage/in-memory-store'
import type {
  Generation,
  MoveDecision,
  SafetyEvent,
  SignalSet,
  TurnAnalysis,
  TurnTrace,
  Turn,
} from '@/types/domain'
import type { StateEstimate } from '@/engine/state-estimator'
import { POLICY_VERSION } from '@/engine/move-selector'

export interface LogTurnParams {
  userTurn: Turn
  aiTurn: Turn
  signalSet: SignalSet
  stateEstimate: StateEstimate
  generation: Generation
  safetyEvents: SafetyEvent[]
}

export function logTurn(params: LogTurnParams): TurnTrace {
  const { userTurn, aiTurn, signalSet, stateEstimate, generation, safetyEvents } = params

  const analysis: TurnAnalysis = {
    turn_id: userTurn.id,
    signals: signalSet.signals,
    inferred_state: stateEstimate.state,
    state_confidence: stateEstimate.confidence,
  }

  const moveDecision: MoveDecision = {
    turn_id: aiTurn.id,
    selected_move: generation.move_directive.move,
    rationale: generation.move_directive.rationale,
    alternatives: generation.move_directive.alternatives_considered,
    constraints: generation.move_directive.constraints,
    policy_version: POLICY_VERSION,
  }

  const trace: TurnTrace = {
    user_turn: userTurn,
    ai_turn: aiTurn,
    signal_set: signalSet,
    analysis,
    move_decision: moveDecision,
    generation,
    safety_events: safetyEvents,
  }

  store.appendTrace(userTurn.conversation_id, trace)
  return trace
}

/**
 * When the next user message contains a correction, retroactively link it
 * to the AI turn it corrects. First-class data, not noise (blueprint §2).
 */
export function linkCorrection(conversationId: string, userTurnId: string): void {
  store.linkCorrection(conversationId, userTurnId)
}

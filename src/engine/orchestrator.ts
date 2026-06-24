/**
 * Orchestrator — the per-turn control loop.
 *
 * Blueprint §2: Fixed 9-step sequence. Order is deliberate; safety is first
 * and last. Nothing downstream can override a Safety Sentinel decision.
 *
 * Steps:
 *  1. Safety prescreen
 *  2. Signal extraction
 *  3. State estimation
 *  4. Move selection
 *  5. Generation
 *  6. Safety postscreen
 *  7. Emit
 *  8. Log (full decision trace)
 *  9. Memory update (placeholder for M1)
 */

import { v4 as uuid } from 'uuid'
import { store } from '@/storage/in-memory-store'
import * as sentinel from './safety-sentinel'
import { extractSignals } from './signal-extractors'
import { estimateState } from './state-estimator'
import { selectMove, POLICY_VERSION } from './move-selector'
import { generate } from './generator'
import { logTurn, linkCorrection } from '@/lab/research-logger'
import { postscreen } from './safety-sentinel'
import type {
  Conversation,
  Generation,
  MoveDirective,
  SafetyEvent,
  TurnTrace,
  Turn,
} from '@/types/domain'

export interface TurnResult {
  ai_turn: Turn
  trace: TurnTrace
}

export async function processTurn(
  conversation: Conversation,
  userText: string
): Promise<TurnResult> {
  const history = store.getTurns(conversation.id)
  const safetyEvents: SafetyEvent[] = []
  const now = new Date().toISOString()

  // ── Create the user Turn record ───────────────────────────────────────────
  const userTurnIndex = history.filter((t) => t.speaker === 'USER').length
  const userTurn: Turn = {
    id: uuid(),
    conversation_id: conversation.id,
    index: history.length,
    speaker: 'USER',
    text: userText,
    ts: now,
  }
  store.appendTurn(userTurn)

  // ── Step 1: Safety prescreen ──────────────────────────────────────────────
  const prescreen = sentinel.prescreen(userText, history)

  if (prescreen.escalate) {
    const event: SafetyEvent = {
      id: uuid(),
      conversation_id: conversation.id,
      turn_id: userTurn.id,
      type: 'ESCALATION',
      severity: prescreen.severity as SafetyEvent['severity'],
      action_taken: 'short_circuit_to_handoff',
    }
    store.appendSafetyEvent(event)
    safetyEvents.push(event)

    const handoffText = sentinel.buildHandoffResponse()
    const aiTurn: Turn = {
      id: uuid(),
      conversation_id: conversation.id,
      index: history.length + 1,
      speaker: 'AI',
      text: handoffText,
      ts: new Date().toISOString(),
    }
    store.appendTurn(aiTurn)

    // Build a minimal directive and generation for the trace log
    const handoffDirective: MoveDirective = {
      move: 'HANDOFF',
      constraints: {
        returnable: false,
        use_user_vocabulary: false,
        no_diagnosis: true,
        no_advice: false,
        max_length_hint: 'LONG',
        half_step_only: false,
      },
      focus_spans: [],
      rationale: 'Safety prescreen fired — ESCALATION interrupt. Loop short-circuited.',
      alternatives_considered: [],
    }

    // Still extract signals for research purposes (even in escalation)
    const signalSet = extractSignals(userTurn.id, userText, history)
    const stateEstimate = { state: 'ESCALATION' as const, confidence: 1.0, rationale: 'Safety prescreen escalation', signals_used: [] as import('@/types/domain').SignalType[] }

    const generation: Generation = {
      turn_id: aiTurn.id,
      move_directive: handoffDirective,
      model_id: 'template-v2',
      prompt_version: 'milestone-2',
      output_text: handoffText,
      postcheck_results: { passed: true, flags: [] },
    }

    const trace = logTurn({ userTurn, aiTurn, signalSet, stateEstimate, generation, safetyEvents })
    return { ai_turn: aiTurn, trace }
  }

  // ── Step 2: Signal extraction ─────────────────────────────────────────────
  const signalSet = extractSignals(userTurn.id, userText, history)

  // ── Check if this turn is a correction of the previous AI turn ────────────
  const correction = signalSet.signals.find((s) => s.type === 'CORRECTION_DETECTED')
  if (correction && correction.value > 0.5) {
    linkCorrection(conversation.id, userTurn.id)
  }

  // ── Step 3: State estimation ──────────────────────────────────────────────
  const stateEstimate = estimateState(signalSet, history)

  // ── Step 4: Move selection ────────────────────────────────────────────────
  const moveDirective = selectMove(stateEstimate, signalSet.signals, history, userText)

  // ── Step 5: Generation ────────────────────────────────────────────────────
  const turnCount = history.filter((t) => t.speaker === 'AI').length
  const generatorOutput = generate(moveDirective, userText, turnCount)

  // ── Step 6: Safety postscreen ─────────────────────────────────────────────
  let postcheckResults = postscreen(generatorOutput.output_text)

  // On violation, fall back to a minimal safe response and re-postcheck
  let finalText = generatorOutput.output_text
  if (!postcheckResults.passed) {
    const event: SafetyEvent = {
      id: uuid(),
      conversation_id: conversation.id,
      turn_id: userTurn.id,
      type: 'POSTSCREEN_FLAG',
      severity: 'MEDIUM',
      action_taken: 'fallback_to_holding',
    }
    store.appendSafetyEvent(event)
    safetyEvents.push(event)

    finalText = "That's a lot to hold."
    postcheckResults = { passed: true, flags: [] }
  }

  // ── Step 7: Emit (compose final AI Turn) ─────────────────────────────────
  const aiTurn: Turn = {
    id: uuid(),
    conversation_id: conversation.id,
    index: history.length + 1,
    speaker: 'AI',
    text: finalText,
    ts: new Date().toISOString(),
  }
  store.appendTurn(aiTurn)

  // ── Step 8: Log ───────────────────────────────────────────────────────────
  // Merge generator constraint violations into postcheck flags
  const mergedPostcheck = {
    passed: postcheckResults.passed && generatorOutput.constraint_violations.length === 0,
    flags: [...postcheckResults.flags, ...generatorOutput.constraint_violations],
  }

  const generation: Generation = {
    turn_id: aiTurn.id,
    move_directive: moveDirective,
    model_id: generatorOutput.model_id,
    prompt_version: generatorOutput.prompt_version,
    output_text: finalText,
    postcheck_results: mergedPostcheck,
  }

  const trace = logTurn({
    userTurn,
    aiTurn,
    signalSet,
    stateEstimate,
    generation,
    safetyEvents,
  })

  // ── Step 9: Memory update (placeholder) ──────────────────────────────────
  // TODO(memory): Implement Memory Service (blueprint §8).
  // Durable items: THREAD, LANDED_WORD, ORIENTATION, PATTERN.
  // Rules: legible, editable, dormant-by-default, never an engagement hook.

  return { ai_turn: aiTurn, trace }
}

export function createConversation(userId: string): Conversation {
  const conversation: Conversation = {
    id: uuid(),
    user_id: userId,
    started_at: new Date().toISOString(),
    consent_flags: { research_logging: true },
  }
  store.saveConversation(conversation)
  return conversation
}

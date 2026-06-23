// ─── Core enumerations ───────────────────────────────────────────────────────

export type Speaker = 'USER' | 'AI'

/** The seven regions a conversation can occupy. ESCALATION is an interrupt,
 *  not a stage — it can fire from anywhere. */
export type ConversationState =
  | 'ARRIVAL'
  | 'OPENING'
  | 'DEEPENING'
  | 'HOLDING'
  | 'CRYSTALLIZING'
  | 'ORIENTING_OUTWARD'
  | 'ESCALATION'

/** Every conversational move the engine can select. */
export type MoveType =
  | 'QUESTION'
  | 'REFLECTION'
  | 'VALIDATION'
  | 'CLARIFICATION'
  | 'NAMING'
  | 'SUMMARY'
  | 'GENTLE_CHALLENGE'
  | 'ORIENTATION'
  | 'HOLDING'
  | 'RECONNECTION'
  | 'EXIT'
  | 'HANDOFF'

/** The six perceptual signals the extractors emit. */
export type SignalType =
  | 'DEPTH_VS_CIRCLING'
  | 'CONCRETENESS_VS_ABSTRACTION'
  | 'AFFECT_TRAJECTORY'
  | 'CORRECTION_DETECTED'
  | 'FELT_SHIFT_DETECTED'
  | 'GUARDEDNESS'

export type MemoryItemType = 'THREAD' | 'LANDED_WORD' | 'ORIENTATION' | 'PATTERN'

export type OutcomeScope = 'IN_SESSION' | 'SESSION' | 'DELAYED'

export type SafetyEventType = 'PRESCREEN_FLAG' | 'POSTSCREEN_FLAG' | 'ESCALATION'

export type SafetySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export type MaxLengthHint = 'SHORT' | 'MEDIUM' | 'LONG'

// ─── Stable contract #1: Signal Set ──────────────────────────────────────────
// This is the boundary between Signal Extractors and the State Estimator.
// Keeping it stable means perception can be rewritten without touching the engine.

export interface Signal {
  type: SignalType
  /** Normalised value. DEPTH_VS_CIRCLING and CONCRETENESS_VS_ABSTRACTION use
   *  [-1, +1]; binary signals (CORRECTION_DETECTED, FELT_SHIFT_DETECTED) use
   *  [0, 1]; GUARDEDNESS uses [0, 1]. */
  value: number
  /** How much to trust this signal. Low confidence → downstream bias to slow down. */
  confidence: number
  /** Verbatim substrings from the user message that drove this signal. */
  evidence_spans: string[]
}

export interface SignalSet {
  turn_id: string
  signals: Signal[]
  extracted_at: string // ISO timestamp
}

// ─── Stable contract #2: Move Directive ──────────────────────────────────────
// This is the boundary between the Policy (engine) and the Generator (LLM).
// The LLM implements the directive; it may not change the move.

export interface MoveConstraints {
  returnable: boolean       // must invite correction ("am I off?")
  use_user_vocabulary: boolean
  no_diagnosis: true        // always; not a toggle
  no_advice: boolean        // true for REFLECTION / NAMING / HOLDING
  max_length_hint: MaxLengthHint
  half_step_only: boolean   // for NAMING / GENTLE_CHALLENGE
}

export interface AlternativeConsidered {
  move: MoveType
  reason_rejected: string
}

export interface MoveDirective {
  move: MoveType
  constraints: MoveConstraints
  /** Verbatim phrases from the user message the response should build from. */
  focus_spans: string[]
  /** Why this move was chosen. Logged, never shown to user. */
  rationale: string
  alternatives_considered: AlternativeConsidered[]
}

// ─── Data entities (§10) ─────────────────────────────────────────────────────

export interface Conversation {
  id: string
  user_id: string
  started_at: string // ISO
  ended_at?: string  // ISO
  consent_flags: Record<string, boolean>
  experiment_arm?: string
}

export interface Turn {
  id: string
  conversation_id: string
  index: number
  speaker: Speaker
  text: string
  ts: string // ISO
}

export interface TurnAnalysis {
  turn_id: string
  signals: Signal[]
  inferred_state: ConversationState
  state_confidence: number
}

export interface MoveDecision {
  turn_id: string
  selected_move: MoveType
  rationale: string
  alternatives: AlternativeConsidered[]
  constraints: MoveConstraints
  policy_version: string
}

export interface PostcheckResult {
  passed: boolean
  flags: string[]
}

export interface Generation {
  turn_id: string
  move_directive: MoveDirective
  model_id: string
  prompt_version: string
  output_text: string
  postcheck_results: PostcheckResult
}

export interface SafetyEvent {
  id: string
  conversation_id: string
  turn_id: string
  type: SafetyEventType
  severity: SafetySeverity
  action_taken: string
}

export interface MemoryItem {
  id: string
  user_id: string
  type: MemoryItemType
  content: string
  source_conversation_id: string
  source_turn_id: string
  user_visible: boolean
  user_edited: boolean
  status: 'ACTIVE' | 'DORMANT' | 'DELETED'
  created_at: string // ISO
}

export interface OutcomeMeasure {
  id: string
  conversation_id: string
  scope: OutcomeScope
  measure: string
  value: number
  rater_id?: string
  ts: string // ISO
}

// ─── Research Logger output ───────────────────────────────────────────────────
// One TurnTrace per AI turn — the lab's raw material.

export interface TurnTrace {
  user_turn: Turn
  ai_turn: Turn
  signal_set: SignalSet
  analysis: TurnAnalysis
  move_decision: MoveDecision
  generation: Generation
  safety_events: SafetyEvent[]
  /** Id of the user turn (next message) that retroactively corrected this AI turn. */
  correction_link?: string
}

/**
 * In-memory store for Milestone 1.
 * Module-level singleton — persists across API calls within the same Node
 * process (works in Next.js dev mode). Replace with a real DB in a later
 * milestone; the store interface is the only thing that needs to change.
 */

import type {
  Conversation,
  Turn,
  TurnTrace,
  SafetyEvent,
  MemoryItem,
  OutcomeMeasure,
} from '@/types/domain'

class InMemoryStore {
  private conversations = new Map<string, Conversation>()
  private turns = new Map<string, Turn[]>()           // conversation_id → turns
  private traces = new Map<string, TurnTrace[]>()     // conversation_id → traces
  private safetyEvents = new Map<string, SafetyEvent[]>() // conversation_id → events
  private memoryItems = new Map<string, MemoryItem[]>()   // user_id → items
  private outcomes = new Map<string, OutcomeMeasure[]>()  // conversation_id → outcomes

  // ── Conversations ──────────────────────────────────────────────────────────

  saveConversation(c: Conversation): void {
    this.conversations.set(c.id, c)
  }

  getConversation(id: string): Conversation | undefined {
    return this.conversations.get(id)
  }

  // ── Turns ──────────────────────────────────────────────────────────────────

  appendTurn(turn: Turn): void {
    const list = this.turns.get(turn.conversation_id) ?? []
    list.push(turn)
    this.turns.set(turn.conversation_id, list)
  }

  getTurns(conversationId: string): Turn[] {
    return this.turns.get(conversationId) ?? []
  }

  // ── Decision Traces ────────────────────────────────────────────────────────

  appendTrace(conversationId: string, trace: TurnTrace): void {
    const list = this.traces.get(conversationId) ?? []
    list.push(trace)
    this.traces.set(conversationId, list)
  }

  getTraces(conversationId: string): TurnTrace[] {
    return this.traces.get(conversationId) ?? []
  }

  getLatestTrace(conversationId: string): TurnTrace | undefined {
    const list = this.traces.get(conversationId) ?? []
    return list[list.length - 1]
  }

  /** Mark the last AI turn as corrected by the given user turn. */
  linkCorrection(conversationId: string, userTurnId: string): void {
    const list = this.traces.get(conversationId)
    if (!list || list.length === 0) return
    list[list.length - 1].correction_link = userTurnId
  }

  // ── Safety Events ──────────────────────────────────────────────────────────

  appendSafetyEvent(event: SafetyEvent): void {
    const list = this.safetyEvents.get(event.conversation_id) ?? []
    list.push(event)
    this.safetyEvents.set(event.conversation_id, list)
  }

  getSafetyEvents(conversationId: string): SafetyEvent[] {
    return this.safetyEvents.get(conversationId) ?? []
  }

  // ── Memory Items ───────────────────────────────────────────────────────────

  saveMemoryItem(item: MemoryItem): void {
    const list = this.memoryItems.get(item.user_id) ?? []
    const idx = list.findIndex((i) => i.id === item.id)
    if (idx >= 0) list[idx] = item
    else list.push(item)
    this.memoryItems.set(item.user_id, list)
  }

  getMemoryItems(userId: string): MemoryItem[] {
    return (this.memoryItems.get(userId) ?? []).filter((i) => i.status !== 'DELETED')
  }

  // ── Outcomes ───────────────────────────────────────────────────────────────

  appendOutcome(outcome: OutcomeMeasure): void {
    const list = this.outcomes.get(outcome.conversation_id) ?? []
    list.push(outcome)
    this.outcomes.set(outcome.conversation_id, list)
  }

  getOutcomes(conversationId: string): OutcomeMeasure[] {
    return this.outcomes.get(conversationId) ?? []
  }
}

// Singleton pinned to globalThis so it survives Next.js hot-module reloads
// and is shared across independently compiled API route modules in dev mode.
const g = globalThis as typeof globalThis & { __talk2me_store?: InMemoryStore }
if (!g.__talk2me_store) g.__talk2me_store = new InMemoryStore()
export const store = g.__talk2me_store

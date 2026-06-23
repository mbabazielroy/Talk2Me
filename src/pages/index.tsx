/**
 * Main page — split-panel Conversation Lab UI.
 * Left: chat. Right: decision trace for the selected AI turn.
 */

import { useState, useCallback } from 'react'
import type { Turn, TurnTrace, Conversation } from '@/types/domain'
import ChatPanel from '@/components/ChatPanel'
import TracePanel from '@/components/TracePanel'

interface Message {
  turn: Turn
  trace?: TurnTrace
}

export default function Home() {
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedTrace, setSelectedTrace] = useState<TurnTrace | null>(null)
  const [selectedAiTurnId, setSelectedAiTurnId] = useState<string | null>(null)
  const [selectedTurnIndex, setSelectedTurnIndex] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── Ensure a conversation exists ──────────────────────────────────────────
  async function ensureConversation(): Promise<Conversation> {
    if (conversation) return conversation
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!res.ok) throw new Error('Failed to start conversation')
    const c: Conversation = await res.json()
    setConversation(c)
    return c
  }

  // ── Send a message ────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!input.trim() || loading) return
    const text = input.trim()
    setInput('')
    setError(null)
    setLoading(true)

    try {
      const conv = await ensureConversation()

      // Add user message to UI immediately
      const userTurn: Turn = {
        id: `temp-user-${Date.now()}`,
        conversation_id: conv.id,
        index: messages.length,
        speaker: 'USER',
        text,
        ts: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, { turn: userTurn }])

      // Call the API
      const res = await fetch(`/api/conversations/${conv.id}/turns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })

      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? 'API error')
      }

      const { ai_turn, trace }: { ai_turn: Turn; trace: TurnTrace } = await res.json()

      // Replace temp user turn with the real one, add AI turn
      setMessages((prev) => {
        const updated = prev.slice(0, -1).concat({ turn: trace.user_turn })
        return [...updated, { turn: ai_turn, trace }]
      })

      // Auto-select the latest trace
      setSelectedTrace(trace)
      setSelectedAiTurnId(ai_turn.id)
      setSelectedTurnIndex(messages.length) // approximate turn index for display
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, loading, conversation, messages.length])

  function handleSelectTrace(trace: TurnTrace, turnId: string) {
    setSelectedTrace(trace)
    setSelectedAiTurnId(turnId)
    // Find turn index in messages
    const idx = messages.findIndex((m) => m.turn.id === turnId)
    setSelectedTurnIndex(idx >= 0 ? idx : null)
  }

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      background: '#fff',
    }}>

      {/* Top bar */}
      <div style={{
        padding: '0 20px',
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid #e5e7eb',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: '#111827' }}>Talk2Me</span>
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            background: '#fef3c7',
            color: '#92400e',
            borderRadius: 4,
            padding: '2px 7px',
            letterSpacing: 0.5,
          }}>CONVERSATION LAB · M1</span>
        </div>
        <span style={{ fontSize: 11, color: '#9ca3af' }}>
          user msg → signals → state → move → response → trace
        </span>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          padding: '8px 20px',
          background: '#fef2f2',
          color: '#991b1b',
          fontSize: 12,
          borderBottom: '1px solid #fecaca',
        }}>
          Error: {error}
        </div>
      )}

      {/* Split panel */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left: Chat */}
        <div style={{
          flex: '1 1 0',
          minWidth: 0,
          borderRight: '1px solid #e5e7eb',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <ChatPanel
            messages={messages}
            selectedAiTurnId={selectedAiTurnId}
            onSelectTrace={handleSelectTrace}
            input={input}
            onInputChange={setInput}
            onSend={handleSend}
            loading={loading}
            conversationId={conversation?.id ?? null}
          />
        </div>

        {/* Right: Trace */}
        <div style={{
          width: 380,
          flexShrink: 0,
          overflowY: 'auto',
          background: '#fafafa',
        }}>
          <div style={{
            padding: '10px 20px',
            borderBottom: '1px solid #e5e7eb',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1,
            color: '#9ca3af',
          }}>
            DECISION TRACE
          </div>
          <TracePanel trace={selectedTrace} turnIndex={selectedTurnIndex} />
        </div>

      </div>
    </div>
  )
}

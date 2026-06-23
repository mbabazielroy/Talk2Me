/**
 * ChatPanel — conversation UI with clickable AI turns to surface traces.
 */

import { useEffect, useRef } from 'react'
import type { Turn, TurnTrace } from '@/types/domain'

interface Message {
  turn: Turn
  trace?: TurnTrace
}

interface Props {
  messages: Message[]
  selectedAiTurnId: string | null
  onSelectTrace: (trace: TurnTrace, turnId: string) => void
  input: string
  onInputChange: (v: string) => void
  onSend: () => void
  loading: boolean
  conversationId: string | null
}

const MOVE_COLORS: Record<string, string> = {
  QUESTION: '#3b82f6',
  REFLECTION: '#8b5cf6',
  VALIDATION: '#10b981',
  CLARIFICATION: '#f59e0b',
  NAMING: '#ec4899',
  SUMMARY: '#06b6d4',
  GENTLE_CHALLENGE: '#f97316',
  ORIENTATION: '#6366f1',
  HOLDING: '#6b7280',
  RECONNECTION: '#84cc16',
  EXIT: '#14b8a6',
  HANDOFF: '#ef4444',
}

export default function ChatPanel({
  messages,
  selectedAiTurnId,
  onSelectTrace,
  input,
  onInputChange,
  onSend,
  loading,
  conversationId,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Session header */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid #e5e7eb',
        fontSize: 11,
        color: '#9ca3af',
        flexShrink: 0,
      }}>
        {conversationId
          ? <><span style={{ color: '#6b7280' }}>session</span> {conversationId.slice(0, 8)}…</>
          : 'no active session'}
      </div>

      {/* Message list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {messages.length === 0 && (
          <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', marginTop: 60 }}>
            <p style={{ marginBottom: 8 }}>Conversation Lab — Milestone 1</p>
            <p style={{ fontSize: 11 }}>Type something to start. Click any AI response to inspect its decision trace →</p>
          </div>
        )}

        {messages.map((msg, i) => {
          const isUser = msg.turn.speaker === 'USER'
          const isAI = msg.turn.speaker === 'AI'
          const isSelected = isAI && msg.turn.id === selectedAiTurnId
          const move = msg.trace?.move_decision.selected_move
          const moveColor = move ? (MOVE_COLORS[move] ?? '#6b7280') : undefined

          return (
            <div
              key={msg.turn.id}
              style={{
                marginBottom: 14,
                display: 'flex',
                flexDirection: isUser ? 'row-reverse' : 'row',
                alignItems: 'flex-start',
                gap: 8,
              }}
            >
              {/* Speaker icon */}
              <div style={{
                flexShrink: 0,
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: isUser ? '#3b82f6' : '#6b7280',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                color: '#fff',
                fontWeight: 700,
              }}>
                {isUser ? 'U' : 'AI'}
              </div>

              {/* Bubble */}
              <div style={{ maxWidth: '78%' }}>
                <div
                  onClick={isAI && msg.trace ? () => onSelectTrace(msg.trace!, msg.turn.id) : undefined}
                  style={{
                    background: isUser ? '#eff6ff' : '#f9fafb',
                    border: isSelected
                      ? `2px solid ${moveColor ?? '#6b7280'}`
                      : '2px solid transparent',
                    borderRadius: isUser ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
                    padding: '10px 14px',
                    fontSize: 14,
                    lineHeight: 1.55,
                    color: '#111827',
                    cursor: isAI && msg.trace ? 'pointer' : 'default',
                    transition: 'border-color 0.15s',
                  }}
                >
                  {msg.turn.text}
                </div>

                {/* Move badge */}
                {isAI && move && (
                  <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      display: 'inline-block',
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      color: moveColor,
                      background: moveColor + '15',
                      borderRadius: 3,
                      padding: '1px 6px',
                    }}>
                      {move}
                    </span>
                    {msg.trace && (
                      <span style={{ fontSize: 10, color: '#9ca3af' }}>
                        {msg.trace.analysis.inferred_state} · {Math.round(msg.trace.analysis.state_confidence * 100)}%
                      </span>
                    )}
                    {msg.trace?.correction_link && (
                      <span style={{ fontSize: 10, color: '#f59e0b' }}>⟳ corrected</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {loading && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', background: '#6b7280',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, color: '#fff', fontWeight: 700,
            }}>AI</div>
            <div style={{ background: '#f9fafb', border: '2px solid transparent', borderRadius: '4px 12px 12px 12px', padding: '10px 14px', color: '#9ca3af', fontSize: 13 }}>
              thinking…
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        borderTop: '1px solid #e5e7eb',
        padding: '12px 16px',
        display: 'flex',
        gap: 8,
        flexShrink: 0,
      }}>
        <textarea
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Type a message… (Enter to send)"
          disabled={loading}
          rows={2}
          style={{
            flex: 1,
            resize: 'none',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 14,
            fontFamily: 'inherit',
            outline: 'none',
            color: '#111827',
            lineHeight: 1.5,
          }}
        />
        <button
          onClick={onSend}
          disabled={loading || !input.trim()}
          style={{
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '0 18px',
            fontSize: 13,
            fontWeight: 600,
            cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
            opacity: loading || !input.trim() ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </div>
    </div>
  )
}

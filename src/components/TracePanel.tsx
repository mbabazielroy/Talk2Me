/**
 * TracePanel — displays the full decision trace for one AI turn.
 * This makes the engine architecture visible: every signal, state inference,
 * move decision, and rationale is shown in raw form.
 */

import type { TurnTrace, Signal, MoveType, ConversationState } from '@/types/domain'

interface Props {
  trace: TurnTrace | null
  turnIndex: number | null
}

// ── Signal bar ────────────────────────────────────────────────────────────────

function SignalBar({ value, min = -1, max = 1 }: { value: number; min?: number; max?: number }) {
  const pct = ((value - min) / (max - min)) * 100
  const isNegative = value < 0
  const color = isNegative ? '#f87171' : '#34d399'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          width: 120,
          height: 8,
          background: '#1f2937',
          borderRadius: 4,
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        <div style={{ width: `${Math.max(2, pct)}%`, height: '100%', background: color, borderRadius: 4 }} />
      </div>
      <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#9ca3af', minWidth: 40 }}>
        {value >= 0 ? '+' : ''}{value.toFixed(3)}
      </span>
    </div>
  )
}

// ── Confidence badge ──────────────────────────────────────────────────────────

function ConfBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 70 ? '#34d399' : pct >= 45 ? '#fbbf24' : '#f87171'
  return (
    <span style={{ color, fontFamily: 'monospace', fontSize: 11 }}>
      {pct}%
    </span>
  )
}

// ── Move chip ─────────────────────────────────────────────────────────────────

const MOVE_COLORS: Record<MoveType, string> = {
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

const STATE_COLORS: Record<ConversationState, string> = {
  ARRIVAL: '#6b7280',
  OPENING: '#3b82f6',
  DEEPENING: '#8b5cf6',
  HOLDING: '#fbbf24',
  CRYSTALLIZING: '#10b981',
  ORIENTING_OUTWARD: '#06b6d4',
  ESCALATION: '#ef4444',
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TracePanel({ trace, turnIndex }: Props) {
  if (!trace) {
    return (
      <div style={{ padding: 24, color: '#6b7280', fontSize: 13 }}>
        <p style={{ marginBottom: 8, fontWeight: 600, color: '#374151' }}>Decision Trace</p>
        <p>Select an AI turn to inspect its decision trace.</p>
      </div>
    )
  }

  const { analysis, move_decision, generation, signal_set, safety_events } = trace
  const moveColor = MOVE_COLORS[move_decision.selected_move] ?? '#6b7280'
  const stateColor = STATE_COLORS[analysis.inferred_state] ?? '#6b7280'

  return (
    <div style={{ padding: '16px 20px', fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>

      {/* Header */}
      <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>
          TURN #{(turnIndex ?? 0) + 1} · {new Date(trace.ai_turn.ts).toLocaleTimeString()}
          {trace.correction_link && (
            <span style={{ marginLeft: 8, color: '#f59e0b' }}>⟳ corrected by next turn</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#9ca3af' }}>
          policy: <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>{move_decision.policy_version}</code>
          {' · '}model: <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>{generation.model_id}</code>
        </div>
      </div>

      {/* State */}
      <Section label="STATE">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            background: stateColor,
            color: '#fff',
            borderRadius: 4,
            padding: '2px 8px',
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: 0.5,
          }}>
            {analysis.inferred_state}
          </span>
          <span style={{ color: '#6b7280', fontSize: 11 }}>
            confidence: <ConfBadge value={analysis.state_confidence} />
          </span>
        </div>
        <p style={{ marginTop: 6, color: '#6b7280', fontSize: 11, lineHeight: 1.5 }}>
          {/* State reasoning lives in the trace's generation rationale at estimator level */}
          {analysis.state_confidence < 0.5 && (
            <span style={{ color: '#f59e0b' }}>⚠ Low confidence — engine biased toward safer move</span>
          )}
        </p>
      </Section>

      {/* Signals */}
      <Section label="SIGNALS">
        {analysis.signals.map((sig) => (
          <div key={sig.type} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#374151' }}>
                {sig.type.toLowerCase().replace(/_/g, '_')}
              </span>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>
                conf: <ConfBadge value={sig.confidence} />
              </span>
            </div>
            <SignalBar
              value={sig.value}
              min={['GUARDEDNESS', 'CORRECTION_DETECTED', 'FELT_SHIFT_DETECTED'].includes(sig.type) ? 0 : -1}
              max={1}
            />
            {sig.evidence_spans.length > 0 && (
              <div style={{ marginTop: 3, fontSize: 10, color: '#9ca3af' }}>
                {sig.evidence_spans.slice(0, 3).join(' · ')}
              </div>
            )}
          </div>
        ))}
      </Section>

      {/* Selected Move */}
      <Section label="SELECTED MOVE">
        <span style={{
          background: moveColor,
          color: '#fff',
          borderRadius: 4,
          padding: '3px 10px',
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: 0.5,
        }}>
          {move_decision.selected_move}
        </span>
        <div style={{ marginTop: 8, fontSize: 11, color: '#6b7280' }}>
          <span>returnable: </span>
          <code style={{ color: move_decision.constraints.returnable ? '#10b981' : '#9ca3af' }}>
            {String(move_decision.constraints.returnable)}
          </code>
          <span style={{ marginLeft: 10 }}>no_advice: </span>
          <code style={{ color: move_decision.constraints.no_advice ? '#10b981' : '#9ca3af' }}>
            {String(move_decision.constraints.no_advice)}
          </code>
          <span style={{ marginLeft: 10 }}>length: </span>
          <code>{move_decision.constraints.max_length_hint}</code>
        </div>
      </Section>

      {/* Rationale */}
      <Section label="RATIONALE">
        <p style={{ color: '#374151', lineHeight: 1.6, fontSize: 12 }}>
          {move_decision.rationale}
        </p>
      </Section>

      {/* Focus spans */}
      {generation.move_directive.focus_spans.length > 0 && (
        <Section label="FOCUS SPANS">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {generation.move_directive.focus_spans.map((span, i) => (
              <span key={i} style={{
                background: '#f3f4f6',
                borderLeft: `3px solid ${moveColor}`,
                padding: '3px 8px',
                fontSize: 11,
                color: '#374151',
                borderRadius: '0 3px 3px 0',
              }}>
                "{span}"
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Alternatives */}
      {move_decision.alternatives.length > 0 && (
        <Section label="ALTERNATIVES CONSIDERED">
          {move_decision.alternatives.map((alt, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <span style={{
                background: '#f3f4f6',
                color: '#6b7280',
                borderRadius: 4,
                padding: '1px 6px',
                fontSize: 11,
                fontWeight: 600,
                textDecoration: 'line-through',
              }}>
                {alt.move}
              </span>
              <span style={{ marginLeft: 8, fontSize: 11, color: '#9ca3af' }}>
                {alt.reason_rejected}
              </span>
            </div>
          ))}
        </Section>
      )}

      {/* Safety events */}
      {safety_events.length > 0 && (
        <Section label="SAFETY EVENTS">
          {safety_events.map((ev, i) => (
            <div key={i} style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 4,
              padding: '6px 10px',
              fontSize: 11,
              color: '#991b1b',
              marginBottom: 4,
            }}>
              <strong>{ev.type}</strong> ({ev.severity}) — {ev.action_taken}
            </div>
          ))}
        </Section>
      )}

      {/* Postcheck */}
      <Section label="POSTSCREEN">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            color: generation.postcheck_results.passed ? '#10b981' : '#ef4444',
            fontWeight: 700,
          }}>
            {generation.postcheck_results.passed ? '✓ passed' : '✗ flagged'}
          </span>
          {generation.postcheck_results.flags.length > 0 && (
            <span style={{ fontSize: 11, color: '#ef4444' }}>
              {generation.postcheck_results.flags.join(', ')}
            </span>
          )}
        </div>
      </Section>

    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 1,
        color: '#9ca3af',
        marginBottom: 6,
        textTransform: 'uppercase',
      }}>
        {label}
      </div>
      {children}
    </div>
  )
}

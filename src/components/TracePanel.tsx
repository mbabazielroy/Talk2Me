/**
 * TracePanel — full decision trace for one AI turn.
 * Shows: signals (value + bar + confidence + rationale + evidence_spans),
 * state (inferred state + confidence + rationale + signals_used badges),
 * move (selected move + constraints + rationale + alternatives).
 */

import type { TurnTrace, Signal, MoveType, ConversationState, SignalType } from '@/types/domain'

interface Props {
  trace: TurnTrace | null
  turnIndex: number | null
}

// ─── Signal bar ───────────────────────────────────────────────────────────────

function SignalBar({ value, isBinary = false }: { value: number; isBinary?: boolean }) {
  const min = isBinary ? 0 : -1
  const pct = ((value - min) / (isBinary ? 1 : 2)) * 100
  const color =
    isBinary
      ? value > 0.6 ? '#f97316' : value > 0.3 ? '#fbbf24' : '#34d399'
      : value < -0.1 ? '#f87171' : value > 0.1 ? '#34d399' : '#9ca3af'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 100, height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ width: `${Math.max(2, pct)}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#6b7280', minWidth: 44 }}>
        {value >= 0 && !isBinary ? '+' : ''}{value.toFixed(3)}
      </span>
    </div>
  )
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function ConfBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 70 ? '#059669' : pct >= 50 ? '#d97706' : '#dc2626'
  return <span style={{ color, fontFamily: 'monospace', fontSize: 10, fontWeight: 700 }}>{pct}%</span>
}

function SignalBadge({ type }: { type: SignalType }) {
  return (
    <span style={{
      background: '#f3f4f6',
      border: '1px solid #e5e7eb',
      borderRadius: 3,
      padding: '1px 5px',
      fontSize: 10,
      fontFamily: 'monospace',
      color: '#374151',
    }}>
      {type.toLowerCase()}
    </span>
  )
}

// ─── Colours ──────────────────────────────────────────────────────────────────

const MOVE_COLORS: Record<MoveType, string> = {
  QUESTION: '#3b82f6', REFLECTION: '#8b5cf6', VALIDATION: '#10b981',
  CLARIFICATION: '#f59e0b', NAMING: '#ec4899', SUMMARY: '#06b6d4',
  GENTLE_CHALLENGE: '#f97316', ORIENTATION: '#6366f1', HOLDING: '#6b7280',
  RECONNECTION: '#84cc16', EXIT: '#14b8a6', HANDOFF: '#ef4444',
}

const STATE_COLORS: Record<ConversationState, string> = {
  ARRIVAL: '#6b7280', OPENING: '#3b82f6', DEEPENING: '#8b5cf6',
  HOLDING: '#d97706', CRYSTALLIZING: '#059669',
  ORIENTING_OUTWARD: '#06b6d4', ESCALATION: '#ef4444',
}

const BINARY_SIGNALS = new Set<SignalType>(['CORRECTION_DETECTED', 'FELT_SHIFT_DETECTED', 'GUARDEDNESS'])

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase' }}>
        {label}
      </div>
      {children}
    </div>
  )
}

// ─── Signal row ───────────────────────────────────────────────────────────────

function SignalRow({ sig }: { sig: Signal }) {
  const [expanded, setExpanded] = React.useState(false)
  const isBinary = BINARY_SIGNALS.has(sig.type)

  return (
    <div style={{ marginBottom: 12, borderLeft: '2px solid #f3f4f6', paddingLeft: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            fontFamily: 'monospace', fontSize: 11, color: '#374151', textAlign: 'left',
          }}
        >
          {expanded ? '▾' : '▸'} {sig.type.toLowerCase()}
        </button>
        <ConfBadge value={sig.confidence} />
      </div>

      <SignalBar value={sig.value} isBinary={isBinary} />

      {expanded && (
        <div style={{ marginTop: 8 }}>
          {sig.rationale && (
            <p style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.55, marginBottom: 6 }}>
              {sig.rationale}
            </p>
          )}
          {sig.evidence_spans.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {sig.evidence_spans.map((span, i) => (
                <span key={i} style={{
                  fontSize: 10, background: '#fafafa', border: '1px solid #e5e7eb',
                  borderRadius: 3, padding: '2px 6px', color: '#6b7280', fontFamily: 'monospace',
                }}>
                  {span}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Need React for useState in SignalRow
import React from 'react'

// ─── Main component ───────────────────────────────────────────────────────────

export default function TracePanel({ trace, turnIndex }: Props) {
  if (!trace) {
    return (
      <div style={{ padding: 24, color: '#9ca3af', fontSize: 13 }}>
        <p style={{ marginBottom: 6, fontWeight: 600, color: '#374151' }}>Decision Trace</p>
        <p style={{ lineHeight: 1.6 }}>Click any AI response to inspect its full decision trace: signals → state → move.</p>
      </div>
    )
  }

  const { analysis, move_decision, generation, safety_events } = trace
  const moveColor = MOVE_COLORS[move_decision.selected_move] ?? '#6b7280'
  const stateColor = STATE_COLORS[analysis.inferred_state] ?? '#6b7280'

  return (
    <div style={{ padding: '16px 20px', fontSize: 13, fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #f3f4f6' }}>
        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>
          Turn #{(turnIndex ?? 0) + 1} · {new Date(trace.ai_turn.ts).toLocaleTimeString()}
          {trace.correction_link && (
            <span style={{ marginLeft: 8, color: '#d97706', fontWeight: 600 }}>⟳ next turn corrected this</span>
          )}
        </div>
        <div style={{ fontSize: 10, color: '#9ca3af' }}>
          policy: <code style={{ background: '#f9fafb', padding: '0 4px' }}>{move_decision.policy_version}</code>
          {' · '}model: <code style={{ background: '#f9fafb', padding: '0 4px' }}>{generation.model_id}</code>
        </div>
      </div>

      {/* ── STATE ── */}
      <Section label="State">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{
            background: stateColor, color: '#fff',
            borderRadius: 4, padding: '2px 9px',
            fontWeight: 700, fontSize: 12, letterSpacing: 0.5,
          }}>
            {analysis.inferred_state}
          </span>
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            confidence: <ConfBadge value={analysis.state_confidence} />
          </span>
        </div>

        {analysis.state_rationale && (
          <p style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.55, marginBottom: 8 }}>
            {analysis.state_rationale}
          </p>
        )}

        {analysis.signals_used.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#9ca3af', alignSelf: 'center' }}>drove by:</span>
            {analysis.signals_used.map((s) => <SignalBadge key={s} type={s} />)}
          </div>
        )}

        {analysis.state_confidence < 0.50 && (
          <p style={{ marginTop: 6, fontSize: 10, color: '#d97706', fontWeight: 600 }}>
            ⚠ Low confidence — engine biased toward safer move (§5.3 bias 1)
          </p>
        )}
      </Section>

      {/* ── SIGNALS ── */}
      <Section label={`Signals (${analysis.signals.length}) — click to expand`}>
        {analysis.signals.map((sig) => <SignalRow key={sig.type} sig={sig} />)}
      </Section>

      {/* ── MOVE ── */}
      <Section label="Selected Move">
        <div style={{ marginBottom: 8 }}>
          <span style={{
            background: moveColor, color: '#fff',
            borderRadius: 4, padding: '3px 10px',
            fontWeight: 700, fontSize: 12, letterSpacing: 0.5,
          }}>
            {move_decision.selected_move}
          </span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {[
            ['returnable', move_decision.constraints.returnable],
            ['no_advice', move_decision.constraints.no_advice],
            ['half_step', move_decision.constraints.half_step_only],
          ].map(([label, val]) => (
            <span key={String(label)} style={{
              fontSize: 10, padding: '1px 6px',
              background: val ? '#f0fdf4' : '#f9fafb',
              border: `1px solid ${val ? '#86efac' : '#e5e7eb'}`,
              borderRadius: 3, color: val ? '#16a34a' : '#9ca3af',
              fontFamily: 'monospace',
            }}>
              {String(label)}: {String(val)}
            </span>
          ))}
          <span style={{
            fontSize: 10, padding: '1px 6px',
            background: '#f0f9ff', border: '1px solid #bae6fd',
            borderRadius: 3, color: '#0369a1', fontFamily: 'monospace',
          }}>
            length: {move_decision.constraints.max_length_hint}
          </span>
        </div>

        <p style={{ fontSize: 11, color: '#374151', lineHeight: 1.6, marginBottom: 0 }}>
          {move_decision.rationale}
        </p>
      </Section>

      {/* ── FOCUS SPANS ── */}
      {generation.move_directive.focus_spans.length > 0 && (
        <Section label="Focus Spans (user's words)">
          {generation.move_directive.focus_spans.map((span, i) => (
            <div key={i} style={{
              borderLeft: `3px solid ${moveColor}`, padding: '3px 8px',
              marginBottom: 4, fontSize: 11, color: '#374151',
              background: '#fafafa', borderRadius: '0 3px 3px 0',
              fontStyle: 'italic',
            }}>
              "{span}"
            </div>
          ))}
        </Section>
      )}

      {/* ── ALTERNATIVES ── */}
      {move_decision.alternatives.length > 0 && (
        <Section label="Alternatives Considered">
          {move_decision.alternatives.map((alt, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <span style={{
                background: '#f3f4f6', color: '#9ca3af',
                borderRadius: 3, padding: '1px 6px',
                fontSize: 11, fontWeight: 600, textDecoration: 'line-through',
                fontFamily: 'monospace',
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

      {/* ── POSTSCREEN ── */}
      <Section label="Postscreen">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontWeight: 700,
            color: generation.postcheck_results.passed ? '#059669' : '#dc2626',
          }}>
            {generation.postcheck_results.passed ? '✓ passed' : '✗ flagged'}
          </span>
          {generation.postcheck_results.flags.map((f, i) => (
            <span key={i} style={{ fontSize: 10, color: '#dc2626', fontFamily: 'monospace' }}>{f}</span>
          ))}
        </div>
      </Section>

      {/* ── SAFETY EVENTS ── */}
      {safety_events.length > 0 && (
        <Section label="Safety Events">
          {safety_events.map((ev, i) => (
            <div key={i} style={{
              background: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: 4, padding: '6px 10px', fontSize: 11, color: '#991b1b', marginBottom: 4,
            }}>
              <strong>{ev.type}</strong> ({ev.severity}) — {ev.action_taken}
            </div>
          ))}
        </Section>
      )}

    </div>
  )
}

/**
 * Safety Sentinel — prescreen and postscreen.
 *
 * Blueprint §6: "Built first, because how we handle the worst moment
 * constrains memory, confidentiality, and every transition."
 *
 * M1 STATUS: Placeholder implementation with clear TODOs.
 * The structure and interface are correct; the classification logic
 * is intentionally minimal and must be replaced before any real use.
 *
 * TODO(safety): Replace keyword matching with a proper risk classifier.
 * TODO(safety): Implement the full Handoff path (operational + ethical,
 *               not just a software stub — see blueprint §6 open problem 3).
 * TODO(safety): Resolve the confidentiality-vs-safety policy decision
 *               (founder call, blueprint §6) before building the real
 *               handoff path. This propagates into memory + data retention.
 */

import type { Turn } from '@/types/domain'

export interface PrescreenResult {
  escalate: boolean
  severity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  flags: string[]
}

export interface PostcheckResult {
  passed: boolean
  flags: string[]
}

// ── Prescreen ─────────────────────────────────────────────────────────────────

const ACUTE_RISK_KEYWORDS = [
  'kill myself',
  'end my life',
  'suicide',
  'want to die',
  'hurt myself',
  'self harm',
]

/**
 * Classifies the inbound user message for acute risk *before* the engine
 * reasons about it. On fire → ESCALATION interrupt. Nothing downstream
 * overrides this.
 */
export function prescreen(text: string, _history: Turn[]): PrescreenResult {
  const lower = text.toLowerCase()
  const triggered = ACUTE_RISK_KEYWORDS.filter((kw) => lower.includes(kw))

  if (triggered.length > 0) {
    return {
      escalate: true,
      severity: 'CRITICAL',
      flags: triggered.map((kw) => `keyword_match:${kw}`),
    }
  }

  return { escalate: false, severity: 'NONE', flags: [] }
}

// ── Postscreen ────────────────────────────────────────────────────────────────

const DIAGNOSIS_PATTERNS = [
  /you (have|are suffering from|show signs of) (depression|anxiety|ptsd|bipolar|bpd)/i,
  /sounds like (depression|anxiety|a disorder)/i,
]

const MEANS_PATTERNS = [
  /overdose on/i,
  /method(s)? (to|for) (die|end|harm)/i,
]

const OVERREACH_PATTERNS = [
  /you should (see|get|consult|visit) a (therapist|doctor|psychiatrist)/i,
  /you need (therapy|medication|professional help)/i,
]

/**
 * Checks generated AI text against output constraints.
 * Violations → caller should regenerate or fall back to a safe minimal move.
 */
export function postscreen(text: string): PostcheckResult {
  const flags: string[] = []

  for (const pat of DIAGNOSIS_PATTERNS) {
    if (pat.test(text)) flags.push(`diagnosis_language:${pat.source.slice(0, 30)}`)
  }
  for (const pat of MEANS_PATTERNS) {
    if (pat.test(text)) flags.push(`means_related:${pat.source.slice(0, 30)}`)
  }
  for (const pat of OVERREACH_PATTERNS) {
    if (pat.test(text)) flags.push(`overreaching_advice:${pat.source.slice(0, 30)}`)
  }

  return { passed: flags.length === 0, flags }
}

// ── Handoff response ──────────────────────────────────────────────────────────

/**
 * Returns the text to emit when ESCALATION fires.
 *
 * TODO(safety): This is a placeholder. The real handoff path is an operational
 * and ethical problem — see blueprint §6 and open problem 3. It must not
 * perform safety-assessment interrogation, must not name means, must surface
 * human resources, and must not abandon the person or pretend to be a crisis
 * service. A clean stub does not solve "who is the human at 3am."
 */
export function buildHandoffResponse(): string {
  return (
    "I want to make sure you have the right support right now. " +
    "Please reach out to a crisis line — in the US, you can call or text 988. " +
    "I'm here with you while you find that support. " +
    "[PLACEHOLDER — TODO: implement full handoff path per blueprint §6]"
  )
}

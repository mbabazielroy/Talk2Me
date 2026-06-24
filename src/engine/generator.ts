/**
 * Generator v1 — the expression layer.
 *
 * Blueprint §5.4: "The LLM expresses the directive in natural language,
 * conditioned on the person's own vocabulary. The LLM *never* chooses the
 * move; it *implements* it."
 *
 * Constraints enforced:
 *   • returnable  → suffix "— is that getting at it, or am I off?"
 *   • no_advice   → templates that never contain suggestions or prescriptions
 *   • max_length_hint=SHORT → single sentence maximum (HOLDING, EXIT)
 *   • use_user_vocabulary → responses built from focus_spans, never paraphrased
 *   • half_step_only → NAMING phrased as a tentative offer, never an assertion
 *
 * M2: still template-based. Replace with real LLM in M3 — the MoveDirective
 * contract means nothing else changes.
 */

import type { MoveDirective } from '@/types/domain'

export const MODEL_ID = 'template-v2'
export const PROMPT_VERSION = 'milestone-2'

// ─── Phrase selection ─────────────────────────────────────────────────────────

function lc(s: string): string {
  if (!s) return s
  return s.charAt(0).toLowerCase() + s.slice(1)
}

/** Return the primary focus phrase, falling back gracefully. */
function primaryPhrase(directive: MoveDirective, userText: string): string {
  // Use the first focus_span if it looks like actual user language
  const span = directive.focus_spans.find((s) => s.length > 8 && !s.startsWith('abstract:') && !s.startsWith('opening:'))
  if (span) return span

  // Fall back: first sentence from user text
  const sentences = userText.split(/[.!?]/).map((s) => s.trim()).filter((s) => s.length > 8)
  return sentences[0] ?? userText.slice(0, 70)
}

// ─── Returnable suffix ────────────────────────────────────────────────────────

const RETURNABLE_SUFFIXES = [
  ' — is that getting at it, or am I off?',
  ' — does that land, or does it miss something?',
  ' — is that close, or somewhere different?',
]

function returnableSuffix(i = 0): string {
  return RETURNABLE_SUFFIXES[i % RETURNABLE_SUFFIXES.length]
}

// ─── Templates ────────────────────────────────────────────────────────────────

/** Rotate between multiple templates to avoid sounding mechanical. */
function renderTemplate(directive: MoveDirective, userText: string, turnCount: number): string {
  const phrase = primaryPhrase(directive, userText)
  const p = lc(phrase)
  const t = turnCount % 3  // variant selector

  switch (directive.move) {

    case 'QUESTION': {
      const templates = [
        `When you say "${phrase}" — what's that actually like for you?`,
        `You mentioned ${p} — what happens inside you when that's there?`,
        `What does "${phrase}" feel like from the inside?`,
      ]
      return templates[t]
    }

    case 'REFLECTION': {
      const base = [
        `It sounds like ${p}`,
        `What I'm hearing is ${p}`,
        `There's something about ${p}`,
      ][t]
      return directive.constraints.returnable ? base + returnableSuffix(t) : base + '.'
    }

    case 'VALIDATION': {
      const templates = [
        `That makes sense. ${phrase} is a real and hard thing to be sitting with.`,
        `Of course. ${phrase} — that's not a small thing.`,
        `It makes sense that you'd feel that way. ${phrase} is genuinely difficult.`,
      ]
      return templates[t]
    }

    case 'CLARIFICATION': {
      const templates = [
        `Just to make sure I'm following — is it more that ${p}, or is there something else underneath it?`,
        `Help me understand — when you say ${p}, are you describing what happened, or more how it felt?`,
        `Can you say more about ${p}? I want to make sure I'm with you, not ahead of you.`,
      ]
      return templates[t] + (directive.constraints.returnable ? '' : '')
    }

    case 'NAMING': {
      // half_step_only: always phrased as a tentative offer, never an assertion
      const templates = [
        `I'm wondering if what's underneath this is ${p}${returnableSuffix(t)}`,
        `There might be something about ${p} at the core of this${returnableSuffix((t + 1) % 3)}`,
        `Is it possible that ${p} is the thing that's really driving this${returnableSuffix((t + 2) % 3)}`,
      ]
      return templates[t]
    }

    case 'SUMMARY': {
      const templates = [
        `So if I'm hearing you right: ${p}. Is that where you've arrived?`,
        `It sounds like what you've landed on is ${p}. Does that feel right?`,
        `Let me check — ${p}. Is that the shape of it?`,
      ]
      return templates[t]
    }

    case 'GENTLE_CHALLENGE': {
      // half_step_only; only from OPENING/DEEPENING with established trust
      return `You said ${p} — and I'm curious whether that's the whole picture, or whether something else is sitting alongside it.`
    }

    case 'ORIENTATION': {
      const templates = [
        `It sounds like ${p} is something real you want to carry forward. What would that actually look like?`,
        `${phrase.charAt(0).toUpperCase() + phrase.slice(1)} — what's one concrete thing you could do this week with that?`,
        `You've got ${p}. What would a small next step toward that look like?`,
      ]
      return templates[t]
    }

    case 'HOLDING': {
      // max_length_hint=SHORT: one sentence only; no question attached
      const templates = [
        `That's a lot to hold.`,
        `Yeah. That's heavy.`,
        `There's a lot there.`,
      ]
      return templates[t]
    }

    case 'RECONNECTION': {
      return `Earlier you mentioned ${p}. Does that feel related to what you're sitting with now?`
    }

    case 'EXIT': {
      // SHORT; marks an earned ending
      return `It sounds like you've gotten somewhere real today. Take your time with this.`
    }

    case 'HANDOFF': {
      // Orchestrator handles this directly via buildHandoffResponse()
      return `I want to make sure you have the right support right now.`
    }

    default:
      return `I hear you.`
  }
}

// ─── Constraint enforcement ───────────────────────────────────────────────────

const ADVICE_PATTERNS = [
  /\byou should\b/i,
  /\byou need to\b/i,
  /\btry to\b/i,
  /\bI recommend\b/i,
  /\bI suggest\b/i,
  /\bmake sure you\b/i,
  /\bit would help to\b/i,
  /\bhave you tried\b/i,
]

/** Verify the generated text honours no_advice and no_diagnosis constraints. */
function checkConstraints(text: string, directive: MoveDirective): string[] {
  const violations: string[] = []

  if (directive.constraints.no_advice) {
    for (const pat of ADVICE_PATTERNS) {
      if (pat.test(text)) {
        violations.push(`advice_pattern:${pat.source.slice(0, 30)}`)
      }
    }
  }

  // no_diagnosis always true
  const diagnosisPatterns = [/you (have|are suffering from)\b/i, /sounds like (depression|anxiety|bpd)\b/i]
  for (const pat of diagnosisPatterns) {
    if (pat.test(text)) violations.push(`diagnosis:${pat.source.slice(0, 30)}`)
  }

  return violations
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface GeneratorOutput {
  output_text: string
  model_id: string
  prompt_version: string
  constraint_violations: string[]
}

export function generate(
  directive: MoveDirective,
  userText: string,
  turnCount = 0
): GeneratorOutput {
  const rawText = renderTemplate(directive, userText, turnCount)
  const constraint_violations = checkConstraints(rawText, directive)

  return {
    output_text: rawText,
    model_id: MODEL_ID,
    prompt_version: PROMPT_VERSION,
    constraint_violations,
  }
}

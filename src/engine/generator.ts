/**
 * Generator — the expression layer.
 *
 * Blueprint §5.4: "The LLM expresses the directive in natural language,
 * conditioned on the person's own vocabulary. The LLM *never* chooses the
 * move; it *implements* it."
 *
 * M1 STATUS: Template-based mock. Incorporates the user's actual words
 * (from focus_spans or the raw text) so the architecture feels real.
 * Replace with an actual LLM call in the next milestone — the MoveDirective
 * contract means nothing else changes.
 *
 * Move-fidelity (did the text actually implement the directive?) is checked
 * in the postscreen step, not here.
 */

import type { MoveDirective } from '@/types/domain'

const MODEL_ID = 'mock-template-v1'
const PROMPT_VERSION = 'milestone-1'

// ── Phrase extraction ─────────────────────────────────────────────────────────

function extractPhrase(directive: MoveDirective, userText: string): string {
  if (directive.focus_spans.length > 0 && directive.focus_spans[0].length > 4) {
    return directive.focus_spans[0]
  }
  // Fall back to the first meaningful clause from user text
  const clauses = userText
    .split(/[.,;!?]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10)
  return clauses[0] ?? userText.slice(0, 60)
}

function lc(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

// ── Response templates by move ────────────────────────────────────────────────

function renderTemplate(directive: MoveDirective, userText: string): string {
  const phrase = extractPhrase(directive, userText)

  switch (directive.move) {
    case 'QUESTION':
      return `When you say "${phrase}" — what's that actually like for you?`

    case 'REFLECTION':
      return directive.constraints.returnable
        ? `It sounds like ${lc(phrase)} — is that getting at it, or am I off?`
        : `It sounds like ${lc(phrase)}.`

    case 'VALIDATION':
      return `That makes sense. ${phrase} is a real and hard thing to be sitting with.`

    case 'CLARIFICATION':
      return `Just to make sure I'm following — is it more that ${lc(phrase)}, or is there something else underneath it?`

    case 'NAMING':
      return `I'm wondering if what's underneath all of this is ${lc(phrase)}. Does that land, or does it miss something?`

    case 'SUMMARY':
      return `So if I'm hearing you right: ${lc(phrase)}. Is that where you've arrived?`

    case 'GENTLE_CHALLENGE':
      return `You said ${lc(phrase)} — and I'm curious whether that's the whole picture, or if something else is there too.`

    case 'ORIENTATION':
      return `It sounds like ${lc(phrase)} is something real you want to carry forward. What would that actually look like?`

    case 'HOLDING':
      return `That's a lot to hold.`

    case 'RECONNECTION':
      return `Earlier you mentioned ${lc(phrase)}. Does that feel related to what you're sitting with now?`

    case 'EXIT':
      return `It sounds like you've gotten somewhere real today. Take your time with this.`

    case 'HANDOFF':
      // Should not reach here — orchestrator short-circuits to buildHandoffResponse()
      return `I want to make sure you have the right support right now.`

    default:
      return `I hear you.`
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface GeneratorOutput {
  output_text: string
  model_id: string
  prompt_version: string
}

export function generate(directive: MoveDirective, userText: string): GeneratorOutput {
  const output_text = renderTemplate(directive, userText)
  return { output_text, model_id: MODEL_ID, prompt_version: PROMPT_VERSION }
}

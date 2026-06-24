/**
 * Signal Extractors v1 — the perceptual layer.
 *
 * Blueprint §3: "Each extractor is independent, composable, and individually
 * evaluable against human-labeled transcripts."
 *
 * Each extractor returns Signal { type, value, confidence, evidence_spans, rationale }.
 * The rationale is a human-readable explanation logged in every trace and shown
 * in the Trace Viewer — making perception inspectable, not a black box.
 *
 * Confident limits (from blueprint §3): "Text is a thin, deceptive channel
 * and these extractors will be wrong often, especially early. Build them
 * humble: downstream logic must treat low-confidence signals as reasons to
 * slow down, never to push."
 */

import type { Signal, SignalSet, Turn } from '@/types/domain'

// ─── Shared helpers ───────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/['']/g, "'").split(/\s+/).filter(Boolean)
}

/** Match any of `phrases` against lowercased text; return matched spans. */
function matchPhrases(text: string, phrases: string[]): string[] {
  const lower = text.toLowerCase()
  return phrases.filter((p) => lower.includes(p))
}

/** Find the first phrase that appears at the very start of the text. */
function matchesStart(text: string, phrases: string[]): string | undefined {
  const lower = text.toLowerCase().trim()
  return phrases.find((p) => lower.startsWith(p))
}

// ─── DEPTH_VS_CIRCLING ────────────────────────────────────────────────────────

const CIRCLING_PHRASES = [
  'i keep', 'i always', 'same thing', 'like i said', 'still don\'t', 'never changes',
  'every time', 'over and over', 'going in circles', 'back to this', 'again and again',
  'same as always', 'same old', 'stuck in', 'can\'t stop', 'keeps happening',
]

const DEPTH_OPENER_PHRASES = [
  'actually', 'i mean', 'i realize', 'i wonder', 'what i think',
  'i notice', 'come to think', 'when i really', 'underneath',
]

/**
 * DEPTH_VS_CIRCLING [-1, +1]
 * -1 = person is recycling the same ground (looping/ruminating)
 * +1 = genuinely new content, rising novelty
 */
export function extractDepthVsCircling(text: string, history: Turn[]): Signal {
  const tokens = tokenize(text)
  const contentTokens = tokens.filter((w) => w.length > 3)

  // Build recent user vocabulary (content words only)
  const recentUserTexts = history
    .filter((t) => t.speaker === 'USER')
    .slice(-4)
    .map((t) => t.text)

  const recentWords = new Set(
    recentUserTexts.flatMap((t) => tokenize(t).filter((w) => w.length > 3))
  )

  // Bigrams give stronger recycling signal than unigrams
  const bigrams = tokens
    .slice(0, -1)
    .map((w, i) => `${w} ${tokens[i + 1]}`)
  const recentBigrams = new Set(
    recentUserTexts.flatMap((t) => {
      const ws = tokenize(t)
      return ws.slice(0, -1).map((w, i) => `${w} ${ws[i + 1]}`)
    })
  )

  const repeatedUnigrams = contentTokens.filter((w) => recentWords.has(w)).length
  const repeatedBigrams = bigrams.filter((bg) => recentBigrams.has(bg)).length

  // Novelty: what fraction of content words are new
  const noveltyRatio =
    contentTokens.length === 0
      ? 0.5
      : 1 - (repeatedUnigrams * 0.6 + repeatedBigrams * 0.8) / Math.max(contentTokens.length, 1)

  // Explicit circling phrases (strong negative signal)
  const circlingMatches = matchPhrases(text, CIRCLING_PHRASES)
  const circlingPenalty = Math.min(0.5, circlingMatches.length * 0.2)

  // Depth-opening phrases (modest positive signal)
  const depthMatches = matchPhrases(text, DEPTH_OPENER_PHRASES)
  const depthBonus = Math.min(0.25, depthMatches.length * 0.1)

  // Length: longer messages tend to introduce more content
  const lengthBonus = clamp((tokens.length - 8) / 40, -0.1, 0.2)

  const rawValue = noveltyRatio * 2 - 1 - circlingPenalty + depthBonus + lengthBonus
  const value = parseFloat(clamp(rawValue, -1, 1).toFixed(3))

  const confidence =
    history.length < 2 ? 0.30
    : circlingMatches.length > 0 ? 0.75
    : recentUserTexts.length >= 3 ? 0.60
    : 0.50

  const evidence_spans = [
    ...circlingMatches.slice(0, 2).map((m) => `recycling: "${m}"`),
    ...depthMatches.slice(0, 1).map((m) => `depth opener: "${m}"`),
    ...(repeatedBigrams > 2 ? [`${repeatedBigrams} repeated phrases from recent turns`] : []),
  ]

  const rationale =
    circlingMatches.length > 0
      ? `Explicit recycling phrases detected (${circlingMatches.slice(0, 2).join(', ')}); novelty ratio ${(noveltyRatio * 100).toFixed(0)}%`
      : history.length < 2
      ? `First turn — no history to compare; treating as moderate novelty`
      : `Novelty ratio ${(noveltyRatio * 100).toFixed(0)}% (${repeatedUnigrams}/${contentTokens.length} content words repeated); ${repeatedBigrams} bigram overlaps`

  return { type: 'DEPTH_VS_CIRCLING', value, confidence, evidence_spans, rationale }
}

// ─── CONCRETENESS_VS_ABSTRACTION ──────────────────────────────────────────────

const ABSTRACT_WORDS = new Set([
  // Evaluative / self-diagnostic
  'wrong', 'bad', 'terrible', 'awful', 'broken', 'pointless', 'meaningless',
  'worthless', 'stupid', 'failure', 'useless', 'pathetic', 'hopeless', 'damaged',
  // Universal quantifiers (rumination signature)
  'always', 'never', 'everyone', 'nobody', 'everything', 'nothing', 'everywhere',
  'forever', 'constantly', 'perpetually',
  // Vague causation
  'somehow', 'whatever', 'regardless', 'basically',
  // Temporal abstraction
  'anymore', 'anymore', 'anymore',
])

const ABSTRACT_PHRASES = [
  "what's wrong with me", "why do i", "why am i", "why can't i",
  "i don't know why", "i'm just", "i always do this", "i never",
  "what's the point", "it's always been", "nothing ever",
]

const CONCRETE_WORDS = new Set([
  // Narrative past tense
  'said', 'told', 'asked', 'replied', 'walked', 'went', 'called', 'texted',
  'sat', 'stood', 'ran', 'drove', 'wrote', 'read', 'heard', 'saw', 'felt',
  'happened', 'noticed', 'realized', 'decided',
  // Temporal specifics
  'yesterday', 'today', 'morning', 'afternoon', 'evening', 'tonight',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'last week', 'this week',
])

const CONCRETE_PHRASES = [
  'yesterday', 'this morning', 'last night', 'at work', 'at home',
  'in the car', 'during the meeting', 'at dinner', 'on the phone',
  'when he said', 'when she said', 'when they said', 'and i said',
  'and then', 'so then', 'after that', 'before that',
]

/**
 * CONCRETENESS_VS_ABSTRACTION [-1, +1]
 * -1 = abstract / evaluative / universalizing (rumination signature)
 * +1 = concrete / specific / narrative / temporal
 */
export function extractConcretenessVsAbstraction(text: string): Signal {
  const tokens = tokenize(text)
  const lower = text.toLowerCase()

  const abstractWordMatches = tokens.filter((w) => ABSTRACT_WORDS.has(w))
  const abstractPhraseMatches = ABSTRACT_PHRASES.filter((p) => lower.includes(p))
  const concreteWordMatches = tokens.filter((w) => CONCRETE_WORDS.has(w))
  const concretePhraseMatches = CONCRETE_PHRASES.filter((p) => lower.includes(p))

  const abstractScore = abstractWordMatches.length * 0.15 + abstractPhraseMatches.length * 0.25
  const concreteScore = concreteWordMatches.length * 0.15 + concretePhraseMatches.length * 0.2

  // Normalize to word count
  const norm = Math.max(tokens.length * 0.2, 1)
  const value = parseFloat(clamp((concreteScore - abstractScore) / norm, -1, 1).toFixed(3))

  const totalSignal = abstractScore + concreteScore
  const confidence =
    totalSignal > 0.4 ? 0.70
    : totalSignal > 0.2 ? 0.60
    : 0.45

  const evidence_spans = [
    ...abstractWordMatches.slice(0, 3).map((w) => `abstract: "${w}"`),
    ...abstractPhraseMatches.slice(0, 2).map((p) => `abstract phrase: "${p}"`),
    ...concreteWordMatches.slice(0, 3).map((w) => `concrete: "${w}"`),
    ...concretePhraseMatches.slice(0, 2).map((p) => `concrete phrase: "${p}"`),
  ]

  const totalAbstract = abstractWordMatches.length + abstractPhraseMatches.length
  const totalConcrete = concreteWordMatches.length + concretePhraseMatches.length
  const rationale =
    totalAbstract > totalConcrete
      ? `Abstract framing dominant: ${totalAbstract} abstract marker(s) (${abstractWordMatches.slice(0, 3).join(', ')}), ${totalConcrete} concrete`
      : totalConcrete > totalAbstract
      ? `Concrete / narrative language: ${totalConcrete} concrete marker(s) (${concreteWordMatches.slice(0, 3).join(', ')}), ${totalAbstract} abstract`
      : `Balanced — ${totalAbstract} abstract, ${totalConcrete} concrete markers`

  return { type: 'CONCRETENESS_VS_ABSTRACTION', value, confidence, evidence_spans, rationale }
}

// ─── AFFECT_TRAJECTORY ────────────────────────────────────────────────────────

const OPENING_WORDS = new Set([
  'realized', 'notice', 'wonder', 'sense', 'actually', 'huh', 'interesting',
  'suddenly', 'wait', 'like', 'maybe', 'think', 'feel',
])

const CLOSING_PHRASES = [
  'anyway', 'whatever', 'forget it', "doesn't matter", "it doesn't matter",
  'never mind', 'nevermind', "i guess", "i suppose", "i don't know",
]

/**
 * AFFECT_TRAJECTORY [-1, +1]
 * -1 = closing / withdrawing / shortening
 * +1 = opening / elaborating / energised
 */
export function extractAffectTrajectory(text: string, history: Turn[]): Signal {
  const tokens = tokenize(text)

  const openingCount = tokens.filter((w) => OPENING_WORDS.has(w)).length
  const closingMatches = matchPhrases(text, CLOSING_PHRASES)

  // Compare message length to person's recent average (closing = shorter)
  const prevUserTurns = history.filter((t) => t.speaker === 'USER')
  const avgPrevLen =
    prevUserTurns.length > 0
      ? prevUserTurns.reduce((s, t) => s + t.text.length, 0) / prevUserTurns.length
      : text.length
  const lengthRatio = text.length / Math.max(avgPrevLen, 1)
  const lengthSignal = clamp((lengthRatio - 0.6) * 0.5, -0.3, 0.3)

  const norm = Math.max(tokens.length * 0.15, 1)
  const rawValue = (openingCount * 0.15 - closingMatches.length * 0.25) / norm + lengthSignal
  const value = parseFloat(clamp(rawValue, -1, 1).toFixed(3))

  const evidence_spans = [
    ...tokens.filter((w) => OPENING_WORDS.has(w)).slice(0, 2).map((w) => `opening: "${w}"`),
    ...closingMatches.slice(0, 2).map((p) => `closing: "${p}"`),
    ...(prevUserTurns.length > 0 ? [`msg length ratio vs avg: ${lengthRatio.toFixed(2)}`] : []),
  ]

  const rationale =
    closingMatches.length > 0
      ? `Closing/deflection markers detected: ${closingMatches.slice(0, 2).join(', ')}; length ratio ${lengthRatio.toFixed(2)}`
      : openingCount > 0
      ? `Opening markers: ${openingCount} (${tokens.filter((w) => OPENING_WORDS.has(w)).slice(0, 3).join(', ')}); length ratio ${lengthRatio.toFixed(2)}`
      : `No strong affect markers; length ratio vs avg: ${lengthRatio.toFixed(2)}`

  return {
    type: 'AFFECT_TRAJECTORY',
    value,
    confidence: prevUserTurns.length >= 2 ? 0.55 : 0.40,
    evidence_spans,
    rationale,
  }
}

// ─── CORRECTION_DETECTED ──────────────────────────────────────────────────────

// Ordered by strength. Values below represent the signal score assigned.
const STRONG_CORRECTIONS: string[] = [
  "no, that's not", "no that's not", "not quite", "that's not it",
  "that's not really", "not exactly", "no,", "actually no",
  "no that", "that isn't",
]

const MEDIUM_CORRECTIONS: string[] = [
  "well actually", "i mean, not", "not exactly but", "kind of, but not",
  "sort of, but", "more like", "well, more like", "i mean more",
]

const WEAK_CORRECTIONS: string[] = [
  "yes, but", "yeah but", "right, but also", "true but",
  "i know, but", "i agree but", "kind of but",
]

/**
 * CORRECTION_DETECTED [0, 1]
 * Person is explicitly pushing back on the prior AI reflection.
 * Blueprint: "first-class data, not noise — treat as healthy deepening signal."
 *
 * Score tiers:
 *   1.0 = explicit negation at message start ("No, that's not it")
 *   0.75 = medium correction phrase
 *   0.4  = weak / partial correction mid-message
 *   0.0  = no correction detected
 */
export function extractCorrectionDetected(text: string): Signal {
  const strong = matchesStart(text, STRONG_CORRECTIONS) ?? STRONG_CORRECTIONS.find((p) => text.toLowerCase().includes(p))
  if (strong) {
    const atStart = text.toLowerCase().trim().startsWith(strong) ? 'at message start' : 'in message body'
    return {
      type: 'CORRECTION_DETECTED',
      value: 1.0,
      confidence: 0.88,
      evidence_spans: [`"${strong}" (${atStart})`],
      rationale: `Strong correction phrase "${strong}" detected ${atStart} — person is explicitly pushing back`,
    }
  }

  const medium = MEDIUM_CORRECTIONS.find((p) => text.toLowerCase().includes(p))
  if (medium) {
    return {
      type: 'CORRECTION_DETECTED',
      value: 0.75,
      confidence: 0.72,
      evidence_spans: [`"${medium}"`],
      rationale: `Medium correction phrase "${medium}" — person is refining or redirecting`,
    }
  }

  const weak = WEAK_CORRECTIONS.find((p) => text.toLowerCase().includes(p))
  if (weak) {
    return {
      type: 'CORRECTION_DETECTED',
      value: 0.40,
      confidence: 0.50,
      evidence_spans: [`"${weak}"`],
      rationale: `Weak correction marker "${weak}" — possible partial pushback, low confidence`,
    }
  }

  return {
    type: 'CORRECTION_DETECTED',
    value: 0.0,
    confidence: 0.90,
    evidence_spans: [],
    rationale: 'No correction phrases detected',
  }
}

// ─── FELT_SHIFT_DETECTED ──────────────────────────────────────────────────────

// Phrases that signal the person has genuinely arrived somewhere new
const RESONANCE_PHRASES = [
  "that's it", "that's exactly it", "yes, that", "yeah, that",
  "that lands", "that resonates", "that's the thing", "huh", "oh wait",
  "wait, yes", "oh huh", "i never thought of it that way",
  "i've never put it like that", "i've never said that before",
  "yeah that's it", "you got it", "that's exactly", "oh wow, yes",
]

// Agreement-WITHOUT-movement markers — not a real shift (blueprint §3 warning)
const AGREEMENT_ONLY = [
  'yes exactly', 'yes, exactly', 'absolutely', 'totally', 'definitely yes',
  'completely agree', 'that is so true',
]

/**
 * FELT_SHIFT_DETECTED [0, 1]
 * Did a reflection land? Person has arrived somewhere new.
 *
 * IMPORTANT: enthusiastic agreement with NO new content is a WARNING sign
 * of comfortable mirroring, NOT a shift (blueprint §3). We detect this and
 * reduce the signal accordingly.
 */
export function extractFeltShift(text: string): Signal {
  const lower = text.toLowerCase()
  const tokens = tokenize(text)

  const resonance = RESONANCE_PHRASES.find((p) => lower.includes(p))
  const agreementOnly = !resonance && AGREEMENT_ONLY.find((p) => lower.includes(p))

  if (!resonance && !agreementOnly) {
    return {
      type: 'FELT_SHIFT_DETECTED',
      value: 0.0,
      confidence: 0.88,
      evidence_spans: [],
      rationale: 'No resonance or shift markers detected',
    }
  }

  if (resonance) {
    // Check for agreement-without-movement: shift phrase + very short follow-on
    const shortMessage = tokens.length < 12
    const value = shortMessage ? 0.6 : 0.9
    const note = shortMessage
      ? 'short message — possible agreement-without-movement; check for new content'
      : 'followed by substantive content — genuine shift likely'

    return {
      type: 'FELT_SHIFT_DETECTED',
      value,
      confidence: shortMessage ? 0.60 : 0.82,
      evidence_spans: [`"${resonance}"`],
      rationale: `Resonance marker "${resonance}" detected — ${note}`,
    }
  }

  // Agreement-only phrases — signal is low
  return {
    type: 'FELT_SHIFT_DETECTED',
    value: 0.25,
    confidence: 0.55,
    evidence_spans: [`"${agreementOnly}" (agreement without new content)`],
    rationale: `Agreement phrase "${agreementOnly}" without resonance marker — likely comfortable mirroring, not a felt shift (blueprint §3 warning)`,
  }
}

// ─── GUARDEDNESS ──────────────────────────────────────────────────────────────

const HEDGE_PHRASES = [
  'maybe', 'kind of', 'sort of', "i think maybe", "i'm not sure", 'not sure',
  'probably', 'perhaps', 'i guess', 'i suppose', 'might be', 'could be',
]

const MINIMIZATION_PHRASES = [
  'not a big deal', 'not that important', 'probably nothing', "i shouldn't complain",
  "others have it worse", "i'm probably overthinking", "i know it sounds stupid",
  "it's silly", "i'm being dramatic", "sounds dumb", "not a huge thing",
  "it's fine really", "not really that bad",
]

const DEFLECTION_PHRASES = [
  'anyway', 'whatever', 'forget it', "it doesn't matter", 'never mind', 'nevermind',
  "it is what it is", "doesn't really matter", "not a big deal",
]

const SOCIAL_PERFORMANCE_PHRASES = [
  "i'm fine", "i'm okay", "i'm good", "really okay", "fine honestly",
  "honestly fine", "doing okay", "i'm alright", "totally fine",
]

// Emotional precision reduces guardedness: person is willing to be vulnerable
const EMOTIONAL_PRECISION = new Set([
  'terrified', 'devastated', 'desperate', 'heartbroken', 'furious', 'ecstatic',
  'overwhelmed', 'crushed', 'grief', 'anguish', 'elated', 'horrified',
  'petrified', 'mortified', 'humiliated', 'euphoric', 'bereft', 'numb',
])

/**
 * GUARDEDNESS [0, 1]
 * 0 = very open / trusting / emotionally precise
 * 1 = hedging, deflecting, performing okayness, minimising
 */
export function extractGuardedness(text: string, history: Turn[]): Signal {
  const tokens = tokenize(text)

  const hedgeMatches = matchPhrases(text, HEDGE_PHRASES)
  const minimizeMatches = matchPhrases(text, MINIMIZATION_PHRASES)
  const deflectMatches = matchPhrases(text, DEFLECTION_PHRASES)
  const performMatches = matchPhrases(text, SOCIAL_PERFORMANCE_PHRASES)

  // Emotional precision words reduce guardedness
  const precisionWords = tokens.filter((w) => EMOTIONAL_PRECISION.has(w))
  const precisionBonus = Math.min(0.4, precisionWords.length * 0.2)

  // First user turn always carries baseline guardedness (blueprint §3: ARRIVAL)
  const isFirstTurn = history.filter((t) => t.speaker === 'USER').length === 0
  const firstTurnBonus = isFirstTurn ? 0.20 : 0.0

  // Very short messages can signal withholding
  const brevitySignal = tokens.length < 8 && !isFirstTurn ? 0.15 : 0.0

  const rawScore =
    hedgeMatches.length * 0.12 +
    minimizeMatches.length * 0.28 +
    deflectMatches.length * 0.25 +
    performMatches.length * 0.30 +
    firstTurnBonus +
    brevitySignal -
    precisionBonus

  const value = parseFloat(clamp(rawScore, 0, 1).toFixed(3))

  const totalMarkers = hedgeMatches.length + minimizeMatches.length + deflectMatches.length + performMatches.length
  const confidence =
    precisionWords.length > 0 ? 0.72
    : totalMarkers >= 3 ? 0.75
    : totalMarkers >= 1 ? 0.60
    : 0.45

  const evidence_spans = [
    ...hedgeMatches.slice(0, 2).map((p) => `hedge: "${p}"`),
    ...minimizeMatches.slice(0, 2).map((p) => `minimize: "${p}"`),
    ...deflectMatches.slice(0, 1).map((p) => `deflect: "${p}"`),
    ...performMatches.slice(0, 1).map((p) => `performance: "${p}"`),
    ...precisionWords.slice(0, 2).map((w) => `emotional precision: "${w}"`),
  ]

  const parts: string[] = []
  if (minimizeMatches.length) parts.push(`minimization (${minimizeMatches.slice(0, 2).join(', ')})`)
  if (performMatches.length) parts.push(`social performance (${performMatches[0]})`)
  if (deflectMatches.length) parts.push(`deflection (${deflectMatches[0]})`)
  if (hedgeMatches.length) parts.push(`hedging (${hedgeMatches.slice(0, 2).join(', ')})`)
  if (precisionWords.length) parts.push(`emotional precision reduces score (${precisionWords[0]})`)
  if (isFirstTurn) parts.push('first-turn baseline guardedness')

  const rationale = parts.length
    ? parts.join('; ')
    : 'No strong guardedness markers detected'

  return { type: 'GUARDEDNESS', value, confidence, evidence_spans, rationale }
}

// ─── Public bundle ────────────────────────────────────────────────────────────

export function extractSignals(turnId: string, text: string, history: Turn[]): SignalSet {
  return {
    turn_id: turnId,
    signals: [
      extractDepthVsCircling(text, history),
      extractConcretenessVsAbstraction(text),
      extractAffectTrajectory(text, history),
      extractCorrectionDetected(text),
      extractFeltShift(text),
      extractGuardedness(text, history),
    ],
    extracted_at: new Date().toISOString(),
  }
}

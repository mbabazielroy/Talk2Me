/**
 * Conversation fixtures for unit tests and research evaluation.
 *
 * 10 labeled scenarios, each specifying:
 *  - userText + history (the full input context)
 *  - expected signal directions (not exact values, for resilience)
 *  - expected state
 *  - expected move
 *
 * Blueprint §9.2: "Fixtures are the minimum viable label set. They let us
 * catch regressions in perception, decision, and expression independently."
 */

import type { Turn, ConversationState, MoveType, SignalType } from '@/types/domain'

export interface SignalExpectation {
  type: SignalType
  valueDirection: 'positive' | 'negative' | 'zero' | 'high'  // high = > 0.5 for [0,1] signals
  minConfidence?: number
}

export interface ConversationFixture {
  name: string
  description: string
  userText: string
  history: Turn[]
  expectedSignals: SignalExpectation[]
  expectedState: ConversationState
  expectedMove: MoveType
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function userTurn(text: string, index: number): Turn {
  return {
    id: `u-${index}`,
    conversation_id: 'test-conv',
    index,
    speaker: 'USER',
    text,
    ts: new Date().toISOString(),
  }
}

function aiTurn(text: string, index: number): Turn {
  return {
    id: `a-${index}`,
    conversation_id: 'test-conv',
    index,
    speaker: 'AI',
    text,
    ts: new Date().toISOString(),
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

export const fixtures: ConversationFixture[] = [

  // ── 1. ARRIVAL with hedging ────────────────────────────────────────────────
  {
    name: 'arrival-hedging',
    description: 'First turn with hedging language — guarded, minimal info',
    userText: "I'm not sure where to start. Maybe it's just me overthinking things, I guess.",
    history: [],
    expectedSignals: [
      { type: 'GUARDEDNESS', valueDirection: 'high', minConfidence: 0.45 },
      { type: 'DEPTH_VS_CIRCLING', minConfidence: 0.0 },  // first turn, low conf
    ],
    expectedState: 'ARRIVAL',
    expectedMove: 'VALIDATION',  // high guardedness at ARRIVAL → VALIDATION
  },

  // ── 2. Abstract rumination ─────────────────────────────────────────────────
  {
    name: 'abstract-rumination',
    description: 'Evaluative / universalising language — rumination signature',
    userText: "Why am I always like this? Everything I do is wrong. I'm just broken and I don't know why.",
    history: [
      userTurn("I've been feeling off lately.", 0),
      aiTurn("What's that been like for you?", 1),
    ],
    expectedSignals: [
      { type: 'CONCRETENESS_VS_ABSTRACTION', valueDirection: 'negative', minConfidence: 0.55 },
    ],
    expectedState: 'ARRIVAL',  // abstract + low depth → no OPENING; falls to default
    expectedMove: 'CLARIFICATION',  // abstract framing → invite specifics
  },

  // ── 3. Concrete narrative ──────────────────────────────────────────────────
  {
    name: 'concrete-narrative',
    description: 'Specific, temporal, first-person account of an event',
    userText: "Yesterday at work my manager called me into his office and told me he was letting me go. I just sat there. I heard nothing else.",
    history: [
      userTurn("I have some stuff going on at work.", 0),
      aiTurn("What's been happening there?", 1),
    ],
    expectedSignals: [
      { type: 'CONCRETENESS_VS_ABSTRACTION', valueDirection: 'positive', minConfidence: 0.55 },
      { type: 'DEPTH_VS_CIRCLING', valueDirection: 'positive' },
    ],
    expectedState: 'OPENING',
    expectedMove: 'QUESTION',
  },

  // ── 4. Explicit correction ─────────────────────────────────────────────────
  {
    name: 'explicit-correction',
    description: 'Person pushes back on an AI reflection — first-class data',
    userText: "No, that's not it. You're hearing it wrong — it's not that I'm afraid, it's that I'm angry.",
    history: [
      userTurn("I feel weird when my partner ignores me.", 0),
      aiTurn("It sounds like there's some fear underneath that — is that getting at it?", 1),
    ],
    expectedSignals: [
      { type: 'CORRECTION_DETECTED', valueDirection: 'high', minConfidence: 0.80 },
    ],
    expectedState: 'OPENING',  // not enough turns for DEEPENING
    expectedMove: 'REFLECTION',  // correction rule fires, reflect the corrected version
  },

  // ── 5. Felt shift ─────────────────────────────────────────────────────────
  {
    name: 'felt-shift',
    description: 'Resonance marker followed by substantive new content — genuine arrival',
    userText: "Oh wait, yes — that's exactly it. I've never said that out loud before. It's about needing to feel in control and I realise now I never have been.",
    history: [
      userTurn("Things feel out of control.", 0),
      aiTurn("What kind of out of control?", 1),
      userTurn("Like nothing I do matters.", 2),
      aiTurn("Is it more that you feel powerless, or that you feel unseen?", 3),
    ],
    expectedSignals: [
      { type: 'FELT_SHIFT_DETECTED', valueDirection: 'high', minConfidence: 0.70 },
    ],
    expectedState: 'CRYSTALLIZING',
    expectedMove: 'SUMMARY',
  },

  // ── 6. Circling ────────────────────────────────────────────────────────────
  {
    name: 'circling',
    description: 'Person is recycling the same ground with explicit looping phrases',
    userText: "I keep coming back to the same thing. It's like I'm going in circles and I can't stop. Same thing over and over every time.",
    history: [
      userTurn("I can't stop thinking about what happened.", 0),
      aiTurn("What's it like when it comes back?", 1),
      userTurn("I just keep thinking about the same thing.", 2),
      aiTurn("When you say 'the same thing' — what exactly do you mean?", 3),
    ],
    expectedSignals: [
      { type: 'DEPTH_VS_CIRCLING', valueDirection: 'negative', minConfidence: 0.65 },
    ],
    expectedState: 'HOLDING',
    expectedMove: 'HOLDING',
  },

  // ── 7. Guardedness / minimization ─────────────────────────────────────────
  {
    name: 'guardedness-minimization',
    description: 'Multiple minimization and social-performance markers',
    userText: "I'm fine honestly. It's not a big deal. I probably shouldn't even be talking about this — others have it much worse.",
    history: [
      userTurn("I guess I've had a rough week.", 0),
      aiTurn("What's been rough about it?", 1),
    ],
    expectedSignals: [
      { type: 'GUARDEDNESS', valueDirection: 'high', minConfidence: 0.60 },
    ],
    expectedState: 'ARRIVAL',  // early turn + high guardedness
    expectedMove: 'VALIDATION',
  },

  // ── 8. Deepening ──────────────────────────────────────────────────────────
  {
    name: 'deepening',
    description: 'Rising novelty with concrete material after established history',
    userText: "And now I realize it goes back further than I thought. When I was sixteen my dad walked out without saying anything. I noticed last night I hold my breath when someone leaves a room.",
    history: [
      userTurn("I tend to panic when people go quiet.", 0),
      aiTurn("What happens in you when that quiet comes?", 1),
      userTurn("It's like an alarm goes off. I start imagining the worst.", 2),
      aiTurn("What does the worst look like?", 3),
      userTurn("That they're going to leave and not come back.", 4),
      aiTurn("There's something underneath that fear — what's it connected to for you?", 5),
    ],
    expectedSignals: [
      { type: 'DEPTH_VS_CIRCLING', valueDirection: 'positive', minConfidence: 0.50 },
      { type: 'CONCRETENESS_VS_ABSTRACTION', valueDirection: 'positive' },
    ],
    expectedState: 'DEEPENING',
    expectedMove: 'REFLECTION',
  },

  // ── 9. Orienting outward ──────────────────────────────────────────────────
  {
    name: 'orienting-outward',
    description: 'Forward-looking language with concrete action intent in late session',
    userText: "I want to talk to him tomorrow. I'll start differently this time. I'm going to be direct and tell him what I need.",
    history: [
      userTurn("We haven't been talking.", 0),
      aiTurn("What does that silence feel like for you?", 1),
      userTurn("Heavy. Like a wall.", 2),
      aiTurn("What's on the other side of the wall?", 3),
      userTurn("What I actually need — which I've never told him.", 4),
      aiTurn("What would it mean to tell him?", 5),
      userTurn("Like getting something back. Like being a person.", 6),
      aiTurn("There's something about reclaiming yourself in that — is that close?", 7),
    ],
    expectedSignals: [],  // state is driven by forward phrase count, not signals
    expectedState: 'ORIENTING_OUTWARD',
    expectedMove: 'ORIENTATION',
  },

  // ── 10. Holding / heavy pain ──────────────────────────────────────────────
  {
    name: 'holding-heavy-pain',
    description: 'Circling + closing affect — presence over excavation',
    userText: "I don't know. Forget it, whatever. I keep going round in circles and I don't know why I bother. Anyway, doesn't matter.",
    history: [
      userTurn("I just feel nothing.", 0),
      aiTurn("What is nothing like for you?", 1),
      userTurn("Heavy. Just heavy.", 2),
      aiTurn("Yeah. That heaviness is real.", 3),
    ],
    expectedSignals: [
      { type: 'DEPTH_VS_CIRCLING', valueDirection: 'negative', minConfidence: 0.55 },
      { type: 'AFFECT_TRAJECTORY', valueDirection: 'negative' },
    ],
    expectedState: 'HOLDING',
    expectedMove: 'HOLDING',
  },
]

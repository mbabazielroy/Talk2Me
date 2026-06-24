/**
 * Move Directive Contract Tests (blueprint §9.2 "move-fidelity")
 *
 * These tests verify that the MoveConstraints produced by defaultConstraints()
 * honour the invariants promised by the blueprint. They are independent of
 * what text the generator produces — they pin the contract itself.
 *
 * Invariants under test:
 *  1. no_diagnosis is ALWAYS true for every move
 *  2. HOLDING / EXIT are always SHORT + no_advice + not returnable
 *  3. REFLECTION is always returnable + no_advice
 *  4. NAMING is always returnable + no_advice + half_step_only
 *  5. GENTLE_CHALLENGE is always half_step_only + returnable
 *  6. HANDOFF is always LONG
 *  7. use_user_vocabulary is always true for every move
 */

import { defaultConstraints } from '@/engine/move-selector'
import type { MoveType } from '@/types/domain'

const ALL_MOVES: MoveType[] = [
  'QUESTION', 'REFLECTION', 'VALIDATION', 'CLARIFICATION', 'NAMING', 'SUMMARY',
  'GENTLE_CHALLENGE', 'ORIENTATION', 'HOLDING', 'RECONNECTION', 'EXIT', 'HANDOFF',
]

describe('move directive contract', () => {

  test('no_diagnosis is true for every move', () => {
    for (const move of ALL_MOVES) {
      const c = defaultConstraints(move)
      expect(c.no_diagnosis).toBe(true)
    }
  })

  test('use_user_vocabulary is true for every move', () => {
    for (const move of ALL_MOVES) {
      const c = defaultConstraints(move)
      expect(c.use_user_vocabulary).toBe(true)
    }
  })

  test('HOLDING: SHORT + no_advice + not returnable + not half_step_only', () => {
    const c = defaultConstraints('HOLDING')
    expect(c.max_length_hint).toBe('SHORT')
    expect(c.no_advice).toBe(true)
    expect(c.returnable).toBe(false)
    expect(c.half_step_only).toBe(false)
  })

  test('EXIT: SHORT + not returnable', () => {
    const c = defaultConstraints('EXIT')
    expect(c.max_length_hint).toBe('SHORT')
    expect(c.returnable).toBe(false)
  })

  test('VALIDATION: SHORT + not returnable', () => {
    const c = defaultConstraints('VALIDATION')
    expect(c.max_length_hint).toBe('SHORT')
    expect(c.returnable).toBe(false)
  })

  test('REFLECTION: returnable + no_advice + MEDIUM', () => {
    const c = defaultConstraints('REFLECTION')
    expect(c.returnable).toBe(true)
    expect(c.no_advice).toBe(true)
    expect(c.max_length_hint).toBe('MEDIUM')
    expect(c.half_step_only).toBe(false)
  })

  test('NAMING: returnable + no_advice + half_step_only + MEDIUM', () => {
    const c = defaultConstraints('NAMING')
    expect(c.returnable).toBe(true)
    expect(c.no_advice).toBe(true)
    expect(c.half_step_only).toBe(true)
    expect(c.max_length_hint).toBe('MEDIUM')
  })

  test('GENTLE_CHALLENGE: returnable + half_step_only + MEDIUM', () => {
    const c = defaultConstraints('GENTLE_CHALLENGE')
    expect(c.returnable).toBe(true)
    expect(c.half_step_only).toBe(true)
    expect(c.max_length_hint).toBe('MEDIUM')
  })

  test('HANDOFF: LONG', () => {
    const c = defaultConstraints('HANDOFF')
    expect(c.max_length_hint).toBe('LONG')
  })

  test('QUESTION: no_advice + MEDIUM + not returnable', () => {
    const c = defaultConstraints('QUESTION')
    expect(c.no_advice).toBe(true)
    expect(c.max_length_hint).toBe('MEDIUM')
    expect(c.returnable).toBe(false)
  })

  test('CLARIFICATION: returnable + MEDIUM', () => {
    const c = defaultConstraints('CLARIFICATION')
    expect(c.returnable).toBe(true)
    expect(c.max_length_hint).toBe('MEDIUM')
  })

  test('SUMMARY: returnable + MEDIUM', () => {
    const c = defaultConstraints('SUMMARY')
    expect(c.returnable).toBe(true)
    expect(c.max_length_hint).toBe('MEDIUM')
  })

  test('RECONNECTION: returnable + MEDIUM', () => {
    const c = defaultConstraints('RECONNECTION')
    expect(c.returnable).toBe(true)
    expect(c.max_length_hint).toBe('MEDIUM')
  })

  test('ORIENTATION: MEDIUM + not returnable', () => {
    const c = defaultConstraints('ORIENTATION')
    expect(c.max_length_hint).toBe('MEDIUM')
    expect(c.returnable).toBe(false)
  })

})

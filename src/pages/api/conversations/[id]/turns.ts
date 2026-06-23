/**
 * POST /api/conversations/[id]/turns
 * Submit a user message. Runs the full turn loop:
 * prescreen → extract → estimate → select → generate → postscreen → log → memory.
 * Returns the AI utterance and the full decision trace.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { store } from '@/storage/in-memory-store'
import { processTurn } from '@/engine/orchestrator'
import type { TurnTrace, Turn } from '@/types/domain'

type SuccessBody = { ai_turn: Turn; trace: TurnTrace }
type ErrorBody = { error: string }

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessBody | ErrorBody>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { id } = req.query
  if (typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid conversation id' })
  }

  const conversation = store.getConversation(id)
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' })
  }

  const text = req.body?.text as string | undefined
  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: 'text is required' })
  }

  const result = await processTurn(conversation, text.trim())
  return res.status(200).json(result)
}

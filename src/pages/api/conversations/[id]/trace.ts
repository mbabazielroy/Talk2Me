/**
 * GET /api/conversations/[id]/trace
 * Full decision trace for a conversation (research / admin view).
 * Blueprint §11: "architecture as data" — every decision queryable.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { store } from '@/storage/in-memory-store'
import type { TurnTrace } from '@/types/domain'

type SuccessBody = { conversation_id: string; traces: TurnTrace[] }
type ErrorBody = { error: string }

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessBody | ErrorBody>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { id } = req.query
  if (typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid conversation id' })
  }

  if (!store.getConversation(id)) {
    return res.status(404).json({ error: 'Conversation not found' })
  }

  const traces = store.getTraces(id)
  return res.status(200).json({ conversation_id: id, traces })
}

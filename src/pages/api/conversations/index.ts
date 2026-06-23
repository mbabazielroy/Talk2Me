/**
 * POST /api/conversations
 * Start a new conversation. Attaches consent flags and optionally an
 * experiment arm (blueprint §11 / §10 Conversation entity).
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { createConversation } from '@/engine/orchestrator'
import type { Conversation } from '@/types/domain'

type ErrorBody = { error: string }

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<Conversation | ErrorBody>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // M1: anonymous user — no auth yet
  const userId = (req.body?.user_id as string | undefined) ?? 'anonymous'
  const conversation = createConversation(userId)
  return res.status(201).json(conversation)
}

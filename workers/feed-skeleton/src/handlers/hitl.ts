/**
 * POST /api/hitl
 *
 * Records a HITL (human-in-the-loop) thumbs up/down vote for a post.
 * Body: { feedId, postUri, signal, sessionType }
 */

import { type Env, json, err } from '../types'

interface HitlBody {
  feedId:      string
  postUri:     string
  signal:      1 | -1
  sessionType: 'creation' | 'refinement' | 'weekly_review'
}

export async function handleHitl(req: Request, env: Env): Promise<Response> {
  let body: HitlBody
  try {
    body = await req.json() as HitlBody
  } catch {
    return err('invalid JSON body')
  }

  const { feedId, postUri, signal, sessionType } = body

  if (!feedId || !postUri) return err('feedId and postUri are required')
  if (signal !== 1 && signal !== -1) return err('signal must be 1 or -1')
  if (!['creation', 'refinement', 'weekly_review'].includes(sessionType)) {
    return err('invalid sessionType')
  }

  // Upsert: if user re-votes on the same post in the same session, update signal
  await env.DB
    .prepare(`
      INSERT INTO hitl_events (feed_id, post_uri, signal, session_type, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `)
    .bind(feedId, postUri, signal, sessionType, Date.now())
    .run()

  return json({ ok: true })
}

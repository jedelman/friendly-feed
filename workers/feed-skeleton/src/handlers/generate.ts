/**
 * POST /api/generate
 *
 * Calls Claude to turn a user's plain-language feed intent into a
 * structured feed config proposal (terms, excludeTerms, seedAccounts, rationale).
 *
 * Body: { did: string, intent: string }
 */

import { type Env, json, err } from '../types'

const MODEL    = 'claude-sonnet-4-6'
const BSKY_API = 'https://public.api.bsky.app/xrpc'

const SYSTEM_PROMPT = `You are a Bluesky feed configuration generator.
Given a user's description of what they want to read, return a JSON feed config.

Rules:
- terms: 8–20 lowercase strings to match in post text. Include common variants and hashtags (e.g. "#housing", "housing policy", "zoning reform"). Prefer specific phrases over single common words.
- excludeTerms: 3–10 lowercase strings that reliably filter out noise or off-topic content.
- seedAccounts: Up to 15 Bluesky accounts whose posts should always appear. Only include accounts you are confident exist (well-known researchers, journalists, orgs in this space). Format: { "did": "did:plc:XXXX", "handle": "user.bsky.social", "reason": "why this account matters" }. If you are not certain of a DID, omit that field and only provide handle.
- rationale: 2–3 sentences explaining the term choices and any tradeoffs.

Return ONLY valid JSON in this exact shape — no markdown, no explanation:
{
  "terms": [...],
  "excludeTerms": [...],
  "seedAccounts": [...],
  "rationale": "..."
}`

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>
  stop_reason: string
}

interface GenerateBody {
  did:    string
  intent: string
}

export async function handleGenerate(req: Request, env: Env): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY) {
    return err('ANTHROPIC_API_KEY not configured', 500)
  }

  let body: GenerateBody
  try {
    body = await req.json() as GenerateBody
  } catch {
    return err('invalid JSON body')
  }

  const { did, intent } = body
  if (!intent?.trim()) return err('intent is required')

  // Optionally fetch a sample of the user's follows to give Claude context
  let followsContext = ''
  if (did) {
    try {
      const followsRes = await fetch(
        `${BSKY_API}/app.bsky.graph.getFollows?actor=${encodeURIComponent(did)}&limit=40`
      )
      if (followsRes.ok) {
        const followsData = await followsRes.json() as {
          follows: Array<{ handle: string; displayName?: string; description?: string }>
        }
        const sample = followsData.follows
          .slice(0, 20)
          .map(f => `@${f.handle}${f.displayName ? ` (${f.displayName})` : ''}`)
          .join(', ')
        if (sample) {
          followsContext = `\n\nContext: this user follows these accounts on Bluesky (sample): ${sample}`
        }
      }
    } catch {
      // non-fatal — proceed without follow context
    }
  }

  const userMessage = `Feed intent: "${intent.trim()}"${followsContext}

Generate the feed config JSON now.`

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'x-api-key':       env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: 1500,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userMessage }],
    }),
  })

  if (!anthropicRes.ok) {
    const errBody = await anthropicRes.text()
    console.error('[generate] Anthropic error', anthropicRes.status, errBody)
    return err('AI generation failed. Please try again.', 502)
  }

  const aiData = await anthropicRes.json() as AnthropicResponse
  const rawText = aiData.content.find(c => c.type === 'text')?.text ?? ''

  // Strip markdown code fences if present
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  let proposal: {
    terms: string[]
    excludeTerms: string[]
    seedAccounts: Array<{ did?: string; handle: string; reason: string }>
    rationale: string
  }

  try {
    proposal = JSON.parse(cleaned)
  } catch {
    console.error('[generate] Failed to parse AI JSON:', cleaned)
    return err('AI returned malformed response. Please try again.', 502)
  }

  // Normalise + sanitise
  const safeProposal = {
    terms:          (proposal.terms ?? []).map(t => String(t).toLowerCase().slice(0, 100)).slice(0, 30),
    excludeTerms:   (proposal.excludeTerms ?? []).map(t => String(t).toLowerCase().slice(0, 100)).slice(0, 20),
    seedAccounts:   (proposal.seedAccounts ?? []).map(s => ({
      did:    s.did ?? '',
      handle: (s.handle ?? '').replace(/^@/, ''),
      reason: String(s.reason ?? '').slice(0, 200),
    })).slice(0, 15),
    rationale: String(proposal.rationale ?? '').slice(0, 500),
  }

  return json({ proposal: safeProposal })
}

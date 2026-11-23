import { createHash, timingSafeEqual } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { skillsApiToken } from '~/server/config'
import { pushSkillFiles } from '~/server/skills-service'

/** Every starting skill at its longest fits in this, with room for JSON. */
const MAX_BODY_CHARACTERS = 1_000_000

const body = z.object({
  skills: z.array(z.object({ key: z.string(), content: z.string() })).min(1),
})

/** Compares digests, so the time of the comparison says nothing about the token. */
function sameToken(given: string, token: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(given), digest(token))
}

/**
 * Receives the texts of starting skills from their files (`pnpm skills:push`),
 * so a changed file is in use without a new deployment. Only a request with
 * the token from `SKILLS_API_TOKEN` gets in; without the variable the endpoint
 * does not exist.
 */
export const Route = createFileRoute('/api/skills')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = skillsApiToken()
        if (token === null) return new Response('Not found', { status: 404 })
        const given = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1]
        if (given === undefined || !sameToken(given, token)) {
          return new Response('Unauthorized', { status: 401 })
        }
        const length = Number(request.headers.get('content-length') ?? 0)
        if (length > MAX_BODY_CHARACTERS * 4) return new Response('Too large', { status: 413 })
        const text = await request.text()
        if (text.length > MAX_BODY_CHARACTERS) return new Response('Too large', { status: 413 })
        let json: unknown
        try {
          json = JSON.parse(text)
        } catch {
          return new Response('Bad request', { status: 400 })
        }
        const parsed = body.safeParse(json)
        if (!parsed.success) return new Response('Bad request', { status: 400 })
        const skills = await pushSkillFiles(parsed.data.skills)
        if (skills === null) return new Response('Bad request', { status: 400 })
        return Response.json({ skills })
      },
    },
  },
})

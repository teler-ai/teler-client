import { describe, expect, it } from 'bun:test'
import { main } from '../src/index'

const POST = 'post_01m2mgs69ge8nvmkdg6924cgg9'
const ORG = 'org_01m2mgs69ge8nvmkdg6924cgg9'
const env = { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'example-token' }

function translation(language: string, status = 'translated') {
  return {
    language,
    title: `Title ${language}`,
    content: `Content ${language}`,
    status,
    translatedAt: '2026-10-29T10:00:00.000Z',
    labels: { Revenue: `Revenue ${language}` },
  }
}

async function translate(args: string[], response: () => Response, json = true) {
  const requests: { method: string; path: string; search: string; body: unknown }[] = []
  let stdout = ''
  let stderr = ''
  const exitCode = await main(['post', 'translate', ...args, ...(json ? ['--json'] : [])], {
    env,
    writeOut: (text) => {
      stdout += text
    },
    writeErr: (text) => {
      stderr += text
    },
    fetch: async (url, init) => {
      const target = new URL(url)
      requests.push({
        method: init?.method ?? 'GET',
        path: target.pathname,
        search: target.search,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      })
      return response()
    },
  })
  return { stdout, stderr, exitCode, requests }
}

describe('post translate', () => {
  it('asks the API for the languages and reports each one', async () => {
    const result = await translate([POST, '--languages', 'fr,de', '--org', ORG], () =>
      Response.json({
        language: 'en',
        translations: [translation('fr'), translation('de'), translation('it', 'out_of_date')],
        failed: [],
      })
    )
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.requests).toEqual([
      {
        method: 'POST',
        path: `/api/post/${POST}/translations`,
        search: `?organizationId=${ORG}`,
        body: { languages: ['fr', 'de'] },
      },
    ])
    expect(JSON.parse(result.stdout)).toEqual({
      postId: POST,
      language: 'en',
      translated: ['fr', 'de'],
      failed: [],
      already: [],
      skipped: [],
      translations: [translation('fr'), translation('de'), translation('it', 'out_of_date')],
    })
  })

  it('prints the translated and failed languages with their codes', async () => {
    const result = await translate(
      [POST, '--languages', 'fr,de,en', '--org', ORG],
      () =>
        Response.json({
          language: 'en',
          translations: [translation('fr')],
          failed: [{ language: 'de', code: 'TRANSLATION_FAILED' }],
        }),
      false
    )
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe(
      [
        `Translated ${POST} into fr.`,
        'Not translated: de (TRANSLATION_FAILED).',
        "Skipped en: it is the post's main language.",
        '',
      ].join('\n')
    )
  })

  it('exits non-zero when no language was translated, after reporting each one', async () => {
    const result = await translate([POST, '--languages', 'fr,de', '--org', ORG], () =>
      Response.json({
        language: null,
        translations: [],
        failed: [
          { language: 'fr', code: 'TRANSLATION_FAILED' },
          { language: 'de', code: 'ALREADY_IN_LANGUAGE' },
        ],
      })
    )
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({
      translated: [],
      failed: [{ language: 'fr', code: 'TRANSLATION_FAILED' }],
      already: ['de'],
    })
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: 'TRANSLATION_FAILED',
        message: `${POST} was not translated into any language`,
        retryable: false,
      },
    })
  })

  it('reports a post already in the asked language as a notice, not a failure', async () => {
    const result = await translate([POST, '--languages', 'fr', '--org', ORG], () =>
      Response.json({
        language: 'fr',
        translations: [],
        failed: [{ language: 'fr', code: 'ALREADY_IN_LANGUAGE' }],
      })
    )
    // The server read the text and charged for it: retrying would charge again.
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ translated: [], failed: [], already: ['fr'] })
  })

  it('succeeds with nothing to do when only the main language is asked for', async () => {
    const result = await translate([POST, '--languages', 'en', '--org', ORG], () =>
      Response.json({ language: 'en', translations: [] })
    )
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ translated: [], failed: [], skipped: ['en'] })
  })

  it('never repeats an unknown failure code', async () => {
    const result = await translate([POST, '--languages', 'fr', '--org', ORG], () =>
      Response.json({
        language: 'en',
        translations: [],
        failed: [{ language: 'fr', code: 'private provider text' }],
      })
    )
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout).failed).toEqual([
      { language: 'fr', code: 'TRANSLATION_FAILED' },
    ])
    expect(result.stdout + result.stderr).not.toContain('private')
  })

  it('explains a refusal for credits without suggesting --max-credits', async () => {
    const result = await translate([POST, '--languages', 'fr', '--org', ORG], () =>
      Response.json(
        {
          error: 'Not enough credits',
          code: 'INSUFFICIENT_CREDITS',
          failed: [{ language: 'fr', code: 'INSUFFICIENT_CREDITS' }],
        },
        { status: 402 }
      )
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: 'INSUFFICIENT_CREDITS',
        message: 'Not enough credits to translate this post',
        retryable: false,
        hint: 'Add credits in the Teler app, then retry.',
      },
    })
  })

  it('says when the organization cannot translate', async () => {
    const result = await translate([POST, '--languages', 'fr', '--org', ORG], () =>
      Response.json(
        { error: 'Translation is unavailable', code: 'TRANSLATION_UNAVAILABLE' },
        { status: 503 }
      )
    )
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: 'TRANSLATION_UNAVAILABLE',
        message: "Translation is not available for this post's organization",
        retryable: false,
      },
    })
  })

  it.each([
    [[POST], '--languages is required'],
    [[POST, '--languages', 'fr,xx'], 'Unknown language xx; use en, ca, es, fr, it, de or pt'],
    [[POST, '--languages', ' , '], '--languages is required'],
    [[POST, '--languages', 'en,ca,es,fr,it,de,pt'], 'Translate into at most 6 languages at once'],
    [['dash_01m2mgs69ge8nvmkdg6924cgg9', '--languages', 'fr'], 'Invalid post ID'],
    [[POST, POST, '--languages', 'fr'], 'Usage: teler post translate <post-id> --languages <list>'],
    [[POST, '--languages', 'fr', '--file', 'x.json'], 'Unknown option'],
  ])('rejects %j before calling the API', async (args, message) => {
    const result = await translate(args, () => {
      throw new Error('no request expected')
    })
    expect(result.exitCode).toBe(2)
    expect(result.requests).toEqual([])
    expect(JSON.parse(result.stderr).error.message).toBe(message)
  })

  it('accepts spaces, capitals and repeats in the list', async () => {
    const result = await translate([POST, '--languages', 'FR, de,fr', '--org', ORG], () =>
      Response.json({ language: 'en', translations: [translation('fr'), translation('de')] })
    )
    expect(result.exitCode).toBe(0)
    expect(result.requests[0]?.body).toEqual({ languages: ['fr', 'de'] })
    expect(JSON.parse(result.stdout).translated).toEqual(['fr', 'de'])
  })
})

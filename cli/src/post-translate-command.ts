import { z } from 'zod'
import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { assertNoFlags, takeOption } from './command-args'
import { emitJson } from './command-output'
import { ApiError, CommandError, UsageError } from './errors'
import { resourceIdSchema, resourcePath } from './read-resources'

/** The languages a post can be in; a post translates into the others, a few at a time. */
export const POST_LANGUAGES = ['en', 'ca', 'es', 'fr', 'it', 'de', 'pt'] as const
const MAX_LANGUAGES = POST_LANGUAGES.length - 1

const failureCodeSchema = z
  .enum(['INSUFFICIENT_CREDITS', 'TRANSLATION_FAILED', 'ALREADY_IN_LANGUAGE'])
  .catch('TRANSLATION_FAILED')
const responseSchema = z.object({
  language: z.string().nullable(),
  translations: z.array(
    z.object({
      language: z.string(),
      title: z.string().nullable(),
      content: z.string(),
      status: z.string(),
      translatedAt: z.string(),
      labels: z.record(z.string(), z.string()),
    })
  ),
  failed: z.array(z.object({ language: z.string(), code: failureCodeSchema })).optional(),
})

/** `--languages fr,de`: known codes, each once. */
function parseLanguages(raw: string | undefined): string[] {
  const languages = [
    ...new Set(
      (raw ?? '')
        .split(',')
        .map((code) => code.trim().toLowerCase())
        .filter(Boolean)
    ),
  ]
  if (languages.length === 0) throw new UsageError('--languages is required')
  const unknown = languages.find((code) => !(POST_LANGUAGES as readonly string[]).includes(code))
  if (unknown)
    throw new UsageError(
      `Unknown language ${unknown}; use ${POST_LANGUAGES.slice(0, -1).join(', ')} or ${POST_LANGUAGES.at(-1)}`
    )
  if (languages.length > MAX_LANGUAGES)
    throw new UsageError(`Translate into at most ${MAX_LANGUAGES} languages at once`)
  return languages
}

async function requestTranslations(client: TelerApiClient, path: string, languages: string[]) {
  try {
    return await client.json(path, responseSchema, {
      method: 'POST',
      body: JSON.stringify({ languages }),
    })
  } catch (error) {
    if (error instanceof ApiError && error.code === 'INSUFFICIENT_CREDITS')
      throw new CommandError(
        'INSUFFICIENT_CREDITS',
        'Not enough credits to translate this post',
        'Add credits in the Teler app, then retry.'
      )
    if (error instanceof ApiError && error.code === 'TRANSLATION_UNAVAILABLE')
      throw new CommandError(
        'TRANSLATION_UNAVAILABLE',
        "Translation is not available for this post's organization"
      )
    throw error
  }
}

/** `teler post translate <post-id> --languages <list>`: Teler translates the saved post. */
export async function runPostTranslateCommand(
  client: TelerApiClient,
  output: Output,
  args: string[],
  organizationId?: string
): Promise<void> {
  const raw = takeOption(args, '--languages')
  assertNoFlags(args)
  if (args.length !== 1)
    throw new UsageError('Usage: teler post translate <post-id> --languages <list>')
  const postId = args[0] ?? ''
  if (!resourceIdSchema('post').safeParse(postId).success) throw new UsageError('Invalid post ID')
  const languages = parseLanguages(raw)
  const path = await resourcePath(client, `post/${postId}/translations`, organizationId)
  const result = await requestTranslations(client, path, languages)
  const failed = (result.failed ?? []).filter(({ language }) => languages.includes(language))
  const failedLanguages = new Set(failed.map(({ language }) => language))
  const made = new Set(result.translations.map(({ language }) => language))
  const translated = languages.filter(
    (code) => !failedLanguages.has(code) && code !== result.language && made.has(code)
  )
  const skipped = languages.filter(
    (code) => !failedLanguages.has(code) && !translated.includes(code)
  )
  if (output.json)
    emitJson(output, {
      postId,
      language: result.language,
      translated,
      failed,
      skipped,
      translations: result.translations,
    })
  else {
    if (translated.length) output.write(`Translated ${postId} into ${translated.join(', ')}.\n`)
    if (failed.length)
      output.write(
        `Not translated: ${failed.map(({ language, code }) => `${language} (${code})`).join(', ')}.\n`
      )
    for (const code of skipped)
      output.write(
        code === result.language
          ? `Skipped ${code}: it is the post's main language.\n`
          : `Skipped ${code}.\n`
      )
  }
  if (translated.length === 0 && failed.length > 0)
    throw new CommandError('TRANSLATION_FAILED', `${postId} was not translated into any language`)
}

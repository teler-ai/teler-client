#!/usr/bin/env bun

import { authStatus, login, loginWithDeviceFile, logout } from './auth'
import { respondToApproval } from './approvals'
import { TelerApiClient, type FetchLike } from './api'
import { resolveChatId, resolveTaskId } from './chat-id'
import { listArtifacts, listChats, sendMessage, showChat, watchTask } from './chats'
import { assertNoFlags, takeFlag, takeOption, withTimeout } from './command-args'
import {
  createConfiguredCredentialStore,
  resolveCredential,
  type CredentialStore,
  type ResolvedCredential,
} from './credentials'
import { jsonError, UsageError } from './errors'
import { runDataCommand } from './data-command'
import { runAnalysisCommand } from './run-command'
import { runArtifactCommand } from './artifact-command'
import { runSchemaCommand } from './schema-command'
import { runFileCommand } from './file-command'
import { runUploadCommand } from './upload-command'
import { runSyncCommand } from './sync-command'
import { runResourceCommand as runReadResourceCommand } from './resource-command'
import { resolveTelerUrl, type TelerUrlEnv } from './url'
import { withAccessToken } from './access-token'
import { parseResourceCommand, type ResourceKind } from './resource-options'
import { runResourceCommand } from './resources'
import { runDashboardCommand } from './dashboard-command'
import { runScheduleCommand } from './schedule-command'
import { runAgentAccessCommand } from './agent-access-command'
import { steerTurn } from './steer'
import { runUpdateCommand } from './update'
import { startUpdateNotice } from './update-check'
import { writeInfo } from './usage'

interface MainDeps {
  env?: NodeJS.ProcessEnv & TelerUrlEnv
  fetch?: FetchLike
  store?: CredentialStore
  createStore?: () => CredentialStore
  writeOut?: (text: string) => void
  writeErr?: (text: string) => void
}

async function requireCredential(
  store: CredentialStore,
  origin: string,
  env: NodeJS.ProcessEnv
): Promise<ResolvedCredential> {
  const credential = await resolveCredential(store, origin, env)
  if (!credential) throw new UsageError('Not authenticated. Run `teler auth login`.')
  return credential
}

export async function main(argv: readonly string[], deps: MainDeps = {}): Promise<number> {
  const args = [...argv]
  const writeOut = deps.writeOut ?? ((text) => process.stdout.write(text))
  const writeErr = deps.writeErr ?? ((text) => process.stderr.write(text))
  const json = takeFlag(args, '--json')
  try {
    if (writeInfo(args, json, writeOut)) return 0
    const metadataOnly = takeFlag(args, '--metadata-only')
    if (metadataOnly && !json) {
      throw new UsageError('--metadata-only requires --json')
    }
    const [group, action] = args.splice(0, 2)
    if (runSchemaCommand(group, action, args, { json, metadataOnly, write: writeOut })) return 0
    if (group === 'update')
      return await runUpdateCommand(action, args, { json, write: writeOut }, { fetch: deps.fetch })
    const env = deps.env ?? process.env
    const baseUrl = resolveTelerUrl(env)
    const fetchImpl = withAccessToken(env, deps.fetch)
    const supportsMetadataOnly = group === 'send' || (group === 'task' && action === 'watch')
    if (metadataOnly && !supportsMetadataOnly) {
      throw new UsageError('--metadata-only is only valid for send and task watch')
    }

    if (group === 'sync') {
      await runSyncCommand({ json, metadataOnly, write: writeOut }, action, args, {
        env,
        store: deps.store,
        fetch: fetchImpl,
      })
      return 0
    }

    if (group === 'auth' && action === 'login') {
      const deviceFile = takeOption(args, '--device-file')
      assertNoFlags(args)
      if (args.length > 0) {
        throw new UsageError('Usage: teler auth login [--device-file <absolute-path>]')
      }
      const store =
        deps.store ?? (deps.createStore ?? (() => createConfiguredCredentialStore(env)))()
      if (deviceFile) {
        await loginWithDeviceFile(baseUrl, deviceFile, {
          store,
          write: writeOut,
          fetch: fetchImpl,
        })
      } else {
        await login(baseUrl, { store, write: writeOut, fetch: fetchImpl })
      }
      return 0
    }

    const environmentToken = env.TELER_TOKEN?.trim()
    const store =
      deps.store ??
      (environmentToken
        ? { get: async () => null, set: async () => undefined, delete: async () => undefined }
        : (deps.createStore ?? (() => createConfiguredCredentialStore(env)))())
    const credential = await requireCredential(store, baseUrl.origin, env)
    const token = credential.token
    if (group === 'auth' && action === 'status') {
      assertNoFlags(args)
      if (args.length > 0) throw new UsageError('Usage: teler auth status')
      const status = await authStatus(baseUrl, token, fetchImpl)
      writeOut(
        json
          ? `${JSON.stringify(status)}\n`
          : `Authenticated as ${status.user.name ?? status.user.id} on ${baseUrl.origin}.\n`
      )
      return 0
    }
    if (group === 'auth' && action === 'logout') {
      assertNoFlags(args)
      if (args.length > 0) throw new UsageError('Usage: teler auth logout')
      await logout(baseUrl, token, store, {
        deleteStoredCredential: credential.source === 'store',
        fetch: fetchImpl,
      })
      writeOut(`Logged out from ${baseUrl.origin}.\n`)
      return 0
    }

    const client = new TelerApiClient(baseUrl, token, fetchImpl)
    const output = { json, metadataOnly, write: writeOut }
    if (await runAnalysisCommand(group, action, args, client, output)) return 0
    if (await runArtifactCommand(group, action, args, client, output)) return 0
    if (await runDataCommand(group, action, args, client, output)) return 0
    if (group === 'files') {
      await runFileCommand(client, output, action, args)
      return 0
    }
    if (group === 'upload') {
      args.unshift(action ?? '')
      await runUploadCommand(client, output, args)
      return 0
    }
    if (
      group === 'dashboard' &&
      (action === 'add-widget' ||
        action === 'archive' ||
        action === 'approve-refresh' ||
        ((action === 'create' || action === 'update') && !args.includes('--file')))
    ) {
      await runDashboardCommand(client, output, action, args)
      return 0
    }
    if (group === 'schedule') {
      await runScheduleCommand(client, output, action, args)
      return 0
    }
    if (await runReadResourceCommand(group, action, args, client, output)) return 0
    if (group === 'skill' || group === 'memory' || group === 'agent') {
      const command = await parseResourceCommand(group as ResourceKind, action, args)
      await runResourceCommand(client, output, command)
      return 0
    }
    if (group === 'chat' && action === 'list') {
      const limitRaw = takeOption(args, '--limit')
      assertNoFlags(args)
      if (args.length > 0) throw new UsageError('Usage: teler chat list [--limit <count>]')
      const limit = limitRaw ? Number(limitRaw) : 20
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new UsageError('--limit must be an integer from 1 to 100')
      }
      await listChats(client, output, limit)
      return 0
    }
    if (group === 'chat' && (action === 'show' || action === 'artifacts')) {
      assertNoFlags(args)
      if (args.length !== 1) throw new UsageError(`Usage: teler chat ${action} <chat-id-or-url>`)
      const chatId = resolveChatId(args[0] ?? '')
      if (action === 'show') await showChat(client, output, chatId)
      else await listArtifacts(client, output, chatId)
      return 0
    }
    if (group === 'task' && action === 'watch') {
      const timeout = takeOption(args, '--timeout')
      assertNoFlags(args)
      if (args.length !== 2) {
        throw new UsageError('Usage: teler task watch <chat-id-or-url> <task-id>')
      }
      await withTimeout(timeout, async (signal) =>
        watchTask(
          client,
          output,
          resolveChatId(args[0] ?? ''),
          resolveTaskId(args[1] ?? ''),
          signal
        )
      )
      return 0
    }
    if (group === 'approval' && action === 'respond') {
      const organizationId = takeOption(args, '--org')
      const allow = takeFlag(args, '--allow')
      const deny = takeFlag(args, '--deny')
      const wait = takeFlag(args, '--wait')
      const timeout = takeOption(args, '--timeout')
      assertNoFlags(args)
      if (allow === deny) {
        throw new UsageError('teler approval respond requires exactly one of --allow or --deny')
      }
      if (args.length !== 2) {
        throw new UsageError(
          'Usage: teler approval respond <chat-id-or-url> <approval-id> (--allow | --deny)'
        )
      }
      await withTimeout(timeout, async (signal) =>
        respondToApproval(client, output, {
          chatId: resolveChatId(args[0] ?? ''),
          approvalId: args[1] ?? '',
          organizationId,
          approved: allow,
          wait,
          signal,
        })
      )
      return 0
    }
    if (group === 'agent-access') {
      await runAgentAccessCommand(client, output, action, args)
      return 0
    }
    if (group === 'steer') {
      args.unshift(action ?? '')
      const timeout = takeOption(args, '--timeout')
      assertNoFlags(args)
      if (args.length !== 2 || !args[1]) {
        throw new UsageError('Usage: teler steer <chat-id-or-url> "message"')
      }
      const [chatReference, message] = args as [string, string]
      await withTimeout(timeout, async (signal) =>
        steerTurn(client, output, { chatId: resolveChatId(chatReference), message, signal })
      )
      return 0
    }
    if (group === 'send') {
      args.unshift(action ?? '')
      const chatReference = takeOption(args, '--chat')
      const newChat = takeFlag(args, '--new')
      const organizationId = takeOption(args, '--org')
      const title = takeOption(args, '--title')
      const modelSetRaw = takeOption(args, '--model-set')
      const deepAnalysis = takeFlag(args, '--deep')
      const wait = takeFlag(args, '--wait')
      const timeout = takeOption(args, '--timeout')
      assertNoFlags(args)
      if (newChat === Boolean(chatReference)) {
        throw new UsageError('teler send requires exactly one of --chat or --new')
      }
      if (title && !newChat) throw new UsageError('--title is only valid with --new')
      if (args.length !== 1 || !args[0]) throw new UsageError('teler send requires one message')
      if (modelSetRaw !== undefined && modelSetRaw !== 'lite' && modelSetRaw !== 'pro') {
        throw new UsageError('--model-set must be lite or pro')
      }
      await withTimeout(timeout, async (signal) =>
        sendMessage(client, output, {
          chatId: chatReference ? resolveChatId(chatReference) : undefined,
          newChat,
          organizationId,
          title,
          modelSet: modelSetRaw,
          deepAnalysis,
          wait,
          message: args[0],
          signal,
        })
      )
      return 0
    }

    throw new UsageError('Unknown command. Run `teler --help`.')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    writeErr(json ? `${JSON.stringify(jsonError(error))}\n` : `teler: ${message}\n`)
    return error instanceof UsageError ? 2 : 1
  }
}

if (import.meta.main) {
  const notice = startUpdateNotice(process.argv.slice(2), { env: process.env })
  process.exitCode = await main(process.argv.slice(2))
  await notice.finish((text) => process.stderr.write(text))
}

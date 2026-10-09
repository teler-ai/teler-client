/**
 * The CLI's reusable client: the HTTP API client, device sign-in, credential
 * storage, sending chat messages, watching tasks and uploads. The `teler`
 * command is the `./cli` entry.
 */
export { resolveApiUrl, TelerApiClient, type FetchLike } from './api'
export { authStatus, loginWithDeviceFile } from './auth'
export { sendMessage, watchTask } from './chats'
export { assertNoFlags, takeFlag, takeOption } from './command-args'
export {
  createConfiguredCredentialStore,
  createFileCredentialStore,
  resolveCredential,
  type CredentialStore,
} from './credentials'
export { ApiError, UsageError } from './errors'
export { uploadListSchema, uploadStatusSchema, type UploadStatusResponse } from './upload-contract'
export { abortableDelay } from './upload-retry'
export { getUploadStatus, uploadLocalFile, type UploadStatus } from './uploads'

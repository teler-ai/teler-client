import { homedir } from 'node:os'
import { join } from 'node:path'

export function syncDirectory(env: NodeJS.ProcessEnv, home = homedir()) {
  return join(env.XDG_STATE_HOME?.trim() || join(home, '.local', 'state'), 'teler', 'sync')
}
function credentialDirectory(env: NodeJS.ProcessEnv, home: string) {
  return join(env.XDG_CONFIG_HOME?.trim() || join(home, '.config'), 'teler', 'credentials')
}
/**
 * CLI credentials and sync state are never uploaded, both where this process
 * keeps them and at their defaults: an embedder such as Teler Desktop moves
 * its own with `XDG_*`, while the user's CLI keeps using the defaults.
 */
export function protectedSyncPaths(env: NodeJS.ProcessEnv, home = homedir()) {
  return [
    ...new Set([
      credentialDirectory(env, home),
      syncDirectory(env, home),
      credentialDirectory({}, home),
      syncDirectory({}, home),
    ]),
  ]
}

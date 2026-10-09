import { version } from '../package.json'

/** How the CLI names itself to Teler: `User-Agent` and `Teler-Client`. */
export const CLIENT_ID = `teler-cli/${version}`

export function clientHeaders(): Record<string, string> {
  return { 'User-Agent': CLIENT_ID, 'Teler-Client': CLIENT_ID }
}

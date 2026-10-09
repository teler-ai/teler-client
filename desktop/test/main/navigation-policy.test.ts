import { describe, expect, it } from 'vitest'
import { parseMagicLink } from '../../src/main/magic-link'
import {
  decideChildNavigation,
  decideMainNavigation,
  decideWindowOpen,
  isExternalUrl,
  isPermissionAllowed,
} from '../../src/main/navigation-policy'
import { resolveAuthOrigin, resolveTelerOrigin, sessionPartition } from '../../src/main/origin'

const origin = 'https://app.teler.ai'

describe('origin', () => {
  it('defaults to production and accepts HTTPS or loopback origins', () => {
    expect(resolveTelerOrigin(undefined)).toBe(origin)
    expect(resolveTelerOrigin(' https://app.teler.example/ ')).toBe('https://app.teler.example')
    expect(resolveTelerOrigin('http://localhost:5173')).toBe('http://localhost:5173')
  })

  it.each([
    'http://app.teler.ai',
    'https://app.teler.ai/files',
    'https://user:pass@app.teler.ai',
    'https://app.teler.ai?x=1',
    'not a url',
  ])('rejects %s', (value) => {
    expect(() => resolveTelerOrigin(value)).toThrow()
  })

  it('separates sessions per origin', () => {
    expect(sessionPartition(origin)).toBe('persist:teler')
    expect(sessionPartition('http://localhost:5173')).toBe('persist:teler-localhost_5173')
  })
})

describe('main window navigation', () => {
  it('keeps Teler pages in the window and sends other sites to the browser', () => {
    expect(decideMainNavigation('https://app.teler.ai/files', origin)).toBe('allow')
    // On an origin behind Cloudflare Access, its login (through GitHub) completes in the window;
    // production never trusts those hosts.
    const accessOrigin = 'https://app.teler.example'
    for (const login of [
      'https://team.cloudflareaccess.com/cdn-cgi/access/login/app.teler.example',
      'https://github.com/login/oauth/authorize?client_id=x',
      'https://github.com/sessions/two-factor/app',
    ]) {
      expect(decideMainNavigation(login, accessOrigin), login).toBe('allow')
      expect(decideMainNavigation(login, origin), login).toBe('external')
    }
    for (const other of [
      'http://team.cloudflareaccess.com/x',
      'https://gist.github.com/x',
      'https://github.com.evil.example/login',
      'https://cloudflareaccess.com.evil.example/x',
    ])
      expect(decideMainNavigation(other, accessOrigin), other).toBe('external')
    expect(decideMainNavigation('https://payments.example.com/p/session', origin)).toBe('external')
    expect(decideMainNavigation('mailto:hello@example.com', origin)).toBe('external')
  })

  it.each([
    'https://app.teler.ai.evil.example/',
    'https://evil.example/?next=https://app.teler.ai',
    'http://app.teler.ai/',
  ])('does not treat look-alike %s as Teler', (target) => {
    expect(decideMainNavigation(target, origin)).toBe('external')
  })

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'teler-desktop://app/index.html', 'x'])(
    'denies %s',
    (target) => {
      expect(decideMainNavigation(target, origin)).toBe('deny')
    }
  )
})

describe('window.open', () => {
  it('opens same-origin popups in the app and external links in the browser', () => {
    expect(decideWindowOpen('https://app.teler.ai/api/oauth/google/start', origin)).toBe('child')
    expect(decideWindowOpen('https://example.com/source', origin)).toBe('external')
    expect(decideWindowOpen('about:blank', origin)).toBe('deny')
    expect(decideWindowOpen('file:///tmp/x', origin)).toBe('deny')
  })

  it('lets child windows follow HTTPS providers but not local schemes', () => {
    expect(decideChildNavigation('https://accounts.example.com/o/oauth2', origin)).toBe('allow')
    expect(decideChildNavigation('https://app.teler.ai/api/oauth/callback', origin)).toBe('allow')
    expect(decideChildNavigation('http://insecure.example', origin)).toBe('external')
    expect(decideChildNavigation('file:///etc/hosts', origin)).toBe('deny')
  })

  it('hands only web and mail links to the operating system', () => {
    expect(isExternalUrl('https://example.com')).toBe(true)
    expect(isExternalUrl('mailto:a@example.com')).toBe(true)
    expect(isExternalUrl('file:///Applications/Calculator.app')).toBe(false)
    expect(isExternalUrl('smb://host/share')).toBe(false)
  })
})

describe('permissions', () => {
  it('grants Teler copy, notifications, full screen and microphone-only media', () => {
    expect(isPermissionAllowed('clipboard-sanitized-write', `${origin}/chat`, origin)).toBe(true)
    expect(isPermissionAllowed('notifications', `${origin}/`, origin)).toBe(true)
    expect(isPermissionAllowed('media', `${origin}/`, origin, ['audio'])).toBe(true)
  })

  it('denies cameras, other permissions and other origins', () => {
    expect(isPermissionAllowed('media', `${origin}/`, origin, ['audio', 'video'])).toBe(false)
    expect(isPermissionAllowed('media', `${origin}/`, origin)).toBe(false)
    expect(isPermissionAllowed('geolocation', `${origin}/`, origin)).toBe(false)
    expect(isPermissionAllowed('openExternal', `${origin}/`, origin)).toBe(false)
    expect(isPermissionAllowed('notifications', 'https://evil.example/', origin)).toBe(false)
  })
})

describe('copied sign-in links', () => {
  const link = `${origin}/api/auth/magic-link/verify?token=abc&callbackURL=%2F`

  it('accepts a magic link for the configured origin', () => {
    expect(parseMagicLink(`  ${link}#frag `, origin)).toBe(link)
  })

  it.each([
    'https://evil.example/api/auth/magic-link/verify?token=abc',
    `${origin}/api/auth/magic-link/verify`,
    `${origin}/api/auth/sign-out?token=abc`,
    `https://user@app.teler.ai/api/auth/magic-link/verify?token=abc`,
    'hello',
  ])('rejects %s', (value) => {
    expect(parseMagicLink(value, origin)).toBeNull()
  })
})

describe('separate sign-in origin', () => {
  const app = 'http://localhost:3000'
  const auth = 'http://localhost:3001'

  it('uses a separate sign-in origin only when configured', () => {
    expect(resolveAuthOrigin(undefined, origin)).toBe(origin)
    expect(resolveAuthOrigin('  ', origin)).toBe(origin)
    expect(resolveAuthOrigin(' http://localhost:3001/ ', app)).toBe(auth)
    expect(() => resolveAuthOrigin('http://auth.example', app)).toThrow('TELER_AUTH_URL')
  })

  it('treats the sign-in origin as Teler and nothing else', () => {
    expect(decideMainNavigation(`${auth}/sign-in`, app, auth)).toBe('allow')
    expect(decideWindowOpen(`${auth}/portal/account`, app, auth)).toBe('child')
    expect(decideChildNavigation(`${auth}/device`, app, auth)).toBe('allow')
    expect(decideMainNavigation('http://localhost:3002/', app, auth)).toBe('external')
    expect(decideMainNavigation(`${auth}/sign-in`, app)).toBe('external')
  })

  it('accepts a copied sign-in link for the sign-in origin', () => {
    const link = `${auth}/api/auth/magic-link/verify?token=t`
    expect(parseMagicLink(link, app, auth)).toBe(link)
    expect(parseMagicLink(link, app)).toBeNull()
  })
})

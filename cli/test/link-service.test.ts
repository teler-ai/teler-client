import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  installService,
  serviceStatus,
  uninstallService,
  type ServiceHost,
} from '../src/link/service'
import { runServiceCommand } from '../src/link/service-command'
import {
  launchAgentPlist,
  linkServiceCommand,
  serviceEnvironment,
  systemdUnit,
  windowsLauncher,
  windowsTaskXml,
} from '../src/link/service-units'

const spec = {
  command: ['/opt/teler 100%/teler', 'link'],
  env: { TELER_URL: 'https://app.teler.example', PATH: '/usr/bin:$HOME/bin' },
}

describe('teler link service: definitions', () => {
  test('runs the same CLI with link: the executable, or bun with the entry from a checkout', () => {
    expect(linkServiceCommand('/usr/local/bin/teler', 'file:///$bunfs/root/teler')).toEqual([
      '/usr/local/bin/teler',
      'link',
    ])
    expect(
      linkServiceCommand('/usr/bin/bun', 'file:///repo/cli/src/link/service-units.ts')
    ).toEqual(['/usr/bin/bun', '/repo/cli/src/index.ts', 'link'])
  })

  test('keeps the Teler origin and PATH, and never a token', () => {
    const env = {
      TELER_URL: 'https://app.teler.example/',
      PATH: '/usr/bin',
      TELER_TOKEN: 'secret-token',
      TELER_LINK_CODEX_BIN: '/opt/codex',
      HOME: '/home/someone',
    }
    expect(serviceEnvironment(env, 'linux')).toEqual({
      TELER_URL: 'https://app.teler.example',
      PATH: '/usr/bin',
      TELER_LINK_CODEX_BIN: '/opt/codex',
    })
    expect(serviceEnvironment(env, 'win32').PATH).toBeUndefined()
    expect(JSON.stringify(serviceEnvironment(env, 'darwin'))).not.toContain('secret-token')
  })

  test('a systemd user unit that restarts on failure but not on a lost pairing', () => {
    const unit = systemdUnit(spec)
    expect(unit).toContain('ExecStart="/opt/teler 100%%/teler" "link"')
    expect(unit).toContain('Environment="TELER_URL=https://app.teler.example"')
    expect(unit).toContain('Environment="PATH=/usr/bin:$$HOME/bin"')
    expect(unit).toContain('Restart=on-failure')
    expect(unit).toContain('RestartPreventExitStatus=2')
    expect(unit).toContain('WantedBy=default.target')
    expect(unit).not.toContain('User=')
  })

  test('a LaunchAgent and a per-user logon task', () => {
    const plist = launchAgentPlist({
      command: ['/Apps/T & T/teler', 'link'],
      env: spec.env,
      logPath: '/Users/someone/Library/Logs/teler-link.log',
    })
    expect(plist).toContain('<string>ai.teler.link</string>')
    expect(plist).toContain('<string>/Apps/T &amp; T/teler</string>')
    expect(plist).toContain('<key>SuccessfulExit</key>')
    expect(plist).toContain('<key>TELER_URL</key>')
    const task = windowsTaskXml({
      userId: 'PC\\someone',
      launcherPath: 'C:\\Users\\someone\\teler-link.cmd',
    })
    expect(task).toContain('<LogonTrigger><Enabled>true</Enabled><UserId>PC\\someone</UserId>')
    expect(task).toContain('<RunLevel>LeastPrivilege</RunLevel>')
    expect(task).not.toContain('HighestAvailable')
    expect(task).toContain('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>')
    const launcher = windowsLauncher({
      command: ['C:\\teler.exe', 'link'],
      env: { TELER_URL: 'https://x.example' },
    })
    expect(launcher).toBe(
      '@echo off\r\nset "TELER_URL=https://x.example"\r\n"C:\\teler.exe" "link"\r\n'
    )
  })
})

describe('teler link service: install, status, uninstall', () => {
  let home: string
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'teler-link-service-'))
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  function host(platform: NodeJS.Platform, answers: Record<string, string> = {}) {
    const ran: string[] = []
    const fake: ServiceHost = {
      platform,
      home,
      env: {},
      uid: 501,
      user: 'PC\\someone',
      async run(command) {
        ran.push(command.join(' '))
        const stdout = answers[command.join(' ')]
        return { exitCode: 0, stdout: stdout ?? '', stderr: '' }
      },
    }
    return { fake, ran }
  }

  test('Linux: a user unit through systemctl --user, never sudo', async () => {
    const { fake, ran } = host('linux', {
      'systemctl --user is-active teler-link.service': 'active\n',
    })
    const path = await installService(fake, spec)
    expect(path).toBe(join(home, '.config', 'systemd', 'user', 'teler-link.service'))
    expect(await readFile(path, 'utf8')).toBe(systemdUnit(spec))
    expect(ran).toEqual([
      'systemctl --user daemon-reload',
      'systemctl --user enable teler-link.service',
      'systemctl --user restart teler-link.service',
    ])
    expect(await serviceStatus(fake)).toEqual({
      platform: 'linux',
      installed: true,
      running: true,
      path,
    })
    expect(await uninstallService(fake)).toBe(true)
    expect(await stat(path).catch(() => null)).toBeNull()
    expect(ran.some((line) => line.includes('sudo'))).toBe(false)
  })

  test('macOS: a LaunchAgent in the user’s GUI domain', async () => {
    const { fake, ran } = host('darwin')
    const path = await installService(fake, spec)
    expect(path).toBe(join(home, 'Library', 'LaunchAgents', 'ai.teler.link.plist'))
    expect(ran).toEqual([
      'launchctl bootout gui/501/ai.teler.link',
      `launchctl bootstrap gui/501 ${path}`,
    ])
  })

  test('Windows: a per-user task from an XML definition', async () => {
    const { fake, ran } = host('win32', {
      'schtasks /Query /TN Teler Link /FO LIST': 'TaskName: \\Teler Link\r\nStatus:   Running\r\n',
    })
    const path = await installService(fake, spec)
    const bytes = await readFile(path)
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xfe])
    expect(bytes.subarray(2).toString('utf16le')).toContain('<LogonTrigger>')
    expect(ran).toEqual([
      `schtasks /Create /TN Teler Link /XML ${path} /F`,
      'schtasks /Run /TN Teler Link',
    ])
    expect((await serviceStatus(fake)).running).toBe(true)
  })

  test('install needs a pairing of its own, and is not for Teler Desktop', async () => {
    const { fake } = host('linux')
    const output = { json: true, write: () => undefined }
    await expect(
      runServiceCommand('install', [], output, {
        host: fake,
        managed: false,
        paired: async () => false,
      })
    ).rejects.toThrow('Not paired')
    await expect(
      runServiceCommand('install', [], output, {
        host: fake,
        managed: true,
        paired: async () => true,
      })
    ).rejects.toThrow('Teler Desktop')
    let out = ''
    await runServiceCommand(
      'status',
      [],
      { json: true, write: (t) => void (out += t) },
      {
        host: fake,
        managed: false,
        paired: async () => true,
      }
    )
    expect(JSON.parse(out)).toMatchObject({ installed: false, running: false })
  })
})

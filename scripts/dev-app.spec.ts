import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'

const spawn = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ spawn }))

import { parseDevAppOptions, runWebDevelopment } from './dev-app.ts'

/** Child-process double that reports completion when it receives SIGTERM. */
class TestChildProcess extends EventEmitter {
  /** The normal exit code, when applicable. */
  exitCode: number | null = null
  /** The termination signal, when applicable. */
  signalCode: NodeJS.Signals | null = null
  /** Records termination and reports the child as stopped. */
  readonly kill = vi.fn((signal: NodeJS.Signals) => {
    this.signalCode = signal
    queueMicrotask(() => this.emit('exit', null, signal))
    return true
  })

  /** Report an ordinary process exit. */
  exit(code: number): void {
    this.exitCode = code
    this.emit('exit', code, null)
  }
}

afterEach(() => {
  spawn.mockReset()
})

it('reserves the build flag and forwards Web application arguments', () => {
  expect(parseDevAppOptions(['--', '--skip-build', '--port', '3081', '--skip-build'])).toEqual({
    skipBuild: true,
    webArgs: ['--port', '3081'],
  })
})

it('stops the remaining development process after one exits', async () => {
  const watcher = new TestChildProcess()
  const host = new TestChildProcess()
  spawn.mockReturnValueOnce(watcher).mockReturnValueOnce(host)

  const running = runWebDevelopment({ skipBuild: true, webArgs: ['--port', '3081'] })
  watcher.exit(0)

  await expect(running).resolves.toBe(0)
  expect(host.kill).toHaveBeenCalledWith('SIGTERM')
  expect(spawn.mock.calls[1]?.[2]).toMatchObject({
    env: { DSH_HOME: `${process.cwd()}/.dsh-home` },
  })
})

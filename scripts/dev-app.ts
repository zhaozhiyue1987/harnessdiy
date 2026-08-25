/** Starts the built Web frontend watcher and source Host as one development process. */

import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Parsed arguments for {@link runWebDevelopment}. */
export interface DevAppOptions {
  /** Skip the initial artifact build when the current checkout is already built. */
  skipBuild: boolean
  /** Arguments passed verbatim to `dsh web`, such as `--port 3080`. */
  webArgs: string[]
}

/**
 * Parse this script's flag and preserve all Web application arguments.
 *
 * @param args - Arguments passed to this script.
 * @returns the initial-build selection and arguments for `dsh web`.
 */
export function parseDevAppOptions(args: readonly string[]): DevAppOptions {
  let skipBuild = false
  const webArgs: string[] = []
  for (const arg of args) {
    if (arg === '--') continue
    if (arg === '--skip-build') skipBuild = true
    else webArgs.push(arg)
  }
  return {
    skipBuild,
    webArgs,
  }
}

/** A spawned process and its normalized completion result. */
interface StartedProcess {
  /** The active child process. */
  child: ChildProcess
  /** Resolves when the child exits or fails to start. */
  done: Promise<number>
}

/** Stop children and wait until neither can keep the parent process alive. */
async function stopChildren(children: readonly StartedProcess[]): Promise<void> {
  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }
  await Promise.all(children.map(({ done }) => done))
}

/** Spawn one pnpm command with inherited terminal I/O. */
function spawnPnpm(args: readonly string[]): StartedProcess {
  const child = spawn(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
    stdio: 'inherit',
    env: { ...process.env, DSH_HOME: process.env.DSH_HOME ?? resolve('.dsh-home') },
  })
  const done = new Promise<number>((resolve) => {
    child.once('error', () => { resolve(1) })
    child.once('exit', (code) => { resolve(code ?? 1) })
  })
  return { child, done }
}

/**
 * Build artifacts once unless requested otherwise, then keep the Web watcher
 * and source Host alive together. The first child that exits stops its sibling.
 *
 * @param options - Web arguments and initial-build selection.
 * @returns the terminating child process's normalized exit code.
 */
export async function runWebDevelopment(options: DevAppOptions): Promise<number> {
  if (!options.skipBuild) {
    const build = spawnPnpm(['run', 'build'])
    if (await build.done !== 0) return 1
  }

  const watcher = spawnPnpm(['run', 'dev:web'])
  const host = spawnPnpm(['dsh', 'web', ...options.webArgs])
  const children = [watcher, host]
  let interrupted = false
  let resolveInterruption: (() => void) | undefined
  const interruptedPromise = new Promise<void>((resolve) => {
    resolveInterruption = resolve
  })
  const stop = (): void => {
    if (interrupted) return
    interrupted = true
    resolveInterruption?.()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    const code = await Promise.race([...children.map(({ done }) => done), interruptedPromise.then(() => 130)])
    await stopChildren(children)
    return code
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}

const invokedPath = process.argv[1]
const isMain = invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href
if (isMain) {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log('Usage: pnpm run dev:app [--skip-build] [-- <dsh web options>]')
  } else {
    process.exitCode = await runWebDevelopment(parseDevAppOptions(args))
  }
}

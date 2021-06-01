import * as cp from 'child_process'
import * as fp from 'fs/promises'
import * as pt from 'path'
import {run, isNil, isStr, isStruct, toTest, cwdUrl, fileUrlFromAbs, urlRel, valid, validInst, eachValid, show} from './jtg_shared.mjs'

/* Exported but undocumented */

export {Abort, Funs, runMain, isAbort, throwNonAbort, logNonAbort} from './jtg_shared.mjs'

/* Public API */

export {Ctx} from './jtg_shared.mjs'

export function runCli(...funs) {
  return runArgs(funs, process.argv.slice(2))
}

export function runArgs(funs, args) {
  return run(funs, args, process)
}

export async function* watch(target, test, opts) {
  if (!pt.isAbsolute(target)) target = pt.resolve(target)

  test = toTest(test)
  const isDir = (await fp.stat(target)).isDirectory()
  const base = isDir ? target : pt.dirname(target)
  const cwd = cwdUrl(process.cwd())
  const iter = fp.watch(target, opts)

  try {
    for await (const event of iter) {
      const {filename: path} = event
      const url = fileUrlFromAbs(pt.join(base, path))
      const rel = urlRel(url, cwd)
      if (test(rel)) yield {...event, path, url, rel}
    }
  }
  finally {
    iter.return()
  }
}

export function emptty() {
  process.stdout.write('\x1bc\x1b[3J')
}

export function spawn(cmd, args, opts) {
  procValid(cmd, args, opts)

  return link(cp.spawn(cmd, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: !isWin,
    ...opts,
   }))
}

export function fork(cmd, args, opts) {
  procValid(cmd, args, opts)

  return link(cp.fork(cmd, args, {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    detached: !isWin,
    ...opts,
  }))
}

export function link(proc) {
  validInst(proc, cp.ChildProcess)

  function cleanup() {
    proc.removeListener('exit', cleanup)
    procs.delete(proc)
    kill(proc)
  }

  procs.add(proc)
  proc.once('exit', cleanup)
  return proc
}

export async function wait(proc) {
  if (isNil(proc)) return undefined
  validInst(proc, cp.ChildProcess)

  if (isNil(proc.exitCode)) {
    await new Promise(function procWaitInit(done, fail) {
      proc.once('error', fail)
      proc.once('exit', done)
    })
  }

  return onProcExit(proc)
}

export function kill(proc) {
  validInst(proc, cp.ChildProcess)

  if (!isNil(proc.exitCode)) {
    return undefined
  }

  // Rare edge case spotted on Windows.
  if (isNil(proc.pid)) {
    throw Error(`can't kill process ${show(proc.spawnargs)} without pid`)
  }

  // Not ideal. Unless the process explicitly adds its child processes to its
  // own job object, this causes them to get orphaned.
  if (isWin) {
    proc.kill()
    return
  }

  // Requires that the process was spawned with `detached: true`, putting it in
  // its own group. Jtg's `spawn` and `fork` do that.
  process.kill(-proc.pid)
  proc.kill()
}

/* Internal Utils */

const isWin = process.platform === 'win32'
const procs = new Set()
process.once('exit', killRemainingProcs)

function onProcExit(proc) {
  const {exitCode: code, spawnargs: args} = proc
  if (isNil(code)) {
    throw Error(`internal error: attempted to finalize child process ${show(args)} which is still running`)
  }
  if (code) {
    throw Error(`process ${show(args)} exited with ${code}`)
  }
}

function procValid(cmd, args, opts) {
  valid(cmd, isStr)
  if (!isNil(args)) eachValid(args, isStr)
  if (!isNil(opts)) valid(opts, isStruct)
}

function killRemainingProcs() {
  procs.forEach(killRemainingProc)
}

function killRemainingProc(proc) {
  procs.delete(proc)
  kill(proc)
}

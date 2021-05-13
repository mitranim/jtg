import * as cp from 'child_process'

/* Public API */

export function runCli(...funs) {
  return runArgs(funs, process.argv.slice(2))
}

export function runArgs(funs, args) {
  funs = new Funs(...funs)
  eachValid(args, isStr)

  if (!args.length) {
    const fun = funs.def()
    if (fun) return runMain(fun)

    console.error(`Missing task name and no registered tasks.`)
    process.exit(1)
    return
  }

  if (args.length > 1) {
    console.error(`Too many arguments. Please specify one task.\n${help(funs)}`)
    process.exit(1)
    return
  }

  const arg = args[0]
  const fun = funs.get(arg)
  if (fun) return runMain(fun)

  if (arg === '-h' || arg === '--help' || arg === 'help') {
    console.log(help(funs))
    process.exit(0)
    return
  }

  console.error(`No task named ${show(arg)}.\n${help(funs)}`)
  process.exit(1)
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
}

/* Internal Utils */

const isWin = process.platform === 'win32'
const procs = new Set()
process.once('exit', killRemainingProcs)

export async function runMain(fun) {
  const ctx = new Ctx()
  try {return await ctx.run(fun)}
  finally {ctx.deinit()}
}

export class Funs extends Map {
  constructor(...funs) {
    super()
    for (const fun of funs) this.add(fun)
  }

  add(fun) {
    valid(fun, isFun)
    const key = fun.name
    if (!key) throw Error(`missing name for task function ${fun}`)
    if (this.has(key)) throw Error(`duplicate task ${key}`)
    this.set(key, fun)
  }

  names() {return [...this.keys()]}

  def() {
    for (const pair of this) return pair[1]
    return undefined
  }
}

export class Ctx extends Map {
  constructor() {
    super()

    Object.defineProperty(this, 'abc', {
      value: new AbortController(),
      enumerable: false,
      configurable: true,
    })

    Object.defineProperty(this, 'signal', {
      get() {return this.abc.signal},
      enumerable: true,
      configurable: true,
    })
  }

  get [Symbol.toStringTag]() {return this.constructor.name}

  run(fun) {
    if (!this.has(fun)) this.set(fun, fun(this))
    return this.get(fun)
  }

  par(...funs) {
    eachValid(funs, isFun)
    return Promise.all(funs.map(this.run, this))
  }

  async ser(...funs) {
    eachValid(funs, isFun)
    for (const fun of funs) await this.run(fun)
  }

  deinit() {this.abc.abort()}
}

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
  if (isNil(opts)) valid(opts, isStruct)
}

function killRemainingProcs() {
  procs.forEach(killRemainingProc)
}

function killRemainingProc(proc) {
  procs.delete(proc)
  kill(proc)
}

function help(funs) {
  const names = funs.names()
  if (!names.length) return `No tasks are registered.`
  return `Known tasks (case-sensitive): ${show(names)}`
}

function isNil(val)       {return val == null}
function isStr(val)       {return typeof val === 'string'}
function isFun(val)       {return typeof val === 'function'}
function isObj(val)       {return val !== null && typeof val === 'object'}
function isArr(val)       {return isInst(val, Array)}
function isComp(val)      {return isObj(val) || isFun(val)}
function isStruct(val)    {return isObj(val) && !isArr(val)}
function isInst(val, Cls) {return isComp(val) && val instanceof Cls}

function isDict(val) {
  if (!isObj(val)) return false
  const proto = Object.getPrototypeOf(val)
  return proto === null || proto === Object.prototype
}

function each(val, fun, ...args) {
  valid(val, isArr)
  valid(fun, isFun)
  for (let i = 0; i < val.length; i++) fun(val[i], i, ...args)
}

function valid(val, test) {
  if (!isFun(test)) throw Error(`expected validator function, got ${show(test)}`)
  if (!test(val)) invalid(val, test)
}

function eachValid(val, test) {
  valid(test, isFun)
  each(val, validAt, test)
}

function validAt(val, key, test) {
  if (!test(val)) invalidAt(val, key, test)
}

function invalid(val, test) {
  throw Error(`expected ${show(val)} to satisfy test ${show(test)}`)
}

function invalidAt(val, key, test) {
  throw Error(`expected ${show(val)} at key ${key} to satisfy test ${show(test)}`)
}

function validInst(val, Cls) {
  if (!isInst(val, Cls)) {
    throw Error(`expected ${show(val)} to be an instance of ${show(Cls)}`)
  }
}

function show(val) {
  if (isFun(val) && val.name) return val.name

  // Plain data becomes JSON, if possible.
  if (isArr(val) || isDict(val) || isStr(val)) {
    try {
      return JSON.stringify(val)
    }
    catch (__) {
      return String(val)
    }
  }

  return String(val)
}

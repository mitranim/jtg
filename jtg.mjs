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

export function par(ctx, ...funs) {
  validInst(ctx, Ctx)
  eachValid(funs, isFun)
  return Promise.all(funs.map(ctx.run, ctx))
}

export async function ser(ctx, ...funs) {
  validInst(ctx, Ctx)
  eachValid(funs, isFun)
  for (const fun of funs) await ctx.run(fun)
}

export function spawn(ctx, cmd, ...args) {
  procValid(ctx, cmd, args)
  return link(ctx, cp.spawn(cmd, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: !isWin,
  }))
}

export function fork(ctx, cmd, ...args) {
  procValid(ctx, cmd, args)
  return link(ctx, cp.fork(cmd, args, {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    detached: !isWin,
  }))
}

export function link(ctx, proc) {
  validInst(ctx, Ctx)
  validInst(proc, cp.ChildProcess)

  const {signal: sig} = ctx

  function cleanup() {
    sig.removeEventListener('abort', cleanup)
    proc.removeListener('exit', cleanup)
    kill(proc)
  }

  proc.once('exit', cleanup)
  sig.addEventListener('abort', cleanup, {once: true})

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

  if (isWin) {
    proc.kill()
    return
  }

  process.kill(-proc.pid)
}

/* Internal Utils */

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
    this.abc = new AbortController()
  }

  get signal() {return this.abc.signal}

  run(fun) {
    if (!this.has(fun)) this.set(fun, fun(this))
    return this.get(fun)
  }

  deinit() {this.abc.abort()}

  get [Symbol.toStringTag]() {return this.constructor.name}
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

const isWin = process.platform === 'win32'

function procValid(ctx, cmd, args) {
  validInst(ctx, Ctx)
  valid(cmd, isStr)
  eachValid(args, isStr)
}

function help(funs) {
  const names = funs.names()
  if (!names.length) return `No tasks are registered.`
  return `Known tasks (case-sensitive): ${show(names)}`
}

function isNil(val)         {return val == null}
function isStr(val)         {return typeof val === 'string'}
function isFun(val)         {return typeof val === 'function'}
function isObj(val)         {return val !== null && typeof val === 'object'}
function isArr(val)         {return isInst(val, Array)}
function isComp(val)        {return isObj(val) || isFun(val)}
function isPromise(val)     {return isComp(val) && isFun(val.then) && isFun(val.catch)}
function isInst(val, Cls)   {return isComp(val) && val instanceof Cls}

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

/* Semi-public */

export function run(funs, args, proc) {
  funs = new Funs(...funs)
  eachValid(args, isStr)

  if (!args.length) {
    const fun = funs.def()
    if (fun) return runMain(fun)

    console.error(`Missing task name and no registered tasks.`)
    proc.exit(1)
    return
  }

  if (args.length > 1) {
    console.error(`Too many arguments. Please specify one task.\n${help(funs)}`)
    proc.exit(1)
    return
  }

  const arg = args[0]
  const fun = funs.get(arg)
  if (fun) return runMain(fun)

  if (arg === '-h' || arg === '--help' || arg === 'help') {
    console.log(help(funs))
    proc.exit(0)
    return
  }

  console.error(`No task named ${show(arg)}.\n${help(funs)}`)
  proc.exit(1)
}

export async function runMain(fun) {
  const ctx = new Ctx()
  try {return await ctx.run(fun)}
  finally {ctx.abort()}
}

// Uses tricks because `AbortError` is not in global scope.
export function isAbort(err) {
  return isInst(err, Error) && err.name === 'AbortError'
}

export function throwNonAbort(err) {
  if (!isAbort(err)) throw err
}

export function logNonAbort(val) {
  if (!isAbort(val)) console.error(val)
}

export class Ctx {
  constructor({signal} = {}) {
    Object.defineProperties(this, {
      vals: {value: new Map()},
      abc: {value: new Abort(signal)},
      signal: sigDesc,
    })
  }

  run(fun) {
    if (!this.vals.has(fun)) this.vals.set(fun, fun(this))
    return this.vals.get(fun)
  }

  par(...funs) {
    eachValid(funs, isFun)
    return Promise.all(funs.map(this.run, this))
  }

  async ser(...funs) {
    eachValid(funs, isFun)
    for (const fun of funs) await this.run(fun)
  }

  sub() {
    return Object.create(this, {
      abc: {value: this.abc.sub()},
      signal: sigDesc,
    })
  }

  re() {
    this.abort()
    return Object.getPrototypeOf(this).sub()
  }

  each(iter) {
    return this.sub().subEach(iter)
  }

  async* preEach(iter) {
    const ctx = this.sub()
    yield [ctx]
    for await (const val of ctx.subEach(iter)) yield val
  }

  async* subEach(iter) {
    let ctx = this
    for await (const val of iter) {
      ctx = ctx.re()
      yield [ctx, val]
    }
  }

  abort() {this.abc.abort()}
}

export class Abort extends AbortController {
  constructor(sig) {
    super()

    if (!sig) return

    if (sig.aborted) {
      this.abort()
      return
    }

    Object.defineProperty(this, 'sig', {value: sig})
    sig.addEventListener('abort', this, {once: true})
  }

  sub() {
    return new this.constructor(this.signal)
  }

  handleEvent({type}) {
    if (type === 'abort') this.abort()
  }

  abort() {
    if (this.sig) this.sig.removeEventListener('abort', this)
    super.abort()
  }
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

/* Internal Utils */

export function help(funs) {
  const names = funs.names()
  if (!names.length) return `No tasks are registered.`
  return `Known tasks (case-sensitive): ${show(names)}`
}

export function testBy(val, test) {
  valid(val, isStr)
  if (isFun(test)) return test(val)
  if (isReg(test)) return test.test(val)
  return true
}

export function toTest(test) {
  valid(test, isTest)
  return function testAt(path) {return testBy(path, test)}
}

export function isNil(val)       {return val == null}
export function isStr(val)       {return typeof val === 'string'}
export function isFun(val)       {return typeof val === 'function'}
export function isObj(val)       {return val !== null && typeof val === 'object'}
export function isArr(val)       {return isInst(val, Array)}
export function isReg(val)       {return isInst(val, RegExp)}
export function isComp(val)      {return isObj(val) || isFun(val)}
export function isTest(val)      {return isNil(val) || isStr(val) || isReg(val)}
export function isStruct(val)    {return isObj(val) && !isArr(val)}
export function isInst(val, Cls) {return isComp(val) && val instanceof Cls}

export function isDict(val) {
  if (!isObj(val)) return false
  const proto = Object.getPrototypeOf(val)
  return proto === null || proto === Object.prototype
}

export function each(val, fun, ...args) {
  valid(val, isArr)
  valid(fun, isFun)
  for (let i = 0; i < val.length; i++) fun(val[i], i, ...args)
}

export function valid(val, test) {
  if (!isFun(test)) throw Error(`expected validator function, got ${show(test)}`)
  if (!test(val)) invalid(val, test)
}

export function eachValid(val, test) {
  valid(test, isFun)
  each(val, validAt, test)
}

export function validAt(val, key, test) {
  if (!test(val)) invalidAt(val, key, test)
}

export function invalid(val, test) {
  throw Error(`expected ${show(val)} to satisfy test ${show(test)}`)
}

export function invalidAt(val, key, test) {
  throw Error(`expected ${show(val)} at key ${key} to satisfy test ${show(test)}`)
}

export function validInst(val, Cls) {
  if (!isInst(val, Cls)) {
    throw Error(`expected ${show(val)} to be an instance of ${show(Cls)}`)
  }
}

export function show(val) {
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

export const sigDesc = {
  get() {return this.abc.signal},
  enumerable: true,
}

export function trimPrefix(str, pre) {
  valid(str, isStr)
  valid(pre, isStr)
  if (!str.startsWith(pre)) return ''
  return str.slice(pre.length)
}

export function pathToPosix(val) {
  valid(val, isStr)
  return val.replace(/[\\]/g, '/')
}

export function ensureLeadingSlash(val) {
  valid(val, isStr)
  if (val[0] !== '/') val = '/' + val
  return val
}

export function ensureTrailingSlash(val) {
  valid(val, isStr)
  if (!val.endsWith('/')) val += '/'
  return val
}

// Adapter for Windows paths like `C:\\blah`. Unnecessary/nop on Unix.
export function fileUrlFromAbs(path) {
  return new URL(ensureLeadingSlash(pathToPosix(path)), 'file:')
}

export function cwdUrl(cwd) {
  return urlMut(fileUrlFromAbs(cwd), ensureTrailingSlash)
}

export function urlMut(url, fun, ...args) {
  validInst(url, URL)

  const val = fun(url.pathname, ...args)
  valid(val, isStr)

  url.pathname = val
  return url
}

export function urlRel(sub, sup) {
  validInst(sub, URL)
  validInst(sup, URL)
  return decodeURIComponent(trimPrefix(sub.pathname, sup.pathname))
}

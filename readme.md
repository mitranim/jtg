## Overview

"JS Task Group". Simple JS-based replacement for Make, Gulp, etc. Similar in design to Go [Gtg](https://github.com/mitranim/gtg).

Jtg works differently from other task runners. It's _not_ a CLI executable. It's just a library that you import and call.

Tiny, depends only on Node.js (>= 0.15).

## TOC

* [Why](#why)
* [Usage](#usage)
* [Tasks](#tasks)
* [Cancelation](#cancelation)
  * [Process Leaks](#process-leaks)
* [API](#api)
  * [`function runCli`](#function-runclifuns)
  * [`function runArgs`](#function-runargsfuns-args)
  * [`function spawn`](#function-spawncmd-args-opts)
  * [`function fork`](#function-forkcmd-args-opts)
  * [`function link`](#function-linkproc)
  * [`function wait`](#function-waitproc)
  * [`function kill`](#function-killproc)
  * [`class Ctx`](#class-ctx)
    * [`property ctx.signal`](#property-ctxsignal)
    * [`method ctx.run(fun)`](#method-ctxrunfun)
    * [`method ctx.par(fun)`](#method-ctxparfuns)
    * [`method ctx.ser(fun)`](#method-ctxserfuns)

## Why

* Make is not portable.
* `package.json` scripts are not portable. Also, `npm run` is slow to start.
* Gulp is too bloated and complex.
* Most task runners force you to use their CLI, invariably bloated, slow, buggy, and full of weird shit.

## Usage

```sh
npm i -ED jtg

# Run default task.
node make.mjs

# Run specific task.
node make.mjs build

# List available tasks.
node make.mjs --help

# Known tasks (case-sensitive): ["watch","build","styles","scripts","server"]
```

Sample `make.mjs`. The file name is arbitrary.

```js
import * as fp from 'fs/promises'
import * as j from 'jtg'

await j.runCli(watch, build, styles, scripts, server)

async function watch(ctx) {
  await ctx.par(stylesW, scriptsW, serverW)
}

async function build(ctx) {
  await ctx.par(styles, scripts)
}

async function styles(ctx) {
  await j.wait(j.spawn('sass', ['main.scss:main.css'], ctx))
}

async function stylesW(ctx) {
  await j.wait(j.spawn('sass', ['main.scss:main.css', '--watch'], ctx))
}

async function scripts(ctx) {
  const mod = await import('<your-script-build-tool>')
  await mod.someBuildFunction()
}

async function scriptsW(ctx) {
  const mod = await import('<your-script-build-tool>')
  await mod.someWatchFunction()
}

async function server(ctx) {
  // The module should use top-level await. This line waits unless it crashes.
  await import('./scripts/server.mjs')
}

async function serverW(ctx) {
  const start = () => j.fork('./scripts/server.mjs', [], ctx)
  const events = fp.watch('scripts', {recursive: true, ...ctx})

  let proc = start()
  for await (const _ of events) {
    j.kill(proc)
    proc = start()
  }
}
```

## Tasks

In Jtg, tasks are named functions. On the CLI, you specify the name of the task function to run. It may invoke other tasks.

Like other task runners, Jtg forms a "task group", where each task runs no more than once. This is convenient for build systems where many tasks rely on some shared task, and may be invoked either individually or all together. See the [Usage](#usage) example above.

A task takes one argument: a [`Ctx`](#class-ctx) instance. The context stores the results of previously-called task functions, which allows [`ctx.par`](#method-ctxparfuns) and [`ctx.ser`](#method-ctxserfuns) to deduplicate them. It also has an associated [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal): [`ctx.signal`](#property-ctxsignal).

Jtg leaves error handling to you. If you don't handle exceptions, they crash the process. For build tools, this is usually desirable.

## Cancelation

Cancelation happens for the following reasons:

* Main process terminates.
* Main task terminates.

Cancelation happens in the following ways:

* When the main process terminates, its _immediate_ children also terminate. On Windows, this is true for all immediate children. On Unix, this is true for children created by [`spawn`](#function-spawncmd-args-opts) and [`fork`](#function-forkcmd-args-opts). However, _indirect_ children may not terminate; see [Process Leaks](#process-leaks).
* When the main task terminates, but the process is still running, the [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) available as [`ctx.signal`](#property-ctxsignal) is aborted, causing termination of any activities that took this signal, including subprocesses created by [`spawn`](#function-spawncmd-args-opts) and [`fork`](#function-forkcmd-args-opts), if `ctx` was passed to them.

### Process Leaks

By default, on _all_ operating systems, child processes don't terminate together with parents. On Windows, Node uses the "job object" API to link with its _immediate_ children, but not their descendants. Be aware that most programs, written for most systems, don't link with their child processes this way.

Explicit termination via `Ctrl+C` usually works on every system, but crashes are fraught with peril. When you shell out to `sh` (Unix) or `cmd.exe` (Windows) to spawn another program, and then Node crashes or gets killed, the shell will terminate, but that other program will not.

On Unix, Jtg makes an effort to kill entire subprocess groups. However, on Windows, the necessary operating system APIs appear to be unavailable in Node. To reduce process leaks, avoid sub-sub-processes.

The [Usage](#usage) example above invokes `sass`, which demonstrates this very problem. At the time of writing, the recommended Sass implementation is `dart-sass`, and the recommended way to install it on Windows is via Chocolatey. The installation process creates one real executable and one unnecessary wrapper executable, which shells out to the real one, without linking together via a job object. An abrupt termination leaks the sub-sub-process. You can avoid this issue by modifying your `%PATH%`, allowing the OS to find the real executable before the fake one. The problem should never have existed in the first place.

## API

### `function runCli(...funs)`

Shortcut for CLI scripts. See the [Usage](#usage) example above. Simply calls [`runArgs`](#function-runargsfuns-args) with CLI args.

### `function runArgs(funs, args)`

* `funs` must be an iterable of task functions.
* `args` must be an array of strings, usually CLI args.

Chooses one task function, by name, based on the provided args. Runs the task, or prints help and terminates. If `args` are empty, runs the first task.

In addition to provided functions, supports `-h`, `--help` and `help`, which print available tasks and terminate. If there's no match, prints available tasks and terminates.

Like most Jtg functions, this is async. If a task was found, returns the promise of its execution.

```js
// Runs `watch`.
j.runArgs([build, watch], ['watch'])

// Runs the first function (`build`).
j.runArgs([build, watch], [])

// Prints help.
j.runArgs([build, watch], ['--help'])
```

### `function spawn(cmd, args, opts)`

Variant of `child_process.spawn` where:

* Standard output/error is inherited from the parent process.
* Sub-sub-processes are less likely to [leak](#process-leaks) (Unix only).

Should be combined with [`wait`](#function-waitproc). Pass `ctx` as the last argument to take advantage of [`ctx.signal`](#property-ctxsignal) for cancelation.

```js
async function styles(ctx) {
  await j.wait(j.spawn('sass', ['main.scss:main.css'], ctx))
}
```

### `function fork(cmd, args, opts)`

Variant of `child_process.fork` where:

* Standard output/error is inherited from the parent process.
* Sub-sub-processes are less likely to [leak](#process-leaks) (Unix only).

Should be combined with [`wait`](#function-waitproc). Pass `ctx` as the last argument to take advantage of [`ctx.signal`](#property-ctxsignal) for cancelation.

```js
async function server(ctx) {
  await j.wait(j.fork('./scripts/server.mjs', [], ctx))
}
```

### `function link(proc)`

Used internally by [`spawn`](#function-spawncmd-args-opts) and [`fork`](#function-forkcmd-args-opts). Registers the process for additional cleanup via [`kill`](#function-killproc). Returns the same process.

### `function wait(proc)`

Returns a `Promise` that resolves when the provided process terminates for any reason.

```js
async function styles(ctx) {
  await j.wait(j.spawn('sass', ['main.scss:main.css'], ctx))
}
```

### `function kill(proc)`

Variant of `proc.kill()` that tries to terminate the entire subprocess tree. Assumes that it was spawned by [`spawn`](#function-spawncmd-args-opts) or [`fork`](#function-forkcmd-args-opts). These functions share some platform-specific logic.

Automatically used by [`link`](#function-linkproc). In most cases, you don't need to call this. Provided for cases such as restarting a server on changes, where a manual kill is required.

On Windows, this is equivalent to `proc.kill()`. On Unix, this tries to send a termination signal to the entire subprocess group.

```js
async function serverW(ctx) {
  const start = () => j.fork('./scripts/server.mjs', [], ctx)
  const events = fp.watch('scripts', {recursive: true, ...ctx})

  let proc = start()
  for await (const _ of events) {
    j.kill(proc)
    proc = start()
  }
}
```

### `class Ctx`

Represents a "task group", the context of a task run. Created automatically. The same instance is passed to every task in the group. Stores their results for deduplication.

The only enumerable property is [`ctx.signal`](#property-ctxsignal). When calling APIs that take a `signal` for cancelation, pass `ctx` directly, or spread it into other options:

```js
import * as fp from 'fs/promises'
import * as j from 'jtg'

const events = fp.watch('some_folder', ctx)
const events = fp.watch('some_folder', {recursive: true, ...ctx})

const proc = j.fork('some_file.mjs', [], ctx)
const proc = j.fork('some_file.mjs', [], {...ctx, killSignal: 'SIGINT'})
```

#### `property ctx.signal`

Associated [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal), which is aborted when the main task terminates for any reason. Use this for [cancelation](#cancelation). Abort signals are the new standard for cancelation, supported by `fetch`, `child_process` and various other APIs.

#### `method ctx.run(fun)`

Runs the provided task function no more than once. If the task was previously invoked (and possibly still running!), its result is stored and returned from this call. For async functions, their stored result is a promise, not the final value.

This is for singular dependencies. For multiple dependencies, use [`ctx.par`](#method-ctxparfuns) and [`ctx.ser`](#method-ctxserfuns).

```js
// build -> [styles + scripts] -> clean
async function build(ctx) {
  await ctx.par(styles, scripts)
}

// Called from two tasks, but runs only once.
async function clean(ctx) {
  await someDeleteOperation(ctx)
}

async function styles(ctx) {
  await ctx.run(clean)
  await someStyleBuild(ctx)
}

async function scripts() {
  await ctx.run(clean)
  await someScriptBuild(ctx)
}
```

### `method ctx.par(...funs)`

Short for "parallel", or rather "concurrent". Runs the provided task functions concurrently, but no more than once per [`Ctx`](#class-ctx). The result of every task function is stored in `ctx` and reused on redundant calls.

```js
async function watch(ctx) {
  await ctx.par(stylesW, scriptsW, serverW)
}
```

### `method ctx.ser(...funs)`

Short for "serial". Runs the provided task functions serially, but no more than once per [`Ctx`](#class-ctx). The result of every task function is stored in `ctx` and reused on redundant calls.

```js
async function html(ctx) {
  await ctx.ser(clean, styles, templates)
}
```

## License

https://unlicense.org

## Misc

I'm receptive to suggestions. If this library _almost_ satisfies you but needs changes, open an issue or chat me up. Contacts: https://mitranim.com/#contacts

## Overview

"JS task group". Simple JS-based replacement for Make, Gulp, etc. Similar in design to Go [Gtg](https://github.com/mitranim/gtg).

Jtg works differently from other task runners. It's _not_ a CLI executable. It's just a library that you import and call.

Tiny with no dependencies.

## TOC

* [Why](#why)
* [Usage](#usage)
* [Tasks](#tasks)
* [Cancelation](#cancelation)
* [API](#api)
  * [`function runCli`](#function-runclifuns)
  * [`function runArgs`](#function-runargsfuns-args)
  * [`function par`](#function-parctx-funs)
  * [`function ser`](#function-serctx-funs)
  * [`function spawn`](#function-spawnctx-cmd-args)
  * [`function fork`](#function-forkctx-cmd-args)
  * [`function link`](#function-linkctx-proc)
  * [`function wait`](#function-waitproc)
  * [`function kill`](#function-killproc)
  * [`class Ctx`](#class-ctx)
    * [`property ctx.signal`](#property-ctxsignal)
    * [`method ctx.run(fun)`](#method-ctxrunfun)

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

Sample `make.mjs`. The file name is arbitrary. The `sass` example is oversimplified, might not work on Windows.

```js
import * as fp from 'fs/promises'
import * as j from 'jtg'

j.runCli(watch, build, styles, scripts, server)

async function watch(ctx) {
  await j.par(ctx, stylesW, scriptsW, serverW)
}

async function build(ctx) {
  await j.par(ctx, styles, scripts)
}

async function styles(ctx) {
  await j.spawn(ctx, 'sass', 'styles/main.scss:target/styles/main.css')
}

async function stylesW(ctx) {
  await j.spawn(ctx, 'sass', '--watch', 'styles/main.scss:target/styles/main.css')
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
  await import('./scripts/server.mjs')
}

async function serverW(ctx) {
  const start = () => j.fork(ctx, './scripts/server.mjs')

  const events = fp.watch('scripts', {recursive: true, signal: ctx.signal})

  let proc = start()
  for (const _ of events) {
    j.kill(proc)
    proc = start()
  }
}
```

## Tasks

In Jtg, tasks are named functions. On the CLI, you specify the name of the task function to run. It may invoke other tasks.

Like other task runners, Jtg forms a "task group", where each task runs no more than once. This is convenient for build systems where many tasks rely on some shared task, and may be invoked either individually or all together. See the [Usage](#usage) example above.

A task takes one argument: a [`Ctx`](#class-ctx) instance. The context stores the results of previously-called task functions, which allows [`par`](#function-parctx-funs) and [`ser`](#function-serctx-funs) to deduplicate them. It also has an associated [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal), used by [`spawn`](#function-spawnctx-cmd-args) and [`fork`](#function-forkctx-cmd-args). You should pass [`ctx.signal`](#property-ctxsignal) to APIs that support cancelation, such as `fetch`, `"fs/promises".watch`, and so on.

## Cancelation

Cancelation happens for the following reasons:

* Main process terminates.
* Main task terminates.

Cancelation happens in the following ways:

* When the main process terminates, well-behaved subprocesses should also terminate. Subshells misbehave, see below.
* When the main task terminates, but the process is still running, the [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) available as [`ctx.signal`](#property-ctxsignal) is aborted, causing termination of running subprocesses created by [`spawn`](#function-spawnctx-cmd-args) and [`fork`](#function-forkctx-cmd-args), or any other activities that took [`ctx.signal`](#property-ctxsignal).

Caution: some subprocesses, when killed programmatically, don't terminate their children. The main offender is subshells such as `sh` (Unix) and `cmd.exe` (Windows). `Ctrl+C` would usually terminate the entire tree, but an unhandled exception in a task, causing programmatic shutdown of the Node process, would orphan the children of any spawned subshells, leaving them hanging in the background. Due to the limitations of the Node child process API, Jtg currently does not provide any solution to this problem. To avoid this issue, avoid using subshells; use [`fork`](#function-forkctx-cmd-args) and [`spawn`](#function-spawnctx-cmd-args) to spawn well-behaved executables directly.

## API

### `function runCli(...funs)`

Shortcut for CLI scripts. See the [Usage](#usage) example above. Simply calls `runArgs` with CLI args.

### `function runArgs(funs, args)`

* `funs` must be an iterable of task functions.
* `args` must be an array of strings, usually CLI args.

Chooses one task function, by name, based on the provided args. Runs the task, or prints help and terminates. If `args` are empty, runs the first task.

In addition to provided functions, supports `-h`, `--help` and `help`, which print available tasks and terminate. If there's no match, prints available tasks and terminates.

Like most Jtg functions, this is async. If a task was found, returns a promise.

```js
// Runs `watch`.
j.runArgs([build, watch], ['watch'])

// Runs the first function (`build`).
j.runArgs([build, watch], [])

// Prints help.
j.runArgs([build, watch], ['--help'])
```

### `function par(ctx, ...funs)`

Short for "parallel", or rather "concurrent". Runs the provided task functions concurrently, but no more than once per [`Ctx`](#class-ctx). The result of every task function is stored in `ctx` and reused on redundant calls.

```js
async function watch(ctx) {
  await j.par(ctx, stylesW, scriptsW, serverW)
}
```

### `function ser(ctx, ...funs)`

Short for "serial". Runs the provided task functions serially, but no more than once per [`Ctx`](#class-ctx). The result of every task function is stored in `ctx` and reused on redundant calls.

```js
async function html(ctx) {
  await j.ser(ctx, clean, styles, templates)
}
```

### `function spawn(ctx, cmd, ...args)`

Variant of `child_process.spawn` where:

* Standard output/error is inherited from the parent process.
* The proc is terminated when `ctx` terminates.

Should be combined with [`wait`](#function-waitproc).

```js
async function styles(ctx) {
  await j.wait(j.spawn(ctx, 'sass', 'main.scss:main.css'))
}
```

### `function fork(ctx, cmd, ...args)`

Variant of `child_process.fork` where:

* Standard output/error is inherited from the parent process.
* The proc is terminated when `ctx` terminates.

Should be combined with [`wait`](#function-waitproc).

```js
async function server(ctx) {
  await j.wait(j.fork(ctx, './scripts/server.mjs'))
}
```

### `function link(ctx, proc)`

Used internally by [`spawn`](#function-spawnctx-cmd-args) and [`fork`](#function-forkctx-cmd-args). Links the lifetime of the child process to the lifetime of `ctx`. When `ctx` terminates, the child process is killed.

Assumes that `proc` was spawned by [`spawn`](#function-spawnctx-cmd-args) or [`fork`](#function-forkctx-cmd-args). These functions share some platform-specific logic to increase the likelihood of terminating the entire subprocess tree.

### `function wait(proc)`

Returns a `Promise` that resolves when the provided process terminates for any reason.

```js
async function styles(ctx) {
  await j.wait(j.spawn(ctx, 'sass', 'main.scss:main.css'))
}
```

### `function kill(proc)`

Variant of `proc.kill()` that tries to terminate the entire subprocess tree. The proc must have been spawned by [`spawn`](#function-spawnctx-cmd-args) or [`fork`](#function-forkctx-cmd-args), otherwise this might explode.

Used internally by [`link`](#function-linkctx-proc). In most cases, you don't need to call this. Provided for cases such as restarting a server on changes, where a manual kill is required. In most cases, `proc.kill()` is equivalent.

### `class Ctx`

Represents a "task group", or perhaps the context of a task run. Created automatically. The same instance is passed to every task function in the group. Stores results of tasks invocations for deduplication.

#### `property ctx.signal`

Associated [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal), which is aborted when the main task terminates for any reason. Use this for [cancelation](#cancelation). Abort signals are the new standard for cancelation, supported by `fetch`, `child_process` and various other APIs.

#### `method ctx.run(fun)`

Runs the provided task function no more than once. If the task was previously invoked (and possibly still running!), its result is stored and returned from this call. For async functions, their stored result is a promise, not the final value.

This is for singular dependencies. For multiple dependencies, use [`par`](#function-parctx-funs) and [`ser`](#function-serctx-funs).

```js
// build -> [styles + scripts] -> clean
async function build(ctx) {
  await par(ctx, styles, scripts)
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

## License

https://unlicense.org

## Misc

I'm receptive to suggestions. If this library _almost_ satisfies you but needs changes, open an issue or chat me up. Contacts: https://mitranim.com/#contacts

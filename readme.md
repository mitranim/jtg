## Overview

"JS Task Group". Simple JS-based replacement for Make, Gulp, etc. Similar in design to [Gtg](https://github.com/mitranim/gtg) made for Go.

Jtg works differently from other task runners. It's _not_ a CLI executable. It's just a library that you import and call.

Tiny, dependency-free. Two versions:

* `jtg_node.mjs`: for [Node.js](https://nodejs.org) >= 0.15.
* `jtg_deno.mjs`: for [Deno](https://deno.land).

The API is isomorphic, but some functions are Node-only, at least for now.

## TOC

* [Why](#why)
* [Usage](#usage)
* [Tasks](#tasks)
* [Cancelation](#cancelation)
  * [Process Leaks](#process-leaks)
* [API](#api)
  * [`function runCli`](#function-runclifuns)
  * [`function runArgs`](#function-runargsfuns-args)
  * [`function watch`](#function-watchtarget-test-opts)
  * [`function emptty`](#function-emptty)
  * [`class Ctx`](#class-ctx)
    * [`property ctx.signal`](#property-ctxsignal)
    * [`method ctx.run`](#method-ctxrunfun)
    * [`method ctx.par`](#method-ctxparfuns)
    * [`method ctx.ser`](#method-ctxserfuns)
    * [`method ctx.sub`](#method-ctxsub)
    * [`method ctx.re`](#method-ctxre)
    * [`method ctx.each`](#method-ctxeachiter)
    * [`method ctx.preEach`](#method-ctxpreeachiter)
  * [`function spawn`](#function-spawncmd-args-opts)
  * [`function fork`](#function-forkcmd-args-opts)
  * [`function link`](#function-linkproc)
  * [`function wait`](#function-waitproc)
  * [`function kill`](#function-killproc)
  * [Undocumented](#undocumented)
* [Changelog](#changelog)

## Why

* Make is less portable.
* `package.json` scripts are less portable. Also, `npm run` is slow to start.
* Gulp is too bloated and complex.
* Most task runners force you to use their CLI, invariably bloated, slow, buggy, and full of weird shit.

Jtg is JS-based, tiny, trivially simple, and _is not a CLI_.

## Usage

In Node, install via NPM, run your script via `node`. See the sample `make.mjs` script below.

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

In Deno, import by URL, run your script via `deno run`.

```js
import * as j from 'https://unpkg.com/jtg@<version>/jtg_deno.mjs'
```

Sample `make.mjs` for Node. The file name is arbitrary.

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
  // Imported module should use top-level await to "block" until a crash.
  await import('./scripts/server.mjs')
}

async function serverW(ctx) {
  const events = fp.watch('scripts', {...ctx, recursive: true})

  for await (const [sub] of ctx.preEach(events)) {
    j.fork('./scripts/server.mjs', [], sub).once('error', j.logNonAbort)
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

* When the main process terminates, its _immediate_ children _may_ also terminate, depending on exactly how your Node/Deno process got killed. In Node on Unix, this is only true for children created by [`spawn`](#function-spawncmd-args-opts) and [`fork`](#function-forkcmd-args-opts). However, _indirect_ children usually will _not_ automatically terminate; see [Process Leaks](#process-leaks).
* When the main task terminates, but the process is still running, the [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) available as [`ctx.signal`](#property-ctxsignal) is aborted, causing termination of any activities that took this signal, including subprocesses created by [`spawn`](#function-spawncmd-args-opts) and [`fork`](#function-forkcmd-args-opts), if `ctx` was passed to them. Note that `Deno.run` doesn't support abort signals yet (as of `1.10.1`).

### Process Leaks

By default, on _all_ operating systems, child processes don't terminate together with parents. Both Node and Deno make some limited effort to terminate their _immediate_ children, but not their descendants. Be aware that most programs, written for most systems, don't link with their child processes this way.

Interrupt via `Ctrl+C` usually works on every system, but crashes are fraught with peril. For example, when you shell out to `sh` (Unix) or `cmd.exe` (Windows) to spawn another program, and then the current process crashes or gets killed, the shell sub-process will terminate, but the sub-sub-process will not.

On Unix, Jtg's subprocess functions such as [`spawn`](#function-spawncmd-args-opts) and [`kill`](#function-killproc) make an effort to ensure termination of entire subprocess groups. However, on Windows, the necessary operating system APIs appear to be unavailable in Node. To reduce process leaks, avoid sub-sub-processes.

The [Usage](#usage) example above invokes `sass`, which demonstrates this very problem. At the time of writing, the recommended Sass implementation is `dart-sass`, and the recommended way to install it on Windows is via Chocolatey. The installation process creates one real executable and one unnecessary wrapper executable, which shells out to the real one, _without_ linking together via the job object API. An abrupt termination leaks the sub-sub-process. You can avoid this issue by modifying your `%PATH%`, allowing the OS to find the real executable before the fake one.

On Windows, Deno currently doesn't use the job object API. When a Deno process gets killed by an external cause other than Ctrl+C, even the immediate child processes are not killed.

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

### `function watch(target, test, opts)`

An [async iterator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of) over FS events. Wraps `'fs/promises'.watch` (Node) or `Deno.watchFs` (Deno), normalizing FS paths and filtering them via `test`.

`test` may be nil, a function, or a `RegExp`. It tests an FS path, always Posix-style (`/`-separated) and relative to the current working directory (`process.cwd()` or `Deno.cwd()`). If the test fails (the result is falsy), an event is ignored (not yielded).

`target` and `opts` are passed directly to the underlying FS watch API. Additionally, this adds missing support for `opts.signal` in Deno. (Known issue: in some Deno versions/environments, attempting to stop file watching may fail with a `BadSource` error.)

For watch-and-restart tasks, wrap this iterator via [`ctx.each`](#method-ctxeachiter) or [`ctx.preEach`](#method-ctxpreeachiter), which create a separate `AbortSignal` for each iteration.

Example:

```js
import * as j from 'jtg'

function watch(ctx) {
  const events = j.watch('target', /[.]html|css$/, {...ctx, recursive: true})

  for await (const event of events) {
    notifyClientsAboutChanges(event)
  }
}

```

### `function emptty()`

Clears the terminal. More specifically, prints to stdout escape codes "Reset to Initial State" and "Erase in Display (3)", causing a full-clear in most terminals. Useful for watching-and-restarting.

### `class Ctx`

Represents a "task group", the context of a task run. Created automatically. The same instance is passed to every task in the group. Stores their results for deduplication.

Pass `ctx.signal` to APIs that take an `AbortSignal` for cancelation. You can pass `ctx` as-is, or merge `ctx.signal` with other opts:

```js
import * as fp from 'fs/promises'
import * as j from 'jtg'

const events = fp.watch('some_folder', ctx)
const events = fp.watch('some_folder', {signal: ctx.signal, recursive: true})
const events = fp.watch('some_folder', {...ctx, recursive: true})

const proc = j.fork('some_file.mjs', [], ctx)
const proc = j.fork('some_file.mjs', [], {signal: ctx.signal, killSignal: 'SIGINT'})
const proc = j.fork('some_file.mjs', [], {...ctx, killSignal: 'SIGINT'})
```

#### `property ctx.signal`

Associated [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal), which is the new standard for cancelation, supported by `fetch`, `child_process` and various other APIs. Use this for [cancelation](#cancelation).

On the main context, this is aborted when the main task terminates for any reason. On sub-contexts created with [`ctx.sub`](#method-ctxsub), this is auto-aborted on each cycle of [`ctx.each`](#method-ctxeachiter) or [`ctx.preEach`](#method-ctxpreeachiter). Can be aborted manually via `ctx.abort` (undocumented) or [`ctx.re`](#method-ctxre).

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

#### `method ctx.par(...funs)`

Short for "parallel", or rather "concurrent". Runs the provided task functions concurrently, but no more than once per [`Ctx`](#class-ctx). The result of every task function is stored in `ctx` and reused on redundant calls.

```js
async function watch(ctx) {
  await ctx.par(stylesW, scriptsW, serverW)
}
```

#### `method ctx.ser(...funs)`

Short for "serial". Runs the provided task functions serially, but no more than once per [`Ctx`](#class-ctx). The result of every task function is stored in `ctx` and reused on redundant calls.

```js
async function html(ctx) {
  await ctx.ser(clean, styles, templates)
}
```

#### `method ctx.sub()`

Creates a sub-context that:

* Prototypally inherits from the super.
* May be aborted without affecting the super.
* Is aborted when the super is aborted.

Useful for watching-and-restarting. Should be paired with [`ctx.re`](#method-ctxre) to abort and replace the sub-context on each iteration.

Most of the time, you should use [`ctx.each`](#method-ctxeachiter) or [`ctx.preEach`](#method-ctxpreeachiter) instead.

#### `method ctx.re()`

Short for "replace". Aborts the context and returns a new _sibling_ context. Should be used on sub-contexts created via [`ctx.sub`](#method-ctxsub).

```
        super
       /
      /
    sub0

    sub0.re() -> sub1

        super
       /     \
      /       \
    sub0      sub1
    (aborted)
```

#### `method ctx.each(iter)`

Wraps an [async iterable](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of). Returns an iterable that yields `[sub, val]` for each `val` in the iterable, where `sub` is a [_sub-context_](#method-ctxsub) of `ctx`, aborted before the next iteration.

Useful for watching-and-restarting. Consider using [`emptty`](#function-emptty) to clear the terminal on each iteration. Also see [`ctx.preEach`](#method-ctxpreeachiter) that runs the first iteration immediately.

Gotcha 1: handle all your errors.

Gotcha 2: all sub- and super- contexts share the memory of previously-called tasks. Tasks that repeat in a loop must be run "manually", _not_ through `ctx.run`, `ctx.ser` or `ctx.par`, which would deduplicate them.

```js
import * as fp from 'fs/promises'

async function watch(ctx) {
  const events = fp.watch('some_folder', ctx)

  for await (const [sub, event] of ctx.each(events)) {
    j.emptty()
    console.log('[watch] FS event:', event)
    startSomeActivity(sub).catch(j.logNonAbort)
  }
}
```

#### `method ctx.preEach(iter)`

Same as [`ctx.each`](#method-ctxeachiter), but starts immediately, by yielding one sub-context before walking the async iterable.

Useful for watching-and-restarting.

```js
import * as fp from 'fs/promises'

async function watch() {
  const events = fp.watch('some_folder', ctx)

  for await (const [sub] of ctx.preEach(events)) {
    startSomeActivity(sub).catch(j.logNonAbort)
  }
}
```

### `function spawn(cmd, args, opts)`

(Only in `jtg_node.mjs`.) Variant of `child_process.spawn` where:

* Standard output/error is inherited from the parent process.
* Sub-sub-processes are less likely to [leak](#process-leaks) (Unix only).

Should be combined with [`wait`](#function-waitproc). Pass `ctx` as the last argument to take advantage of [`ctx.signal`](#property-ctxsignal) for cancelation.

```js
async function styles(ctx) {
  await j.wait(j.spawn('sass', ['main.scss:main.css'], ctx))
}
```

### `function fork(cmd, args, opts)`

(Only in `jtg_node.mjs`.) Variant of `child_process.fork` where:

* Standard output/error is inherited from the parent process.
* Sub-sub-processes are less likely to [leak](#process-leaks) (Unix only).

Should be combined with [`wait`](#function-waitproc). Pass `ctx` as the last argument to take advantage of [`ctx.signal`](#property-ctxsignal) for cancelation.

```js
async function server(ctx) {
  await j.wait(j.fork('./scripts/server.mjs', [], ctx))
}
```

### `function link(proc)`

(Only in `jtg_node.mjs`.)

Used internally by [`spawn`](#function-spawncmd-args-opts) and [`fork`](#function-forkcmd-args-opts). Registers the process for additional cleanup via [`kill`](#function-killproc). Returns the same process.

### `function wait(proc)`

(Only in `jtg_node.mjs`.) Returns a `Promise` that resolves when the provided process terminates for any reason.

```js
async function styles(ctx) {
  await j.wait(j.spawn('sass', ['main.scss:main.css'], ctx))
}
```

### `function kill(proc)`

(Only in `jtg_node.mjs`.)

Variant of `proc.kill()` that tries to terminate the entire subprocess tree. Assumes that it was spawned by [`spawn`](#function-spawncmd-args-opts) or [`fork`](#function-forkcmd-args-opts). These functions share some platform-specific logic.

Automatically used by [`link`](#function-linkproc). In most cases, you don't need to call this. Provided for cases such as restarting a server on changes, where a manual kill is required.

On Windows, this is equivalent to `proc.kill()`. On Unix, this tries to send a termination signal to the entire subprocess group.

### Undocumented

Some minor APIs are exported but undocumented to avoid bloating the docs. Check the source files and look for `export`.

## Changelog

### 0.1.4

* Support both Node and Deno.
* Added `watch`.

### 0.1.3

Fixed a memory/listener leak in sub-contexts.

### 0.1.2

TLDR: better support for "watch"-style tasks.

Just like the Go `context` package, `Ctx` now supports sub-contexts. A sub-context created via `ctx.sub` prototypally inherits from the previous context, but has its own `AbortController` and `AbortSignal`. Just like in Go:

* Aborting a super-context aborts every sub-context.
* Sub-contexts can be aborted without aborting super-contexts.

This is useful for watching-and-restarting, where each cycle uses a sub-context aborted before the next cycle.

New `ctx` methods:

* `ctx.sub`
* `ctx.re`
* `ctx.each`
* `ctx.preEach`

New functions:

* `emptty`

New undocumented functions. Various minor tweaks.

## License

https://unlicense.org

## Misc

I'm receptive to suggestions. If this library _almost_ satisfies you but needs changes, open an issue or chat me up. Contacts: https://mitranim.com/#contacts

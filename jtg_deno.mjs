/* global Deno */

import {run, toTest, cwdUrl, fileUrlFromAbs, urlRel} from './jtg_shared.mjs'

/* Exported but undocumented */

export {Abort, Funs, runMain, isAbort, throwNonAbort, logNonAbort} from './jtg_shared.mjs'

/* Public API */

export function runCli(...funs) {
  return runArgs(funs, Deno.args)
}

export function runArgs(funs, args) {
  return run(funs, args, Deno)
}

export async function* watch(target, test, opts) {
  test = toTest(test)
  const cwd = cwdUrl(Deno.cwd())
  const iter = watchFs(target, opts)

  try {
    for await (const {paths, ...event} of iter) {
      for (const path of paths) {
        const url = fileUrlFromAbs(path)
        const rel = urlRel(url, cwd)
        if (test(rel)) yield {...event, path, url, rel}
      }
    }
  }
  finally {
    iter.return()
  }
}

// Variant of `Deno.watchFs` with support for `AbortSignal`.
export async function* watchFs(target, opts) {
  const sig = opts?.signal
  const iter = Deno.watchFs(target, opts)
  const deinit = iter.return.bind(iter)

  try {
    sig?.addEventListener('abort', deinit, {once: true})
    for await (const event of iter) yield event
  }
  finally {
    sig?.removeEventListener('abort', deinit)
    iter.return()
  }
}

export function emptty() {
  return Deno.stdout.write(clear)
}

/* Internal Utils */

const clear = new TextEncoder().encode('\x1bc\x1b[3J')

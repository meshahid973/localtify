/** A failed or cancelled shader must not retain its registered view. */
export async function compileGlassView(compile: () => Promise<unknown>, release: () => void, signal: AbortSignal, timeoutMs = 15000) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    if (signal.aborted) throw new Error('Glass view cancelled')
    await Promise.race([
      Promise.resolve().then(compile),
      new Promise<never>((_, reject) => {
        abort = () => reject(new Error('Glass view cancelled'))
        signal.addEventListener('abort', abort, { once: true })
        timeout = setTimeout(() => reject(new Error('Glass shader compilation timed out')), timeoutMs)
      }),
    ])
    if (signal.aborted) throw new Error('Glass view cancelled')
  } catch (error) {
    release()
    throw error
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    if (abort) signal.removeEventListener('abort', abort)
  }
}

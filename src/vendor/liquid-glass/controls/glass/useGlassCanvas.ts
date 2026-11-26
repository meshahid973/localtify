'use client'

import { useCallback, useEffect, useRef } from 'react'

import type { GlassViewHandle, GlassViewSpec, GlassViewStats } from './runtime'

/**
 * Registers a canvas with the shared glass renderer. The spec is read fresh every
 * frame, so callers keep animation state in refs and simply return a new spec.
 */
export function useGlassCanvas(spec: GlassViewSpec) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const specRef = useRef(spec)
  specRef.current = spec
  const handle = useRef<GlassViewHandle | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.setAttribute('data-glass-skip', '')
    const lifetime = new AbortController()
    // three.js loads lazily so the page still prerenders on the server.
    import('./runtime')
      .then(({ getGlassRuntime }) => getGlassRuntime())
      .then((runtime) => runtime.createView(canvas, () => specRef.current, lifetime.signal))
      .then((view) => {
        if (lifetime.signal.aborted) view.dispose()
        else handle.current = view
      })
      .catch((error) => { if (!lifetime.signal.aborted) console.warn('Liquid glass renderer unavailable', error) })
    return () => {
      lifetime.abort()
      handle.current?.dispose()
      handle.current = null
    }
  }, [])

  // Any React render (new props, theme, size) repaints once.
  useEffect(() => {
    handle.current?.invalidate()
  })

  const invalidate = useCallback(() => handle.current?.invalidate(), [])
  /** Running totals of GPU passes for this canvas (zero until the renderer is up). */
  const stats = useCallback((): GlassViewStats => handle.current?.stats() ?? { renders: 0, ms: 0 }, [])
  return { canvasRef, invalidate, stats }
}

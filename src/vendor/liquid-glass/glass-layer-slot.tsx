import { lazy, Suspense } from 'react'
import type { GlassLayerProps } from './glass-layer'

const OpticalLayer = lazy(() => import('./glass-layer'))

export function GlassLayerSlot(props: GlassLayerProps) {
  return <Suspense fallback={null}><OpticalLayer {...props} /></Suspense>
}

import { createContext } from 'react'
import type { GlassPopup } from './glass-popup'

export const GlassPopupContext = createContext<GlassPopup | null>(null)

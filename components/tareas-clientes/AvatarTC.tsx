'use client'

import { Anchor, Bike, Bird, Camera, Cat, Coffee, Crown, Dog, Fish, Flame, Gamepad2, Gem, Ghost, Heart, Leaf, Moon, Mountain, Music, Pizza, Plane, Rocket, Smile, Star, Sun, Target, Zap, type LucideIcon } from 'lucide-react'
import { colorDePersona } from '@/components/rendimiento/ui'
import { hexDeColor } from '@/lib/tareas-clientes/apariencia'
import { useApariencia } from './AparienciaProvider'

export const DIBUJOS: Record<string, LucideIcon> = {
  cohete: Rocket, llama: Flame, estrella: Star, rayo: Zap, corazon: Heart, hoja: Leaf, luna: Moon, sol: Sun, gato: Cat, perro: Dog, pajaro: Bird, pez: Fish, ancla: Anchor,
  corona: Crown, gema: Gem, cafe: Coffee, pizza: Pizza, musica: Music, camara: Camera, mando: Gamepad2, fantasma: Ghost, sonrisa: Smile, bici: Bike, montana: Mountain, avion: Plane, diana: Target,
}

const inicialesDe = (nombre: string) =>
  nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')

/** Un círculo con el icono y el color que ha elegido la persona; si no ha elegido, sus iniciales con el color de siempre (que sale de su id). Misma firma que el `Avatar` del resto del ERP */
export function AvatarDePersona({ color, icono, id, nombre, tamano = 22 }: { color?: string | null; icono?: string | null; id: string; nombre: string; tamano?: number }) {
  const tono = hexDeColor(color) ?? colorDePersona(id)
  const Dibujo = icono ? DIBUJOS[icono] : undefined
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{ width: tamano, height: tamano, fontSize: Math.round(tamano * 0.45), color: tono, background: `color-mix(in srgb, ${tono} ${hexDeColor(color) ? 24 : 18}%, transparent)`, boxShadow: hexDeColor(color) ? `inset 0 0 0 1px color-mix(in srgb, ${tono} 55%, transparent)` : undefined }}
    >
      {Dibujo ? <Dibujo style={{ width: Math.round(tamano * 0.58), height: Math.round(tamano * 0.58) }} strokeWidth={2.2} /> : inicialesDe(nombre)}
    </span>
  )
}

export function Avatar({ id, nombre, tamano = 22 }: { id: string; nombre: string; tamano?: number }) {
  const a = useApariencia().mapa[id]
  return <AvatarDePersona color={a?.color} icono={a?.icono} id={id} nombre={nombre} tamano={tamano} />
}

/** El color de una persona (el que ha elegido, o el de siempre): para teñir lo que es suyo, como el filo de las tarjetas */
export function useTonoDePersona(): (id: string) => string {
  const { mapa } = useApariencia()
  return (id) => hexDeColor(mapa[id]?.color) ?? colorDePersona(id)
}

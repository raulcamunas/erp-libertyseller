'use client'

import React from 'react'
import {
  AlertTriangle,
  Ban,
  CalendarCheck2,
  Check,
  CircleDashed,
  Clock3,
  Info,
  Mail,
  Minus,
  RotateCw,
  TrendingUp,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import type { ColdLeadStatus } from '@/lib/types/cold-leads'
import type { EstadoStock } from './datos'

/**
 * Las piezas compartidas de la propuesta.
 *
 * La regla que gobierna este fichero: NINGÚN ESTADO SE DISTINGUE SOLO POR COLOR.
 * Cada estado es una terna —icono + palabra + tono—, y el tono es el que sobra.
 * Se puede imprimir la pantalla en blanco y negro y sigue leyéndose.
 *
 * Por qué importa aquí y no es una casilla que marcar: en la tabla de Cold Calling
 * hay SIETE estados y hoy se distinguen por un punto de 8 px y por el tinte de la
 * fila al 8 % de alfa. Con deuteranopía, #EAB308 (no contesta), #F97316 (en
 * seguimiento) y #22C55E (cita cualificada) al 8 % son el mismo beige — y son tres
 * estados que mandan tres acciones distintas.
 */

/* ------------------------------------------------------------------ */
/* Los siete estados de Cold Calling                                   */
/* ------------------------------------------------------------------ */

/**
 * Un icono por estado, y elegidos por lo que HAY QUE HACER, no por decorar:
 * la flecha de reintentar dice «vuelve a llamar», el reloj dice «tienes hora»,
 * el sobre dice «la pelota está en su tejado».
 */
export const ICONO_ESTADO: Record<ColdLeadStatus, LucideIcon> = {
  pendiente: CircleDashed,
  no_contesta: RotateCw,
  programado: Clock3,
  email_enviado: Mail,
  seguimiento: TrendingUp,
  cita_cualificada: CalendarCheck2,
  no_interesa: Ban,
}

export function colorEstado(estado: ColdLeadStatus): string {
  return `var(--ctx-e-${estado})`
}

/* ------------------------------------------------------------------ */
/* Estados de una ejecución de stock                                   */
/* ------------------------------------------------------------------ */

type Tono = 'ok' | 'aviso' | 'error' | 'neutro' | 'info'

/**
 * `simulacro` va en gris y con icono de PAUSA, no de visto bueno. Es una decisión
 * que ya está tomada en lib/types/stock-sync.ts y que esta propuesta respeta letra
 * por letra: es el estado de un cliente que NO está mandando nada, y pintarlo de
 * «todo bien» es cómo se pasan tres semanas creyendo que la automatización está en
 * marcha. Aquí además se refuerza con el icono, que es lo que se ve primero.
 */
export const ESTADO_EJECUCION: Record<
  EstadoStock,
  { etiqueta: string; tono: Tono; icono: LucideIcon; explica: string }
> = {
  enviado: { etiqueta: 'Enviado', tono: 'ok', icono: Check, explica: 'Los cambios llegaron a Amazon' },
  frenado: { etiqueta: 'Frenado', tono: 'aviso', icono: AlertTriangle, explica: 'Saltó un freno: no se mandó nada' },
  simulacro: { etiqueta: 'Simulacro', tono: 'neutro', icono: Clock3, explica: 'Se lee y se calcula, pero NO se envía nada a Amazon' },
  sin_cambios: { etiqueta: 'Sin cambios', tono: 'neutro', icono: Minus, explica: 'El fichero es idéntico al anterior' },
  error: { etiqueta: 'Error', tono: 'error', icono: XCircle, explica: 'No se pudo leer el fichero' },
  sin_perfil: { etiqueta: 'Sin perfil', tono: 'neutro', icono: CircleDashed, explica: 'Esta cuenta no tiene automatización de stock' },
}

export const ESTADO_CONEXION: Record<
  'activa' | 'caducada' | 'revocada' | 'sin_conectar',
  { etiqueta: string; tono: Tono; icono: LucideIcon }
> = {
  activa: { etiqueta: 'Conectada', tono: 'ok', icono: Check },
  caducada: { etiqueta: 'Caducada', tono: 'aviso', icono: AlertTriangle },
  revocada: { etiqueta: 'Revocada', tono: 'error', icono: XCircle },
  sin_conectar: { etiqueta: 'Sin conectar', tono: 'neutro', icono: CircleDashed },
}

/* ------------------------------------------------------------------ */
/* Componentes                                                         */
/* ------------------------------------------------------------------ */

export function Insignia({
  tono,
  icono: Icono,
  children,
  titulo,
}: {
  tono: Tono
  icono: LucideIcon
  children: React.ReactNode
  titulo?: string
}) {
  return (
    <span
      className="ctx-estado"
      title={titulo}
      style={{
        color: `var(--ctx-${tono})`,
        background: `var(--ctx-${tono}-bg)`,
        borderColor: `var(--ctx-${tono}-line)`,
      }}
    >
      <Icono size={12} strokeWidth={2.4} aria-hidden />
      {children}
    </span>
  )
}

/** El estado de un lead dentro de la tabla: icono con el tono, palabra en texto normal */
export function EstadoLead({ estado, etiqueta }: { estado: ColdLeadStatus; etiqueta: string }) {
  const Icono = ICONO_ESTADO[estado]
  return (
    <span className="ctx-fila-flex" style={{ gap: 6 }}>
      <Icono size={13} strokeWidth={2.4} style={{ color: colorEstado(estado), flex: 'none' }} aria-hidden />
      <span className="ctx-trunc">{etiqueta}</span>
    </span>
  )
}

export function Caja({
  tipo,
  children,
}: {
  tipo: 'info' | 'aviso' | 'error' | 'ok'
  children: React.ReactNode
}) {
  const Icono = tipo === 'error' ? XCircle : tipo === 'aviso' ? AlertTriangle : tipo === 'ok' ? Check : Info
  return (
    <div className={`ctx-caja ctx-caja--${tipo}`}>
      <Icono size={14} strokeWidth={2.2} aria-hidden />
      <div>{children}</div>
    </div>
  )
}

export function Cifra({ etiqueta, valor, sub }: { etiqueta: string; valor: string; sub?: string }) {
  return (
    <div className="ctx-cifra">
      <span className="ctx-cifra-et">{etiqueta}</span>
      <span className="ctx-cifra-v">{valor}</span>
      {sub && <span className="ctx-cifra-sub">{sub}</span>}
    </div>
  )
}

export function Chip({
  activo,
  onClick,
  children,
  num,
  color,
  icono: Icono,
}: {
  activo?: boolean
  onClick?: () => void
  children: React.ReactNode
  num?: number
  color?: string
  icono?: LucideIcon
}) {
  return (
    <button type="button" className="ctx-chip ctx-t" data-ctx-activo={activo ? 'true' : 'false'} onClick={onClick}>
      {Icono && (
        <Icono
          size={12}
          strokeWidth={2.4}
          aria-hidden
          style={{ color: activo ? 'currentColor' : color, flex: 'none' }}
        />
      )}
      {children}
      {num !== undefined && <span className="ctx-chip-num">{num.toLocaleString('es-ES')}</span>}
    </button>
  )
}

export function Interruptor({
  on,
  onChange,
  etiqueta,
  nota,
}: {
  on: boolean
  onChange: (v: boolean) => void
  etiqueta: string
  nota?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="ctx-fila-flex ctx-t"
      style={{ gap: 8, width: '100%', alignItems: 'flex-start' }}
    >
      <span className="ctx-switch ctx-t" data-ctx-on={on ? 'true' : 'false'} aria-hidden style={{ marginTop: 1 }} />
      <span style={{ minWidth: 0 }}>
        <span className="ctx-md" style={{ fontWeight: 500, display: 'block' }}>
          {etiqueta}{' '}
          {/* Mismo criterio que el estado de los frenos: 12 px y en caja baja. El
              estado de un interruptor no se escribe con la letra más pequeña de
              la pantalla ni en versales, que es la forma más lenta de leerlo. */}
          <span style={{ color: on ? 'var(--ctx-ok)' : 'var(--ctx-fg-3)', fontWeight: 700, fontSize: 12 }}>
            {on ? '· Encendido' : '· Apagado'}
          </span>
        </span>
        {nota && <span className="ctx-nota" style={{ display: 'block', marginTop: 2 }}>{nota}</span>}
      </span>
    </button>
  )
}

/** Nunca se pinta un dato ausente igual que un dato: el guion es «mute», no texto */
export function SinDato() {
  return (
    <span className="ctx-mute" aria-label="sin dato">
      —
    </span>
  )
}

export function formatEuros(n: number | null): string {
  if (n == null) return '—'
  return `${Math.round(n).toLocaleString('es-ES')} €`
}

export function formatFecha(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a.slice(2)}`
}

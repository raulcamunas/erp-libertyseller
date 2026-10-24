'use client'

import {
  Ban,
  CalendarClock,
  Check,
  CheckCheck,
  Clock3,
  FlaskConical,
  Flag,
  Gauge,
  History,
  Hourglass,
  MailX,
  MessageSquareReply,
  Pause,
  Pencil,
  Play,
  Send,
  ShieldAlert,
  SkipForward,
  Sparkles,
  TriangleAlert,
  Waypoints,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import { diaCorto, diaDeMadrid, horaDeMadrid } from '@/lib/correo/secuencias/fechas'
import { ETIQUETA_DE_CODIGO, type ItemDeCola, type PasoDeCola } from '@/lib/correo/secuencias/vistas'
import { cuando, cuentaAtras } from './datos'

/**
 * LA LÍNEA DE TIEMPO DE UN LEAD.
 *
 * Una fila de nodos: el primer correo y cada seguimiento, unidos por tramos. Un correo que ya salió es un círculo verde con su visto; el que va a salir, un
 * anillo naranja (el SIGUIENTE late); uno detenido, ámbar; uno que falló, rojo; uno saltado o cancelado, gris. El tramo que lleva al siguiente se llena a
 * medida que pasa el tiempo entre un correo y el otro, y un pequeño avión de papel recorre ese tramo mientras la secuencia está en marcha. Al final, cómo
 * acabó (o cuándo acabará): contestó, rebotó, se canceló, o pasará a «No interesa».
 *
 * Todo el movimiento es CSS (las clases `sec-*` de app/globals.css) y desaparece con «reducir movimiento».
 */

export type TonoDeNodo = 'verde' | 'acento' | 'ambar' | 'rojo' | 'gris'

export const COLOR_DE_TONO: Record<TonoDeNodo, string> = {
  verde: 'var(--ls-e-verde)',
  acento: 'var(--ls-acc-graf)',
  ambar: 'var(--ls-e-ambar)',
  rojo: 'var(--ls-e-rojo)',
  gris: 'var(--ls-t4)',
}

export function estiloDelPaso(p: Pick<PasoDeCola, 'estado' | 'ensayo'>): { Icono: LucideIcon; tono: TonoDeNodo; discontinuo: boolean } {
  if (p.ensayo) return { Icono: FlaskConical, tono: 'gris', discontinuo: true }
  switch (p.estado) {
    case 'enviado':
      return { Icono: Check, tono: 'verde', discontinuo: false }
    case 'enviando':
      return { Icono: Send, tono: 'acento', discontinuo: false }
    case 'pausado':
      return { Icono: Pause, tono: 'ambar', discontinuo: false }
    case 'fallido':
      return { Icono: TriangleAlert, tono: 'rojo', discontinuo: false }
    case 'saltado':
      return { Icono: SkipForward, tono: 'gris', discontinuo: true }
    case 'cancelado':
      return { Icono: X, tono: 'gris', discontinuo: true }
    default:
      return { Icono: Clock3, tono: 'acento', discontinuo: false }
  }
}

/** El icono y el color de cada cosa que se apunta en el rastro de una secuencia */
export const ESTILO_DE_EVENTO: Record<string, { Icono: LucideIcon; tono: TonoDeNodo }> = {
  inscrita: { Icono: Waypoints, tono: 'acento' },
  programado: { Icono: CalendarClock, tono: 'acento' },
  reprogramado: { Icono: CalendarClock, tono: 'ambar' },
  enviado: { Icono: Send, tono: 'verde' },
  recuperado: { Icono: History, tono: 'verde' },
  adaptado: { Icono: Sparkles, tono: 'acento' },
  aplazado: { Icono: Hourglass, tono: 'ambar' },
  saltado: { Icono: SkipForward, tono: 'gris' },
  pausado: { Icono: Pause, tono: 'ambar' },
  reanudado: { Icono: Play, tono: 'verde' },
  cancelada: { Icono: Ban, tono: 'gris' },
  editado: { Icono: Pencil, tono: 'gris' },
  respuesta: { Icono: MessageSquareReply, tono: 'verde' },
  respuesta_ia: { Icono: Sparkles, tono: 'acento' },
  rebote: { Icono: MailX, tono: 'rojo' },
  fuera_de_oficina: { Icono: Hourglass, tono: 'ambar' },
  parada: { Icono: ShieldAlert, tono: 'rojo' },
  completada: { Icono: CheckCheck, tono: 'verde' },
  no_interesa: { Icono: Flag, tono: 'gris' },
  ensayo: { Icono: FlaskConical, tono: 'gris' },
  freno: { Icono: Gauge, tono: 'ambar' },
  error: { Icono: TriangleAlert, tono: 'rojo' },
  sin_hueco: { Icono: CalendarClock, tono: 'ambar' },
}

/* ------------------------------------------------------------------ */
/* Un nodo                                                             */
/* ------------------------------------------------------------------ */

interface PropsDeNodo {
  Icono: LucideIcon
  tono: TonoDeNodo
  lleno?: boolean
  discontinuo?: boolean
  /** Late: es el próximo en salir */
  late?: boolean
  /** Acaba de pasar a enviado: destello verde */
  destello?: boolean
  escalon?: number
  tamano?: number
}

export function Nodo({ Icono, tono, lleno = false, discontinuo = false, late = false, destello = false, escalon = 0, tamano = 22 }: PropsDeNodo) {
  const color = COLOR_DE_TONO[tono]
  return (
    <span className="sec-nodo inline-flex" style={{ '--d': escalon } as CSSProperties}>
      <span
        className={`inline-flex items-center justify-center rounded-full border-2 ${late ? 'sec-pulso' : ''} ${destello ? 'sec-destello' : ''}`}
        style={{ width: tamano, height: tamano, borderColor: color, borderStyle: discontinuo ? 'dashed' : 'solid', background: lleno ? color : 'var(--ls-sup)', color: lleno ? 'var(--ls-sup)' : color }}
      >
        <Icono className="h-[55%] w-[55%]" strokeWidth={2.4} aria-hidden />
      </span>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* El tramo entre dos nodos                                            */
/* ------------------------------------------------------------------ */

function Tramo({ llenado, tono, escalon, vuela = false, discontinuo = false }: { llenado: number; tono: TonoDeNodo; escalon: number; vuela?: boolean; discontinuo?: boolean }) {
  return (
    <span className="relative mx-1 mt-[10px] h-[2px] min-w-4 flex-1 self-start" aria-hidden>
      <span className={`absolute inset-0 rounded-full ${discontinuo ? 'border-t-2 border-dashed border-[var(--ls-linea2)]' : 'bg-[var(--ls-linea2)]'}`} />
      {llenado > 0 && (
        <span className="sec-tramo absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.round(llenado * 100)}%`, background: COLOR_DE_TONO[tono], '--d': escalon } as CSSProperties} />
      )}
      {vuela && (
        <span className="pointer-events-none absolute inset-x-0 -top-[7px] h-4 overflow-hidden">
          <Send className="sec-vuela absolute left-0 top-0 h-3 w-3 text-[var(--ls-acc)]" aria-hidden />
        </span>
      )}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* La etiqueta que va bajo cada nodo                                   */
/* ------------------------------------------------------------------ */

function nombreDelPaso(p: PasoDeCola): string {
  return p.orden === 0 ? 'Primer correo' : `Seguimiento ${p.orden}`
}

function Etiqueta({ paso, ahora, siguiente }: { paso: PasoDeCola; ahora: number; siguiente: boolean }) {
  let detalle: string
  if (paso.estado === 'enviado') detalle = paso.enviadoAt ? `${diaCorto(diaDeMadrid(paso.enviadoAt))} · ${horaDeMadrid(paso.enviadoAt)}` : 'Enviado'
  else if (paso.estado === 'pendiente' || paso.estado === 'enviando') detalle = paso.programadoAt ? cuando(paso.programadoAt, ahora) : 'Sin hora todavía'
  else detalle = paso.etiqueta
  return (
    <span className="mt-1.5 flex w-full flex-col items-center text-center leading-tight">
      <span className={`text-[11px] font-medium ${paso.estado === 'cancelado' || paso.estado === 'saltado' ? 'text-[var(--ls-t4)] line-through' : 'text-[var(--ls-t2)]'}`}>{nombreDelPaso(paso)}</span>
      <span className="text-[10.5px] tabular-nums text-[var(--ls-t4)]">{detalle}</span>
      {siguiente && paso.programadoAt && <span className="mt-0.5 text-[10px] font-semibold text-[var(--ls-acc)]">{cuentaAtras(paso.programadoAt, ahora)}</span>}
      {paso.esperando && <span className="mt-0.5 line-clamp-2 text-[10px] text-[var(--ls-e-ambar)]">{paso.esperando}</span>}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* El final de la secuencia                                            */
/* ------------------------------------------------------------------ */

function Final({ item, ahora, escalon }: { item: ItemDeCola; ahora: number; escalon: number }) {
  let cuerpo: { Icono: LucideIcon; tono: TonoDeNodo; lleno: boolean; discontinuo: boolean; titulo: string; detalle: string } | null = null
  switch (item.estado) {
    case 'respondida':
      cuerpo = { Icono: MessageSquareReply, tono: 'verde', lleno: true, discontinuo: false, titulo: 'Contestó', detalle: item.paradaAt ? cuando(item.paradaAt, ahora) : '' }
      break
    case 'parada':
      cuerpo = { Icono: ShieldAlert, tono: 'rojo', lleno: false, discontinuo: false, titulo: 'Parada', detalle: (item.codigo && ETIQUETA_DE_CODIGO[item.codigo]) || item.motivo || '' }
      break
    case 'cancelada':
      cuerpo = { Icono: Ban, tono: 'gris', lleno: false, discontinuo: true, titulo: 'Cancelada', detalle: item.paradaAt ? cuando(item.paradaAt, ahora) : '' }
      break
    case 'completada':
      cuerpo = { Icono: Flag, tono: 'gris', lleno: false, discontinuo: true, titulo: 'No interesa', detalle: item.cierre ? `si no contesta · ${diaCorto(diaDeMadrid(item.cierre))}` : 'sin cierre automático' }
      break
    case 'sin_respuesta':
      cuerpo = { Icono: Flag, tono: 'gris', lleno: true, discontinuo: false, titulo: 'No interesa', detalle: item.paradaAt ? diaCorto(diaDeMadrid(item.paradaAt)) : '' }
      break
    default:
      return null
  }
  return (
    <>
      <Tramo llenado={cuerpo.lleno ? 1 : 0} tono={cuerpo.tono} escalon={escalon} discontinuo={!cuerpo.lleno} />
      <span className="flex w-[96px] shrink-0 flex-col items-center sm:w-[112px]">
        <Nodo Icono={cuerpo.Icono} tono={cuerpo.tono} lleno={cuerpo.lleno} discontinuo={cuerpo.discontinuo} escalon={escalon + 1} />
        <span className="mt-1.5 flex w-full flex-col items-center text-center leading-tight">
          <span className="text-[11px] font-medium text-[var(--ls-t2)]">{cuerpo.titulo}</span>
          {cuerpo.detalle && <span className="line-clamp-2 text-[10.5px] text-[var(--ls-t4)]">{cuerpo.detalle}</span>}
        </span>
      </span>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* La línea entera                                                     */
/* ------------------------------------------------------------------ */

export function LineaMini({ item, ahora, recien }: { item: ItemDeCola; ahora: number; recien?: ReadonlySet<string> }) {
  const pasos = item.pasos
  const vivo = item.estado === 'activa'
  const siguiente = vivo ? pasos.find((p) => p.estado === 'pendiente' || p.estado === 'enviando') : undefined
  return (
    <div className="flex min-w-0 items-start" role="list" aria-label={`Línea de tiempo de ${item.lead.nombre}`}>
      {pasos.map((p, i) => {
        const e = estiloDelPaso(p)
        const anterior = pasos[i - 1]
        let llenado = 0
        let tonoTramo: TonoDeNodo = 'verde'
        if (anterior) {
          if (p.estado === 'enviado') llenado = 1
          else if (anterior.estado === 'enviado' && (p.estado === 'pendiente' || p.estado === 'enviando') && anterior.enviadoAt && p.programadoAt && p.programadoAt > anterior.enviadoAt) {
            llenado = Math.min(1, Math.max(0, (ahora - anterior.enviadoAt) / (p.programadoAt - anterior.enviadoAt)))
            tonoTramo = 'acento'
          } else if (anterior.estado === 'enviado' && p.estado === 'pausado') {
            llenado = 1
            tonoTramo = 'ambar'
          }
        }
        const esElSiguiente = siguiente?.id === p.id
        return (
          <div key={p.id} className="contents" role="listitem">
            {anterior && <Tramo llenado={llenado} tono={tonoTramo} escalon={i} vuela={esElSiguiente && Boolean(anterior.estado === 'enviado')} discontinuo={p.estado === 'cancelado' || p.estado === 'saltado'} />}
            <span className="flex w-[96px] shrink-0 flex-col items-center sm:w-[112px]">
              <Nodo Icono={e.Icono} tono={e.tono} lleno={p.estado === 'enviado'} discontinuo={e.discontinuo} late={esElSiguiente} destello={recien?.has(p.id)} escalon={i} />
              <Etiqueta paso={p} ahora={ahora} siguiente={esElSiguiente} />
            </span>
          </div>
        )
      })}
      <Final item={item} ahora={ahora} escalon={pasos.length} />
    </div>
  )
}

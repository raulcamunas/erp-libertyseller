'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCheck, ChevronDown, Info, Loader2, RefreshCw, Timer, Unplug } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { mezcla } from '@/components/ui-ls/utilidades'
import { TACTIL } from '@/components/ui-ls/Boton'
import { avisosDeBanda, type AvisoDeBanda, type CalidadParaBanda } from './estilo-plan'
import { cx } from './ui'

/**
 * LA BANDA DE CALIDAD DE LOS DATOS (spec remesas-pro §1.1, D10, D27 y D41).
 *
 * Va ARRIBA de cada pantalla con cifras: antes de las conclusiones, si los datos no aguantan. Enseña todos los avisos de
 * `CalidadDatos` (los ordena y les pone tono `avisosDeBanda`, en estilo-plan.ts):
 *   sin API de Amazon · libro sin leer · ventas atrasadas (> 7 días: plan PROVISIONAL) · última lectura fallida ·
 *   libro corto · plazos «de partida» · plan calculado hace > 36 h · varias conexiones · referencias fuera de la base de
 *   datos · merma alta · referencias sin precio · y cualquier otro texto de `calidad.avisos`.
 *
 * Acciones:
 *   «Leer de Amazon» (onLeerAmazon) solo para admin: gasta cupo de informes de Amazon. Los demás leen «Pide a un
 *   administrador que lea las ventas».
 *   «Confirmar plazos» (onConfirmarPlazos) y «Poner plazos» (onPonerPlazos) para quien puede editar.
 *
 * En el móvil se pliega: se ve el aviso más grave y «N avisos más», que despliega el resto. En el escritorio, todo.
 * Sin avisos no pinta nada.
 *
 * API
 *   <BandaDeCalidad calidad esAdmin puedeEditar? hoy? onLeerAmazon? leyendo? onConfirmarPlazos? confirmando?
 *                   onPonerPlazos? extra? className? />
 *   `calidad`: el `CalidadDatos` del plan, o el recorte del cliente externo (libro, leidoHasta, diasAtraso, avisos…)
 *   `extra`: avisos propios de la pantalla (p. ej. «Hay 3 envíos nuevos en Amazon… [Importar]» en Envíos, D41)
 */

export interface BandaDeCalidadProps {
  calidad: CalidadParaBanda | null | undefined
  esAdmin: boolean
  /** Puede confirmar o poner plazos (agencia con editar) */
  puedeEditar?: boolean
  hoy?: string | null
  onLeerAmazon?: () => void | Promise<void>
  leyendo?: boolean
  onConfirmarPlazos?: () => void | Promise<void>
  confirmando?: boolean
  onPonerPlazos?: () => void
  /** Avisos más, ya montados (van después de los de calidad) */
  extra?: Array<{ id: string; tono: AvisoDeBanda['tono']; texto: string; accion?: { texto: string; onClick: () => void } }>
  className?: string
}

const ICONO = {
  alta: AlertTriangle,
  media: AlertTriangle,
  info: Info,
} as const

const BOTON_BANDA =
  'inline-flex h-7 shrink-0 items-center gap-[6px] whitespace-nowrap rounded-[10px] border px-[10px] text-[12px] font-medium transition-colors ' +
  'disabled:cursor-default disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ls-acc-graf)] ' +
  TACTIL

export function BandaDeCalidad({
  calidad,
  esAdmin,
  puedeEditar = false,
  hoy,
  onLeerAmazon,
  leyendo = false,
  onConfirmarPlazos,
  confirmando = false,
  onPonerPlazos,
  extra = [],
  className,
}: BandaDeCalidadProps) {
  const [abierta, setAbierta] = useState(false)
  const avisos = avisosDeBanda(calidad ?? null, { hoy })
  const todos = [
    ...avisos.map((a) => ({ ...a, propia: null as null | { texto: string; onClick: () => void } })),
    ...extra.map((e) => ({ id: `extra_${e.id}`, tono: e.tono, gravedad: 'media' as const, texto: e.texto, accion: null, propia: e.accion ?? null })),
  ]
  if (todos.length === 0) return null

  const peor = todos[0]
  const colorPeor = COLOR_ESTADO[peor.tono]
  // La acción de leer se pone UNA vez (en el primer aviso que la pide), no en cada uno
  // (sin conexión con Amazon no hay nada que leer)
  const primeroQueLee = calidad?.sinConexion ? null : todos.find((a) => a.accion === 'leer')?.id ?? null
  const primeroDePlazos = todos.find((a) => a.accion === 'plazos')?.id ?? null
  const ocultos = todos.length - 1

  return (
    <section
      aria-label="Calidad de los datos"
      className={cx('relative min-w-0 overflow-hidden rounded-[14px] border bg-[var(--ls-sup)] shadow-[var(--ls-sombra-1)]', className)}
      style={{ borderColor: mezcla(colorPeor, 35) }}
    >
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[3px]" style={{ background: colorPeor }} />
      <ul className="divide-y divide-[var(--ls-linea)]">
        {todos.map((a, i) => {
          const color = COLOR_ESTADO[a.tono]
          const Icono = a.id === 'sin_conexion' ? Unplug : a.accion === 'plazos' ? Timer : ICONO[a.gravedad]
          return (
            <li
              key={a.id}
              className={cx('min-w-0 flex-wrap items-center gap-x-3 gap-y-2 py-[9px] pl-4 pr-3', i === 0 || abierta ? 'flex' : 'hidden lg:flex')}
            >
              <span className="flex min-w-0 flex-1 basis-[220px] items-start gap-2">
                <Icono aria-hidden className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color }} />
                <span className="min-w-0 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">{a.texto}</span>
              </span>

              <span className="flex shrink-0 flex-wrap items-center gap-2">
                {a.id === primeroQueLee &&
                  (esAdmin && onLeerAmazon ? (
                    <button
                      type="button"
                      onClick={() => void onLeerAmazon()}
                      disabled={leyendo}
                      className={cx(BOTON_BANDA, 'border-[var(--ls-linea2)] bg-[var(--ls-sup2)] text-[var(--ls-t1)] hover:bg-[var(--ls-sup3)]')}
                      title="Lee el libro de ventas y la planificación de Amazon (gasta cupo de informes)"
                    >
                      {leyendo ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      {leyendo ? 'Leyendo…' : 'Leer de Amazon'}
                    </button>
                  ) : !esAdmin ? (
                    <span className="text-[11.5px] text-[var(--ls-t4)]">Pide a un administrador que lea las ventas</span>
                  ) : null)}

                {a.id === primeroDePlazos && puedeEditar && (
                  <>
                    {onConfirmarPlazos && (
                      <button
                        type="button"
                        onClick={() => void onConfirmarPlazos()}
                        disabled={confirmando}
                        className={cx(BOTON_BANDA, 'border-[var(--ls-acc-borde)] bg-[var(--ls-acc-relleno)] text-[var(--ls-acc-tinta)] hover:brightness-110')}
                        title="Guarda los plazos de ahora (medidos o de partida) como buenos: la banda deja de salir"
                      >
                        {confirmando ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
                        Confirmar plazos
                      </button>
                    )}
                    {onPonerPlazos && (
                      <button type="button" onClick={onPonerPlazos} className={cx(BOTON_BANDA, 'border-[var(--ls-linea2)] bg-[var(--ls-sup2)] text-[var(--ls-t1)] hover:bg-[var(--ls-sup3)]')}>
                        <Timer className="h-3 w-3" />
                        Poner plazos
                      </button>
                    )}
                  </>
                )}

                {a.propia && (
                  <button type="button" onClick={a.propia.onClick} className={cx(BOTON_BANDA, 'border-[var(--ls-linea2)] bg-[var(--ls-sup2)] text-[var(--ls-t1)] hover:bg-[var(--ls-sup3)]')}>
                    {a.propia.texto}
                  </button>
                )}

                {i === 0 && ocultos > 0 && (
                  <button
                    type="button"
                    onClick={() => setAbierta((v) => !v)}
                    aria-expanded={abierta}
                    className={cx(BOTON_BANDA, 'border-transparent text-[var(--ls-t3)] hover:text-[var(--ls-t1)] lg:hidden')}
                  >
                    {abierta ? 'Menos' : `${ocultos} aviso${ocultos === 1 ? '' : 's'} más`}
                    <ChevronDown className={cx('h-3 w-3 transition-transform motion-reduce:transition-none', abierta && 'rotate-180')} />
                  </button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

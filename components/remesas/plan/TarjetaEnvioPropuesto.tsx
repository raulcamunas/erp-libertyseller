'use client'

import type { CSSProperties } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { ArrowRight, Ban, CheckCircle2, Clock, MessageSquare, MoreHorizontal, PackagePlus, RotateCcw, UserMinus, UserPlus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Boton, Insignia } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { EnvioPropuestoGuardado, EstadoEnvioPropuesto } from '@/lib/fba/plan-tipos'
import { CONFIANZA, ESTADO_ENVIO, PRIORIDAD, diasEntre, dinero, entero, fechaCorta } from '../comun/estilo-plan'
import { cx } from '../comun/ui'
import { semanaIso } from './CalendarioDeSalidas'

/**
 * TARJETA DE UN ENVÍO PROPUESTO EN EL PLAN (spec remesas-pro §1.5).
 *
 *   │▌Opinas · Envío de la semana 49                       [Esta semana]
 *   │ Decidir antes del 6 dic · salir antes del 13 dic · a la venta el 23 dic
 *   │ 6 ref · 412 ud · ~9 cajas · 1.900 € en juego si no sale
 *   │ «80-HGPJ-1F82 vende 2,1 ud/día y se queda sin stock el 30 dic; …»
 *   │ Nuevo · Responsable: — · [Asignarme] [Hablado] [Convertir en remesa] [⋯]
 *
 * El filo izquierdo lleva el color de la PRIORIDAD (tarde rojo sólido y late en el escritorio, urgente rojo, esta semana
 * naranja, próximas 2 ámbar, este mes azul, más adelante gris). Toda la tarjeta abre el panel del envío (título con
 * «enlace estirado»); los botones van por encima y no lo abren. Sin botón primario: el primario de la pantalla es el
 * del panel.
 *
 * API
 *   <TarjetaEnvioPropuesto envio hoy usuarioId puedeEditar ocupado? mostrarCliente? indice?
 *     onAbrir onCambiar(cambio) onConvertir onDescartar onAbrirRemesa? />
 *
 * Puro (con prueba en plan.prueba.ts):
 *   semanaDelEnvio(envio)              nº de semana ISO de la salida (de la clave «…:2026-W49» o de la fecha)
 *   accionesDeEstado(estado)           los botones que tocan en cada estado, en orden
 *   refsDelEnvio(envio) / cuentaAtras(fechaLimite, hoy)
 */

export type AccionTarjeta = 'hablado' | 'esperando' | 'contestado' | 'convertir' | 'abrir_remesa' | 'recuperar' | 'descartar'

const ACCIONES: Record<EstadoEnvioPropuesto, AccionTarjeta[]> = {
  nuevo: ['hablado', 'convertir', 'descartar'],
  hablado: ['convertir', 'esperando', 'descartar'],
  esperando_cliente: ['convertir', 'contestado', 'descartar'],
  en_preparacion: ['abrir_remesa'],
  enviado: ['abrir_remesa'],
  descartado: ['recuperar'],
  caducado: [],
}

export function accionesDeEstado(estado: EstadoEnvioPropuesto): AccionTarjeta[] {
  return ACCIONES[estado] ?? []
}

export const TEXTO_ACCION: Record<AccionTarjeta, { texto: string; icono: LucideIcon }> = {
  hablado: { texto: 'Hablado', icono: MessageSquare },
  esperando: { texto: 'Esperando al cliente', icono: Clock },
  contestado: { texto: 'Ha contestado', icono: CheckCircle2 },
  convertir: { texto: 'Convertir en remesa', icono: PackagePlus },
  abrir_remesa: { texto: 'Abrir la remesa', icono: ArrowRight },
  recuperar: { texto: 'Recuperar', icono: RotateCcw },
  descartar: { texto: 'Descartar', icono: Ban },
}

export function semanaDelEnvio(e: Pick<EnvioPropuestoGuardado, 'clave' | 'salirAntesDe'>): number {
  const m = /-W(\d{1,2})$/.exec(e.clave ?? '')
  if (m) return Number(m[1])
  return semanaIso(e.salirAntesDe).semana
}

/** Las referencias que van en el envío (lo hablado si se habló) */
export function refsDelEnvio(e: Pick<EnvioPropuestoGuardado, 'lineas' | 'lineasAceptadas'>): number {
  return (e.lineasAceptadas ?? e.lineas).filter((l) => l.cantidad > 0 && !l.fuera).length
}

/** «vence hoy», «quedan 3 días», «vencido hace 2 días» */
export function cuentaAtras(fechaLimite: string, hoy: string): { texto: string; tono: 'rojo' | 'ambar' | 'gris' } {
  const d = diasEntre(hoy, fechaLimite)
  if (d < 0) return { texto: `vencido hace ${-d} ${d === -1 ? 'día' : 'días'}`, tono: 'rojo' }
  if (d === 0) return { texto: 'vence hoy', tono: 'rojo' }
  if (d <= 3) return { texto: `quedan ${d} ${d === 1 ? 'día' : 'días'}`, tono: 'ambar' }
  return { texto: `quedan ${d} días`, tono: 'gris' }
}

export interface CambioDesdeTarjeta {
  estado?: EstadoEnvioPropuesto
  responsableId?: string | null
}

export interface TarjetaEnvioPropuestoProps {
  envio: EnvioPropuestoGuardado
  hoy: string
  usuarioId: string | null
  puedeEditar: boolean
  ocupado?: boolean
  mostrarCliente?: boolean
  indice?: number
  onAbrir: (id: string) => void
  onCambiar: (envio: EnvioPropuestoGuardado, cambio: CambioDesdeTarjeta) => void
  onConvertir: (envio: EnvioPropuestoGuardado) => void
  onDescartar: (envio: EnvioPropuestoGuardado) => void
  onAbrirRemesa?: (envio: EnvioPropuestoGuardado) => void
}

const ITEM_MENU =
  'flex min-h-[36px] cursor-pointer select-none items-center gap-2 rounded-[8px] px-[10px] text-[13px] text-[var(--ls-t2)] outline-none data-[highlighted]:bg-[var(--ls-sup3)] data-[highlighted]:text-[var(--ls-t1)] [@media(pointer:coarse)]:min-h-[44px]'

export function TarjetaEnvioPropuesto({
  envio: e,
  hoy,
  usuarioId,
  puedeEditar,
  ocupado = false,
  mostrarCliente = true,
  indice,
  onAbrir,
  onCambiar,
  onConvertir,
  onDescartar,
  onAbrirRemesa,
}: TarjetaEnvioPropuestoProps) {
  const p = PRIORIDAD[e.prioridad]
  const color = COLOR_ESTADO[p.tono]
  const est = ESTADO_ENVIO[e.estado]
  const conf = CONFIANZA[e.confianza]
  const semana = semanaDelEnvio(e)
  const refs = refsDelEnvio(e)
  const acordadas = e.lineasAceptadas ? e.lineasAceptadas.filter((l) => l.cantidad > 0 && !l.fuera).reduce((s, l) => s + l.cantidad, 0) : null
  const activo = e.estado === 'nuevo' || e.estado === 'hablado' || e.estado === 'esperando_cliente'
  const cuenta = activo ? cuentaAtras(e.fechaLimite, hoy) : null
  const acciones = accionesDeEstado(e.estado).filter((a) => (a === 'abrir_remesa' ? !!e.remesaId && !!onAbrirRemesa : puedeEditar))
  const visibles: AccionTarjeta[] = acciones.filter((a) => a !== 'descartar' && a !== 'esperando' && a !== 'contestado')
  const enMenu = acciones.filter((a) => !visibles.includes(a))
  const esMio = !!usuarioId && e.responsableId === usuarioId
  const titulo = `${mostrarCliente ? `${e.clienteNombre} · ` : ''}Envío de la semana ${semana}`

  const ejecutar = (a: AccionTarjeta) => {
    if (a === 'hablado') onCambiar(e, { estado: 'hablado' })
    else if (a === 'esperando') onCambiar(e, { estado: 'esperando_cliente' })
    else if (a === 'contestado') onCambiar(e, { estado: 'hablado' })
    else if (a === 'recuperar') onCambiar(e, { estado: 'nuevo' })
    else if (a === 'convertir') onConvertir(e)
    else if (a === 'descartar') onDescartar(e)
    else if (a === 'abrir_remesa') onAbrirRemesa?.(e)
  }

  return (
    <article
      className={cx(
        'relative flex min-w-0 flex-col overflow-hidden rounded-[14px] border bg-[var(--ls-sup)] shadow-[var(--ls-sombra-1)] transition-colors',
        'before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-[image:var(--ls-velo)]',
        'ls-elevar hover:border-[var(--ls-linea2)]',
        e.vencido ? 'border-[color-mix(in_srgb,var(--ls-e-rojo)_40%,var(--ls-linea))]' : 'border-[var(--ls-linea)]',
        indice != null && 'ls-aparecer',
        (e.estado === 'descartado' || e.estado === 'caducado') && 'opacity-75'
      )}
      style={indice != null ? ({ ['--ls-i' as string]: Math.min(indice, 12) } as CSSProperties) : undefined}
    >
      {/* Filo de la prioridad */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-[4px]" style={{ background: color, opacity: p.variante === 'solida' ? 1 : 0.75 }} />
      {e.provisional && (
        <span aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: `repeating-linear-gradient(135deg, transparent 0 9px, color-mix(in srgb, var(--ls-e-ambar) 6%, transparent) 9px 11px)` }} />
      )}

      <div className="relative flex min-w-0 flex-col gap-[10px] py-3 pl-[18px] pr-3 sm:pr-4">
        {/* Cabecera */}
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-[6px]">
          <h3 className="min-w-0 text-[14px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">
            {/* Enlace estirado: toda la tarjeta abre el panel */}
            <button type="button" onClick={() => onAbrir(e.id)} className="text-left outline-none after:absolute after:inset-0 after:z-0 after:rounded-[14px] focus-visible:after:ring-2 focus-visible:after:ring-[var(--ls-acc-graf)] hover:underline">
              {titulo}
            </button>
          </h3>
          <div className="relative z-[1] flex flex-wrap items-center gap-[6px]">
            {e.vencido && <Insignia tono="rojo" variante="solida" tamano="sm">Vencido</Insignia>}
            <Insignia tono={p.tono} variante={p.variante} vivo={p.vivo} tamano="sm" title={`Prioridad: ${p.texto}`}>
              {p.texto}
            </Insignia>
          </div>
        </div>

        {/* Fechas */}
        <dl className="grid min-w-0 grid-cols-3 gap-2 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2">
          {[
            { k: 'Decidir antes del', c: 'Decidir', v: e.decidirAntesDe, fuerte: activo },
            { k: 'Salir antes del', c: 'Salir', v: e.salirAntesDe, fuerte: false },
            { k: 'A la venta el', c: 'A la venta', v: e.aLaVenta, fuerte: false },
          ].map((x) => (
            <div key={x.k} className="min-w-0">
              <dt className="truncate text-[10.5px] uppercase tracking-[0.05em] text-[var(--ls-t4)]" title={x.k}>
                  <span className="sm:hidden">{x.c}</span>
                  <span className="hidden sm:inline">{x.k}</span>
                </dt>
              <dd className={cx('truncate text-[13.5px] tabular-nums', x.fuerte ? 'font-semibold text-[var(--ls-t1)]' : 'text-[var(--ls-t2)]')}>{fechaCorta(x.v, hoy)}</dd>
            </div>
          ))}
        </dl>

        {/* Cifras */}
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-[10px] gap-y-[2px] text-[12.5px] tabular-nums text-[var(--ls-t2)]">
          <span>{refs} ref</span>
          <span aria-hidden className="text-[var(--ls-t4)]">·</span>
          <span>
            <b className="font-semibold text-[var(--ls-t1)]">{entero(acordadas ?? e.unidades)}</b> ud
            {acordadas !== null && acordadas !== e.unidades && <span className="text-[var(--ls-t4)]"> (hoy el plan dice {entero(e.unidades)})</span>}
          </span>
          {e.cajasEstimadas != null && e.cajasEstimadas > 0 && (
            <>
              <span aria-hidden className="text-[var(--ls-t4)]">·</span>
              <span title="Cajas estimadas con la caja de cada referencia (o 40 ud por caja si no se sabe)">~{entero(e.cajasEstimadas)} cajas</span>
            </>
          )}
          {e.eurosEnRiesgo != null && e.eurosEnRiesgo > 0 && (
            <>
              <span aria-hidden className="text-[var(--ls-t4)]">·</span>
              <span title="Ventas que se pierden en los próximos días si no sale, a precio actual de Amazon">
                <b className="font-semibold" style={{ color: COLOR_ESTADO[e.prioridad === 'tarde' || e.prioridad === 'urgente' ? 'rojo' : 'naranja'] }}>{dinero(e.eurosEnRiesgo, e.moneda)}</b> en juego si no sale
              </span>
            </>
          )}
          {conf && <Insignia tono={conf.tono} variante={conf.variante} tamano="sm">{conf.texto}</Insignia>}
        </p>

        {/* El porqué */}
        {e.porque.length > 0 && (
          <p className="line-clamp-3 min-w-0 border-l-2 border-[var(--ls-linea2)] pl-[10px] text-[12.5px] leading-[1.5] text-[var(--ls-t3)]">
            {e.porque.slice(0, 2).join(' ')}
            {e.porque.length > 2 ? ` ${e.porque[2]}` : ''}
          </p>
        )}
        {e.planYaNoLoPide && (
          <p className="text-[12px]" style={{ color: COLOR_ESTADO.ambar }}>
            El plan de hoy ya no lo pide: decide si sigue adelante o se descarta.
          </p>
        )}

        {/* Estado, responsable y acciones */}
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-[var(--ls-linea)] pt-[10px]">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--ls-t3)]">
            <Insignia tono={est.tono} variante={est.variante} tamano="sm">{est.texto}</Insignia>
            <span className="truncate">
              Responsable: <span className="text-[var(--ls-t2)]">{e.responsableNombre ?? (e.responsableId ? 'asignado' : '—')}</span>
            </span>
            {cuenta && (
              <span className="tabular-nums" style={{ color: cuenta.tono === 'gris' ? undefined : COLOR_ESTADO[cuenta.tono] }}>
                · {cuenta.texto}
              </span>
            )}
          </div>

          <div className="relative z-[1] flex flex-wrap items-center gap-[6px]">
            {puedeEditar && activo && !e.responsableId && usuarioId && (
              <Boton tamano="sm" variante="fantasma" icono={UserPlus} disabled={ocupado} onClick={() => onCambiar(e, { responsableId: usuarioId })}>
                Asignarme
              </Boton>
            )}
            {visibles.map((a) => {
              const t = TEXTO_ACCION[a]
              return (
                <Boton key={a} tamano="sm" variante="secundario" icono={t.icono} disabled={ocupado} cargando={ocupado && a === 'convertir'} onClick={() => ejecutar(a)}>
                  {t.texto}
                </Boton>
              )
            })}
            {(enMenu.length > 0 || esMio) && (
              <Menu.Root modal={false}>
                <Menu.Trigger asChild>
                  <Boton tamano="sm" variante="fantasma" soloIcono icono={MoreHorizontal} aria-label="Más acciones" disabled={ocupado} />
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Content
                    align="end"
                    sideOffset={6}
                    collisionPadding={12}
                    className="z-[60] min-w-[200px] rounded-[12px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-1 shadow-[var(--ls-sombra-3)] data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none"
                  >
                    <Menu.Item className={ITEM_MENU} onSelect={() => onAbrir(e.id)}>
                      <ArrowRight className="h-[14px] w-[14px]" aria-hidden /> Ver el detalle
                    </Menu.Item>
                    {esMio && puedeEditar && activo && (
                      <Menu.Item className={ITEM_MENU} onSelect={() => onCambiar(e, { responsableId: null })}>
                        <UserMinus className="h-[14px] w-[14px]" aria-hidden /> Soltar (dejar sin responsable)
                      </Menu.Item>
                    )}
                    {enMenu.map((a) => {
                      const t = TEXTO_ACCION[a]
                      const Icono = t.icono
                      return (
                        <Menu.Item
                          key={a}
                          className={cx(ITEM_MENU, a === 'descartar' && 'text-[var(--ls-e-rojo)] data-[highlighted]:text-[var(--ls-e-rojo)]')}
                          onSelect={() => ejecutar(a)}
                        >
                          <Icono className="h-[14px] w-[14px]" aria-hidden /> {t.texto}
                        </Menu.Item>
                      )
                    })}
                  </Menu.Content>
                </Menu.Portal>
              </Menu.Root>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

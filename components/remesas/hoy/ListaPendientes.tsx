'use client'

import { useMemo, useState } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { toast } from 'sonner'
import {
  ArrowRight, Building2, CheckCircle2, ChevronDown, Clock, ListChecks, MessageSquare, MoreHorizontal, PackagePlus, Search, Truck, UserPlus,
  type LucideIcon,
} from 'lucide-react'
import { Boton, Confirmacion, EstadoVacio, Esqueleto, Insignia, Tarjeta } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { EnvioPropuestoGuardado, TareaPendiente } from '@/lib/fba/plan-tipos'
import type { CallbacksRemesas, SeccionCliente, SesionRemesas } from '../comun/tipos-ui'
import type { useEnviosPropuestos } from '../comun/useEnviosPropuestos'
import { cx } from '../comun/ui'
import { dinero } from '../formato'
import {
  AYUDA_ACCION, TEXTO_ACCION, TONO_GRAVEDAD, accionDePendiente, accionesSecundarias, cuentaAtras, cuentaPorGravedad,
  type AccionPendiente,
} from './useResumen'

/**
 * LISTA DE PENDIENTES DE «HOY» (spec remesas-pro §1.5, §4.3 y D18).
 *
 * Lo que vence, ordenado por gravedad y € (el orden lo da el servidor, `pendientes` de trabajo-plan.ts). Cada tarea dice
 * qué hacer (título de tú), por qué (detalle con cifras), de qué cliente, cuánto € y, si la tiene, la cuenta atrás.
 * La acción principal va visible (Hablado, Convertir en remesa, Asignarme, Importar, Reclamar o Abrir: la decide
 * `accionDePendiente`, que solo propone lo que el servidor aceptaría) y el resto en «⋯».
 *
 * No embebe el panel del envío propuesto: «Ver el envío» llama a `onAbrirEnvioPropuesto` y el resto a `onIrA`.
 * Los datos y las escrituras vienen de `useEnviosPropuestos({ pendientes: true })` (lo monta VistaHoy y lo pasa en `datos`).
 * En el móvil cada tarea es una tarjeta con la acción debajo; en el escritorio, filas con las acciones a la derecha.
 *
 * API
 *   <ListaPendientes datos sesion callbacks visibles? />
 */

export type DatosEnviosPropuestos = ReturnType<typeof useEnviosPropuestos>

export interface ListaPendientesProps {
  datos: DatosEnviosPropuestos
  sesion: SesionRemesas
  callbacks: CallbacksRemesas
  /** Cuántas se ven antes de «Ver todas» */
  visibles?: number
  className?: string
}

const ICONO_ACCION: Record<AccionPendiente, LucideIcon> = {
  hablado: MessageSquare,
  convertir: PackagePlus,
  asignarme: UserPlus,
  importar: PackagePlus,
  reclamar: Search,
  abrir: ArrowRight,
}

type Secundaria = ReturnType<typeof accionesSecundarias>[number]

const TEXTO_SECUNDARIA: Record<Secundaria, { texto: string; icono: LucideIcon }> = {
  hablado: { texto: 'Marcar como hablado', icono: MessageSquare },
  convertir: { texto: 'Convertir en remesa', icono: PackagePlus },
  asignarme: { texto: 'Asignármelo', icono: UserPlus },
  importar: { texto: 'Importar pedidos', icono: PackagePlus },
  reclamar: { texto: 'Abrir para reclamar', icono: Search },
  abrir: { texto: 'Abrir donde se resuelve', icono: ArrowRight },
  esperando: { texto: 'Esperando al cliente', icono: Clock },
  ver_envio: { texto: 'Ver el envío propuesto', icono: Truck },
  ver_cliente: { texto: 'Ver el cliente', icono: Building2 },
}

const ITEM_MENU =
  'flex min-h-[36px] cursor-pointer select-none items-center gap-2 rounded-[8px] px-[10px] text-[13px] text-[var(--ls-t2)] outline-none data-[highlighted]:bg-[var(--ls-sup3)] data-[highlighted]:text-[var(--ls-t1)] [@media(pointer:coarse)]:min-h-[44px]'

const SECCIONES: readonly SeccionCliente[] = ['resumen', 'stock', 'ventas', 'reposicion', 'envios', 'lotes', 'propuestas', 'base']
const comoSeccion = (s: string | undefined): SeccionCliente | undefined => (s && (SECCIONES as readonly string[]).includes(s) ? (s as SeccionCliente) : undefined)

const GRAVEDAD_TEXTO: Record<TareaPendiente['gravedad'], string> = { alta: 'Grave', media: 'Importante', baja: 'Cuando puedas' }

export function ListaPendientes({ datos, sesion, callbacks, visibles = 6, className }: ListaPendientesProps) {
  const { pendientes, envios, cargando, error, migracion316, aviso, recargar, cambiar, convertir, ocupado } = datos
  const [todas, setTodas] = useState(false)
  const [convirtiendo, setConvirtiendo] = useState<{ envio: EnvioPropuestoGuardado; t: TareaPendiente } | null>(null)
  const porId = useMemo(() => new Map(envios.map((e) => [e.id, e])), [envios])
  const n = cuentaPorGravedad(pendientes)
  const mostradas = todas ? pendientes : pendientes.slice(0, visibles)
  const ocultas = pendientes.length - mostradas.length

  /** Ir a donde se resuelve la tarea (lo que trae `ir`, con el cliente siempre puesto) */
  const irDeTarea = (t: TareaPendiente) => {
    if (t.ir.vista === 'plan' && t.envioPropuestoId) return callbacks.onAbrirEnvioPropuesto(t.envioPropuestoId)
    const params = { ...(t.ir.params ?? {}) }
    if (t.ir.vista === 'cliente' && !params.cliente) params.cliente = t.clienteId
    if (t.remesaId && t.ir.vista === 'cliente' && !params.remesa) params.remesa = t.remesaId
    callbacks.onIrA(t.ir.vista, comoSeccion(t.ir.seccion), params)
  }

  const avisarDe = (r: { ok: boolean; error?: string; conflicto?: unknown; aviso?: string | null }, hecho: string) => {
    if (r.ok) {
      toast.success(hecho, r.aviso ? { description: r.aviso } : undefined)
      return
    }
    toast.error(r.conflicto ? 'Alguien lo ha cambiado antes que tú: ya ves lo de ahora. Vuelve a probar si sigue haciendo falta.' : r.error ?? 'No se ha podido hacer')
  }

  const ejecutar = async (accion: Secundaria | 'convertir-confirmado', t: TareaPendiente, envio: EnvioPropuestoGuardado | null) => {
    switch (accion) {
      case 'hablado':
        if (envio) avisarDe(await cambiar(envio, { estado: 'hablado' }), `${t.clienteNombre}: marcado como hablado`)
        return
      case 'esperando':
        if (envio) avisarDe(await cambiar(envio, { estado: 'esperando_cliente' }), `${t.clienteNombre}: esperando al cliente`)
        return
      case 'asignarme':
        if (envio) avisarDe(await cambiar(envio, { responsableId: sesion.usuarioId }), `Te has quedado el envío de ${t.clienteNombre}`)
        return
      case 'convertir': {
        // A2.2: la misma confirmación que en el Plan y en el panel del envío (antes en Hoy se convertía de un toque)
        if (!envio) return
        setConvirtiendo({ envio, t })
        return
      }
      case 'convertir-confirmado': {
        if (!envio) return
        const r = await convertir(envio)
        if (r.ok) {
          toast.success(r.yaExistia ? 'Ya estaba convertido: te llevo a su remesa' : `Remesa creada en borrador para ${t.clienteNombre}`)
          callbacks.onIrA('cliente', 'propuestas', { cliente: t.clienteId, remesa: r.remesaId })
        } else {
          toast.error(r.conflicto ? 'Alguien lo ha cambiado antes que tú: revisa el envío y vuelve a probar.' : r.error)
        }
        return
      }
      case 'importar':
        callbacks.onImportarPedidos(t.clienteId)
        return
      case 'ver_envio':
        if (t.envioPropuestoId) callbacks.onAbrirEnvioPropuesto(t.envioPropuestoId)
        return
      case 'ver_cliente':
        callbacks.onIrA('cliente', 'resumen', { cliente: t.clienteId })
        return
      case 'reclamar':
      case 'abrir':
        irDeTarea(t)
        return
    }
  }

  const subtitulo = cargando && pendientes.length === 0
    ? 'Cargando…'
    : pendientes.length === 0
      ? 'Nada vencido ni por vencer'
      : [n.alta && `${n.alta} grave${n.alta === 1 ? '' : 's'}`, n.media && `${n.media} importante${n.media === 1 ? '' : 's'}`, n.baja && `${n.baja} cuando puedas`]
          .filter(Boolean)
          .join(' · ')

  return (
    <Tarjeta acento="remesas" icono={ListChecks} titulo="Pendientes" subtitulo={subtitulo} className={cx('h-full', className)} sinRelleno>
      {cargando && pendientes.length === 0 ? (
        <ul aria-label="Cargando pendientes" className="divide-y divide-[var(--ls-linea)]">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="flex gap-3 px-4 py-3">
              <Esqueleto className="mt-[5px] h-2 w-2 rounded-full" />
              <div className="flex-1">
                <Esqueleto className="h-[13px] w-3/4" />
                <Esqueleto className="mt-2 h-[10px] w-11/12" />
                <Esqueleto className="mt-2 h-[10px] w-2/5" />
              </div>
              <Esqueleto className="hidden h-8 w-24 rounded-[10px] sm:block" />
            </li>
          ))}
        </ul>
      ) : error && pendientes.length === 0 ? (
        <div className="p-4">
          <EstadoVacio
            compacto
            acento="remesas"
            titulo="No se han podido leer los pendientes"
            descripcion={error}
            accion={{ texto: 'Volver a probar', onClick: () => void recargar() }}
          />
        </div>
      ) : pendientes.length === 0 ? (
        <div className="p-4">
          <EstadoVacio
            compacto
            acento="remesas"
            icono={CheckCircle2}
            titulo={migracion316 === false ? 'Sin envíos propuestos guardados' : 'Todo al día'}
            descripcion={
              migracion316 === false
                ? aviso ?? 'Falta lanzar la migración 316: el plan se calcula, pero sin guardarlo no hay estados ni pendientes.'
                : 'No hay envíos vencidos, ni que venzan esta semana, ni envíos de Amazon por reclamar.'
            }
            accion={{ texto: 'Ver el plan', onClick: () => callbacks.onIrA('plan') }}
          />
        </div>
      ) : (
        <>
          {migracion316 === false && aviso && <p className="border-b border-[var(--ls-linea)] px-4 py-2 text-[12px] text-[var(--ls-t3)]">{aviso}</p>}
          <ul className="divide-y divide-[var(--ls-linea)]">
            {mostradas.map((t, i) => (
              <FilaPendiente
                key={t.id}
                tarea={t}
                indice={i}
                envio={t.envioPropuestoId ? porId.get(t.envioPropuestoId) ?? null : null}
                sesion={sesion}
                ocupado={!!t.envioPropuestoId && ocupado === t.envioPropuestoId}
                onAccion={ejecutar}
              />
            ))}
          </ul>
          {(ocultas > 0 || todas) && pendientes.length > visibles && (
            <div className="border-t border-[var(--ls-linea)] px-4 py-2">
              <button
                type="button"
                onClick={() => setTodas((v) => !v)}
                aria-expanded={todas}
                className="inline-flex min-h-[44px] items-center gap-1 rounded-[8px] px-1 text-[12.5px] font-medium text-[var(--ls-t2)] outline-none hover:text-[var(--ls-t1)] focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)] lg:min-h-[32px]"
              >
                {todas ? 'Ver menos' : `Ver todas (${pendientes.length})`}
                <ChevronDown className={cx('h-3 w-3 transition-transform motion-reduce:transition-none', todas && 'rotate-180')} aria-hidden />
              </button>
            </div>
          )}
        </>
      )}
      <Confirmacion
        abierto={convirtiendo !== null}
        onCambio={(a) => !a && setConvirtiendo(null)}
        palabra={null}
        tono="normal"
        titulo={convirtiendo ? `¿Convertir en remesa el envío de ${convirtiendo.t.clienteNombre}?` : '¿Convertir en remesa?'}
        descripcion={
          convirtiendo
            ? `Se crea una remesa en borrador con ${convirtiendo.envio.unidades.toLocaleString('es-ES')} ud (${convirtiendo.envio.lineasAceptadas ? 'lo hablado' : 'el plan de hoy'}) y te llevo a ella. Después sigue el flujo de siempre: enlace al cliente, etiquetas, cajas y envío.`
            : undefined
        }
        textoConfirmar="Crear la remesa"
        onConfirmar={async () => {
          if (!convirtiendo) return
          const c = convirtiendo
          setConvirtiendo(null)
          await ejecutar('convertir-confirmado', c.t, c.envio)
        }}
      />
    </Tarjeta>
  )
}

function FilaPendiente({
  tarea: t,
  indice,
  envio,
  sesion,
  ocupado,
  onAccion,
}: {
  tarea: TareaPendiente
  indice: number
  envio: EnvioPropuestoGuardado | null
  sesion: SesionRemesas
  ocupado: boolean
  onAccion: (a: Secundaria, t: TareaPendiente, envio: EnvioPropuestoGuardado | null) => void | Promise<void>
}) {
  const principal = accionDePendiente(t, envio, sesion)
  const otras = accionesSecundarias(principal, t, envio, sesion)
  const cuenta = cuentaAtras(t)
  const tono = TONO_GRAVEDAD[t.gravedad]
  const color = COLOR_ESTADO[tono]
  const Icono = ICONO_ACCION[principal]
  const vivo = t.gravedad === 'alta'

  return (
    <li
      className="ls-aparecer flex min-w-0 flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start"
      style={{ ['--ls-i' as string]: Math.min(indice, 12) }}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <span className="relative mt-[6px] flex h-2 w-2 shrink-0" title={GRAVEDAD_TEXTO[t.gravedad]}>
          {vivo && (
            <span
              aria-hidden
              className="absolute inline-flex h-full w-full rounded-full opacity-60 max-lg:hidden lg:animate-ping motion-reduce:animate-none"
              style={{ background: color }}
            />
          )}
          <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
          <span className="sr-only">{GRAVEDAD_TEXTO[t.gravedad]}</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold leading-[1.35] tracking-[-0.005em] text-[var(--ls-t1)] [overflow-wrap:anywhere]">{t.titulo}</p>
          <p className="mt-[3px] line-clamp-3 text-[12.5px] leading-[1.5] text-[var(--ls-t3)] [overflow-wrap:anywhere] sm:line-clamp-2" title={t.detalle}>
            {t.detalle}
          </p>
          <div className="mt-[6px] flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--ls-t3)]">
            <span className="max-w-full truncate font-medium text-[var(--ls-t2)]">{t.clienteNombre}</span>
            {t.euros != null && t.euros > 0 && (
              <span className="tabular-nums" title="€ en juego, a precio actual de Amazon">
                · {dinero(t.euros, t.moneda ?? 'EUR')}
              </span>
            )}
            {cuenta && (
              <Insignia tono={cuenta.tono} tamano="sm" variante={cuenta.tono === 'rojo' ? 'solida' : 'suave'} icono={Clock}>
                {cuenta.texto}
              </Insignia>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-[6px] pl-5 sm:pl-0">
        <Boton
          tamano="sm"
          variante={principal === 'abrir' ? 'fantasma' : 'secundario'}
          icono={Icono}
          disabled={ocupado}
          cargando={ocupado && (principal === 'convertir' || principal === 'hablado' || principal === 'asignarme')}
          title={AYUDA_ACCION[principal]}
          onClick={() => void onAccion(principal, t, envio)}
        >
          {TEXTO_ACCION[principal]}
        </Boton>
        {otras.length > 0 && (
          <Menu.Root modal={false}>
            <Menu.Trigger asChild>
              <Boton tamano="sm" variante="fantasma" soloIcono icono={MoreHorizontal} aria-label={`Más acciones: ${t.titulo}`} disabled={ocupado} />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content
                align="end"
                sideOffset={6}
                collisionPadding={12}
                className="z-[60] min-w-[220px] max-w-[calc(100vw-24px)] rounded-[12px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-1 shadow-[var(--ls-sombra-3)] data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none"
              >
                {otras.map((a) => {
                  const x = TEXTO_SECUNDARIA[a]
                  const I = x.icono
                  return (
                    <Menu.Item key={a} className={ITEM_MENU} onSelect={() => void onAccion(a, t, envio)}>
                      <I className="h-[14px] w-[14px] shrink-0" aria-hidden /> {x.texto}
                    </Menu.Item>
                  )
                })}
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        )}
      </div>
    </li>
  )
}

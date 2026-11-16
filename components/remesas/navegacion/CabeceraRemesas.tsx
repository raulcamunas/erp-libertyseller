'use client'

import type { ReactNode } from 'react'
import { BellRing, CalendarRange, Columns3, RefreshCw, Store, Sunrise, Truck, type LucideIcon } from 'lucide-react'
import { Boton, CabeceraDeModulo, Pestanas, type Opcion } from '@/components/ui-ls'
import type { SesionRemesas, VistaRemesas } from '../comun/tipos-ui'

/**
 * LA CABECERA DE REMESAS A FBA (spec remesas-pro §1.2 y §1.3).
 *
 * `CabeceraDeModulo` con el acento del módulo, una entradilla que dice qué responde la vista abierta, «Actualizar» a la derecha y, debajo,
 * las vistas en `Pestanas`:
 *   agencia          Hoy · Plan · Cliente · Tablero · Alertas (con el nº de críticas y altas abiertas)
 *   cliente de fuera Mi stock y, si tiene varias cuentas, Mis cuentas (el tablero reducido, D39). Con una sola cuenta no hay pestañas.
 *
 * No navega: llama a `onVista`. En el móvil, al pasarla, el kit deja arriba una barra compacta con el título.
 *
 *   <CabeceraRemesas sesion vista vistas onVista alertas? subtitulo? actualizando? onActualizar? acciones? />
 */

export interface CabeceraRemesasProps {
  sesion: Pick<SesionRemesas, 'actor'>
  vista: VistaRemesas
  /** Las vistas que puede abrir quien mira, en orden */
  vistas: readonly VistaRemesas[]
  onVista: (v: VistaRemesas) => void
  /** Alertas graves abiertas (críticas + altas). null = no se enseñan */
  alertas?: { criticas: number; altas: number } | null
  /** Lo que se pinta bajo el título (por defecto, lo que responde la vista) */
  subtitulo?: ReactNode
  actualizando?: boolean
  /** Sin él no sale «Actualizar» (Hoy trae el suyo, que además recalcula el resumen en el servidor) */
  onActualizar?: () => void
  /** Más botones a la derecha */
  acciones?: ReactNode
}

const VISTA: Record<VistaRemesas, { agencia: string; cliente: string; icono: LucideIcon; responde: { agencia: string; cliente: string } }> = {
  hoy: { agencia: 'Hoy', cliente: 'Hoy', icono: Sunrise, responde: { agencia: 'Qué hay que hacer hoy y qué se nos escapa', cliente: '' } },
  plan: {
    agencia: 'Plan',
    cliente: 'Plan',
    icono: CalendarRange,
    responde: { agencia: 'Qué hay que enviar, cuánto y antes de qué fecha, en todos los clientes', cliente: '' },
  },
  cliente: {
    agencia: 'Cliente',
    cliente: 'Mi stock',
    icono: Store,
    responde: {
      agencia: 'Todo lo de un cliente: stock, ventas, reposición, envíos, lotes y propuestas',
      cliente: 'Tu stock en Amazon, tus ventas, tus envíos y tus propuestas',
    },
  },
  tablero: {
    agencia: 'Tablero',
    cliente: 'Mis cuentas',
    icono: Columns3,
    responde: { agencia: 'Los envíos vivos de cada cliente y las propuestas por fases', cliente: 'Los envíos de cada una de tus cuentas' },
  },
  alertas: {
    agencia: 'Alertas',
    cliente: 'Alertas',
    icono: BellRing,
    responde: { agencia: 'Roturas de stock, envíos parados, descuadres y stock parado de todos los clientes', cliente: '' },
  },
}

export function textoDeVista(v: VistaRemesas, actor: 'agencia' | 'cliente'): string {
  return VISTA[v][actor]
}

export function CabeceraRemesas({ sesion, vista, vistas, onVista, alertas = null, subtitulo, actualizando = false, onActualizar, acciones }: CabeceraRemesasProps) {
  const actor = sesion.actor
  const graves = alertas ? alertas.criticas + alertas.altas : 0
  const opciones: Array<Opcion<VistaRemesas>> = vistas.map((v) => ({
    id: v,
    texto: VISTA[v][actor],
    icono: VISTA[v].icono,
    ...(v === 'alertas' && graves > 0 ? { cuenta: graves } : {}),
  }))

  return (
    <CabeceraDeModulo
      // Al imprimir (Resumen semanal de Alertas) la hoja va sola, sin la cabecera ni las pestañas
      className="print:hidden"
      icono={Truck}
      acento="remesas"
      titulo="Remesas a FBA"
      subtitulo={subtitulo ?? (VISTA[vista].responde[actor] || undefined)}
      acciones={
        acciones || onActualizar ? (
          <>
            {acciones}
            {onActualizar && (
              <Boton
                variante="secundario"
                tamano="sm"
                icono={RefreshCw}
                cargando={actualizando}
                onClick={onActualizar}
                disabled={actualizando}
                title="Vuelve a leer lo que hay en pantalla (no pregunta a Amazon)"
              >
                Actualizar
              </Boton>
            )}
          </>
        ) : undefined
      }
      debajo={vistas.length > 1 ? <Pestanas etiqueta="Vistas de Remesas" opciones={opciones} valor={vista} onCambio={onVista} acento="remesas" /> : undefined}
    />
  )
}

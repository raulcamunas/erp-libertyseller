'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Clock3, Loader2, Plus, RefreshCw, Table2, WifiOff } from 'lucide-react'
import { haceCuanto } from '@/lib/agenda/memoria'
import { BOTON, COLOR_ESTADO, PANTALLA, TEXTO, TITULO } from '@/lib/estilo/denso'

/**
 * LA BARRA DE ARRIBA DE LA AGENDA: título, semana, acciones y quién se ve.
 *
 * Son dos filas en vez de las tres de antes (título suelto, botones, leyenda): arriba va todo lo que se hace —moverse por las semanas y agendar— y abajo, quién se ve.
 *
 * LA LEYENDA AHORA SE PUEDE PULSAR. Antes eran unas pastillas con el color de cada comercial que no hacían nada; ahora cada una enciende y apaga las citas de esa persona,
 * y «Google Calendar» los huecos importados — que son 5.889 contra 50 citas del ERP, y tapan todo cuando lo que se quiere ver es la agenda del equipo. Lo que se apaga se
 * recuerda en este navegador. Cada pastilla lleva además cuántas citas tiene esa persona esta semana, que es lo primero que se quiere saber de un vistazo.
 */

export interface PersonaDeLaLeyenda {
  id: string
  nombre: string
  color: string
  /** Citas del ERP que tiene en la semana que se mira */
  cuenta: number
  visible: boolean
}

interface Props {
  /** «26 oct – 1 nov 2026», o «lunes 26 de oct» en móvil */
  etiqueta: string
  /** Número de semana del año, o null en móvil */
  semana: number | null
  movil: boolean
  esAdmin: boolean
  sincronizando: boolean
  /** Hay semanas pidiéndose a la base */
  cargando: boolean
  /** Si las últimas lecturas de la agenda han fallado: cuándo se pudo leer por última vez (milisegundos). null = al día, y no se enseña nada */
  desfasadaDesde: number | null
  gente: PersonaDeLaLeyenda[]
  verGoogle: boolean
  /** Citas del ERP en lo que se ve */
  totalVisible: number
  onAnterior: () => void
  onSiguiente: () => void
  onHoy: () => void
  /** Una fecha elegida en el selector, «2026-11-03» */
  onIrA: (fecha: string) => void
  onSincronizar: () => void
  /** Volver a leer ya la agenda (el chip de «sin actualizar») */
  onReintentar: () => void
  onDisponibilidad: () => void
  onNueva: () => void
  onAlternarPersona: (id: string) => void
  onAlternarGoogle: () => void
}

const botonSecundario = `${BOTON.base} ${BOTON.secundario} ${BOTON.alto}`
const botonIcono = `${botonSecundario} !w-7 justify-center !px-0`

export function BarraDeAgenda({
  etiqueta, semana, movil, esAdmin, sincronizando, cargando, desfasadaDesde, gente, verGoogle, totalVisible,
  onAnterior, onSiguiente, onHoy, onIrA, onSincronizar, onReintentar, onDisponibilidad, onNueva, onAlternarPersona, onAlternarGoogle,
}: Props) {
  const selectorDeFecha = useRef<HTMLInputElement>(null)

  const abrirSelector = () => {
    const campo = selectorDeFecha.current
    if (!campo) return
    try {
      campo.showPicker()
    } catch {
      campo.focus()
      campo.click()
    }
  }

  return (
    <div className="flex shrink-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <h1 className={`${TITULO.pantalla} mr-1`}>Agenda comercial</h1>

        <div className="flex items-center gap-1">
          <button type="button" onClick={onAnterior} className={botonIcono} aria-label={movil ? 'Día anterior' : 'Semana anterior'}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onHoy} className={botonSecundario}>
            Hoy
          </button>
          <button type="button" onClick={onSiguiente} className={botonIcono} aria-label={movil ? 'Día siguiente' : 'Semana siguiente'}>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={abrirSelector}
            className="inline-flex h-7 items-center gap-1.5 rounded-[6px] px-1.5 text-[13px] font-semibold tracking-[-0.006em] text-[var(--ls-t1)] hover:bg-[var(--ls-sup3)]"
            title="Ir a una fecha"
          >
            <span className="inline-block first-letter:uppercase">{etiqueta}</span>
            {semana !== null && <span className="text-[11px] font-normal tabular-nums text-[var(--ls-t4)]">Semana {semana}</span>}
            {cargando && <Loader2 className="h-3 w-3 animate-spin text-[var(--ls-t4)]" aria-label="Cargando" />}
          </button>
          {/* El selector de fechas del navegador, invisible: el botón de al lado lo abre */}
          <input
            ref={selectorDeFecha}
            type="date"
            tabIndex={-1}
            aria-label="Ir a una fecha"
            onChange={(e) => e.target.value && onIrA(e.target.value)}
            className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
          />
        </div>

        {/* Solo si la agenda no ha podido releerse las últimas veces: lo normal es que no se vea. Mejor este aviso que una pantalla que parece al día y no lo está */}
        {desfasadaDesde !== null && (
          <button
            type="button"
            onClick={onReintentar}
            className={BOTON.chip}
            title="No se ha podido actualizar la agenda las últimas veces, así que lo que ves puede no ser lo último. Pulsa para reintentarlo."
          >
            <WifiOff className="h-3 w-3" style={{ color: COLOR_ESTADO.ambar }} aria-hidden />
            <span>Sin actualizar {haceCuanto(desfasadaDesde, Date.now())}</span>
            <span className="font-medium text-[var(--ls-t1)]">Reintentar</span>
          </button>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {esAdmin && (
            <button type="button" onClick={onSincronizar} disabled={sincronizando} className={botonSecundario} title="Volver a leer Google Calendar entero, sin esperar al ciclo automático">
              <RefreshCw className={`h-3.5 w-3.5 ${sincronizando ? 'animate-spin text-[var(--ls-acc)]' : ''}`} />
              <span className="hidden sm:inline">{sincronizando ? 'Sincronizando…' : 'Sincronizar'}</span>
            </button>
          )}
          {esAdmin && (
            <button type="button" onClick={onDisponibilidad} className={botonSecundario}>
              <Clock3 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Mi disponibilidad</span>
            </button>
          )}
          <Link href="/dashboard/agenda/desglose" className={botonSecundario}>
            <Table2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Desglose de citas</span>
          </Link>
          <button type="button" onClick={onNueva} className={`${BOTON.base} ${BOTON.primario} ${BOTON.alto}`}>
            <Plus className="h-3.5 w-3.5" />
            Nueva cita
          </button>
        </div>
      </div>

      <div className={`${PANTALLA.fila} flex-wrap gap-1.5`}>
        {gente.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={p.visible}
            onClick={() => onAlternarPersona(p.id)}
            title={p.visible ? `Ocultar las citas de ${p.nombre}` : `Mostrar las citas de ${p.nombre}`}
            className={`${BOTON.chip} transition-opacity ${p.visible ? '' : 'opacity-50'}`}
          >
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: p.visible ? p.color : 'transparent', boxShadow: `inset 0 0 0 1.5px ${p.color}` }}
            />
            <span className={p.visible ? 'text-[var(--ls-t1)]' : 'line-through'}>{p.nombre}</span>
            {p.cuenta > 0 && <span className="tabular-nums text-[var(--ls-t4)]">{p.cuenta}</span>}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={verGoogle}
          onClick={onAlternarGoogle}
          title={verGoogle ? 'Ocultar los huecos ocupados de Google Calendar' : 'Mostrar los huecos ocupados de Google Calendar'}
          className={`${BOTON.chip} transition-opacity ${verGoogle ? '' : 'opacity-50'}`}
        >
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full border border-dashed border-[var(--ls-t4)]"
            style={{ backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 1.5px, var(--ls-t4) 1.5px 2.5px)' }}
          />
          <span className={verGoogle ? 'text-[var(--ls-t1)]' : 'line-through'}>Google Calendar</span>
        </button>
        <span className={`ml-auto text-[11.5px] tabular-nums ${TEXTO.t3}`}>
          {totalVisible} {totalVisible === 1 ? 'cita' : 'citas'} {movil ? 'hoy' : 'esta semana'}
        </span>
      </div>
    </div>
  )
}

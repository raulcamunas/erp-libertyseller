'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Clock3, Loader2, MoreHorizontal, Plus, RefreshCw, Table2, WifiOff } from 'lucide-react'
import { haceCuanto } from '@/lib/agenda/memoria'
import { BOTON, COLOR_ESTADO, PANTALLA, TEXTO, TITULO } from '@/lib/estilo/denso'
import { RelojesDeLaAgenda } from './RelojesDeLaAgenda'

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
  /** MÓVIL: los 7 días de la semana con sus citas (la tira de arriba), cuál se mira y el de hoy */
  tiraSemana?: Array<{ clave: string; fecha: Date; citas: number; colores: string[] }> | null
  diaElegido?: number
  hoy?: string
  onElegirDia?: (indice: number) => void
}

const botonSecundario = `${BOTON.base} ${BOTON.secundario} ${BOTON.alto}`
const botonIcono = `${botonSecundario} !w-7 justify-center !px-0`

export function BarraDeAgenda({
  etiqueta, semana, movil, esAdmin, sincronizando, cargando, desfasadaDesde, gente, verGoogle, totalVisible,
  onAnterior, onSiguiente, onHoy, onIrA, onSincronizar, onReintentar, onDisponibilidad, onNueva, onAlternarPersona, onAlternarGoogle,
  tiraSemana, diaElegido = 0, hoy, onElegirDia,
}: Props) {
  const selectorDeFecha = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState(false)
  const cajaMenu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const fuera = (e: PointerEvent) => !cajaMenu.current?.contains(e.target as Node) && setMenu(false)
    document.addEventListener('pointerdown', fuera)
    return () => document.removeEventListener('pointerdown', fuera)
  }, [menu])

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

  // EN EL MÓVIL, OTRA BARRA: el día en grande (abre el calendario), la semana en una tira que se toca, quién se ve en una fila que se desliza, las
  // acciones en «⋯» y «Nueva cita» flotando abajo a la derecha, a mano del pulgar
  if (movil) {
    const chip = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 text-[12.5px] font-medium transition-opacity'
    return (
      <div className="flex shrink-0 flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <button type="button" onClick={abrirSelector} className="flex max-w-full items-center gap-1.5 rounded-[10px] py-1 text-left" title="Ir a una fecha">
              <span className="truncate text-[19px] font-bold tracking-[-0.02em] text-[var(--ls-t1)] first-letter:uppercase">{etiqueta}</span>
              {cargando ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--ls-t4)]" aria-label="Cargando" /> : <CalendarDays className="h-4 w-4 shrink-0 text-[var(--ls-t4)]" aria-hidden />}
            </button>
            <input ref={selectorDeFecha} type="date" tabIndex={-1} aria-label="Ir a una fecha" onChange={(e) => e.target.value && onIrA(e.target.value)} className="pointer-events-none absolute inset-0 h-full w-full opacity-0" />
          </div>
          <div className="flex shrink-0 items-center rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-[3px]">
            <button type="button" onClick={onAnterior} className="grid h-9 w-9 place-items-center rounded-[9px] text-[var(--ls-t2)] active:bg-[var(--ls-sup3)]" aria-label="Día anterior">
              <ChevronLeft className="h-[18px] w-[18px]" />
            </button>
            <button type="button" onClick={onHoy} className="h-9 rounded-[9px] px-3 text-[13px] font-semibold text-[var(--ls-t1)] active:bg-[var(--ls-sup3)]">
              Hoy
            </button>
            <button type="button" onClick={onSiguiente} className="grid h-9 w-9 place-items-center rounded-[9px] text-[var(--ls-t2)] active:bg-[var(--ls-sup3)]" aria-label="Día siguiente">
              <ChevronRight className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>

        {/* La semana: tocar un día lleva a él; los puntos son sus citas con el color de cada comercial */}
        {tiraSemana && (
          <div className="grid grid-cols-7 gap-1 rounded-[16px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-1.5">
            {tiraSemana.map((d, i) => {
              const elegido = i === diaElegido
              const esHoy = d.clave === hoy
              return (
                <button
                  key={d.clave}
                  type="button"
                  onClick={() => onElegirDia?.(i)}
                  aria-pressed={elegido}
                  aria-label={`${d.fecha.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}: ${d.citas} ${d.citas === 1 ? 'cita' : 'citas'}`}
                  className={`flex h-[58px] flex-col items-center justify-center gap-[3px] rounded-[12px] transition-colors ${elegido ? 'bg-[var(--ls-acc)] text-[var(--ls-acc-tinta)] shadow-[0_6px_16px_-8px_var(--ls-acc)]' : 'text-[var(--ls-t2)] active:bg-[var(--ls-sup3)]'}`}
                >
                  <span className={`text-[10.5px] font-semibold uppercase ${elegido ? '' : 'text-[var(--ls-t4)]'}`}>{['L', 'M', 'X', 'J', 'V', 'S', 'D'][i]}</span>
                  <span className={`grid h-6 w-6 place-items-center rounded-full text-[15px] font-bold tabular-nums ${esHoy && !elegido ? 'text-[var(--ls-acc)] ring-1 ring-[var(--ls-acc)]' : ''}`}>{d.fecha.getDate()}</span>
                  <span className="flex h-[5px] items-center gap-[2px]">
                    {d.colores.slice(0, 3).map((c, k) => (
                      <span key={k} className="h-[5px] w-[5px] rounded-full" style={{ background: elegido ? 'var(--ls-acc-tinta)' : c }} />
                    ))}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {desfasadaDesde !== null && (
          <button type="button" onClick={onReintentar} className={`${BOTON.chip} self-start`}>
            <WifiOff className="h-3 w-3" style={{ color: COLOR_ESTADO.ambar }} aria-hidden />
            <span>Sin actualizar {haceCuanto(desfasadaDesde, Date.now())}</span>
            <span className="font-medium text-[var(--ls-t1)]">Reintentar</span>
          </button>
        )}

        {/* Quién se ve: una fila que se desliza, y las acciones en «⋯» */}
        <div className="flex items-center gap-2">
          <div className="-ml-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-0.5 pl-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {gente.map((p) => (
              <button key={p.id} type="button" aria-pressed={p.visible} onClick={() => onAlternarPersona(p.id)} className={`${chip} ${p.visible ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t4)] opacity-60'}`}>
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.visible ? p.color : 'transparent', boxShadow: `inset 0 0 0 1.5px ${p.color}` }} />
                <span className={p.visible ? '' : 'line-through'}>{p.nombre}</span>
                {p.cuenta > 0 && <span className="rounded-full bg-[var(--ls-sup3)] px-1.5 text-[11px] tabular-nums text-[var(--ls-t2)]">{p.cuenta}</span>}
              </button>
            ))}
            <button type="button" aria-pressed={verGoogle} onClick={onAlternarGoogle} className={`${chip} ${verGoogle ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t4)] opacity-60'}`}>
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full border border-dashed border-[var(--ls-t4)]" />
              <span className={verGoogle ? '' : 'line-through'}>Google</span>
            </button>
          </div>
          <div ref={cajaMenu} className="relative shrink-0">
            <button type="button" onClick={() => setMenu((x) => !x)} aria-expanded={menu} aria-label="Más acciones" className="grid h-9 w-9 place-items-center rounded-[11px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[var(--ls-t2)]">
              {sincronizando ? <RefreshCw className="h-4 w-4 animate-spin text-[var(--ls-acc)]" /> : <MoreHorizontal className="h-4 w-4" />}
            </button>
            {menu && (
              <div className="absolute right-0 top-11 z-40 w-[230px] rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-1 shadow-[var(--ls-sombra-3)]">
                {esAdmin && (
                  <button type="button" disabled={sincronizando} onClick={() => (setMenu(false), onSincronizar())} className="flex h-11 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[14px] text-[var(--ls-t1)] active:bg-[var(--ls-sup3)]">
                    <RefreshCw className="h-4 w-4 text-[var(--ls-t3)]" /> {sincronizando ? 'Sincronizando…' : 'Sincronizar Google'}
                  </button>
                )}
                {esAdmin && (
                  <button type="button" onClick={() => (setMenu(false), onDisponibilidad())} className="flex h-11 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[14px] text-[var(--ls-t1)] active:bg-[var(--ls-sup3)]">
                    <Clock3 className="h-4 w-4 text-[var(--ls-t3)]" /> Mi disponibilidad
                  </button>
                )}
                <Link href="/dashboard/agenda/preparar" onClick={() => setMenu(false)} className="flex h-11 w-full items-center gap-3 rounded-[10px] px-3 text-[14px] text-[var(--ls-t1)] active:bg-[var(--ls-sup3)]">
                  <ClipboardList className="h-4 w-4 text-[var(--ls-t3)]" /> Preparador de reuniones
                </Link>
                <Link href="/dashboard/agenda/desglose" onClick={() => setMenu(false)} className="flex h-11 w-full items-center gap-3 rounded-[10px] px-3 text-[14px] text-[var(--ls-t1)] active:bg-[var(--ls-sup3)]">
                  <Table2 className="h-4 w-4 text-[var(--ls-t3)]" /> Desglose de citas
                </Link>
                <div className="mx-3 my-1 border-t border-[var(--ls-linea)]" />
                <div className="px-3 py-2 text-[12px] text-[var(--ls-t4)]">
                  {totalVisible} {totalVisible === 1 ? 'cita' : 'citas'} este día
                </div>
              </div>
            )}
          </div>
        </div>

        {/* «Nueva cita», flotando encima de la barra de abajo */}
        <button
          type="button"
          onClick={onNueva}
          aria-label="Nueva cita"
          className="fixed right-4 z-30 inline-flex h-14 items-center gap-2 rounded-full px-5 text-[15px] font-semibold text-[var(--ls-acc-tinta)] shadow-[0_14px_30px_-10px_var(--ls-acc)] active:scale-95"
          style={{ bottom: 'calc(var(--barra-hueco, 0px) + 16px)', background: 'linear-gradient(135deg, var(--ls-acc), color-mix(in srgb, var(--ls-acc) 70%, #FFB36B))' }}
        >
          <Plus className="h-5 w-5" /> Nueva cita
        </button>
      </div>
    )
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
          <Link href="/dashboard/agenda/preparar" className={botonSecundario} title="Prepara el guion de una cita y sácalo en una hoja para imprimir">
            <ClipboardList className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Preparador de reuniones</span>
          </Link>
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
        <div className="ml-auto flex items-center gap-3">
          <RelojesDeLaAgenda />
          <span aria-hidden className="h-3 w-px bg-[var(--ls-linea)] max-sm:hidden" />
        <span className={`text-[11.5px] tabular-nums ${TEXTO.t3}`}>
          {totalVisible} {totalVisible === 1 ? 'cita' : 'citas'} {movil ? 'hoy' : 'esta semana'}
        </span>
        </div>
      </div>
    </div>
  )
}

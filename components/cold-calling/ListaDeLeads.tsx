'use client'

import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { fechaDeRellamada } from '@/lib/cold-calling/cartera'
import { vencimientoDe, etiquetaDeVencimiento } from '@/lib/cold-calling/fechas'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { COLD_STATUS_LABELS, esPartner, type ColdLead } from '@/lib/types/cold-leads'
import { Esqueleto } from '@/components/rendimiento/ui'
import { MarcaDeFestivo } from './Festivos'
import { CifraDeLista, GlifoDeEstado, tinte, tonoDeLista } from './ui'
import { useVentana } from './useVentana'

/**
 * LA LISTA DE LEADS: dos líneas por lead, de alto fijo, y solo se pintan las que se ven.
 *
 *   ● Nombre de la tienda                                  N1 · 80 k€
 *     +34 910 21 04 65 · Empresa SL                  atrasada 3 d · 2 int.
 *
 * Cada fila dice lo que se necesita para decidir a quién llamar sin abrirla: el estado (forma y color), el teléfono, y si hay
 * una rellamada que vence —en cian si es de hoy, en ámbar si se pasó—. El resto está en la ficha.
 */

export const ALTO_DE_FILA = 52

interface PropsDeFila {
  lead: ColdLead
  activa: boolean
  hoy: string
  /** El día para el que se mira si es festivo en la comunidad del lead: hoy, o en la agenda de rellamadas el día que se elige. Sin él, hoy */
  diaFestivos?: string
  /** Se pinta un cuadradito con el color de su lista: solo cuando se mezclan varias y hay que distinguirlas */
  mostrarLista: boolean
  onSeleccionar: (id: string) => void
  /** Su posición entre las primeras: las diez primeras entran con un ligero ascenso, escalonado */
  entrada: number | null
}

export const FilaDeLead = memo(function FilaDeLead({ lead, activa, hoy, diaFestivos, mostrarLista, onSeleccionar, entrada }: PropsDeFila) {
  const fecha = fechaDeRellamada(lead)
  const vencimiento = vencimientoDe(fecha, hoy)
  const cerrado = lead.status === 'no_interesa'

  const chip =
    vencimiento && (vencimiento.tipo === 'atrasada' || vencimiento.tipo === 'hoy' || vencimiento.tipo === 'manana') ? (
      <span
        title={`Rellamar ${vencimiento.tipo === 'hoy' ? 'hoy' : vencimiento.tipo === 'manana' ? 'mañana' : `el ${fecha}`}`}
        className="inline-flex h-[17px] items-center rounded-[4px] px-1.5 text-[10.5px] font-semibold leading-none"
        style={{
          color: COLOR_ESTADO[vencimiento.tipo === 'atrasada' ? 'ambar' : vencimiento.tipo === 'hoy' ? 'cian' : 'gris'],
          background: tinte(vencimiento.tipo === 'atrasada' ? 'ambar' : vencimiento.tipo === 'hoy' ? 'cian' : 'gris'),
        }}
      >
        {etiquetaDeVencimiento(fecha, hoy)}
      </span>
    ) : null

  return (
    <button
      type="button"
      onClick={() => onSeleccionar(lead.id)}
      aria-current={activa ? 'true' : undefined}
      title={COLD_STATUS_LABELS[lead.status]}
      // El fondo de «pasar el ratón» solo con ratón: en el móvil el último toque lo dejaba pegado y parecía la fila seleccionada
      className={`group relative flex w-full items-center gap-2.5 border-b border-[var(--ls-linea)] px-3 text-left outline-none transition-colors focus-visible:bg-[var(--ls-sup3)] ${entrada !== null ? 'rend-entra' : ''} ${
        activa ? 'bg-[var(--ls-sel)]' : '[@media(hover:hover)]:hover:bg-[var(--ls-sup3)]'
      }`}
      style={{ height: ALTO_DE_FILA, ...(entrada !== null ? ({ '--d': entrada } as CSSProperties) : null) }}
    >
      {activa && <span aria-hidden className="absolute inset-y-2 left-0 w-[2px] rounded-full bg-[var(--ls-acc-graf)]" />}
      <GlifoDeEstado estado={lead.status} tamano={15} />

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={`min-w-0 flex-1 truncate text-[12.5px] font-semibold ${cerrado ? 'text-[var(--ls-t3)]' : 'text-[var(--ls-t1)]'}`}>{lead.store_name}</span>
          {/* Un día festivo en su comunidad: casi seguro no contestan. Solo si el festivo es de una comunidad o una zona (uno de toda España sería igual en todas las filas) */}
          <MarcaDeFestivo lead={lead} dia={diaFestivos ?? hoy} hoy={hoy} />
          <CifraDeLista lead={lead} />
        </span>
        <span className="mt-px flex items-center gap-1.5 text-[11px] text-[var(--ls-t4)]">
          {mostrarLista && lead.source_list && <span aria-hidden title={lead.source_list} className="h-1.5 w-1.5 shrink-0 rounded-[2px]" style={{ background: COLOR_ESTADO[tonoDeLista(lead.source_list)] }} />}
          <span className="min-w-0 flex-1 truncate">
            {lead.phone || 'Sin teléfono'}
            {/* De un partner interesa DÓNDE está y QUÉ es (la razón social dice poco: «HNOS SESÉ ASENSIO, SL»); del resto, su empresa */}
            {esPartner(lead) ? [lead.ciudad, lead.category].filter(Boolean).map((t) => ` · ${t}`).join('') : lead.company ? ` · ${lead.company}` : ''}
          </span>
          {chip}
          {lead.call_attempts > 0 && (
            <span className="shrink-0 tabular-nums" title={`${lead.call_attempts} ${lead.call_attempts === 1 ? 'intento' : 'intentos'} de llamada`}>
              {lead.call_attempts} int.
            </span>
          )}
        </span>
      </span>
    </button>
  )
})

/* ------------------------------------------------------------------ */
/* La lista con ventana                                                */
/* ------------------------------------------------------------------ */

interface PropsDeLista {
  leads: readonly ColdLead[]
  seleccionado: string | null
  onSeleccionar: (id: string) => void
  hoy: string
  mostrarLista: boolean
  /** Sube cuando cambia el filtro o el orden: la lista vuelve arriba y las primeras filas vuelven a entrar */
  generacion: string
  cargando: boolean
  /** Lo que se enseña si no hay ningún lead */
  vacio: ReactNode
}

export function ListaDeLeads({ leads, seleccionado, onSeleccionar, hoy, mostrarLista, generacion, cargando, vacio }: PropsDeLista) {
  const [contenedor, setContenedor] = useState<HTMLDivElement | null>(null)
  const { inicio, fin, desplazarA } = useVentana({ total: leads.length, alto: ALTO_DE_FILA, contenedor })

  // Las diez primeras filas entran con un ligero ascenso, pero SOLO cuando la lista es nueva (al abrir o al cambiar un filtro). Antes lo
  // repetían cada vez que se volvía arriba haciendo scroll, porque las filas se montan de nuevo al entrar en la ventana
  const [conEntrada, setConEntrada] = useState(true)
  useEffect(() => {
    setConEntrada(true)
    const parar = setTimeout(() => setConEntrada(false), 900)
    return () => clearTimeout(parar)
  }, [generacion])

  // Un filtro o un orden nuevos: otra lista, y se empieza por arriba
  useEffect(() => {
    if (contenedor) contenedor.scrollTop = 0
  }, [generacion, contenedor])

  // Moverse con el teclado o con «Siguiente» no puede dejar el lead seleccionado fuera de la vista
  useEffect(() => {
    if (!seleccionado) return
    const i = leads.findIndex((l) => l.id === seleccionado)
    if (i >= 0) desplazarA(i)
    // `leads` no es una dependencia a propósito: cuando llega un cambio en tiempo real no hay que mover la lista
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionado, desplazarA])

  if (cargando && leads.length === 0) {
    return (
      <div className="flex-1 space-y-px overflow-hidden" aria-busy="true" aria-label="Cargando leads">
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="flex h-[52px] items-center gap-2.5 border-b border-[var(--ls-linea)] px-3">
            <Esqueleto className="h-[15px] w-[15px] rounded-full" />
            <span className="flex-1 space-y-1.5">
              <Esqueleto className="h-[11px]" />
              <Esqueleto className="h-[9px] w-2/3" />
            </span>
          </div>
        ))}
      </div>
    )
  }

  if (leads.length === 0) return <div className="flex flex-1 items-center justify-center px-6 py-10">{vacio}</div>

  return (
    // `overflow-anchor: none`: el navegador no debe «anclar» el scroll a una fila cuando las de arriba entran y salen de la ventana
    <div ref={setContenedor} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]" role="list" aria-label="Leads">
      {/* LA VENTANA SE COLOCA CON RELLENOS Y NO CON `transform`. Antes era `translateY(inicio × alto)` y la regla global de app/globals.css anima
          el `transform` de TODOS los elementos (200 ms): cada vez que el scroll pasaba una fila, las pintadas se deslizaban hasta su sitio
          en vez de quedarse quietas, y eso es lo que se notaba como «va con lag». Con el relleno de arriba y el de abajo el alto total es el
          mismo (leads × alto) y no hay nada que animar */}
      <div key={generacion} style={{ paddingTop: inicio * ALTO_DE_FILA, paddingBottom: Math.max(0, leads.length - fin) * ALTO_DE_FILA }}>
        {leads.slice(inicio, fin).map((lead, i) => (
          <div role="listitem" key={lead.id}>
            <FilaDeLead lead={lead} activa={lead.id === seleccionado} hoy={hoy} mostrarLista={mostrarLista} onSeleccionar={onSeleccionar} entrada={conEntrada && inicio + i < 10 ? inicio + i : null} />
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La lista por secciones (la agenda de rellamadas)                    */
/* ------------------------------------------------------------------ */

export interface SeccionDeLista {
  id: string
  titulo: string
  /** Lo que se dice a la derecha del título: «las que llevan más tiempo cayéndose» */
  nota?: string
  tono: 'cian' | 'ambar' | 'gris'
  leads: readonly ColdLead[]
}

/**
 * Las rellamadas de un día, en secciones. Son pocas (las de un día), así que no lleva ventana: se pintan todas.
 */
export function ListaPorSecciones({ secciones, seleccionado, onSeleccionar, hoy, diaFestivos, vacio }: { secciones: readonly SeccionDeLista[]; seleccionado: string | null; onSeleccionar: (id: string) => void; hoy: string; diaFestivos?: string; vacio: ReactNode }) {
  const contenedor = useRef<HTMLDivElement>(null)

  // Si el lead seleccionado cambia con el teclado, que se vea
  useEffect(() => {
    if (!seleccionado) return
    contenedor.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [seleccionado])

  const total = secciones.reduce((n, s) => n + s.leads.length, 0)
  if (total === 0) return <div className="flex flex-1 items-center justify-center px-6 py-10">{vacio}</div>

  let entrada = 0
  return (
    <div ref={contenedor} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" role="list" aria-label="Rellamadas">
      {secciones
        .filter((s) => s.leads.length > 0)
        .map((s) => (
          <section key={s.id} aria-label={s.titulo}>
            <h3 className="sticky top-0 z-10 flex h-7 items-center gap-2 border-b border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 text-[11px] font-semibold text-[var(--ls-t3)]">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: COLOR_ESTADO[s.tono] }} />
              {s.titulo}
              <span className="tabular-nums text-[var(--ls-t4)]">{s.leads.length}</span>
              {s.nota && <span className="ml-auto font-normal text-[var(--ls-t4)]">{s.nota}</span>}
            </h3>
            {s.leads.map((lead) => (
              <div role="listitem" key={lead.id}>
                <FilaDeLead lead={lead} activa={lead.id === seleccionado} hoy={hoy} diaFestivos={diaFestivos} mostrarLista={false} onSeleccionar={onSeleccionar} entrada={entrada++ < 10 ? entrada - 1 : null} />
              </div>
            ))}
          </section>
        ))}
    </div>
  )
}

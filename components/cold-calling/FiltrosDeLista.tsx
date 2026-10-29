'use client'

import { ArrowUpDown, Check, ChevronDown, Euro, Layers, Rocket, X } from 'lucide-react'
import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SIN_FILTROS, hayFiltros, type FiltrosDeCartera } from '@/lib/cold-calling/cartera'
import { ORDEN_DE_PRIORIDADES, PRIORIDADES_DE_PARTNER } from '@/lib/cold-calling/partners'
import { BOTON, CAMPO, COLOR_ESTADO } from '@/lib/estilo/denso'
import { COLD_NIVEL_LABELS, COLD_SORT_LABELS, COLD_SORT_LABELS_PARTNERS, COLD_STATUSES, COLD_STATUS_LABELS, type ColdLeadStatus, type ColdSort } from '@/lib/types/cold-leads'
import { ESTADO_VISUAL, GlifoDeEstado, TONO_DE_NIVEL, tinte, tonoDeLista } from './ui'

/**
 * LA FILA DE FILTROS: la lista de origen, el estado, el nivel, la facturación y el orden, en UNA sola fila.
 *
 * Antes eran tres filas de chips (estado, nivel, lista) y otra más de facturación, y ocupaban más que la lista de leads. Ahora:
 *   · la LISTA es un desplegable (una persona trabaja de una a cinco), no cinco botones;
 *   · los ESTADOS son chips de glifo y número que se ABREN al pulsarlos (escriben su nombre) SIN MOVER LA FILA: el grupo mide siempre lo mismo
 *     y reparte su ancho como un acordeón, así que lo que hay detrás no se desplaza;
 *   · el NIVEL solo existe cuando se mira una lista de tiendas, y la FACTURACIÓN solo cuando se mira una de vendedores de Amazon.
 *   · la PRIORIDAD (P1 a P4) y «Menciona Amazon» solo existen cuando hay partners en la lista que se mira: ni tienen nivel ni facturación, y su orden de trabajo es la prioridad
 *     (1 llamar primero · 2 segunda ronda · 3 solo email · 4 revisar) y, dentro de ella, los puntos.
 */

const PRESETS_DE_FACTURACION: ReadonlyArray<{ etiqueta: string; min: string; max: string }> = [
  { etiqueta: '+ de 100k', min: '100000', max: '' },
  { etiqueta: '50k – 100k', min: '50000', max: '100000' },
  { etiqueta: '20k – 50k', min: '20000', max: '50000' },
  { etiqueta: '- de 20k', min: '', max: '20000' },
]

const numero = (n: number) => n.toLocaleString('es-ES')

/**
 * LAS CAJITAS DE ESTADO SE ABREN Y LA FILA NO SE MUEVE.
 *
 * Cada cajita enseña glifo y número; la pulsada se «abre» y escribe además su nombre. Lo que se pidió es que eso no descuadre nada: antes
 * la abierta se ensanchaba y empujaba a todo lo que tenía detrás (los niveles, el recuento), que saltaba de sitio con cada clic.
 *
 * Ahora el grupo mide SIEMPRE lo mismo (512 px desde pantallas medianas) y reparte ese ancho como un acordeón: con todas cerradas las
 * siete miden igual (~70 px) y al abrir una esa crece (3 partes frente a 1) y las otras ceden lo justo.
 *
 * LA CUENTA, que no es la ingenua: el relleno y el borde de cada cajita (14 px) NO se reparten, solo el resto. Con 512 px de grupo, 24 de
 * huecos y 7 × 14 de relleno quedan 390 px por repartir: la abierta mide 14 + 390 × 3/9 = 144 px (cabe «Sin contactar», el nombre más largo,
 * que por eso los nombres son CORTOS) y cada cerrada 14 + 390/9 = 57 px (glifo, hueco y una cifra de hasta cuatro dígitos, «9999»). Una
 * cifra de cinco dígitos no cabría en una cerrada: si la cartera llega ahí, hay que subir el ancho del grupo y no el reparto. Medido en la
 * vista previa con las siete abiertas una a una: el grupo no se mueve ni un píxel y nada queda recortado.
 *
 * En pantallas estrechas (menos de `md`) las cajitas se parten en líneas y cada una mide lo que mida: allí no hay nada que descuadrar.
 */
const GRUPO_DE_ESTADOS = 'md:w-[512px] md:flex-nowrap'
const CAJITA_CERRADA = 'md:flex-[1_1_0%]'
const CAJITA_ABIERTA = 'md:flex-[3_1_0%]'
const ANIMACION_DE_CAJITA = '[transition:flex-grow_0.28s_cubic-bezier(0.22,0.8,0.3,1),background-color_0.2s,border-color_0.2s,color_0.2s]'
/** Los niveles miden lo mismo con una cifra que con cuatro («N1 5000» cabe): si su ancho cambiara con la cifra, la fila podría cambiar de línea al pulsar un estado */
const ANCHO_DE_NIVEL = 'w-[76px] justify-center'
const ANCHO_DE_TODOS = 'min-w-[88px] justify-center'

/** El chip de este módulo: el del sistema de diseño, con el anillo de foco en el acento y no el azul del navegador */
const CHIP = `${BOTON.chip} outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)]`

/** Lo que escribe la cajita abierta. CORTOS a propósito (ver arriba): el nombre completo sale al pasar el ratón */
const NOMBRE_CORTO: Record<ColdLeadStatus, string> = {
  pendiente: 'Sin contactar',
  no_contesta: 'No contesta',
  programado: 'Rellamada',
  email_enviado: 'Info enviada',
  seguimiento: 'Seguimiento',
  cita_cualificada: 'Cita',
  no_interesa: 'No interesa',
}

interface Props {
  filtros: FiltrosDeCartera
  onCambiar: (cambios: Partial<FiltrosDeCartera>) => void
  /** Cuántos hay de cada estado en la cartera de la persona */
  porEstado: ReadonlyMap<ColdLeadStatus, number>
  /** Cuántos leads tiene la persona en total */
  total: number
  listas: ReadonlyArray<[string, number]>
  niveles: Record<1 | 2 | 3, number>
  /** ¿Hay tiendas con nivel en la lista que se mira? Entonces hay filtro de nivel y NO de facturación */
  hayNiveles: boolean
  /** Cuántos partners hay de cada prioridad con los demás filtros puestos */
  prioridades: Record<1 | 2 | 3 | 4, number>
  /** ¿Hay partners en la lista que se mira? Entonces hay filtro de prioridad y de «Menciona Amazon» */
  hayPartners: boolean
  /** ¿Son TODOS partners? Entonces no hay facturación que filtrar y el orden habla de puntos y de prioridad */
  soloPartners: boolean
  /** Cuántos partners mencionan Amazon con los demás filtros puestos */
  mencionanAmazon: number
  /** Cuántos leads salen con lo que está puesto */
  coinciden: number
}

export function FiltrosDeLista({ filtros, onCambiar, porEstado, total, listas, niveles, hayNiveles, prioridades, hayPartners, soloPartners, mencionanAmazon, coinciden }: Props) {
  const [listaAbierta, setListaAbierta] = useState(false)
  const [rangoAbierto, setRangoAbierto] = useState(false)
  const rangoPuesto = filtros.minRev !== '' || filtros.maxRev !== ''

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {/* La lista de origen */}
      {listas.length > 0 && (
        <Popover open={listaAbierta} onOpenChange={setListaAbierta}>
          <PopoverTrigger asChild>
            <button type="button" className={`${CHIP} ${filtros.lista !== 'all' ? BOTON.chipEncendido : ''}`} aria-label="Lista de origen">
              <Layers className="h-3 w-3" aria-hidden />
              {filtros.lista === 'all' ? 'Todas las listas' : filtros.lista}
              <span className="tabular-nums text-[var(--ls-t4)]">{numero(filtros.lista === 'all' ? total : (listas.find(([n]) => n === filtros.lista)?.[1] ?? 0))}</span>
              <ChevronDown className="h-3 w-3 text-[var(--ls-t4)]" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="w-[260px] rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-1 text-[var(--ls-t2)] shadow-xl">
            {[['all', total] as const, ...listas].map(([nombre, cuantos]) => {
              const activa = filtros.lista === nombre
              return (
                <button
                  key={nombre}
                  type="button"
                  onClick={() => {
                    onCambiar({ lista: nombre })
                    setListaAbierta(false)
                  }}
                  className={`flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[12.5px] outline-none transition-colors focus-visible:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)] ${activa ? 'bg-[var(--ls-sel)] text-[var(--ls-t1)]' : 'hover:bg-[var(--ls-sup3)]'}`}
                >
                  {nombre === 'all' ? <span aria-hidden className="h-2 w-2 rounded-[2px] border border-[var(--ls-linea2)]" /> : <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: COLOR_ESTADO[tonoDeLista(nombre)] }} />}
                  <span className="min-w-0 flex-1 truncate">{nombre === 'all' ? 'Todas las listas' : nombre}</span>
                  <span className="tabular-nums text-[var(--ls-t4)]">{numero(cuantos)}</span>
                  {activa && <Check className="h-3.5 w-3.5 text-[var(--ls-acc)]" aria-hidden />}
                </button>
              )
            })}
          </PopoverContent>
        </Popover>
      )}

      <span aria-hidden className="hidden h-4 w-px bg-[var(--ls-linea2)] sm:block" />

      {/* El estado: glifo y número; el pulsado se abre y escribe su nombre */}
      <div role="group" aria-label="Estado" className="flex flex-wrap items-center gap-1 md:flex-nowrap">
        <button type="button" onClick={() => onCambiar({ estado: 'all' })} aria-pressed={filtros.estado === 'all'} className={`${CHIP} ${ANCHO_DE_TODOS} shrink-0 ${filtros.estado === 'all' ? BOTON.chipEncendido : ''}`}>
          Todos <span className="tabular-nums text-[var(--ls-t4)]">{numero(total)}</span>
        </button>
        <div className={`flex flex-wrap items-center gap-1 ${GRUPO_DE_ESTADOS}`}>
          {COLD_STATUSES.map((s) => {
            const activo = filtros.estado === s
            const cuantos = porEstado.get(s) ?? 0
            const { tono } = ESTADO_VISUAL[s]
            return (
              <button
                key={s}
                type="button"
                onClick={() => onCambiar({ estado: activo ? 'all' : s })}
                aria-pressed={activo}
                title={`${COLD_STATUS_LABELS[s]}: ${numero(cuantos)}`}
                className={`${CHIP} min-w-[64px] justify-center overflow-hidden !px-1.5 md:min-w-0 ${ANIMACION_DE_CAJITA} ${activo ? `${CAJITA_ABIERTA} !text-[var(--ls-t1)] font-medium` : CAJITA_CERRADA}`}
                style={activo ? { background: tinte(tono, 16), borderColor: COLOR_ESTADO[tono] } : undefined}
              >
                <GlifoDeEstado estado={s} tamano={12} />
                {activo && <span className="rend-desliza min-w-0 truncate">{NOMBRE_CORTO[s]}</span>}
                <span className={`shrink-0 tabular-nums ${activo ? 'text-[var(--ls-t2)]' : 'text-[var(--ls-t4)]'}`}>{numero(cuantos)}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* El nivel: solo en una lista de tiendas. Es su orden de trabajo, y por eso lleva la pista de qué hacer primero */}
      {hayNiveles && (
        <>
          <span aria-hidden className="hidden h-4 w-px bg-[var(--ls-linea2)] sm:block" />
          <div role="group" aria-label="Nivel" className="flex items-center gap-1">
            {([1, 2, 3] as const).map((nivel) => {
              const activo = filtros.nivel === nivel
              const tono = TONO_DE_NIVEL[nivel]
              return (
                <button
                  key={nivel}
                  type="button"
                  disabled={niveles[nivel] === 0}
                  onClick={() => onCambiar({ nivel: activo ? 'all' : nivel })}
                  aria-pressed={activo}
                  title={`Nivel ${nivel} · ${COLD_NIVEL_LABELS[nivel]}: ${numero(niveles[nivel])}`}
                  className={`${CHIP} ${ANCHO_DE_NIVEL} disabled:opacity-35 ${activo ? '!text-[var(--ls-t1)] font-medium' : ''}`}
                  style={activo ? { background: tinte(tono, 16), borderColor: COLOR_ESTADO[tono] } : undefined}
                >
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: COLOR_ESTADO[tono] }} />
                  N{nivel}
                  <span className="tabular-nums text-[var(--ls-t4)]">{numero(niveles[nivel])}</span>
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* La prioridad de los partners: es su orden de trabajo, y por eso es lo primero que se toca. Con la pista de qué significa cada una */}
      {hayPartners && (
        <>
          <span aria-hidden className="hidden h-4 w-px bg-[var(--ls-linea2)] sm:block" />
          <div role="group" aria-label="Prioridad" className="flex items-center gap-1">
            {ORDEN_DE_PRIORIDADES.map((prioridad) => {
              const activo = filtros.prioridad === prioridad
              const { corta, etiqueta, tono, pista } = PRIORIDADES_DE_PARTNER[prioridad]
              return (
                <button
                  key={prioridad}
                  type="button"
                  disabled={prioridades[prioridad] === 0}
                  onClick={() => onCambiar({ prioridad: activo ? 'all' : prioridad })}
                  aria-pressed={activo}
                  title={`Prioridad ${prioridad} · ${etiqueta}: ${numero(prioridades[prioridad])}. ${pista}`}
                  className={`${CHIP} ${ANCHO_DE_NIVEL} disabled:opacity-35 ${activo ? '!text-[var(--ls-t1)] font-medium' : ''}`}
                  style={activo ? { background: tinte(tono, 16), borderColor: COLOR_ESTADO[tono] } : undefined}
                >
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: COLOR_ESTADO[tono] }} />
                  {corta}
                  <span className="tabular-nums text-[var(--ls-t4)]">{numero(prioridades[prioridad])}</span>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={() => onCambiar({ mencionaAmazon: !filtros.mencionaAmazon })}
            aria-pressed={filtros.mencionaAmazon}
            disabled={mencionanAmazon === 0 && !filtros.mencionaAmazon}
            title={`Solo los partners cuya web menciona Amazon: ${numero(mencionanAmazon)}. Ya conocen el canal y entienden mejor de qué se les habla`}
            className={`${CHIP} disabled:opacity-35 ${filtros.mencionaAmazon ? BOTON.chipEncendido : ''}`}
          >
            <Rocket className="h-3 w-3" aria-hidden />
            Menciona Amazon
            <span className="tabular-nums text-[var(--ls-t4)]">{numero(mencionanAmazon)}</span>
          </button>
        </>
      )}

      {/* La facturación: solo en una lista de vendedores de Amazon. Ninguna tienda online tiene facturación observada, así que el rango
          las dejaría todas fuera y la pantalla se quedaría vacía sin explicar por qué. Y un partner tampoco tiene facturación: con una
          lista de solo partners no hay nada que filtrar por ahí */}
      {!hayNiveles && !soloPartners && (
        <Popover open={rangoAbierto} onOpenChange={setRangoAbierto}>
          <PopoverTrigger asChild>
            <button type="button" className={`${CHIP} ${rangoPuesto ? BOTON.chipEncendido : ''}`}>
              <Euro className="h-3 w-3" aria-hidden />
              {rangoPuesto ? `${filtros.minRev ? `${numero(Number(filtros.minRev))}` : '0'} – ${filtros.maxRev ? numero(Number(filtros.maxRev)) : '∞'}` : 'Facturación'}
              <ChevronDown className="h-3 w-3 text-[var(--ls-t4)]" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="w-[290px] space-y-2.5 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-3 text-[var(--ls-t2)] shadow-xl">
            <p className="text-[11.5px] leading-snug text-[var(--ls-t3)]">Facturación al mes, en euros. Los vendedores sin importe quedan fuera mientras haya un rango puesto.</p>
            <div className="flex items-center gap-2">
              <input value={filtros.minRev} onChange={(e) => onCambiar({ minRev: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" placeholder="desde" aria-label="Facturación desde" className={`${CAMPO.input} ${CAMPO.numero}`} />
              <span className="text-[var(--ls-t4)]">–</span>
              <input value={filtros.maxRev} onChange={(e) => onCambiar({ maxRev: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" placeholder="hasta" aria-label="Facturación hasta" className={`${CAMPO.input} ${CAMPO.numero}`} />
            </div>
            <div className="flex flex-wrap gap-1">
              {PRESETS_DE_FACTURACION.map((p) => {
                const activo = filtros.minRev === p.min && filtros.maxRev === p.max
                return (
                  <button key={p.etiqueta} type="button" onClick={() => onCambiar(activo ? { minRev: '', maxRev: '' } : { minRev: p.min, maxRev: p.max })} aria-pressed={activo} className={`${BOTON.chip} ${activo ? BOTON.chipEncendido : ''}`}>
                    {p.etiqueta}
                  </button>
                )
              })}
            </div>
            {rangoPuesto && (
              <button type="button" onClick={() => onCambiar({ minRev: '', maxRev: '' })} className="text-[11.5px] text-[var(--ls-t3)] underline underline-offset-2 hover:text-[var(--ls-t1)]">
                Quitar el rango
              </button>
            )}
          </PopoverContent>
        </Popover>
      )}

      {/* LO DE LA DERECHA MIDE SIEMPRE LO MISMO: recuento, quitar filtros y orden. Antes el recuento cambiaba de ancho con sus dígitos («32
          leads» / «2086 leads») y «Limpiar» aparecía y desaparecía: la fila cabía justa y, con cuatro dígitos o con un filtro puesto, este grupo
          saltaba a la línea de abajo y todo lo de debajo se movía. Ahora el recuento tiene el hueco de cinco dígitos, el botón de quitar filtros
          está siempre (invisible si no hay nada que quitar) y es un icono, y quien decide si cabe en la línea es solo el ancho de la ventana. */}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <span className="hidden w-[72px] text-right text-[11.5px] tabular-nums text-[var(--ls-t4)] md:inline-block">
          {numero(coinciden)} {coinciden === 1 ? 'lead' : 'leads'}
        </span>
        <button
          type="button"
          onClick={() => onCambiar({ ...SIN_FILTROS })}
          title="Quitar todos los filtros"
          aria-label="Quitar todos los filtros"
          tabIndex={hayFiltros(filtros) ? 0 : -1}
          className={`${CHIP} w-6 justify-center !px-0 ${hayFiltros(filtros) ? 'rend-entra' : 'invisible'}`}
        >
          <X className="h-3 w-3" aria-hidden />
        </button>
        {/* De ancho fijo: un <select> mide lo que su opción más larga en unos navegadores y lo que la elegida en otros, y no debe cambiar de ancho al ordenar */}
        <label className="relative inline-flex w-[144px] items-center" title="Ordenar la lista">
          <ArrowUpDown className="pointer-events-none absolute left-2 h-3 w-3 text-[var(--ls-t4)]" aria-hidden />
          <select value={filtros.orden} onChange={(e) => onCambiar({ orden: e.target.value as ColdSort })} aria-label="Ordenar la lista" className={`${CHIP} w-full cursor-pointer appearance-none text-ellipsis !pl-6 !pr-2`}>
            {(Object.keys(COLD_SORT_LABELS) as ColdSort[]).map((o) => (
              <option key={o} value={o} className="bg-[var(--ls-sup)]">
                {(soloPartners ? COLD_SORT_LABELS_PARTNERS : COLD_SORT_LABELS)[o]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}

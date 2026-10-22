'use client'

import { ArrowDown, ArrowUp, Loader2, Minus, TrendingDown, TrendingUp, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  contacto,
  sumarTotales,
  variacion,
  type Comparacion,
  type ResultadoDePersona,
  type Totales,
  type Variacion,
} from '@/lib/rendimiento/comparativa'
import { tiempoHablado } from '@/lib/rendimiento/metricas'
import { etiquetaDePeriodo, type Periodo } from '@/lib/rendimiento/periodos'
import { Tendencia } from './Tendencia'

/**
 * LA COMPARATIVA DEL EQUIPO: una fila por comercial con las cifras del periodo, lo que han cambiado frente a la
 * referencia y una miniatura de su tendencia. Es lo primero que ve quien supervisa.
 *
 *   · La barra de «Llamadas» mide a cada uno contra el que más ha llamado del equipo: es una comparación entre
 *     personas, no contra un objetivo (todavía no hay objetivos).
 *   · Los cambios son frente a la referencia de la barra de periodo: la semana anterior, el mes anterior o la
 *     media de los mismos días de la semana.
 *   · Las columnas se ordenan pulsando su cabecera. Un clic más las invierte y otro más devuelve el orden de siempre.
 *   · Un clic en una persona abre su panel.
 */

export interface FilaDeComparativa {
  id: string
  nombre: string
  /** Sin Rinkel vinculado no hay llamadas que contar: se pinta un guion, no un cero */
  vinculado: boolean
  resultado: ResultadoDePersona
}

interface Props {
  filas: FilaDeComparativa[]
  periodo: Periodo
  hoy: string
  comparacion: Comparacion | null
  /** La persona cuyo panel se está viendo; null si se mira a todo el equipo */
  seleccionada: string | null
  /** Quien mira es administrador: a quien no tiene Rinkel se le puede poner la clave desde su panel */
  puedeGestionar: boolean
  cargando: boolean
  onElegir: (id: string) => void
}

type Columna = 'nombre' | 'llamadas' | 'contacto' | 'conversaciones' | 'segundos' | 'whatsapp' | 'correos' | 'respuestas' | 'citas'

const COLUMNAS: ReadonlyArray<{ id: Exclude<Columna, 'nombre'>; texto: string; ayuda: string }> = [
  { id: 'llamadas', texto: 'Llamadas', ayuda: 'Llamadas hechas (salientes). La barra compara con quien más ha llamado' },
  { id: 'contacto', texto: 'Contacto', ayuda: 'Llamadas hechas que contestó una persona, entre las hechas (10 segundos o más; los contestadores no cuentan)' },
  { id: 'conversaciones', texto: 'Conv.', ayuda: 'Conversaciones por teléfono: contestadas de más de 1 minuto' },
  { id: 'segundos', texto: 'Al teléf.', ayuda: 'Tiempo al teléfono, sin los contestadores' },
  { id: 'whatsapp', texto: 'WhatsApp', ayuda: 'Conversaciones de WhatsApp: clientes distintos con los que se habló cada día, por muchas interacciones que se apunten' },
  { id: 'correos', texto: 'Correos', ayuda: 'Conversaciones por correo: clientes distintos con los que se habló cada día' },
  { id: 'respuestas', texto: 'Respuestas', ayuda: 'Clientes distintos que han contestado cada día' },
  { id: 'citas', texto: 'Citas', ayuda: 'Citas agendadas en la Agenda' },
]

const numero = (n: number) => Math.round(n).toLocaleString('es-ES')

/** Hay datos de teléfono si tiene Rinkel vinculado o, aunque lo haya desvinculado, ya tiene llamadas guardadas */
const tieneTelefono = (f: FilaDeComparativa) => f.vinculado || f.resultado.actual.llamadas + f.resultado.actual.recibidas > 0

function valorDe(t: Totales, col: Exclude<Columna, 'nombre'>): number {
  switch (col) {
    case 'llamadas':
      return t.llamadas
    case 'contacto':
      return contacto(t)
    case 'conversaciones':
      return t.conversaciones
    case 'segundos':
      return t.segundos
    case 'whatsapp':
      return t.whatsapp
    case 'correos':
      return t.correos
    case 'respuestas':
      return t.respuestas
    case 'citas':
      return t.citas
  }
}

function Cambio({ v, contra }: { v: Variacion | null; contra: string }) {
  if (!v || v.sentido === 'sinBase') return null
  const color = v.sentido === 'sube' ? 'text-emerald-400' : v.sentido === 'baja' ? 'text-red-400' : 'text-white/30'
  const Icono = v.sentido === 'sube' ? TrendingUp : v.sentido === 'baja' ? TrendingDown : Minus
  return (
    <span title={`Comparado con ${contra}`} className={`inline-flex items-center gap-0.5 text-[10px] font-medium whitespace-nowrap ${color}`}>
      <Icono className="h-2.5 w-2.5" aria-hidden /> {v.texto}
    </span>
  )
}

export function ComparativaDelEquipo({ filas, periodo, hoy, comparacion, seleccionada, puedeGestionar, cargando, onElegir }: Props) {
  const [orden, setOrden] = useState<{ col: Columna; descendente: boolean } | null>(null)
  const contra = comparacion?.texto ?? 'el periodo anterior'

  const conRinkel = filas.filter(tieneTelefono)
  const maximoDeLlamadas = conRinkel.reduce((m, f) => Math.max(m, f.resultado.actual.llamadas), 0)

  const ordenadas = useMemo(() => {
    if (!orden) return filas
    const signo = orden.descendente ? -1 : 1
    return [...filas].sort((a, b) => {
      if (orden.col === 'nombre') return signo * a.nombre.localeCompare(b.nombre, 'es')
      // Quien no tiene Rinkel no tiene llamadas que comparar: va siempre al final de las columnas de teléfono
      const esDeTelefono = orden.col === 'llamadas' || orden.col === 'contacto' || orden.col === 'conversaciones' || orden.col === 'segundos'
      if (esDeTelefono && tieneTelefono(a) !== tieneTelefono(b)) return tieneTelefono(a) ? -1 : 1
      return signo * (valorDe(a.resultado.actual, orden.col) - valorDe(b.resultado.actual, orden.col))
    })
  }, [filas, orden])

  const total = sumarTotales(filas.map((f) => f.resultado.actual))
  const totalDeTelefono = sumarTotales(conRinkel.map((f) => f.resultado.actual))
  // El total de llamadas se compara solo entre quienes tienen referencia, para no inflar el cambio con gente sin datos antes
  const conReferencia = conRinkel.filter((f) => f.resultado.base)
  const cambioDelTotal =
    conReferencia.length > 0
      ? variacion(
          conReferencia.reduce((s, f) => s + f.resultado.actual.llamadas, 0),
          conReferencia.reduce((s, f) => s + (f.resultado.base?.llamadas ?? 0), 0)
        )
      : null

  const pulsar = (col: Columna) =>
    setOrden((o) => {
      if (!o || o.col !== col) return { col, descendente: col !== 'nombre' }
      if (o.descendente === (col !== 'nombre')) return { col, descendente: col === 'nombre' }
      return null
    })

  const cabecera = 'font-medium text-[10px] uppercase tracking-wider text-white/35 pb-1.5 px-2'
  const celda = 'text-right tabular-nums px-2 py-2 border-t border-white/[0.06]'
  const muda = 'text-white/25'

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4" aria-label="Comparativa del equipo">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-2.5">
        <h2 className="text-[13px] font-semibold text-white flex items-center gap-2">
          <Users className="h-3.5 w-3.5 text-[#FF6600]" /> Equipo
          <span className="font-normal text-white/45"> · {etiquetaDePeriodo(periodo, hoy)}</span>
        </h2>
        <span className="text-[11px] text-white/35 flex items-center gap-1.5">
          {cargando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {comparacion ? `Cambios comparados con ${comparacion.texto}` : ''}
        </span>
      </div>

      <div className={`overflow-x-auto transition-opacity ${cargando ? 'opacity-60' : ''}`}>
        <table className="w-full min-w-[860px] text-[12px] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className={`${cabecera} text-left pl-0 pr-3 sticky left-0 z-10 bg-[#0c0c0c]`} aria-sort={orden?.col === 'nombre' ? (orden.descendente ? 'descending' : 'ascending') : 'none'}>
                <button type="button" onClick={() => pulsar('nombre')} className="uppercase tracking-wider hover:text-white/70 transition-colors">
                  Persona
                </button>
              </th>
              {COLUMNAS.map((c) => (
                <th key={c.id} title={c.ayuda} className={`${cabecera} text-right`} aria-sort={orden?.col === c.id ? (orden.descendente ? 'descending' : 'ascending') : 'none'}>
                  <button type="button" onClick={() => pulsar(c.id)} className="inline-flex items-center gap-0.5 uppercase tracking-wider hover:text-white/70 transition-colors">
                    {c.texto}
                    {orden?.col === c.id && (orden.descendente ? <ArrowDown className="h-2.5 w-2.5" /> : <ArrowUp className="h-2.5 w-2.5" />)}
                  </button>
                </th>
              ))}
              <th className={`${cabecera} text-right`} title="Llamadas por día laborable en los últimos periodos (en un día, sus últimos 7 laborables)">
                Tendencia
              </th>
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((f) => {
              const elegida = f.id === seleccionada
              const t = f.resultado.actual
              const base = f.resultado.base
              const hayTelefono = tieneTelefono(f)
              const cambioDeLlamadas = hayTelefono && comparacion ? variacion(t.llamadas, base ? base.llamadas : null) : null
              const cambioDeConversaciones = hayTelefono && comparacion ? variacion(t.conversaciones, base ? base.conversaciones : null) : null
              const anchoDeBarra = maximoDeLlamadas === 0 ? 0 : (t.llamadas / maximoDeLlamadas) * 100
              return (
                <tr key={f.id} onClick={() => onElegir(f.id)} className={`cursor-pointer transition-colors ${elegida ? 'bg-[#FF6600]/[0.08]' : 'hover:bg-white/[0.03]'}`}>
                  <th scope="row" className={`text-left font-medium pl-0 pr-3 py-2 border-t border-white/[0.06] sticky left-0 z-10 ${elegida ? 'text-white bg-[#1a120c]' : 'text-white/80 bg-[#0c0c0c]'}`}>
                    {/* Sin onClick propio: el clic (también el de teclado) sube a la fila, que es quien abre el panel */}
                    <button type="button" className="text-left hover:underline underline-offset-2">
                      {f.nombre}
                    </button>
                    {!f.vinculado && (
                      <span className={`ml-2 text-[10px] font-normal ${puedeGestionar ? 'text-[#FF6600]/70' : 'text-white/30'}`}>
                        {puedeGestionar ? 'sin Rinkel · vincular' : 'sin Rinkel'}
                      </span>
                    )}
                  </th>
                  <td className={`${celda} min-w-[130px]`}>
                    {hayTelefono ? (
                      <div>
                        <div className="flex items-center justify-end gap-2">
                          <Cambio v={cambioDeLlamadas} contra={contra} />
                          <span className="text-white font-semibold">{numero(t.llamadas)}</span>
                        </div>
                        <div className="mt-1 h-[3px] rounded-full bg-white/[0.06] overflow-hidden" aria-hidden>
                          <div className="h-full rounded-full bg-[#FF6600]/70" style={{ width: `${anchoDeBarra}%` }} />
                        </div>
                      </div>
                    ) : (
                      <span className={muda}>—</span>
                    )}
                  </td>
                  <td className={`${celda} ${hayTelefono && t.llamadas > 0 ? 'text-white/70' : muda}`}>{hayTelefono && t.llamadas > 0 ? `${Math.round(contacto(t) * 100)} %` : '—'}</td>
                  <td className={`${celda} ${hayTelefono ? 'text-white/70' : muda}`}>
                    {hayTelefono ? (
                      <span className="inline-flex items-center justify-end gap-2">
                        <Cambio v={cambioDeConversaciones} contra={contra} />
                        {numero(t.conversaciones)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={`${celda} ${hayTelefono ? 'text-white/70' : muda}`}>{hayTelefono ? tiempoHablado(t.segundos) : '—'}</td>
                  <td className={`${celda} text-white/70`}>{numero(t.whatsapp)}</td>
                  <td className={`${celda} text-white/70`}>{numero(t.correos)}</td>
                  <td className={`${celda} text-white/70`}>{numero(t.respuestas)}</td>
                  <td className={`${celda} text-white/70`}>{numero(t.citas)}</td>
                  <td className="px-2 py-1.5 border-t border-white/[0.06] text-right">
                    {hayTelefono ? <span className="inline-block align-middle"><Tendencia puntos={f.resultado.tendencia} /></span> : <span className={muda}>—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="text-left font-semibold text-white pl-0 pr-3 py-2 border-t border-white/15 sticky left-0 z-10 bg-[#0c0c0c]">
                Total
              </th>
              <td className="text-right tabular-nums font-semibold text-white px-2 py-2 border-t border-white/15">
                <span className="inline-flex items-center justify-end gap-2">
                  <Cambio v={cambioDelTotal} contra={contra} />
                  {numero(totalDeTelefono.llamadas)}
                </span>
              </td>
              <td className="text-right tabular-nums font-semibold text-white px-2 py-2 border-t border-white/15">{totalDeTelefono.llamadas > 0 ? `${Math.round(contacto(totalDeTelefono) * 100)} %` : '—'}</td>
              <td className="text-right tabular-nums font-semibold text-white px-2 py-2 border-t border-white/15">{numero(totalDeTelefono.conversaciones)}</td>
              <td className="text-right tabular-nums font-semibold text-white px-2 py-2 border-t border-white/15">{tiempoHablado(totalDeTelefono.segundos)}</td>
              <td className="text-right tabular-nums font-semibold text-white px-2 py-2 border-t border-white/15">{numero(total.whatsapp)}</td>
              <td className="text-right tabular-nums font-semibold text-white px-2 py-2 border-t border-white/15">{numero(total.correos)}</td>
              <td className="text-right tabular-nums font-semibold text-white px-2 py-2 border-t border-white/15">{numero(total.respuestas)}</td>
              <td className="text-right tabular-nums font-semibold text-white px-2 py-2 border-t border-white/15">{numero(total.citas)}</td>
              <td className="border-t border-white/15" />
            </tr>
            {filas.length > 1 && (
              <tr>
                <th scope="row" className="text-left font-normal text-white/50 pl-0 pr-3 py-1.5 sticky left-0 z-10 bg-[#0c0c0c]">
                  Media por persona
                </th>
                <td className="text-right tabular-nums text-white/50 px-2 py-1.5">{conRinkel.length > 0 ? numero(totalDeTelefono.llamadas / conRinkel.length) : '—'}</td>
                <td className="text-right tabular-nums text-white/50 px-2 py-1.5" />
                <td className="text-right tabular-nums text-white/50 px-2 py-1.5">{conRinkel.length > 0 ? numero(totalDeTelefono.conversaciones / conRinkel.length) : '—'}</td>
                <td className="text-right tabular-nums text-white/50 px-2 py-1.5">{conRinkel.length > 0 ? tiempoHablado(totalDeTelefono.segundos / conRinkel.length) : '—'}</td>
                <td className="text-right tabular-nums text-white/50 px-2 py-1.5">{numero(total.whatsapp / filas.length)}</td>
                <td className="text-right tabular-nums text-white/50 px-2 py-1.5">{numero(total.correos / filas.length)}</td>
                <td className="text-right tabular-nums text-white/50 px-2 py-1.5">{numero(total.respuestas / filas.length)}</td>
                <td className="text-right tabular-nums text-white/50 px-2 py-1.5">{numero(total.citas / filas.length)}</td>
                <td />
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      <p className="text-[10px] text-white/30 mt-2">
        Llamadas, contacto y tiempo salen de Rinkel. WhatsApp y correos son conversaciones —clientes distintos con los que se habló cada día, por muchas interacciones que se apunten— y salen, igual que las respuestas, de las notas de
        Cold Calling. Las citas, de la Agenda. Un clic en una persona abre su panel; un clic en una cabecera ordena.
      </p>
    </section>
  )
}

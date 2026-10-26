'use client'

import { ArrowDown, ArrowUp, Info, Loader2, Users } from 'lucide-react'
import { useMemo, useState, type CSSProperties } from 'react'
import {
  contacto,
  sumarTotales,
  variacion,
  type Comparacion,
  type ResultadoDePersona,
  type Totales,
} from '@/lib/rendimiento/comparativa'
import { tiempoHablado } from '@/lib/rendimiento/metricas'
import { etiquetaDePeriodo, type Periodo } from '@/lib/rendimiento/periodos'
import { Tendencia } from './Tendencia'
import { Avatar, CabeceraDePanel, Delta, NOTA_DE_PANEL, PANEL } from './ui'

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
 *
 * LA PRIMERA COLUMNA SE QUEDA FIJA al deslizar la tabla en pantallas estrechas, con el color OPACO de la tarjeta (el
 * token de superficie, no un negro suelto): si fuera transparente, las cifras que pasan por debajo la cruzarían.
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
  { id: 'llamadas', texto: 'Llamadas', ayuda: 'Clientes a los que se llamó (salientes): uno cuenta una vez al día aunque se le llame varias veces. La barra compara con quien más ha llamado' },
  { id: 'contacto', texto: 'Contacto', ayuda: 'Clientes llamados que contestaron en algún intento, entre los llamados (10 segundos o más; los contestadores no cuentan)' },
  { id: 'conversaciones', texto: 'Conv.', ayuda: 'Conversaciones por teléfono: clientes con una llamada contestada de más de 1 minuto' },
  { id: 'segundos', texto: 'Al teléfono', ayuda: 'Tiempo al teléfono, sin los contestadores' },
  { id: 'whatsapp', texto: 'WhatsApp', ayuda: 'Conversaciones de WhatsApp: clientes distintos con los que se habló cada día, por muchas interacciones que se apunten' },
  { id: 'correos', texto: 'Correos', ayuda: 'Conversaciones por correo: clientes distintos con los que se habló cada día' },
  { id: 'respuestas', texto: 'Respuestas', ayuda: 'Clientes distintos que han contestado cada día' },
  { id: 'citas', texto: 'Citas', ayuda: 'Citas agendadas en la Agenda' },
]

const COMO_SE_CUENTA =
  'Llamadas, contacto y tiempo salen de Rinkel: un cliente llamado varias veces el mismo día cuenta una sola llamada, y al día siguiente vuelve a contar. WhatsApp y correos son conversaciones —clientes distintos con los que se habló cada día, por muchas interacciones que se apunten— y salen, igual que las respuestas, de las notas de Cold Calling. Las citas, de la Agenda.'

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

  const cabecera = 'h-7 px-2.5 text-[11px] font-semibold whitespace-nowrap text-[var(--ls-t4)] bg-[var(--ls-sup2)] border-b border-[var(--ls-linea2)]'
  const celda = 'h-10 px-2.5 text-right tabular-nums whitespace-nowrap border-b border-[var(--ls-linea)] transition-colors'
  const pie = 'h-9 px-2.5 tabular-nums whitespace-nowrap font-semibold text-[var(--ls-t1)] bg-[var(--ls-sup2)] border-t border-[var(--ls-linea2)]'
  const muda = 'text-[var(--ls-t4)]'

  return (
    <section className={`${PANEL} rend-aparece overflow-hidden`} aria-label="Comparativa del equipo">
      <CabeceraDePanel
        icono={<Users className="h-3.5 w-3.5" />}
        titulo="Equipo"
        contexto={`· ${etiquetaDePeriodo(periodo, hoy)}`}
        derecha={
          <>
            {cargando && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ls-t4)]" aria-label="Cargando" />}
            {comparacion && <span className={NOTA_DE_PANEL}>Cambios frente a {comparacion.texto}</span>}
            <span title={COMO_SE_CUENTA} className="text-[var(--ls-t4)] hover:text-[var(--ls-t2)] transition-colors cursor-help">
              <Info className="h-3.5 w-3.5" aria-label="Cómo se cuenta cada cifra" />
            </span>
          </>
        }
      />

      <div className={`overflow-x-auto transition-opacity duration-300 ${cargando ? 'opacity-60' : ''}`}>
        <table className="w-full min-w-[860px] border-separate border-spacing-0 text-[12.5px]">
          <thead>
            <tr>
              <th className={`${cabecera} sticky left-0 z-10 text-left`} aria-sort={orden?.col === 'nombre' ? (orden.descendente ? 'descending' : 'ascending') : 'none'}>
                <button type="button" onClick={() => pulsar('nombre')} className="inline-flex items-center gap-0.5 hover:text-[var(--ls-t1)] transition-colors">
                  Persona
                  {orden?.col === 'nombre' && (orden.descendente ? <ArrowDown className="h-2.5 w-2.5" /> : <ArrowUp className="h-2.5 w-2.5" />)}
                </button>
              </th>
              {COLUMNAS.map((c) => (
                <th key={c.id} title={c.ayuda} className={`${cabecera} text-right`} aria-sort={orden?.col === c.id ? (orden.descendente ? 'descending' : 'ascending') : 'none'}>
                  <button type="button" onClick={() => pulsar(c.id)} className={`inline-flex items-center gap-0.5 transition-colors hover:text-[var(--ls-t1)] ${orden?.col === c.id ? 'text-[var(--ls-t1)]' : ''}`}>
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
            {ordenadas.map((f, indice) => {
              const elegida = f.id === seleccionada
              const t = f.resultado.actual
              const base = f.resultado.base
              const hayTelefono = tieneTelefono(f)
              const cambioDeLlamadas = hayTelefono && comparacion ? variacion(t.llamadas, base ? base.llamadas : null) : null
              const cambioDeConversaciones = hayTelefono && comparacion ? variacion(t.conversaciones, base ? base.conversaciones : null) : null
              const anchoDeBarra = maximoDeLlamadas === 0 ? 0 : (t.llamadas / maximoDeLlamadas) * 100
              const fondo = elegida ? 'bg-[var(--ls-sel)]' : 'group-hover:bg-[var(--ls-sup3)]'
              return (
                <tr key={f.id} onClick={() => onElegir(f.id)} className="group cursor-pointer rend-entra" style={{ '--d': indice } as CSSProperties}>
                  <th scope="row" className={`h-10 min-w-[200px] whitespace-nowrap px-2.5 text-left font-medium border-b border-[var(--ls-linea)] sticky left-0 z-10 transition-colors ${elegida ? 'bg-[var(--ls-sel)] text-[var(--ls-t1)]' : 'bg-[var(--ls-sup)] text-[var(--ls-t2)] group-hover:bg-[var(--ls-sup3)] group-hover:text-[var(--ls-t1)]'}`}>
                    <span className="flex items-center gap-2">
                      {elegida && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-[var(--ls-acc-graf)]" />}
                      <Avatar id={f.id} nombre={f.nombre} />
                      {/* Sin onClick propio: el clic (también el de teclado) sube a la fila, que es quien abre el panel */}
                      <button type="button" className="text-left hover:underline underline-offset-2 focus-visible:outline-none">
                        {f.nombre}
                      </button>
                      {!f.vinculado && (
                        <span className={`text-[10.5px] font-normal ${puedeGestionar ? 'text-[var(--ls-acc)]' : 'text-[var(--ls-t4)]'}`}>{puedeGestionar ? 'sin Rinkel · vincular' : 'sin Rinkel'}</span>
                      )}
                    </span>
                  </th>
                  <td className={`${celda} ${fondo} min-w-[150px]`}>
                    {hayTelefono ? (
                      <div>
                        <div className="flex items-center justify-end gap-2">
                          <Delta v={cambioDeLlamadas} contra={contra} />
                          <span className="font-semibold text-[var(--ls-t1)]">{numero(t.llamadas)}</span>
                        </div>
                        <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-[var(--ls-sup3)]" aria-hidden>
                          <div
                            className="rend-crece-x h-full rounded-full transition-[width] duration-700 ease-out bg-[linear-gradient(90deg,var(--ls-acc-graf),color-mix(in_srgb,var(--ls-acc-graf)_65%,white))]"
                            style={{ width: `${anchoDeBarra}%`, '--d': indice } as CSSProperties}
                          />
                        </div>
                      </div>
                    ) : (
                      <span className={muda}>—</span>
                    )}
                  </td>
                  <td className={`${celda} ${fondo} ${hayTelefono && t.llamadas > 0 ? 'text-[var(--ls-t2)]' : muda}`}>{hayTelefono && t.llamadas > 0 ? `${Math.round(contacto(t) * 100)} %` : '—'}</td>
                  <td className={`${celda} ${fondo} ${hayTelefono ? 'text-[var(--ls-t2)]' : muda}`}>
                    {hayTelefono ? (
                      <span className="inline-flex items-center justify-end gap-2">
                        <Delta v={cambioDeConversaciones} contra={contra} />
                        {numero(t.conversaciones)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={`${celda} ${fondo} ${hayTelefono ? 'text-[var(--ls-t2)]' : muda}`}>{hayTelefono ? tiempoHablado(t.segundos) : '—'}</td>
                  <td className={`${celda} ${fondo} text-[var(--ls-t2)]`}>{numero(t.whatsapp)}</td>
                  <td className={`${celda} ${fondo} text-[var(--ls-t2)]`}>{numero(t.correos)}</td>
                  <td className={`${celda} ${fondo} text-[var(--ls-t2)]`}>{numero(t.respuestas)}</td>
                  <td className={`${celda} ${fondo} text-[var(--ls-t2)]`}>{numero(t.citas)}</td>
                  <td className={`${celda} ${fondo} !py-0`}>
                    {hayTelefono ? (
                      <span className="inline-block align-middle">
                        <Tendencia puntos={f.resultado.tendencia} indice={indice} />
                      </span>
                    ) : (
                      <span className={muda}>—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className={`${pie} sticky left-0 z-10 text-left`}>
                Total
              </th>
              <td className={`${pie} text-right`}>
                <span className="inline-flex items-center justify-end gap-2">
                  <Delta v={cambioDelTotal} contra={contra} />
                  {numero(totalDeTelefono.llamadas)}
                </span>
              </td>
              <td className={`${pie} text-right`}>{totalDeTelefono.llamadas > 0 ? `${Math.round(contacto(totalDeTelefono) * 100)} %` : '—'}</td>
              <td className={`${pie} text-right`}>{numero(totalDeTelefono.conversaciones)}</td>
              <td className={`${pie} text-right`}>{tiempoHablado(totalDeTelefono.segundos)}</td>
              <td className={`${pie} text-right`}>{numero(total.whatsapp)}</td>
              <td className={`${pie} text-right`}>{numero(total.correos)}</td>
              <td className={`${pie} text-right`}>{numero(total.respuestas)}</td>
              <td className={`${pie} text-right`}>{numero(total.citas)}</td>
              <td className={pie} />
            </tr>
            {filas.length > 1 && (
              <tr className="text-[var(--ls-t4)]">
                <th scope="row" className="sticky left-0 z-10 h-8 bg-[var(--ls-sup)] px-2.5 text-left text-[12px] font-normal">
                  Media por persona
                </th>
                <td className="h-8 px-2.5 text-right tabular-nums">{conRinkel.length > 0 ? numero(totalDeTelefono.llamadas / conRinkel.length) : '—'}</td>
                <td className="h-8 px-2.5" />
                <td className="h-8 px-2.5 text-right tabular-nums">{conRinkel.length > 0 ? numero(totalDeTelefono.conversaciones / conRinkel.length) : '—'}</td>
                <td className="h-8 px-2.5 text-right tabular-nums">{conRinkel.length > 0 ? tiempoHablado(totalDeTelefono.segundos / conRinkel.length) : '—'}</td>
                <td className="h-8 px-2.5 text-right tabular-nums">{numero(total.whatsapp / filas.length)}</td>
                <td className="h-8 px-2.5 text-right tabular-nums">{numero(total.correos / filas.length)}</td>
                <td className="h-8 px-2.5 text-right tabular-nums">{numero(total.respuestas / filas.length)}</td>
                <td className="h-8 px-2.5 text-right tabular-nums">{numero(total.citas / filas.length)}</td>
                <td className="h-8" />
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      <p className="border-t border-[var(--ls-linea)] px-3 py-1.5 text-[11px] text-[var(--ls-t4)]">Pulsa a una persona para abrir su panel y una cabecera para ordenar. La barra de llamadas compara con quien más ha llamado.</p>
    </section>
  )
}

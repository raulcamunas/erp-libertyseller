'use client'

import { Loader2, Users } from 'lucide-react'
import { etiquetaDeDia } from '@/lib/rendimiento/dia'
import { tiempoHablado, type ActividadDeNotas, type ResumenDeLlamadas } from '@/lib/rendimiento/metricas'

/**
 * EL RESUMEN DEL EQUIPO EN UN DÍA: una fila por comercial con las mismas cifras que el panel de cada uno.
 * Solo lo ven quienes supervisan, y es lo que sustituye al recap diario que se montaba a mano.
 *
 * Un clic en una fila abre el panel de esa persona. El día es el que esté elegido en el calendario.
 */

export interface FilaDelEquipo {
  id: string
  nombre: string
  /** Sin Rinkel vinculado no hay llamadas que contar: se pinta un guion, no un cero */
  vinculado: boolean
  llamadas: ResumenDeLlamadas
  actividad: ActividadDeNotas
  citas: number
}

interface Props {
  filas: FilaDelEquipo[]
  dia: string
  hoy: string
  cargando: boolean
  /** La persona cuyo panel se está viendo */
  seleccionada: string
  /** Quien mira es administrador: a quien no tiene Rinkel se le puede poner la clave desde su panel */
  puedeGestionar?: boolean
  onElegir: (id: string) => void
}

const numero = (n: number) => n.toLocaleString('es-ES')

const CABECERAS: ReadonlyArray<{ clave: string; texto: string; ayuda?: string; alineacion?: string }> = [
  { clave: 'llamadas', texto: 'Llamadas', ayuda: 'Llamadas hechas (salientes)' },
  { clave: 'contestadas', texto: 'Contest.', ayuda: 'Llamadas hechas que se contestaron' },
  { clave: 'conversaciones', texto: 'Conv.', ayuda: 'Conversaciones: contestadas de más de 1 minuto' },
  { clave: 'tiempo', texto: 'Al teléf.', ayuda: 'Tiempo al teléfono' },
  { clave: 'whatsapp', texto: 'WhatsApp', ayuda: 'Conversaciones de WhatsApp: clientes distintos con los que se habló ese día, por muchas interacciones que se apunten' },
  { clave: 'correos', texto: 'Correos', ayuda: 'Conversaciones por correo: clientes distintos con los que se habló ese día' },
  { clave: 'respuestas', texto: 'Respuestas', ayuda: 'Clientes distintos que han contestado ese día' },
  { clave: 'citas', texto: 'Citas' },
]

export function ResumenDelEquipo({ filas, dia, hoy, cargando, seleccionada, puedeGestionar = false, onElegir }: Props) {
  const conRinkel = filas.filter((f) => f.vinculado)
  const suma = (f: (x: FilaDelEquipo) => number) => filas.reduce((s, x) => s + f(x), 0)
  const sumaLlamadas = (f: (x: FilaDelEquipo) => number) => conRinkel.reduce((s, x) => s + f(x), 0)

  const total = {
    llamadas: sumaLlamadas((f) => f.llamadas.realizadas),
    contestadas: sumaLlamadas((f) => f.llamadas.contestadas),
    conversaciones: sumaLlamadas((f) => f.llamadas.conversaciones),
    segundos: sumaLlamadas((f) => f.llamadas.segundosHablados),
    whatsapp: suma((f) => f.actividad.whatsapp),
    correos: suma((f) => f.actividad.correos),
    respuestas: suma((f) => f.actividad.respuestas),
    citas: suma((f) => f.citas),
  }

  const nombreDelDia = dia === hoy ? 'hoy' : etiquetaDeDia(dia)

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4" aria-label={`Resumen del equipo ${nombreDelDia}`}>
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <h2 className="text-[13px] font-semibold text-white flex items-center gap-2">
          <Users className="h-3.5 w-3.5 text-[#FF6600]" /> Equipo
          <span className="font-normal text-white/45"> · {nombreDelDia}</span>
        </h2>
        {cargando && <Loader2 className="h-3.5 w-3.5 animate-spin text-white/40" />}
      </div>

      <div className={`overflow-x-auto transition-opacity ${cargando ? 'opacity-60' : ''}`}>
        <table className="w-full min-w-[640px] text-[12px] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="text-left font-medium text-[10px] uppercase tracking-wider text-white/35 pb-1.5 pr-3">Persona</th>
              {CABECERAS.map((c) => (
                <th key={c.clave} title={c.ayuda} className="text-right font-medium text-[10px] uppercase tracking-wider text-white/35 pb-1.5 px-2">
                  {c.texto}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const elegida = f.id === seleccionada
              const celda = 'text-right tabular-nums px-2 py-2 border-t border-white/[0.06]'
              return (
                <tr
                  key={f.id}
                  onClick={() => onElegir(f.id)}
                  className={`cursor-pointer transition-colors ${elegida ? 'bg-[#FF6600]/[0.08]' : 'hover:bg-white/[0.03]'}`}
                >
                  <th scope="row" className={`text-left font-medium pr-3 py-2 border-t border-white/[0.06] ${elegida ? 'text-white' : 'text-white/80'}`}>
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
                  <td className={`${celda} ${f.vinculado ? 'text-white font-semibold' : 'text-white/25'}`}>{f.vinculado ? numero(f.llamadas.realizadas) : '—'}</td>
                  <td className={`${celda} ${f.vinculado ? 'text-white/70' : 'text-white/25'}`}>{f.vinculado ? numero(f.llamadas.contestadas) : '—'}</td>
                  <td className={`${celda} ${f.vinculado ? 'text-white/70' : 'text-white/25'}`}>{f.vinculado ? numero(f.llamadas.conversaciones) : '—'}</td>
                  <td className={`${celda} ${f.vinculado ? 'text-white/70' : 'text-white/25'}`}>{f.vinculado ? tiempoHablado(f.llamadas.segundosHablados) : '—'}</td>
                  <td className={`${celda} text-white/70`}>{numero(f.actividad.whatsapp)}</td>
                  <td className={`${celda} text-white/70`}>{numero(f.actividad.correos)}</td>
                  <td className={`${celda} text-white/70`}>{numero(f.actividad.respuestas)}</td>
                  <td className={`${celda} text-white/70`}>{numero(f.citas)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="text-left font-semibold text-white pr-3 py-2 border-t border-white/15">
                Total
              </th>
              {[
                numero(total.llamadas),
                numero(total.contestadas),
                numero(total.conversaciones),
                tiempoHablado(total.segundos),
                numero(total.whatsapp),
                numero(total.correos),
                numero(total.respuestas),
                numero(total.citas),
              ].map((v, i) => (
                <td key={i} className="text-right tabular-nums font-semibold text-white px-2 py-2 border-t border-white/15">
                  {v}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-[10px] text-white/30 mt-2">
        Llamadas, contestadas y tiempo salen de Rinkel. WhatsApp y correos son conversaciones —clientes distintos con los que se habló ese día, por muchas interacciones que se apunten— y salen, igual que las respuestas, de las notas de Cold Calling. Las citas, de la Agenda. Un clic en una persona abre su panel.
      </p>
    </section>
  )
}

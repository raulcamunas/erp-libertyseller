'use client'

import { Loader2, Mic, PhoneIncoming, PhoneMissed, PhoneOff, PhoneOutgoing, Play } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { etiquetaDeDia, horaMadrid } from '@/lib/rendimiento/dia'
import { duracionCorta, esContestador, estaContestada } from '@/lib/rendimiento/metricas'
import { telefonoLegible } from '@/lib/rendimiento/telefonos'
import { ReproductorGrabacion } from './ReproductorGrabacion'
import type { LlamadaGuardada } from './tipos'

/**
 * LAS LLAMADAS DE UN DÍA, de la última a la primera, con su grabación.
 *
 * Una grabación se abre debajo de su llamada y solo hay una abierta a la vez: al abrir otra se cierra la
 * anterior, para que no suenen dos conversaciones a la vez.
 *
 * LA TARJETA NO CRECE CON LAS LLAMADAS: en pantallas anchas mide lo que le dan (el panel la pone al lado del calendario y
 * las dos miden lo mismo) y la lista hace scroll por dentro; en pantallas estrechas llega a 480 px y también hace scroll.
 * Así el bloque de debajo no se mueve tenga el día pocas llamadas o cientos.
 */

export interface NombreDeLead {
  nombre: string
  empresa: string | null
}

interface Props {
  dia: string
  hoy: string
  llamadas: LlamadaGuardada[]
  /** Nombre de la tienda de cada lead (cold_leads) al que se llamó, por su id */
  nombres: ReadonlyMap<string, NombreDeLead>
  cargando: boolean
  sinRinkel: boolean
  esPropio: boolean
  /** Si se mira una semana o un mes: pasar a mirar solo este día. Sin esto no se ofrece */
  onAislarDia?: () => void
}

type Filtro = 'todas' | 'contestadas' | 'sin_contestar' | 'recibidas'

const FILTROS: ReadonlyArray<{ id: Filtro; etiqueta: string; ayuda?: string }> = [
  { id: 'todas', etiqueta: 'Todas' },
  { id: 'contestadas', etiqueta: 'Contestadas', ayuda: 'Las que contestó una persona: duran 10 segundos o más' },
  { id: 'sin_contestar', etiqueta: 'Sin contestar', ayuda: 'Incluye los contestadores automáticos: las que duran menos de 10 segundos' },
  { id: 'recibidas', etiqueta: 'Recibidas' },
]

const contestada = estaContestada
const recibida = (l: LlamadaGuardada) => l.direccion === 'inbound'

const CUMPLE: Record<Filtro, (l: LlamadaGuardada) => boolean> = {
  todas: () => true,
  contestadas: contestada,
  sin_contestar: (l) => !contestada(l),
  recibidas: recibida,
}

function IconoDeLlamada({ llamada }: { llamada: LlamadaGuardada }) {
  const ok = contestada(llamada)
  if (recibida(llamada)) {
    return ok ? <PhoneIncoming className="h-4 w-4 text-sky-400" /> : <PhoneMissed className="h-4 w-4 text-red-400" />
  }
  return ok ? <PhoneOutgoing className="h-4 w-4 text-emerald-400" /> : <PhoneOff className="h-4 w-4 text-white/30" />
}

function textoDeEstado(l: LlamadaGuardada): string {
  if (contestada(l)) return recibida(l) ? 'Recibida' : 'Contestada'
  // Rinkel la da por contestada pero duró menos de 10 s: un contestador automático
  if (esContestador(l)) return recibida(l) ? 'Perdida' : 'Contestador'
  return recibida(l) ? 'Perdida' : 'Sin contestar'
}

const grabacionCaducada = (l: LlamadaGuardada) => l.grabacion_hasta !== null && Date.parse(l.grabacion_hasta) < Date.now()

export function ListaLlamadas({ dia, hoy, llamadas, nombres, cargando, sinRinkel, esPropio, onAislarDia }: Props) {
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [abierta, setAbierta] = useState<string | null>(null)

  // Al cambiar de día no se arrastra ni la grabación abierta ni un filtro que ya no tiene nada
  useEffect(() => {
    setAbierta(null)
    setFiltro('todas')
  }, [dia])

  const ordenadas = useMemo(() => [...llamadas].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0)), [llamadas])
  const cuantas = useMemo(
    () => Object.fromEntries(FILTROS.map((f) => [f.id, ordenadas.filter(CUMPLE[f.id]).length])) as Record<Filtro, number>,
    [ordenadas]
  )
  const visibles = useMemo(() => ordenadas.filter(CUMPLE[filtro]), [ordenadas, filtro])

  const nombreDelDia = dia === hoy ? 'de hoy' : `del ${etiquetaDeDia(dia)}`

  return (
    <div id="llamadas-del-dia" className="scroll-mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4 flex flex-col min-h-0 h-full max-h-[480px] lg:max-h-none">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <h2 className="text-[13px] font-semibold text-white">Llamadas {nombreDelDia}</h2>
        <span className="text-[12px] text-white/40 flex items-center gap-2 tabular-nums">
          {cargando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {llamadas.length > 0 && `${llamadas.length.toLocaleString('es-ES')} en total`}
          {onAislarDia && (
            <button type="button" onClick={onAislarDia} className="text-white/50 hover:text-white underline underline-offset-2 transition-colors">
              Ver solo este día
            </button>
          )}
        </span>
      </div>

      {llamadas.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2.5" role="group" aria-label="Filtrar llamadas">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltro(f.id)}
              aria-pressed={filtro === f.id}
              title={f.ayuda}
              disabled={f.id !== 'todas' && cuantas[f.id] === 0}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors disabled:opacity-30 ${
                filtro === f.id ? 'border-[#FF6600]/50 bg-[#FF6600]/15 text-white' : 'border-white/10 text-white/50 hover:text-white/80'
              }`}
            >
              {f.etiqueta} <span className="text-white/40 tabular-nums">{cuantas[f.id]}</span>
            </button>
          ))}
        </div>
      )}

      {visibles.length === 0 ? (
        <p className="text-[12px] text-white/35 py-6 text-center leading-relaxed">
          {sinRinkel
            ? esPropio
              ? 'Todavía no hay llamadas. Vincula tu clave de Rinkel arriba y se leerán todas.'
              : 'Esta persona no ha vinculado su Rinkel, así que no hay llamadas que enseñar.'
            : llamadas.length === 0
              ? 'Ese día no hay llamadas.'
              : 'Ninguna llamada con ese filtro.'}
        </p>
      ) : (
        <ul className="space-y-1.5 overflow-y-auto pr-0.5 flex-1 min-h-0">
          {visibles.map((l) => {
            const lead = l.lead_id ? nombres.get(l.lead_id) : undefined
            const telefono = l.numero ? telefonoLegible(l.numero) : l.numero_anonimo ? 'Número oculto' : 'Sin número'
            const conGrabacion = l.grabacion_id !== null
            const caducada = conGrabacion && grabacionCaducada(l)
            const abierto = abierta === l.id

            return (
              <li key={l.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                <div className="flex items-center gap-3">
                  <span className="shrink-0" title={textoDeEstado(l)}>
                    <IconoDeLlamada llamada={l} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-white truncate">{lead ? lead.nombre : telefono}</p>
                    <p className="text-[11px] text-white/40 truncate">
                      {lead ? `${telefono}${lead.empresa ? ` · ${lead.empresa}` : ''}` : textoDeEstado(l)}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-[12px] text-white/80 tabular-nums">{horaMadrid(l.fecha)}</p>
                    <p className="text-[11px] text-white/40 tabular-nums">
                      {contestada(l)
                        ? duracionCorta(l.duracion_s)
                        : esContestador(l)
                          ? lead
                            ? `Contestador · ${duracionCorta(l.duracion_s)}`
                            : duracionCorta(l.duracion_s)
                          : lead
                            ? textoDeEstado(l)
                            : '—'}
                    </p>
                  </div>

                  {conGrabacion &&
                    (caducada ? (
                      <span className="shrink-0 w-[84px] text-center text-[10px] text-white/25" title="Rinkel guarda las grabaciones 90 días">
                        Caducada
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAbierta(abierto ? null : l.id)}
                        aria-expanded={abierto}
                        className={`shrink-0 w-[84px] h-8 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors ${
                          abierto
                            ? 'border-[#FF6600]/60 bg-[#FF6600]/20 text-white'
                            : 'border-white/10 text-white/70 hover:border-[#FF6600]/40 hover:text-white'
                        }`}
                      >
                        {abierto ? <Mic className="h-3.5 w-3.5 text-[#FF6600]" /> : <Play className="h-3.5 w-3.5" />}
                        Escuchar
                      </button>
                    ))}
                </div>

                {abierto && <ReproductorGrabacion llamadaId={l.id} onCerrar={() => setAbierta(null)} />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

'use client'

import { Loader2, Mic, PhoneIncoming, PhoneMissed, PhoneOff, PhoneOutgoing, Play, Voicemail } from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { etiquetaDeDia, horaMadrid } from '@/lib/rendimiento/dia'
import { duracionCorta, esContestador, estaContestada } from '@/lib/rendimiento/metricas'
import { telefonoLegible } from '@/lib/rendimiento/telefonos'
import { ReproductorGrabacion } from './ReproductorGrabacion'
import type { LlamadaGuardada } from './tipos'
import { CabeceraDePanel, ChipDeFiltro, PANEL } from './ui'

/**
 * LAS LLAMADAS DE UN DÍA, de la última a la primera, con su grabación.
 *
 * Una grabación se abre debajo de su llamada y solo hay una abierta a la vez: al abrir otra se cierra la
 * anterior, para que no suenen dos conversaciones a la vez.
 *
 * LA TARJETA NO CRECE CON LAS LLAMADAS: en pantallas anchas mide lo que le dan (el panel la pone al lado del calendario y
 * las dos miden lo mismo) y la lista hace scroll por dentro; en pantallas estrechas llega a 480 px y también hace scroll.
 * Así el bloque de debajo no se mueve tenga el día pocas llamadas o cientos.
 *
 * CADA LLAMADA lleva un icono con el color de lo que pasó (verde: la contestó alguien; cian: recibida; gris: nadie o
 * un contestador; rojo: perdida), siempre con su palabra al lado: el color nunca va solo.
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

/** El icono de una llamada y el color de lo que pasó en ella */
function EstadoDeLlamada({ llamada }: { llamada: LlamadaGuardada }) {
  let Icono = PhoneOutgoing
  let color: string = COLOR_ESTADO.verde
  if (recibida(llamada)) {
    Icono = contestada(llamada) ? PhoneIncoming : PhoneMissed
    color = contestada(llamada) ? COLOR_ESTADO.cian : COLOR_ESTADO.rojo
  } else if (!contestada(llamada)) {
    Icono = esContestador(llamada) ? Voicemail : PhoneOff
    color = COLOR_ESTADO.gris
  }
  return (
    <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px]" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
      <Icono className="h-3.5 w-3.5" aria-hidden />
    </span>
  )
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
    <div id="llamadas-del-dia" className={`${PANEL} rend-aparece scroll-mt-4 flex h-full max-h-[480px] min-h-0 flex-col overflow-hidden lg:max-h-none`} style={{ '--d': 1 } as CSSProperties}>
      <CabeceraDePanel
        titulo={`Llamadas ${nombreDelDia}`}
        derecha={
          <span className="flex items-center gap-2 text-[11.5px] tabular-nums text-[var(--ls-t4)]">
            {cargando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {llamadas.length > 0 && `${llamadas.length.toLocaleString('es-ES')} en total`}
            {onAislarDia && (
              <button type="button" onClick={onAislarDia} className="text-[var(--ls-t3)] underline underline-offset-2 transition-colors hover:text-[var(--ls-t1)]">
                Ver solo este día
              </button>
            )}
          </span>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col p-3 pt-2.5">
        {llamadas.length > 0 && (
          <div className="mb-2.5 flex flex-wrap gap-1" role="group" aria-label="Filtrar llamadas">
            {FILTROS.map((f) => (
              <ChipDeFiltro key={f.id} activo={filtro === f.id} deshabilitado={f.id !== 'todas' && cuantas[f.id] === 0} onClick={() => setFiltro(f.id)} ayuda={f.ayuda}>
                {f.etiqueta} <span className="tabular-nums text-[var(--ls-t4)]">{cuantas[f.id]}</span>
              </ChipDeFiltro>
            ))}
          </div>
        )}

        {visibles.length === 0 ? (
          <p className="py-6 text-center text-[12px] leading-relaxed text-[var(--ls-t4)]">
            {sinRinkel
              ? esPropio
                ? 'Todavía no hay llamadas. Vincula tu clave de Rinkel arriba y se leerán todas.'
                : 'Esta persona no ha vinculado su Rinkel, así que no hay llamadas que enseñar.'
              : llamadas.length === 0
                ? 'Ese día no hay llamadas.'
                : 'Ninguna llamada con ese filtro.'}
          </p>
        ) : (
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
            {visibles.map((l, i) => {
              const lead = l.lead_id ? nombres.get(l.lead_id) : undefined
              const telefono = l.numero ? telefonoLegible(l.numero) : l.numero_anonimo ? 'Número oculto' : 'Sin número'
              const conGrabacion = l.grabacion_id !== null
              const caducada = conGrabacion && grabacionCaducada(l)
              const abierto = abierta === l.id

              return (
                <li key={l.id} className={`rend-entra rounded-[8px] border transition-colors ${abierto ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-sup2)]' : 'border-transparent bg-[var(--ls-sup)] hover:border-[var(--ls-linea)] hover:bg-[var(--ls-sup2)]'}`} style={{ '--d': Math.min(i, 14) } as CSSProperties}>
                  <div className="flex items-center gap-2.5 px-2 py-1.5">
                    <span title={textoDeEstado(l)}>
                      <EstadoDeLlamada llamada={l} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] text-[var(--ls-t1)]">{lead ? lead.nombre : telefono}</p>
                      <p className="truncate text-[11px] text-[var(--ls-t4)]">{lead ? `${telefono}${lead.empresa ? ` · ${lead.empresa}` : ''}` : textoDeEstado(l)}</p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-[12px] tabular-nums text-[var(--ls-t2)]">{horaMadrid(l.fecha)}</p>
                      <p className="text-[11px] tabular-nums text-[var(--ls-t4)]">
                        {contestada(l) ? duracionCorta(l.duracion_s) : esContestador(l) ? (lead ? `Contestador · ${duracionCorta(l.duracion_s)}` : duracionCorta(l.duracion_s)) : lead ? textoDeEstado(l) : '—'}
                      </p>
                    </div>

                    {conGrabacion &&
                      (caducada ? (
                        <span className="w-[78px] shrink-0 text-center text-[10.5px] text-[var(--ls-t4)]" title="Rinkel guarda las grabaciones 90 días">
                          Caducada
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setAbierta(abierto ? null : l.id)}
                          aria-expanded={abierto}
                          className={`flex h-7 w-[78px] shrink-0 items-center justify-center gap-1.5 rounded-[6px] border text-[11.5px] font-medium transition-colors ${
                            abierto
                              ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] text-[var(--ls-t1)]'
                              : 'border-[var(--ls-linea)] text-[var(--ls-t2)] hover:border-[var(--ls-acc-graf)] hover:text-[var(--ls-t1)]'
                          }`}
                        >
                          {abierto ? <Mic className="h-3.5 w-3.5 text-[var(--ls-acc)]" /> : <Play className="h-3.5 w-3.5" />}
                          Escuchar
                        </button>
                      ))}
                  </div>

                  {abierto && (
                    <div className="px-2 pb-2">
                      <ReproductorGrabacion llamadaId={l.id} onCerrar={() => setAbierta(null)} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

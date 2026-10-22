'use client'

import { CalendarCheck, ChevronDown, MessageSquareReply } from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ETIQUETA_DE_CANAL, agruparConversaciones, citasAgendadas, etiquetaDeEstadoDeCita, itemsDeActividad, respuestasDe, type FiltroDeActividad } from '@/lib/rendimiento/actividad'
import { contacto, variacion, variacionDePuntos, type Variacion } from '@/lib/rendimiento/comparativa'
import { diaMadrid, etiquetaDeDia } from '@/lib/rendimiento/dia'
import { formatoDe, horarioSemanal, mapaHorario, textoDePausa, valorDe, METRICAS, type DiaDeSemana, type Metrica, type ResultadoSemanal, type Semana } from '@/lib/rendimiento/informe'
import { eventosDeLinea, type EventoDeLinea } from '@/lib/rendimiento/linea'
import { nombreDelDia } from '@/lib/rendimiento/periodos'
import type { CitaConComercial, LlamadaDeEquipo, NotaConAutor } from '../lecturas'
import { LineaDelDia } from '../LineaDelDia'
import { ListaDeActividad } from '../ListaDeActividad'
import type { NombreDeLead } from '../ListaLlamadas'
import { Avatar, ChipDeFiltro, Delta, MiniBarras, Numero, PANEL } from '../ui'
import { BarrasDeLaSemana, LeyendaDeBarras } from './BarrasDeLaSemana'
import { MapaDeFranjas } from './MapaDeFranjas'

/**
 * UNA PERSONA EN EL INFORME: SUS CIFRAS, Y AL ABRIRLA, TODO LO QUE HIZO LA SEMANA.
 *
 * Cerrada es una fila con sus ocho cifras y su cambio frente a la semana anterior. Abierta enseña, de arriba abajo:
 * la cifra elegida día a día contra la semana anterior, su horario (a qué hora empezó, acabó y cuánto paró cada
 * día), en qué horas llama, la línea de cualquier día de la semana, lo que consiguió (las citas que agendó y lo que
 * contestaron los clientes) y todas sus conversaciones con el comentario de cada una.
 *
 * Lo que pesa —construir la línea de cada día, el mapa de horas, las listas— solo se calcula mientras está abierta.
 */

const corto = (dia: string) => `${nombreDelDia(dia).slice(0, 3)} ${Number(dia.slice(8))}`

function agruparPorDia<T>(lista: readonly T[], instante: (x: T) => string): Map<string, T[]> {
  const grupos = new Map<string, T[]>()
  for (const x of lista) {
    const dia = diaMadrid(instante(x))
    const grupo = grupos.get(dia)
    if (grupo) grupo.push(x)
    else grupos.set(dia, [x])
  }
  return grupos
}

function Dato({ etiqueta, valor, bruto, formato, cambio, contra }: { etiqueta: string; valor: string; bruto?: number; formato?: (n: number) => string; cambio: Variacion | null; contra: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-[var(--ls-t4)]">{etiqueta}</p>
      <p className="text-[15px] font-semibold leading-tight tabular-nums text-[var(--ls-t1)]">{bruto === undefined ? valor : <Numero valor={bruto} formato={formato} />}</p>
      <div className="min-h-[18px]">{cambio && <Delta v={cambio} contra={contra} />}</div>
    </div>
  )
}

interface Props {
  resultado: ResultadoSemanal
  semana: Semana
  dias: DiaDeSemana[]
  contra: string
  metrica: Metrica
  abierta: boolean
  onAlternar: () => void
  /** El día que se mira en su línea del día; sin él, el de más actividad */
  dia: string | undefined
  onDia: (dia: string) => void
  llamadas: readonly LlamadaDeEquipo[]
  notas: readonly NotaConAutor[]
  citas: readonly CitaConComercial[]
  /** El nombre de cada cliente por su id; los que no estén se piden con `onPedirNombres` */
  nombres: ReadonlyMap<string, NombreDeLead>
  onPedirNombres: (ids: string[]) => void
  /** Minutos desde las 00:00 de ahora mismo si se mira la semana en curso */
  ahora: number | null
  /** El puesto de la persona en la lista: marca el escalón de la animación de entrada */
  indice?: number
}

export function PersonaDelInforme({ resultado, semana, dias, contra, metrica, abierta, onAlternar, dia, onDia, llamadas, notas, citas, nombres, onPedirNombres, ahora, indice = 0 }: Props) {
  const { persona, actual, base } = resultado
  const tasa = contacto(actual)
  const cambio = (a: number, b: number | undefined): Variacion | null => (base ? variacion(a, b ?? 0) : variacion(a, null))
  const n = (x: number) => Math.round(x).toLocaleString('es-ES')

  // El detalle se monta la primera vez que se abre y ya no se desmonta: así se puede plegar y desplegar con animación
  // de altura sin volver a calcularlo todo; mientras está plegado no se ve ni se puede enfocar
  const [yaAbierta, setYaAbierta] = useState(abierta)
  useEffect(() => {
    if (abierta) setYaAbierta(true)
  }, [abierta])

  return (
    <section id={`persona-${persona.id}`} className={`${PANEL} rend-aparece scroll-mt-20 overflow-hidden`} style={{ '--d': indice } as CSSProperties} aria-label={`Informe de ${persona.nombre}`}>
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={abierta}
        aria-controls={`detalle-${persona.id}`}
        className="flex w-full flex-wrap items-center gap-x-6 gap-y-3 px-3.5 py-3 text-left transition-colors hover:bg-[var(--ls-sup2)]"
      >
        <div className="flex min-w-[200px] items-center gap-2.5 lg:w-[220px]">
          <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--ls-t4)] transition-transform duration-300 ${abierta ? 'rotate-180' : ''}`} aria-hidden />
          <Avatar id={persona.id} nombre={persona.nombre} tamano={28} />
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-semibold text-[var(--ls-t1)]">{persona.nombre}</p>
            {!persona.vinculado && <p className="text-[10.5px] text-[var(--ls-e-ambar)]">Sin Rinkel: sus llamadas no se cuentan</p>}
          </div>
        </div>

        <div className="grid min-w-[260px] flex-1 grid-cols-4 gap-x-4 gap-y-3 sm:grid-cols-8">
          <Dato etiqueta="Llamadas" valor={n(actual.llamadas)} bruto={actual.llamadas} cambio={cambio(actual.llamadas, base?.llamadas)} contra={contra} />
          <Dato etiqueta="Contacto" valor={actual.llamadas === 0 ? '—' : `${Math.round(tasa * 100)} %`} bruto={actual.llamadas === 0 ? undefined : Math.round(tasa * 100)} formato={(x) => `${Math.round(x)} %`} cambio={actual.llamadas === 0 ? null : variacionDePuntos(tasa, base ? contacto(base) : null)} contra={contra} />
          <Dato etiqueta="Conversaciones" valor={n(actual.conversaciones)} bruto={actual.conversaciones} cambio={cambio(actual.conversaciones, base?.conversaciones)} contra={contra} />
          <Dato etiqueta="Tiempo" valor={formatoDe('tiempo', actual.segundos)} bruto={actual.segundos} formato={(x) => formatoDe('tiempo', x)} cambio={cambio(actual.segundos, base?.segundos)} contra={contra} />
          <Dato etiqueta="WhatsApp" valor={n(actual.whatsapp)} bruto={actual.whatsapp} cambio={cambio(actual.whatsapp, base?.whatsapp)} contra={contra} />
          <Dato etiqueta="Correos" valor={n(actual.correos)} bruto={actual.correos} cambio={cambio(actual.correos, base?.correos)} contra={contra} />
          <Dato etiqueta="Respuestas" valor={n(actual.respuestas)} bruto={actual.respuestas} cambio={cambio(actual.respuestas, base?.respuestas)} contra={contra} />
          <Dato etiqueta="Citas" valor={n(actual.citas)} bruto={actual.citas} cambio={cambio(actual.citas, base?.citas)} contra={contra} />
        </div>

        <div className="hidden shrink-0 xl:block">
          <MiniBarras
            valores={semana.dias.map((d, i) => (d > semana.hoy ? null : resultado.dias[i].llamadas))}
            anteriores={semana.dias.map((d, i) => (d > semana.hoy ? null : resultado.anteriores[i].llamadas))}
            etiquetas={dias.map((d) => d.etiqueta)}
            formato={n}
            alto={30}
            nombre={`Llamadas de ${persona.nombre}`}
          />
        </div>
      </button>

      <div
        id={`detalle-${persona.id}`}
        className={`grid transition-[grid-template-rows,visibility] duration-300 ease-out ${abierta ? 'visible grid-rows-[1fr]' : 'invisible grid-rows-[0fr]'}`}
        aria-hidden={!abierta}
      >
        <div className="min-h-0 overflow-hidden">
          {yaAbierta && (
            <div className="border-t border-[var(--ls-linea)] p-4 sm:p-5">
              <DetalleDePersona
                resultado={resultado}
                semana={semana}
                dias={dias}
                metrica={metrica}
                dia={dia}
                onDia={onDia}
                llamadas={llamadas}
                notas={notas}
                citas={citas}
                nombres={nombres}
                onPedirNombres={onPedirNombres}
                ahora={ahora}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

type PropsDelDetalle = Omit<Props, 'contra' | 'abierta' | 'onAlternar'>

function DetalleDePersona({ resultado, semana, dias, metrica, dia, onDia, llamadas, notas, citas, nombres, onPedirNombres, ahora }: PropsDelDetalle) {
  const { persona } = resultado
  const [verConversaciones, setVerConversaciones] = useState(false)
  const [filtro, setFiltro] = useState<FiltroDeActividad>('todo')

  const cliente = (id: string) => nombres.get(id)?.nombre ?? null
  const info = METRICAS.find((m) => m.id === metrica) ?? METRICAS[0]
  const formato = (x: number) => formatoDe(metrica, x)

  const conversaciones = useMemo(() => agruparConversaciones(notas), [notas])
  const listaDeCitas = useMemo(() => citasAgendadas(citas), [citas])
  const respuestas = useMemo(() => respuestasDe(conversaciones), [conversaciones])
  const items = useMemo(() => itemsDeActividad(conversaciones, listaDeCitas), [conversaciones, listaDeCitas])
  const clientesQueContestaron = useMemo(() => new Set(respuestas.map((r) => `${r.dia}|${r.leadId}`)).size, [respuestas])

  // Lo de cada día, por dónde cayó: las llamadas por su hora, las notas por la suya y las citas por cuándo se agendaron
  const delDia = useMemo(
    () => ({ llamadas: agruparPorDia(llamadas, (l) => l.fecha), notas: agruparPorDia(notas, (x) => x.occurred_at), citas: agruparPorDia(citas, (c) => c.created_at) }),
    [llamadas, notas, citas]
  )

  const eventosPorDia = useMemo(() => {
    const mapa = new Map<string, EventoDeLinea[]>()
    for (const d of semana.dias) {
      mapa.set(
        d,
        eventosDeLinea({
          llamadas: delDia.llamadas.get(d) ?? [],
          notas: delDia.notas.get(d) ?? [],
          citas: delDia.citas.get(d) ?? [],
          cliente: (id) => nombres.get(id)?.nombre ?? null,
        })
      )
    }
    return mapa
  }, [semana.dias, delDia, nombres])

  const horario = useMemo(() => horarioSemanal(eventosPorDia, semana.dias), [eventosPorDia, semana.dias])
  const mapa = useMemo(() => mapaHorario(llamadas, semana.dias), [llamadas, semana.dias])

  // El día de la línea: el que se pulsó, o el de más actividad (el último si empatan)
  const diaElegido = useMemo(() => {
    if (dia && semana.dias.includes(dia)) return dia
    let mejor = semana.dias.filter((d) => d <= semana.hoy).slice(-1)[0] ?? semana.lunes
    let mas = -1
    for (const d of semana.dias) {
      if (d > semana.hoy) continue
      const cuantos = eventosPorDia.get(d)?.length ?? 0
      if (cuantos >= mas && cuantos > 0) {
        mejor = d
        mas = cuantos
      }
    }
    return mejor
  }, [dia, semana.dias, semana.hoy, semana.lunes, eventosPorDia])

  const idsNecesarios = useMemo(() => {
    const ids = new Set<string>()
    for (const x of notas) ids.add(x.lead_id)
    for (const l of delDia.llamadas.get(diaElegido) ?? []) if (l.lead_id) ids.add(l.lead_id)
    return [...ids]
  }, [notas, delDia, diaElegido])
  useEffect(() => {
    if (idsNecesarios.length > 0) onPedirNombres(idsNecesarios)
  }, [idsNecesarios, onPedirNombres])

  const diasConCosas = semana.dias.filter((d, i) => (d <= semana.hoy && !dias[i].finDeSemana) || (eventosPorDia.get(d)?.length ?? 0) > 0)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[12px] font-semibold text-[var(--ls-t2)]">
              {info.etiqueta}, día a día
            </h3>
            <LeyendaDeBarras />
          </div>
          <BarrasDeLaSemana
            dias={dias}
            actual={semana.dias.map((d, i) => (d > semana.hoy ? null : valorDe(resultado.dias[i], metrica)))}
            anterior={semana.dias.map((d, i) => (d > semana.hoy ? null : valorDe(resultado.anteriores[i], metrica)))}
            formato={formato}
            alto={96}
            nombre={`${info.etiqueta} de ${persona.nombre}`}
          />
        </div>

        <div className="space-y-2.5">
          <h3 className="text-[12px] font-semibold text-[var(--ls-t2)]">Horario</h3>
          <p className="text-[12px] text-[var(--ls-t3)] leading-snug">
            {horario.inicioMedio && horario.finMedio ? (
              <>
                Suele empezar a las <span className="text-[var(--ls-t2)] font-medium tabular-nums">{horario.inicioMedio}</span> y acabar a las <span className="text-[var(--ls-t2)] font-medium tabular-nums">{horario.finMedio}</span>{' '}
                <span className="text-[var(--ls-t4)]">(media de {horario.diasConActividad} {horario.diasConActividad === 1 ? 'jornada' : 'jornadas'})</span>.
              </>
            ) : (
              'No hay ninguna jornada con actividad suficiente para decir cuándo empieza y acaba.'
            )}
          </p>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[11px] font-semibold text-[var(--ls-t4)]">
                <th className="pb-1 text-left font-semibold">Día</th>
                <th className="pb-1 text-right font-semibold">Empezó</th>
                <th className="pb-1 text-right font-semibold">Acabó</th>
                <th className="pb-1 text-right font-semibold">Hueco más largo</th>
                <th className="pb-1 text-right font-semibold">Apuntes</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {horario.dias
                .filter((h) => diasConCosas.includes(h.dia))
                .map((h) => (
                  <tr key={h.dia} className="border-t border-[var(--ls-linea)]">
                    <td className="py-1 text-[var(--ls-t3)]">{corto(h.dia)}</td>
                    <td className="py-1 text-right text-[var(--ls-t2)]">{h.primera ?? '—'}</td>
                    <td className="py-1 text-right text-[var(--ls-t2)]">{h.ultima ?? '—'}</td>
                    <td className={`py-1 text-right ${h.pausaMasLarga >= 90 ? 'text-[var(--ls-e-ambar)]' : 'text-[var(--ls-t3)]'}`}>{textoDePausa(h.pausaMasLarga)}</td>
                    <td className="py-1 text-right text-[var(--ls-t4)]">{h.eventos}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="text-[10px] text-[var(--ls-t4)]">Cuenta llamadas, WhatsApp, correos, respuestas y citas. Un hueco es un rato de media hora o más sin nada.</p>
        </div>
      </div>

      <div className="space-y-2.5">
        <h3 className="text-[12px] font-semibold text-[var(--ls-t2)]">En qué horas llama</h3>
        <MapaDeFranjas mapa={mapa} dias={dias} compacto />
      </div>

      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Elegir el día de la línea">
          <h3 className="text-[12px] font-semibold text-[var(--ls-t2)] mr-2">Línea del día</h3>
          {diasConCosas.map((d) => {
            const cuantos = eventosPorDia.get(d)?.length ?? 0
            return (
              <ChipDeFiltro key={d} activo={d === diaElegido} onClick={() => onDia(d)}>
                {corto(d)} <span className="tabular-nums text-[var(--ls-t4)]">{cuantos}</span>
              </ChipDeFiltro>
            )
          })}
        </div>
        <LineaDelDia titulo={`${persona.nombre} · ${corto(diaElegido)}`} eventos={eventosPorDia.get(diaElegido) ?? []} ahora={diaElegido === semana.hoy ? ahora : null} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="space-y-2.5">
          <h3 className="text-[12px] font-semibold text-[var(--ls-t2)] flex items-center gap-2">
            <CalendarCheck className="h-3.5 w-3.5 text-[var(--ls-e-violeta)]" /> Citas agendadas <span className="text-[var(--ls-t4)] font-normal">{listaDeCitas.length}</span>
          </h3>
          {listaDeCitas.length === 0 ? (
            <p className="text-[12px] text-[var(--ls-t4)]">Ninguna cita esta semana.</p>
          ) : (
            <ul className="space-y-1.5 max-h-[340px] overflow-y-auto pr-0.5">
              {listaDeCitas.map((c, i) => (
                <li key={c.id} className="rend-entra rounded-[6px] border border-l-2 border-[var(--ls-linea)] border-l-[var(--ls-e-violeta)] bg-[var(--ls-sup2)] px-3 py-2" style={{ '--d': Math.min(i, 10) } as CSSProperties}>
                  <p className="text-[13px] text-[var(--ls-t1)] flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{c.cliente}</span>
                    {c.empresa && <span className="text-[var(--ls-t4)]">{c.empresa}</span>}
                    <span className="rounded-full bg-[var(--ls-sup3)] px-1.5 py-px text-[10px] text-[var(--ls-t3)]">{etiquetaDeEstadoDeCita(c.estado)}</span>
                  </p>
                  <p className="text-[11px] text-[var(--ls-t4)] mt-0.5">
                    Agendada el {corto(c.dia)} a las {c.hora} · es para el {etiquetaDeDia(c.paraDia)} a las {c.paraHora}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2.5">
          <h3 className="text-[12px] font-semibold text-[var(--ls-t2)] flex items-center gap-2">
            <MessageSquareReply className="h-3.5 w-3.5 text-[var(--ls-acc)]" /> Lo que contestaron los clientes <span className="text-[var(--ls-t4)] font-normal">{clientesQueContestaron} {clientesQueContestaron === 1 ? 'cliente' : 'clientes'}</span>
          </h3>
          {respuestas.length === 0 ? (
            <p className="text-[12px] text-[var(--ls-t4)]">Ningún cliente contestó (o no se marcó la casilla «Es una respuesta del cliente» en Cold Calling).</p>
          ) : (
            <ul className="space-y-1.5 max-h-[340px] overflow-y-auto pr-0.5">
              {respuestas.map((r, i) => (
                <li key={r.id} className="rend-entra rounded-[6px] border border-l-2 border-[var(--ls-linea)] border-l-[var(--ls-acc-graf)] bg-[var(--ls-sup2)] px-3 py-2" style={{ '--d': Math.min(i, 10) } as CSSProperties}>
                  <p className="text-[11px] text-[var(--ls-t4)]">
                    {corto(r.dia)} · {r.hora} · {ETIQUETA_DE_CANAL[r.canal]}
                  </p>
                  <p className="text-[13px] text-[var(--ls-t2)] leading-snug mt-0.5 break-words">
                    <span className="font-medium text-[var(--ls-t1)]">{cliente(r.leadId) ?? 'Cliente'}</span>: {r.texto ? `«${r.texto}»` : <span className="text-[var(--ls-t4)] italic">sin comentario</span>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setVerConversaciones((v) => !v)}
          aria-expanded={verConversaciones}
          className="flex items-center gap-2 text-[12px] font-semibold text-[var(--ls-t2)] hover:text-[var(--ls-t1)] transition-colors"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${verConversaciones ? 'rotate-180' : ''}`} aria-hidden />
          Todas las conversaciones y comentarios <span className="text-[var(--ls-t4)] font-normal">{items.length}</span>
        </button>
        {verConversaciones && (
          <ListaDeActividad
            persona={persona.nombre}
            periodo={{ tipo: 'semana', ancla: semana.lunes }}
            hoy={semana.hoy}
            items={items}
            filtro={filtro}
            onFiltro={setFiltro}
            nombres={nombres}
            cargando={false}
            clave={`${persona.id}|${semana.lunes}`}
            sinMarco
            anclaId={null}
          />
        )}
      </div>
    </div>
  )
}

'use client'

import { CalendarCheck, ChevronDown, ChevronsDownUp, ChevronsUpDown, Linkedin, Loader2, Mail, MessageCircle, Phone, StickyNote, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  ETIQUETA_DE_CANAL,
  FILTROS_DE_ACTIVIDAD,
  contarPorFiltro,
  etiquetaDeEstadoDeCita,
  filtrarActividad,
  type Canal,
  type CitaAgendada,
  type Conversacion,
  type FiltroDeActividad,
  type ItemDeActividad,
} from '@/lib/rendimiento/actividad'
import { etiquetaDeDia, sumarDias } from '@/lib/rendimiento/dia'
import { etiquetaDePeriodo, type Periodo } from '@/lib/rendimiento/periodos'
import type { NombreDeLead } from './ListaLlamadas'

/**
 * EL DETALLE DE LA ACTIVIDAD: CON QUIÉN HABLÓ CADA PERSONA Y QUÉ APUNTÓ EN CADA MOMENTO.
 *
 * Las tarjetas dicen cuántas conversaciones hubo; esto dice con quién. Una conversación es un cliente, en un canal y
 * en un día (da igual cuántos apuntes se hayan hecho), y al abrirla salen todos, con su hora y su comentario. Las
 * respuestas de los clientes van marcadas, y las citas dicen cuándo se agendaron y para cuándo son.
 *
 * Los días salen del más reciente al más antiguo; dentro de un día, por hora, como un diario.
 */

const POR_PAGINA = 60

const ICONO_DE_CANAL: Record<Canal, { Icono: LucideIcon; color: string }> = {
  whatsapp: { Icono: MessageCircle, color: 'text-green-400' },
  correo: { Icono: Mail, color: 'text-sky-400' },
  linkedin: { Icono: Linkedin, color: 'text-blue-400' },
  llamada: { Icono: Phone, color: 'text-emerald-400' },
  nota: { Icono: StickyNote, color: 'text-white/50' },
}

const AYUDA_DE_FILTRO: Partial<Record<FiltroDeActividad, string>> = {
  respuestas: 'Clientes que contestaron: un cliente que contesta por dos canales el mismo día cuenta una vez',
  otras: 'LinkedIn, llamadas anotadas a mano y notas sueltas',
}

const primeraMayuscula = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t)

interface Props {
  persona: string
  periodo: Periodo
  hoy: string
  /** Todo lo del periodo, sin filtrar: de ahí salen los números de los botones */
  items: ItemDeActividad[]
  filtro: FiltroDeActividad
  onFiltro: (f: FiltroDeActividad) => void
  /** El nombre de cada cliente por su id; el que no esté aquí se enseña como «Cliente» */
  nombres: ReadonlyMap<string, NombreDeLead>
  cargando: boolean
  /** No se pudo leer: se dice, porque una lista vacía sería una afirmación falsa */
  error?: string | null
  /** Cambia al cambiar de persona o de periodo: cierra lo abierto y vuelve a la primera página */
  clave: string
}

function TarjetaDeConversacion({ c, cliente, abierta, onAlternar }: { c: Conversacion; cliente: NombreDeLead | undefined; abierta: boolean; onAlternar: () => void }) {
  const { Icono, color } = ICONO_DE_CANAL[c.canal]
  const n = c.interacciones.length
  // Lo que se ve sin abrir: lo que contestó el cliente, si contestó (es lo que importa); si no, el primer apunte
  const destacada = c.interacciones.find((i) => i.esRespuesta) ?? c.interacciones[0]
  const expandible = n > 1 || destacada.texto.length > 140
  const horas = c.desde === c.hasta ? c.desde : `${c.desde} – ${c.hasta}`

  return (
    <li className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 shrink-0 ${color}`} title={ETIQUETA_DE_CANAL[c.canal]}>
          <Icono className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[13px] text-white truncate max-w-full">{cliente?.nombre || 'Cliente'}</p>
            {c.hayRespuesta && <span className="rounded-full bg-[#FF6600]/15 border border-[#FF6600]/30 px-1.5 py-px text-[10px] font-medium text-[#FF8A3D]">Contestó</span>}
            {n > 1 && <span className="rounded-full bg-white/[0.06] px-1.5 py-px text-[10px] text-white/50">{n} interacciones</span>}
          </div>
          <p className="text-[11px] text-white/40 truncate">
            {ETIQUETA_DE_CANAL[c.canal]}
            {cliente?.empresa ? ` · ${cliente.empresa}` : ''}
          </p>

          {!abierta && destacada.texto && (
            <p className="mt-1.5 text-[12px] text-white/65 leading-snug line-clamp-2 break-words">
              {destacada.esRespuesta && <span className="font-medium text-[#FF8A3D]">Cliente: </span>}
              {destacada.texto}
            </p>
          )}

          {abierta && (
            <ol className="mt-2 space-y-1.5 border-l border-white/10 pl-3">
              {c.interacciones.map((i) => (
                <li key={i.id} className="text-[12px] leading-snug">
                  <p className="flex items-center gap-2 text-[11px]">
                    <span className="font-semibold text-white/80 tabular-nums">{i.hora}</span>
                    <span className={i.esRespuesta ? 'font-medium text-[#FF8A3D]' : 'text-white/35'}>{i.esRespuesta ? 'Contestó el cliente' : 'Apunte'}</span>
                  </p>
                  <p className={`mt-0.5 whitespace-pre-wrap break-words ${i.texto ? 'text-white/70' : 'text-white/25 italic'}`}>{i.texto || 'Sin comentario'}</p>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex shrink-0 items-start gap-1.5">
          <p className="text-[12px] text-white/70 tabular-nums pt-0.5">{horas}</p>
          {expandible && (
            <button
              type="button"
              onClick={onAlternar}
              aria-expanded={abierta}
              aria-label={abierta ? 'Cerrar la conversación' : 'Abrir la conversación'}
              className="rounded-md p-1 text-white/40 hover:bg-white/[0.06] hover:text-white transition-colors"
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${abierta ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

function TarjetaDeCita({ c }: { c: CitaAgendada }) {
  return (
    <li className="rounded-xl border border-violet-400/20 bg-violet-400/[0.04] px-3 py-2.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-violet-400" title="Cita agendada">
          <CalendarCheck className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[13px] text-white truncate max-w-full">{c.cliente}</p>
            <span className="rounded-full bg-violet-400/15 border border-violet-400/30 px-1.5 py-px text-[10px] font-medium text-violet-300">Cita agendada</span>
            <span className="rounded-full bg-white/[0.06] px-1.5 py-px text-[10px] text-white/50">{etiquetaDeEstadoDeCita(c.estado)}</span>
          </div>
          <p className="text-[11px] text-white/40 truncate">{c.empresa ?? 'Sin empresa'}</p>
          <p className="mt-1.5 text-[12px] text-white/65 leading-snug">
            Es para el <span className="text-white/85">{etiquetaDeDia(c.paraDia)}</span> a las <span className="text-white/85 tabular-nums">{c.paraHora}</span>
          </p>
        </div>
        <p className="shrink-0 text-[12px] text-white/70 tabular-nums pt-0.5" title="Hora a la que se agendó">
          {c.hora}
        </p>
      </div>
    </li>
  )
}

function resumenDelDia(items: ItemDeActividad[]): string {
  const conversaciones = items.filter((i) => i.tipo === 'conversacion').length
  const citas = items.length - conversaciones
  const partes: string[] = []
  if (conversaciones > 0) partes.push(`${conversaciones} ${conversaciones === 1 ? 'conversación' : 'conversaciones'}`)
  if (citas > 0) partes.push(`${citas} ${citas === 1 ? 'cita' : 'citas'}`)
  return partes.join(' · ')
}

export function ListaDeActividad({ persona, periodo, hoy, items, filtro, onFiltro, nombres, cargando, error = null, clave }: Props) {
  const [limite, setLimite] = useState(POR_PAGINA)
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(new Set())

  // Otra persona u otro periodo: no se arrastra lo que había abierto ni la página en la que se estaba
  useEffect(() => {
    setLimite(POR_PAGINA)
    setAbiertas(new Set())
  }, [clave])
  useEffect(() => {
    setLimite(POR_PAGINA)
  }, [filtro])

  const cuenta = useMemo(() => contarPorFiltro(items), [items])
  const visibles = useMemo(() => filtrarActividad(items, filtro), [items, filtro])

  const { dias, grupos, restantes } = useMemo(() => {
    const recortados = [...visibles].reverse().slice(0, limite).reverse()
    const porDia = new Map<string, ItemDeActividad[]>()
    for (const i of recortados) {
      const lista = porDia.get(i.dia)
      if (lista) lista.push(i)
      else porDia.set(i.dia, [i])
    }
    return { dias: [...porDia.keys()].sort().reverse(), grupos: porDia, restantes: Math.max(0, visibles.length - recortados.length) }
  }, [visibles, limite])

  const expandibles = useMemo(
    () => visibles.flatMap((i) => (i.tipo === 'conversacion' && (i.conversacion.interacciones.length > 1 || (i.conversacion.interacciones[0]?.texto.length ?? 0) > 140) ? [i.conversacion.clave] : [])),
    [visibles]
  )
  const todoAbierto = expandibles.length > 0 && expandibles.every((k) => abiertas.has(k))

  const alternar = (k: string) =>
    setAbiertas((antes) => {
      const ahora = new Set(antes)
      if (!ahora.delete(k)) ahora.add(k)
      return ahora
    })

  const etiquetaDelDia = (dia: string) => (dia === hoy ? 'Hoy' : dia === sumarDias(hoy, -1) ? 'Ayer' : primeraMayuscula(etiquetaDeDia(dia)))

  return (
    <section id="detalle-actividad" className="scroll-mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4" aria-label="Detalle de la actividad">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-2.5">
        <h2 className="text-[13px] font-semibold text-white">Detalle de la actividad</h2>
        <p className="text-[12px] text-white/40 flex items-center gap-2">
          {cargando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <span className="truncate">
            {persona} · {etiquetaDePeriodo(periodo, hoy)}
          </span>
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar la actividad">
          {FILTROS_DE_ACTIVIDAD.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onFiltro(f.id)}
              aria-pressed={filtro === f.id}
              title={AYUDA_DE_FILTRO[f.id]}
              disabled={f.id !== 'todo' && cuenta[f.id] === 0}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors disabled:opacity-30 ${
                filtro === f.id ? 'border-[#FF6600]/50 bg-[#FF6600]/15 text-white' : 'border-white/10 text-white/50 hover:text-white/80'
              }`}
            >
              {f.etiqueta} <span className="text-white/40 tabular-nums">{cuenta[f.id]}</span>
            </button>
          ))}
        </div>
        {expandibles.length > 0 && (
          <button
            type="button"
            onClick={() => setAbiertas(todoAbierto ? new Set() : new Set(expandibles))}
            className="flex items-center gap-1.5 text-[11px] text-white/50 hover:text-white transition-colors"
          >
            {todoAbierto ? <ChevronsDownUp className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
            {todoAbierto ? 'Cerrar todo' : 'Abrir todo'}
          </button>
        )}
      </div>

      {visibles.length === 0 ? (
        <p className={`text-[12px] py-6 text-center leading-relaxed ${error ? 'text-amber-300' : 'text-white/35'}`} role={error ? 'alert' : undefined}>
          {error
            ? error
            : cargando
              ? 'Leyendo la actividad…'
            : items.length === 0
              ? 'No hay nada apuntado en este periodo. Aquí salen los WhatsApp, correos, respuestas y notas que se apuntan en Cold Calling y las citas que se agendan en la Agenda.'
              : 'Nada con ese filtro.'}
        </p>
      ) : (
        <div className="space-y-4">
          {dias.map((dia) => {
            const delDia = grupos.get(dia) ?? []
            return (
              <div key={dia}>
                <div className="flex items-baseline justify-between gap-3 mb-1.5 px-0.5">
                  <h3 className="text-[12px] font-semibold text-white/80">{etiquetaDelDia(dia)}</h3>
                  <p className="text-[11px] text-white/35">{resumenDelDia(delDia)}</p>
                </div>
                <ul className="space-y-1.5">
                  {delDia.map((i) =>
                    i.tipo === 'cita' ? (
                      <TarjetaDeCita key={`cita-${i.cita.id}`} c={i.cita} />
                    ) : (
                      <TarjetaDeConversacion
                        key={i.conversacion.clave}
                        c={i.conversacion}
                        cliente={nombres.get(i.conversacion.leadId)}
                        abierta={abiertas.has(i.conversacion.clave)}
                        onAlternar={() => alternar(i.conversacion.clave)}
                      />
                    )
                  )}
                </ul>
              </div>
            )
          })}

          {restantes > 0 && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setLimite((l) => l + POR_PAGINA)}
                className="rounded-full border border-white/10 px-4 py-1.5 text-[12px] text-white/60 hover:border-[#FF6600]/40 hover:text-white transition-colors"
              >
                Ver {Math.min(POR_PAGINA, restantes)} más <span className="text-white/35">({restantes.toLocaleString('es-ES')} sin mostrar, las más antiguas)</span>
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

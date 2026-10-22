'use client'

import { CalendarCheck, ChevronDown, ChevronsDownUp, ChevronsUpDown, Linkedin, Loader2, Mail, MessageCircle, Phone, StickyNote, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
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
import { CabeceraDePanel, ChipDeFiltro, PANEL } from './ui'

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
  whatsapp: { Icono: MessageCircle, color: COLOR_ESTADO.verde },
  correo: { Icono: Mail, color: COLOR_ESTADO.cian },
  linkedin: { Icono: Linkedin, color: COLOR_ESTADO.azul },
  llamada: { Icono: Phone, color: COLOR_ESTADO.verde },
  nota: { Icono: StickyNote, color: COLOR_ESTADO.gris },
}

const AYUDA_DE_FILTRO: Partial<Record<FiltroDeActividad, string>> = {
  respuestas: 'Clientes que contestaron: un cliente que contesta por dos canales el mismo día cuenta una vez',
  otras: 'LinkedIn, llamadas anotadas a mano y notas sueltas',
}

const primeraMayuscula = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t)

/** Una etiquetita redonda con su tono: el color lo lleva el fondo suave y el texto, nunca solo uno */
function Etiqueta({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className={`inline-flex h-[17px] items-center rounded-[5px] px-1.5 text-[10.5px] font-medium whitespace-nowrap ${color ? '' : 'bg-[var(--ls-sup3)] text-[var(--ls-t3)]'}`}
      style={color ? { color, background: `color-mix(in srgb, ${color} 15%, transparent)` } : undefined}
    >
      {children}
    </span>
  )
}

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
  /** Sin el marco ni el título: para meterla dentro de otra tarjeta, como en el informe semanal */
  sinMarco?: boolean
  /** El id de la sección, para ir a ella desde las tarjetas. Si hay varias en la página, null en todas menos una */
  anclaId?: string | null
}

function TarjetaDeConversacion({ c, cliente, abierta, onAlternar, orden }: { c: Conversacion; cliente: NombreDeLead | undefined; abierta: boolean; onAlternar: () => void; orden: number }) {
  const { Icono, color } = ICONO_DE_CANAL[c.canal]
  const n = c.interacciones.length
  // Lo que se ve sin abrir: lo que contestó el cliente, si contestó (es lo que importa); si no, el primer apunte
  const destacada = c.interacciones.find((i) => i.esRespuesta) ?? c.interacciones[0]
  const expandible = n > 1 || destacada.texto.length > 140
  const horas = c.desde === c.hasta ? c.desde : `${c.desde} – ${c.hasta}`

  return (
    <li className="rend-entra rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2.5 py-2 transition-colors hover:border-[var(--ls-linea2)]" style={{ '--d': Math.min(orden, 12) } as CSSProperties}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px]" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }} title={ETIQUETA_DE_CANAL[c.canal]}>
          <Icono className="h-3.5 w-3.5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="max-w-full truncate text-[12.5px] text-[var(--ls-t1)]">{cliente?.nombre || 'Cliente'}</p>
            {c.hayRespuesta && <Etiqueta color="var(--ls-acc)">Contestó</Etiqueta>}
            {n > 1 && <Etiqueta>{n} interacciones</Etiqueta>}
          </div>
          <p className="truncate text-[11px] text-[var(--ls-t4)]">
            {ETIQUETA_DE_CANAL[c.canal]}
            {cliente?.empresa ? ` · ${cliente.empresa}` : ''}
          </p>

          {!abierta && destacada.texto && (
            <p className="mt-1.5 line-clamp-2 break-words text-[12px] leading-snug text-[var(--ls-t3)]">
              {destacada.esRespuesta && <span className="font-medium text-[var(--ls-acc)]">Cliente: </span>}
              {destacada.texto}
            </p>
          )}

          {abierta && (
            <ol className="mt-2 space-y-1.5 border-l border-[var(--ls-linea2)] pl-3">
              {c.interacciones.map((i) => (
                <li key={i.id} className="text-[12px] leading-snug">
                  <p className="flex items-center gap-2 text-[11px]">
                    <span className="font-semibold tabular-nums text-[var(--ls-t2)]">{i.hora}</span>
                    <span className={i.esRespuesta ? 'font-medium text-[var(--ls-acc)]' : 'text-[var(--ls-t4)]'}>{i.esRespuesta ? 'Contestó el cliente' : 'Apunte'}</span>
                  </p>
                  <p className={`mt-0.5 whitespace-pre-wrap break-words ${i.texto ? 'text-[var(--ls-t2)]' : 'italic text-[var(--ls-t4)]'}`}>{i.texto || 'Sin comentario'}</p>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex shrink-0 items-start gap-1">
          <p className="pt-0.5 text-[12px] tabular-nums text-[var(--ls-t3)]">{horas}</p>
          {expandible && (
            <button
              type="button"
              onClick={onAlternar}
              aria-expanded={abierta}
              aria-label={abierta ? 'Cerrar la conversación' : 'Abrir la conversación'}
              className="rounded-[6px] p-1 text-[var(--ls-t4)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]"
            >
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${abierta ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

function TarjetaDeCita({ c, orden }: { c: CitaAgendada; orden: number }) {
  const violeta = COLOR_ESTADO.violeta
  return (
    <li className="rend-entra rounded-[8px] border px-2.5 py-2" style={{ borderColor: `color-mix(in srgb, ${violeta} 28%, transparent)`, background: `color-mix(in srgb, ${violeta} 6%, var(--ls-sup))`, '--d': Math.min(orden, 12) } as CSSProperties}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px]" style={{ color: violeta, background: `color-mix(in srgb, ${violeta} 16%, transparent)` }} title="Cita agendada">
          <CalendarCheck className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="max-w-full truncate text-[12.5px] text-[var(--ls-t1)]">{c.cliente}</p>
            <Etiqueta color={violeta}>Cita agendada</Etiqueta>
            <Etiqueta>{etiquetaDeEstadoDeCita(c.estado)}</Etiqueta>
          </div>
          <p className="truncate text-[11px] text-[var(--ls-t4)]">{c.empresa ?? 'Sin empresa'}</p>
          <p className="mt-1.5 text-[12px] leading-snug text-[var(--ls-t3)]">
            Es para el <span className="text-[var(--ls-t1)]">{etiquetaDeDia(c.paraDia)}</span> a las <span className="tabular-nums text-[var(--ls-t1)]">{c.paraHora}</span>
          </p>
        </div>
        <p className="shrink-0 pt-0.5 text-[12px] tabular-nums text-[var(--ls-t3)]" title="Hora a la que se agendó">
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

export function ListaDeActividad({ persona, periodo, hoy, items, filtro, onFiltro, nombres, cargando, error = null, clave, sinMarco = false, anclaId = 'detalle-actividad' }: Props) {
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

  const cuerpo = (
    <div className={sinMarco ? '' : 'p-3 pt-2.5'}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar la actividad">
          {FILTROS_DE_ACTIVIDAD.map((f) => (
            <ChipDeFiltro key={f.id} activo={filtro === f.id} deshabilitado={f.id !== 'todo' && cuenta[f.id] === 0} onClick={() => onFiltro(f.id)} ayuda={AYUDA_DE_FILTRO[f.id]}>
              {f.etiqueta} <span className="tabular-nums text-[var(--ls-t4)]">{cuenta[f.id]}</span>
            </ChipDeFiltro>
          ))}
        </div>
        {expandibles.length > 0 && (
          <button
            type="button"
            onClick={() => setAbiertas(todoAbierto ? new Set() : new Set(expandibles))}
            className="flex items-center gap-1.5 text-[11.5px] text-[var(--ls-t3)] transition-colors hover:text-[var(--ls-t1)]"
          >
            {todoAbierto ? <ChevronsDownUp className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
            {todoAbierto ? 'Cerrar todo' : 'Abrir todo'}
          </button>
        )}
      </div>

      {visibles.length === 0 ? (
        <p className={`py-6 text-center text-[12px] leading-relaxed ${error ? 'text-[var(--ls-e-ambar)]' : 'text-[var(--ls-t4)]'}`} role={error ? 'alert' : undefined}>
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
                <div className="mb-1.5 flex items-center gap-3 px-0.5">
                  <h3 className="text-[12px] font-semibold text-[var(--ls-t2)]">{etiquetaDelDia(dia)}</h3>
                  <span aria-hidden className="h-px flex-1 bg-[var(--ls-linea)]" />
                  <p className="text-[11px] text-[var(--ls-t4)]">{resumenDelDia(delDia)}</p>
                </div>
                <ul className="space-y-1.5">
                  {delDia.map((i, orden) =>
                    i.tipo === 'cita' ? (
                      <TarjetaDeCita key={`cita-${i.cita.id}`} c={i.cita} orden={orden} />
                    ) : (
                      <TarjetaDeConversacion
                        key={i.conversacion.clave}
                        c={i.conversacion}
                        cliente={nombres.get(i.conversacion.leadId)}
                        abierta={abiertas.has(i.conversacion.clave)}
                        onAlternar={() => alternar(i.conversacion.clave)}
                        orden={orden}
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
                className="rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 py-1.5 text-[12px] text-[var(--ls-t2)] transition-colors hover:border-[var(--ls-acc-graf)] hover:text-[var(--ls-t1)]"
              >
                Ver {Math.min(POR_PAGINA, restantes)} más <span className="text-[var(--ls-t4)]">({restantes.toLocaleString('es-ES')} sin mostrar, las más antiguas)</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )

  if (sinMarco) {
    return (
      <section id={anclaId ?? undefined} className="scroll-mt-4" aria-label="Detalle de la actividad">
        {cuerpo}
      </section>
    )
  }

  return (
    <section id={anclaId ?? undefined} className={`${PANEL} rend-aparece scroll-mt-4 overflow-hidden`} aria-label="Detalle de la actividad">
      <CabeceraDePanel
        titulo="Detalle de la actividad"
        derecha={
          <span className="flex items-center gap-2 text-[11.5px] text-[var(--ls-t4)]">
            {cargando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span className="truncate">
              {persona} · {etiquetaDePeriodo(periodo, hoy)}
            </span>
          </span>
        }
      />
      {cuerpo}
    </section>
  )
}

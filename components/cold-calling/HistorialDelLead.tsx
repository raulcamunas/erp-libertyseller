'use client'

import { Linkedin, Loader2, Mail, MessageCircle, Mic, PhoneIncoming, PhoneMissed, PhoneOff, PhoneOutgoing, Play, Plus, StickyNote, Voicemail, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { BOTON, COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import {
  cuandoEs,
  describirLlamada,
  fusionarHistorial,
  grabacionDisponible,
  type IconoDeLlamada,
  type LlamadaDelHistorial,
} from '@/lib/cold-calling/historial'
import { COLD_NOTE_LABELS, type ColdLeadNote, type ColdNoteKind } from '@/lib/types/cold-leads'
import type { UserProfile } from '@/lib/supabase/get-user-profile'
import { ReproductorGrabacion } from '@/components/rendimiento/ReproductorGrabacion'

/**
 * EL HISTORIAL DE UN LEAD.
 *
 * Una sola línea de tiempo con dos clases de cosas: las LLAMADAS que Rinkel ya sabe (cuándo, cuánto duró, si contestaron, la
 * grabación) y los APUNTES que escribe el comercial (lo que Rinkel no puede saber: qué se dijo, qué se acordó). Las llamadas
 * entran solas; lo que se escribe aquí es lo que se habló.
 *
 * Una llamada no es una nota: no se borra desde aquí ni se edita. Vive en `rinkel_llamadas` y se lee con las mismas
 * políticas RLS que «Mi rendimiento» (cada comercial ve las suyas; quien supervisa, las de todos).
 */

interface Props {
  leadId: string
  currentUser: UserProfile
  /** Nombre de cada persona del equipo, para decir quién hizo cada llamada */
  nombres: ReadonlyMap<string, string>
  /** Sube cuando Rinkel ha traído llamadas nuevas: se vuelven a pedir las de este lead */
  version?: number
  /** Se llama al registrar un apunte, para sellar el último contacto del lead */
  onLogged: (kind: ColdNoteKind) => void
}

const ICONO_DE_NOTA: Record<ColdNoteKind, typeof StickyNote> = {
  llamada: PhoneOutgoing,
  email: Mail,
  whatsapp: MessageCircle,
  linkedin: Linkedin,
  nota: StickyNote,
}

const TONO_DE_NOTA: Record<ColdNoteKind, TonoEstado> = {
  llamada: 'azul',
  email: 'magenta',
  whatsapp: 'verde',
  linkedin: 'azul',
  nota: 'gris',
}

const ICONO_DE_LLAMADA: Record<IconoDeLlamada, typeof PhoneOutgoing> = {
  saliente: PhoneOutgoing,
  entrante: PhoneIncoming,
  perdida: PhoneMissed,
  contestador: Voicemail,
  sin_respuesta: PhoneOff,
}

/** Los apuntes que se ofrecen, en este orden. «Llamada» es para una que NO salió por Rinkel: las de Rinkel entran solas */
const CLASES: ColdNoteKind[] = ['nota', 'email', 'whatsapp', 'linkedin', 'llamada']

/** Los canales en los que el cliente puede ESCRIBIR de vuelta: en una nota o una llamada la casilla no tiene sentido */
const CANALES_CON_RESPUESTA: ReadonlySet<ColdNoteKind> = new Set<ColdNoteKind>(['email', 'whatsapp', 'linkedin'])

const AYUDA_DE_CLASE: Partial<Record<ColdNoteKind, string>> = {
  llamada: 'Para una llamada que no ha salido por Rinkel. Las de Rinkel se apuntan solas: aquí solo se deja un comentario',
}

const PLACEHOLDER: Record<ColdNoteKind, string> = {
  nota: 'Qué se ha hablado o acordado…',
  email: 'Qué se le ha escrito o qué ha contestado…',
  whatsapp: 'Qué se le ha escrito o qué ha contestado…',
  linkedin: 'Qué se le ha escrito o qué ha contestado…',
  llamada: 'Comentario de una llamada que no ha pasado por Rinkel…',
}

const NOTE_SELECT = `
  *,
  author:profiles!cold_lead_notes_author_id_fkey(id, full_name, email, role, calendar_color)
`

const CAMPOS_DE_LLAMADA = 'id, user_id, fecha, direccion, duracion_s, estado, numero, numero_anonimo, grabacion_id, grabacion_hasta'

/** El icono redondeado de una entrada, con el color de lo que es */
function Capsula({ icono: Icono, tono }: { icono: typeof StickyNote; tono: TonoEstado }) {
  const color = COLOR_ESTADO[tono]
  return (
    <span
      className="relative z-10 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px]"
      style={{ color, background: `color-mix(in srgb, ${color} 14%, var(--ls-sup))` }}
    >
      <Icono className="h-3 w-3" aria-hidden />
    </span>
  )
}

export function HistorialDelLead({ leadId, currentUser, nombres, version = 0, onLogged }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [notas, setNotas] = useState<ColdLeadNote[]>([])
  const [llamadas, setLlamadas] = useState<LlamadaDelHistorial[]>([])
  const [cargando, setCargando] = useState(true)
  const [clase, setClase] = useState<ColdNoteKind>('nota')
  const [texto, setTexto] = useState('')
  /**
   * Lo que escribió el CLIENTE, no lo que mandamos. Alimenta las «respuestas» de «Mi rendimiento» (clientes distintos que
   * han contestado ese día). La conversación del canal cuenta igual, marcada o no: varias interacciones con el mismo
   * cliente el mismo día son UNA conversación.
   */
  const [esRespuesta, setEsRespuesta] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [abierta, setAbierta] = useState<string | null>(null)
  const marcaRespuesta = esRespuesta && CANALES_CON_RESPUESTA.has(clase)

  const pedirLlamadas = useCallback(async () => {
    const { data, error } = await supabase.from('rinkel_llamadas').select(CAMPOS_DE_LLAMADA).eq('lead_id', leadId).order('fecha', { ascending: false }).limit(300)
    // Sin llamadas que enseñar (o la tabla aún no existe): el historial sigue siendo el de las notas, sin ruido
    return error ? [] : ((data ?? []) as LlamadaDelHistorial[])
  }, [supabase, leadId])

  /** Los apuntes de este lead; null si la consulta falla (entonces se dejan los que había) */
  const pedirNotas = useCallback(async () => {
    const { data, error } = await supabase.from('cold_lead_notes').select(NOTE_SELECT).eq('lead_id', leadId).order('occurred_at', { ascending: false })
    return error ? null : ((data as ColdLeadNote[]) ?? [])
  }, [supabase, leadId])

  useEffect(() => {
    let activo = true
    setCargando(true)
    setTexto('')
    setEsRespuesta(false)
    setAbierta(null)
    Promise.all([pedirNotas(), pedirLlamadas()]).then(([n, l]) => {
      if (!activo) return
      setNotas(n ?? [])
      setLlamadas(l)
      setCargando(false)
    })
    return () => {
      activo = false
    }
  }, [pedirNotas, pedirLlamadas])

  // Rinkel ha traído llamadas nuevas, o ha salido un correo desde la ficha de este lead (se apunta solo): se vuelve a pedir su historial
  useEffect(() => {
    if (version === 0) return
    let activo = true
    Promise.all([pedirNotas(), pedirLlamadas()]).then(([n, l]) => {
      if (!activo) return
      if (n) setNotas(n)
      setLlamadas(l)
    })
    return () => {
      activo = false
    }
  }, [version, pedirNotas, pedirLlamadas])

  async function guardar() {
    const cuerpo = texto.trim()
    if (!cuerpo) return
    setGuardando(true)
    try {
      const { data, error } = await supabase
        .from('cold_lead_notes')
        // `es_respuesta` solo viaja si está marcado: así, antes de lanzar la migración 234, anotar una interacción normal
        // sigue funcionando igual que siempre.
        .insert({ lead_id: leadId, author_id: currentUser.id, kind: clase, body: cuerpo, ...(marcaRespuesta ? { es_respuesta: true } : {}) })
        .select(NOTE_SELECT)
        .single()
      if (error) throw error
      setNotas((previas) => [data as ColdLeadNote, ...previas])
      setTexto('')
      setEsRespuesta(false)
      onLogged(clase)
    } catch (err) {
      console.error('Error guardando la interacción:', err)
      // PGRST204 / 42703: la columna no existe todavía, o sea que falta lanzar la migración 234
      const codigo = (err as { code?: string } | null)?.code
      toast.error(marcaRespuesta && (codigo === 'PGRST204' || codigo === '42703') ? 'Para marcar respuestas falta lanzar la migración 234 en Supabase' : 'No se pudo guardar la interacción')
    } finally {
      setGuardando(false)
    }
  }

  async function borrar(id: string) {
    try {
      const { error } = await supabase.from('cold_lead_notes').delete().eq('id', id)
      if (error) throw error
      setNotas((previas) => previas.filter((n) => n.id !== id))
    } catch (err) {
      console.error('Error borrando la interacción:', err)
      toast.error('No se pudo borrar')
    }
  }

  const elementos = useMemo(() => fusionarHistorial(notas, llamadas), [notas, llamadas])
  const ahora = Date.now()

  return (
    <div className="space-y-2.5">
      {/* Apuntar: siempre a la vista, es lo que más se repite */}
      <div className="space-y-2 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2.5">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Qué se apunta">
          {CLASES.map((k) => {
            const Icono = ICONO_DE_NOTA[k]
            return (
              <button key={k} type="button" onClick={() => setClase(k)} aria-pressed={clase === k} title={AYUDA_DE_CLASE[k]} className={`${BOTON.chip} ${clase === k ? BOTON.chipEncendido : ''}`}>
                <Icono className="h-3 w-3" aria-hidden />
                {COLD_NOTE_LABELS[k]}
              </button>
            )
          })}
        </div>

        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) guardar()
          }}
          rows={2}
          placeholder={PLACEHOLDER[clase]}
          className="w-full resize-none rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2.5 py-1.5 text-[12.5px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] focus:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)]"
        />

        {CANALES_CON_RESPUESTA.has(clase) && (
          <label className="flex w-fit cursor-pointer select-none items-center gap-1.5">
            <input type="checkbox" checked={esRespuesta} onChange={(e) => setEsRespuesta(e.target.checked)} className="h-3 w-3 accent-[var(--ls-acc-graf)]" />
            <span className="text-[11.5px] text-[var(--ls-t2)]">Es una respuesta del cliente</span>
            <span className="text-[11px] text-[var(--ls-t4)]">· varias el mismo día cuentan como 1 conversación</span>
          </label>
        )}

        <div className="flex items-center gap-2">
          <span className="flex-1 text-[11px] text-[var(--ls-t4)]">⌘/Ctrl + Enter para guardar</span>
          <button type="button" onClick={guardar} disabled={guardando || !texto.trim()} className={`${BOTON.base} ${BOTON.primario}`}>
            {guardando ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Plus className="h-3 w-3" aria-hidden />}
            Apuntar
          </button>
        </div>
      </div>

      {cargando ? (
        <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--ls-t4)]">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Cargando historial…
        </p>
      ) : elementos.length === 0 ? (
        <p className="text-[11.5px] text-[var(--ls-t4)]">Todavía no hay nada: las llamadas de Rinkel a este teléfono saldrán aquí solas.</p>
      ) : (
        <ol className="space-y-0">
          {elementos.map((e, i) => {
            const ultimo = i === elementos.length - 1
            const animacion = { '--d': Math.min(i, 10) } as CSSProperties

            if (e.tipo === 'llamada') {
              const l = e.llamada
              const d = describirLlamada(l)
              const quien = nombres.get(l.user_id)
              const conGrabacion = grabacionDisponible(l, ahora)
              const caducada = l.grabacion_id !== null && !conGrabacion
              const abierto = abierta === l.id
              return (
                <li key={`l-${l.id}`} className="rend-entra group relative flex gap-2.5 pb-3" style={animacion}>
                  {!ultimo && <span aria-hidden className="absolute bottom-0 left-[10px] top-6 w-px bg-[var(--ls-linea2)]" />}
                  <Capsula icono={ICONO_DE_LLAMADA[d.icono]} tono={d.tono} />
                  <div className="min-w-0 flex-1">
                    {/* El botón de escuchar va CENTRADO en vertical respecto a las dos líneas de la llamada (título y resultado, y
                        teléfono con fecha), no pegado a la primera: antes se quedaba más arriba que el centro y parecía descolgado */}
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-1.5">
                          <span className="text-[12px] font-semibold text-[var(--ls-t1)]">{d.titulo}</span>
                          <span className="text-[12px] text-[var(--ls-t2)]">{d.resultado}</span>
                        </div>
                        <p className="text-[11px] text-[var(--ls-t4)]">
                          {d.telefono} · {cuandoEs(l.fecha)}
                          {quien ? ` · ${quien}` : ''}
                        </p>
                      </div>
                      {conGrabacion && (
                        <button
                          type="button"
                          onClick={() => setAbierta(abierto ? null : l.id)}
                          aria-expanded={abierto}
                          className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[6px] border px-2 text-[11.5px] font-medium transition-colors ${
                            abierto ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] text-[var(--ls-t1)]' : 'border-[var(--ls-linea)] text-[var(--ls-t2)] hover:border-[var(--ls-acc-graf)] hover:text-[var(--ls-t1)]'
                          }`}
                        >
                          {abierto ? <Mic className="h-3 w-3 text-[var(--ls-acc)]" aria-hidden /> : <Play className="h-3 w-3" aria-hidden />}
                          Escuchar
                        </button>
                      )}
                      {caducada && (
                        <span className="shrink-0 text-[11px] text-[var(--ls-t4)]" title="Rinkel guarda las grabaciones 90 días">
                          grabación caducada
                        </span>
                      )}
                    </div>
                    {abierto && <ReproductorGrabacion llamadaId={l.id} onCerrar={() => setAbierta(null)} />}
                  </div>
                </li>
              )
            }

            const n = e.nota
            const Icono = ICONO_DE_NOTA[n.kind] ?? StickyNote
            return (
              <li key={`n-${n.id}`} className="rend-entra group relative flex gap-2.5 pb-3" style={animacion}>
                {!ultimo && <span aria-hidden className="absolute bottom-0 left-[10px] top-6 w-px bg-[var(--ls-linea2)]" />}
                <Capsula icono={Icono} tono={TONO_DE_NOTA[n.kind] ?? 'gris'} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[12px] font-semibold text-[var(--ls-t1)]">{COLD_NOTE_LABELS[n.kind] ?? n.kind}</span>
                    {n.es_respuesta && <span className="rounded-[4px] bg-[color-mix(in_srgb,var(--ls-e-verde)_16%,transparent)] px-1 py-px text-[10.5px] font-medium text-[var(--ls-e-verde)]">respuesta del cliente</span>}
                    <span className="text-[11px] text-[var(--ls-t4)]">
                      {cuandoEs(n.occurred_at)}
                      {n.author?.full_name ? ` · ${n.author.full_name}` : ''}
                    </span>
                    <button type="button" onClick={() => borrar(n.id)} className="ml-auto text-[var(--ls-t4)] opacity-0 transition-opacity hover:text-[var(--ls-e-rojo)] group-hover:opacity-100" title="Borrar" aria-label="Borrar este apunte">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-[12.5px] leading-snug text-[var(--ls-t2)]">{n.body}</p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

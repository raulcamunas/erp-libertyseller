'use client'

import { Fragment, useEffect, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, FileText, Loader2, RefreshCw, Sparkles, UserRoundCog, Video } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toMadrid } from '@/lib/timezone'
import type { FilaDeNota } from '@/lib/crm/gemini/tipos'
import { analizarNota, asignarNota } from './api'
import { AsignarNota } from './AsignarNota'
import { DesgloseDeLaIA } from './DesgloseDeLaIA'
import { conMayuscula, ESTADO_DE_NOTA, METODO_DE_CITA } from './etiquetas'
import { GuionDeLaReunion } from './GuionDeLaReunion'
import { Aviso, Boton, Insignia, Seccion, Vacio } from './piezas'
import type { ContextoFicha } from './tipos'

const fechaLarga = (iso: string) => conMayuscula(format(toMadrid(new Date(iso)), "EEEE d 'de' MMMM · HH:mm", { locale: es }))
const fechaCorta = (iso: string) => format(toMadrid(new Date(iso)), 'd MMM · HH:mm', { locale: es })

/** **negrita** dentro de una línea, sin HTML: React escapa el texto */
function Negritas({ texto }: { texto: string }) {
  return (
    <>
      {texto.split(/(\*\*[^*]+\*\*)/g).map((trozo, i) => (trozo.startsWith('**') && trozo.endsWith('**') && trozo.length > 4 ? <strong key={i} className="font-semibold text-[var(--ls-t1)]">{trozo.slice(2, -2)}</strong> : <Fragment key={i}>{trozo}</Fragment>))}
    </>
  )
}

/** El detalle de las notas de Gemini (lib/crm/gemini/documento.ts lo deja con «## », «### », «- » y **negritas**) */
function TextoDeNota({ texto }: { texto: string }) {
  return (
    <div className="space-y-[5px]">
      {texto.split('\n').map((l, i) => {
        if (!l.trim()) return null
        if (l.startsWith('### ')) return <h5 key={i} className="mt-2 text-[12px] font-semibold text-[var(--ls-t2)]">{l.slice(4)}</h5>
        if (l.startsWith('## ')) return <h4 key={i} className="mt-3 border-b border-[var(--ls-linea)] pb-1 text-[12.5px] font-semibold text-[var(--ls-t1)] first:mt-0">{l.slice(3)}</h4>
        if (l.startsWith('- ')) {
          return (
            <p key={i} className="flex gap-[7px] text-[12.5px] leading-[1.55] text-[var(--ls-t2)]">
              <span className="mt-[8px] h-[4px] w-[4px] shrink-0 rounded-[1px] bg-[var(--ls-acc-graf)]" />
              <span className="min-w-0"><Negritas texto={l.slice(2)} /></span>
            </p>
          )
        }
        return <p key={i} className="text-[12.5px] leading-[1.6] text-[var(--ls-t2)]"><Negritas texto={l} /></p>
      })}
    </div>
  )
}

/** La transcripción: el minuto en pequeño y quién habla en negrita. Se pinta por tramos porque son miles de líneas */
function Transcripcion({ texto }: { texto: string }) {
  const lineas = texto.split('\n').filter((l) => l.trim() !== '')
  const [todo, setTodo] = useState(false)
  const visibles = todo ? lineas : lineas.slice(0, 160)
  return (
    <div className="space-y-[3px]">
      {visibles.map((l, i) => {
        const minuto = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]$/.exec(l.trim())
        if (minuto) return <p key={i} className="pt-2 text-[10.5px] font-semibold tabular-nums text-[var(--ls-t4)]">{minuto[1]}</p>
        const habla = /^([^:\n]{1,60}):\s+([\s\S]*)$/.exec(l)
        return habla ? (
          <p key={i} className="text-[12px] leading-[1.55] text-[var(--ls-t2)]"><strong className="font-semibold text-[var(--ls-t1)]">{habla[1]}:</strong> {habla[2]}</p>
        ) : (
          <p key={i} className="text-[12px] leading-[1.55] text-[var(--ls-t3)]">{l}</p>
        )
      })}
      {!todo && lineas.length > visibles.length && (
        <div className="pt-2">
          <Boton onClick={() => setTodo(true)}>Mostrar las {lineas.length - visibles.length} líneas que faltan</Boton>
        </div>
      )}
    </div>
  )
}

/** Lo que escribió Gemini, tal cual: el resumen, los temas, los pasos, el detalle y la transcripción. El detalle y la transcripción pesan decenas de miles de caracteres y se piden al abrirlos */
function NotasOriginales({ nota }: { nota: FilaDeNota }) {
  const supabase = createClient()
  const [abierto, setAbierto] = useState(false)
  const [verTranscripcion, setVerTranscripcion] = useState(false)
  const [contenido, setContenido] = useState<{ detalle: string | null; transcripcion: string | null } | null>(null)
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    setContenido(null)
    setVerTranscripcion(false)
  }, [nota.id])

  useEffect(() => {
    if (!abierto || contenido || !nota.completa) return
    let activo = true
    setCargando(true)
    supabase
      .from('crm_notas_reunion')
      .select('detalle, transcripcion')
      .eq('id', nota.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!activo) return
        setContenido({ detalle: (data?.detalle as string | null) ?? null, transcripcion: (data?.transcripcion as string | null) ?? null })
        setCargando(false)
      })
    return () => {
      activo = false
    }
  }, [abierto, contenido, nota.id, nota.completa, supabase])

  return (
    <Seccion
      titulo="Notas originales de Gemini"
      icono={<FileText />}
      derecha={
        <Boton onClick={() => setAbierto((v) => !v)} icono={abierto ? <ChevronDown /> : <ChevronRight />}>
          {abierto ? 'Cerrar' : 'Abrir'}
        </Boton>
      }
    >
      {!abierto ? (
        <p className="text-[12px] text-[var(--ls-t3)]">Lo que apuntó Gemini de la reunión, sin tocar: resumen, temas, pasos, detalle y transcripción.</p>
      ) : (
        <div className="space-y-3.5">
          {!nota.completa && <Aviso tono="ambar">Solo se ha podido leer el correo de Gemini. Cuando se pueda abrir el documento de Drive se completarán solas con el detalle y la transcripción.</Aviso>}
          {nota.resumen && <p className="text-[12.5px] leading-[1.6] text-[var(--ls-t1)]">{nota.resumen}</p>}
          {nota.temas.length > 0 && (
            <div className="space-y-2">
              {nota.temas.map((t, i) => (
                <div key={i}>
                  <p className="text-[12.5px] font-semibold text-[var(--ls-t1)]">{t.titulo}</p>
                  <p className="text-[12.5px] leading-[1.55] text-[var(--ls-t2)]">{t.texto}</p>
                </div>
              ))}
            </div>
          )}
          {nota.proximos_pasos.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold text-[var(--ls-t4)]">Pasos siguientes que propone Gemini</p>
              <ul className="space-y-1">
                {nota.proximos_pasos.map((p, i) => (
                  <li key={i} className="text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">
                    {p.quien && <strong className="font-semibold text-[var(--ls-t1)]">{p.quien}: </strong>}
                    {p.que}
                    {p.detalle ? ` — ${p.detalle}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {cargando && (
            <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--ls-t4)]">
              <Loader2 className="h-3 w-3 animate-spin" /> Cargando el detalle…
            </p>
          )}
          {contenido?.detalle && (
            <div className="border-t border-[var(--ls-linea)] pt-3">
              <TextoDeNota texto={contenido.detalle} />
            </div>
          )}
          {contenido?.transcripcion && (
            <div className="border-t border-[var(--ls-linea)] pt-3">
              <Boton onClick={() => setVerTranscripcion((v) => !v)} icono={verTranscripcion ? <ChevronDown /> : <ChevronRight />}>
                {verTranscripcion ? 'Ocultar la transcripción' : 'Ver la transcripción entera'}
              </Boton>
              {verTranscripcion && (
                <div className="mt-2.5 max-h-[560px] overflow-y-auto rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-3">
                  <Transcripcion texto={contenido.transcripcion} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Seccion>
  )
}

export function PestanaReunion({ ctx }: { ctx: ContextoFicha }) {
  const { notas, client } = ctx
  // Analizar una nota con la IA y asignarla a otro cliente van por rutas de dirección (/api/crm/notas-gemini): un manager o un autónomo ven el desglose pero no lo lanzan
  const puedeEditar = ctx.esDireccion
  const appt = client.appointment
  const [elegida, setElegida] = useState<string | null>(null)
  const [analizando, setAnalizando] = useState(false)
  const [asignando, setAsignando] = useState(false)
  const [trabajando, setTrabajando] = useState(false)

  const nota = notas.find((n) => n.id === elegida) ?? notas[0] ?? null
  const analisis = nota?.analisis ?? null

  async function analizar() {
    if (!nota || analizando) return
    setAnalizando(true)
    const r = await analizarNota(nota.id)
    setAnalizando(false)
    if (!r.ok) {
      toast.error(r.error ?? 'No se ha podido analizar la reunión')
      return
    }
    toast.success('Reunión analizada')
    await ctx.refrescarNotas()
  }

  async function asignar(clientId: string) {
    if (!nota) return
    setTrabajando(true)
    const r = await asignarNota(nota.id, clientId)
    setTrabajando(false)
    if (!r.ok) {
      toast.error(r.error ?? 'No se ha podido asignar la nota')
      return
    }
    setAsignando(false)
    toast.success('Nota asignada a otro cliente')
    // Si todavía no estaba analizada, se lanza ya el análisis para que lo tenga cuando se abra su ficha (es lo mismo que haría el cron en unos minutos)
    if (r.datos.estado === 'pendiente') void analizarNota(nota.id)
    await ctx.refrescarNotas()
  }

  const cabecera = (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {notas.length > 1 && (
        <div className="flex flex-wrap items-center gap-[5px]">
          {notas.map((n) => (
            <button key={n.id} type="button" onClick={() => setElegida(n.id)} className={`inline-flex h-6 items-center gap-[5px] whitespace-nowrap rounded-[6px] border px-2 text-[11.5px] ${n.id === nota?.id ? '!border-[var(--ls-acc-graf)] !bg-[var(--ls-acc-suave)] text-[var(--ls-t1)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]'}`}>
              {n.fecha_reunion ? fechaCorta(n.fecha_reunion) : 'Sin fecha'}
            </button>
          ))}
        </div>
      )}
      <span className="flex-1" />
      {nota?.drive_file_id && (
        <a href={`https://docs.google.com/document/d/${nota.drive_file_id}/edit`} target="_blank" rel="noopener noreferrer" className="inline-flex h-6 items-center gap-[5px] rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-[9px] text-[11.5px] font-medium text-[var(--ls-t2)] hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]">
          <FileText className="h-3 w-3" /> Abrir en Drive
        </a>
      )}
      {puedeEditar && nota && (
        <>
          <Boton onClick={() => setAsignando((v) => !v)} icono={<UserRoundCog />}>
            Asignar a otro cliente
          </Boton>
          <Boton tono={analisis ? 'secundario' : 'primario'} onClick={() => void analizar()} disabled={analizando} icono={analizando ? <Loader2 className="animate-spin" /> : analisis ? <RefreshCw /> : <Sparkles />}>
            {analizando ? 'Analizando…' : analisis ? 'Volver a analizar' : 'Analizar con IA'}
          </Boton>
        </>
      )}
    </div>
  )

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {!nota ? (
        <Seccion titulo="Notas de la reunión" icono={<Video />}>
          <Vacio icono={<Video />}>
            {ctx.migracionFalta
              ? 'Las notas de Gemini se guardan en cuanto se lance la migración 258.'
              : ctx.cargando
                ? 'Cargando…'
                : 'Todavía no hay notas de Gemini de este cliente. Llegan solas de Gmail cuando acaba la reunión de Meet (con las notas de Gemini encendidas), y se enlazan con esta ficha por el evento del calendario, el correo del invitado o el nombre.'}
          </Vacio>
        </Seccion>
      ) : (
        <>
          {cabecera}
          {asignando && (
            <AsignarNota clientes={ctx.clientes} excluir={client.id} trabajando={trabajando} onElegir={(id) => void asignar(id)} onCerrar={() => setAsignando(false)} />
          )}

          <div className="flex flex-wrap items-center gap-[6px] text-[11.5px] text-[var(--ls-t3)]">
            <Insignia tono={ESTADO_DE_NOTA[nota.estado].tono}>{ESTADO_DE_NOTA[nota.estado].texto}</Insignia>
            <span>{nota.fecha_reunion ? fechaLarga(nota.fecha_reunion) : 'Fecha sin determinar'}</span>
            {nota.metodo_cita && <span>· {METODO_DE_CITA[nota.metodo_cita]}</span>}
            {nota.completa ? <span>· notas completas, con transcripción</span> : <span>· solo el correo de Gemini</span>}
            {nota.analisis_modelo && nota.analisis_en && <span>· analizada con {nota.analisis_modelo} el {fechaCorta(nota.analisis_en)}</span>}
          </div>

          {nota.error && nota.estado !== 'procesada' && (
            <Aviso tono="rojo">
              <span className="font-semibold">No se ha podido analizar. </span>
              {nota.error}
            </Aviso>
          )}

          {analisis ? (
            <DesgloseDeLaIA analisis={analisis} ctx={ctx} />
          ) : (
            <Seccion titulo="Desglose de la IA" icono={<Sparkles />}>
              <Vacio icono={<Sparkles />}>
                {puedeEditar
                  ? 'Esta reunión todavía no está analizada. La IA saca de las notas de Gemini el negocio del cliente, los dolores, las objeciones, las respuestas del guion y una propuesta sugerida (unos 0,08 $ por reunión).'
                  : 'Esta reunión todavía no está analizada.'}
              </Vacio>
            </Seccion>
          )}

          <GuionDeLaReunion key={`${client.id}-${nota.id}-${analisis ? 'a' : 'n'}`} ctx={ctx} analisis={analisis} />
          <NotasOriginales nota={nota} />
        </>
      )}

      {/* La cita de cualificación: lo que se apuntó ANTES de esta reunión, cuando se agendó */}
      {(appt?.transcription_summary || appt?.notes) && (
        <Seccion titulo="De la cita de cualificación" icono={<Video />}>
          {appt?.notes && <p className="whitespace-pre-wrap text-[12.5px] leading-[1.55] text-[var(--ls-t2)]">{appt.notes}</p>}
          {appt?.transcription_summary && (
            <div className="mt-2 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2.5">
              <p className="mb-1 text-[11px] font-semibold text-[var(--ls-t4)]">Resumen IA de la llamada</p>
              <p className="whitespace-pre-wrap text-[12.5px] leading-[1.55] text-[var(--ls-t2)]">{appt.transcription_summary}</p>
            </div>
          )}
        </Seccion>
      )}
      {!nota && <GuionDeLaReunion key={`${client.id}-solo`} ctx={ctx} analisis={null} />}
    </div>
  )
}

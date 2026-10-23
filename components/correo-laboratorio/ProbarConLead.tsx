'use client'

import { Dices, Loader2, Search, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { enviarJson } from '@/components/correo/api'
import { createClient } from '@/lib/supabase/client'
import type { RespuestaDePrueba } from '@/lib/correo/ia-laboratorio-tipos'
import type { SeccionesDeInstrucciones } from '@/lib/correo/ia-prompt'
import { AYUDA, BOTON_PRIMARIO, BOTON_SECUNDARIO, CAJA, ETIQUETA, LINEA, centimos } from './ui'

/**
 * PROBAR LA VERSIÓN QUE HAY EN EL EDITOR CON UN LEAD, SIN ENVIAR NADA.
 *
 * Se manda lo que está escrito AHORA en el editor (aunque no se haya guardado), así que se afina el texto y se ve el correo que saldría con
 * un lead de verdad, con sus datos y su historial. Se busca el lead por nombre o se elige uno al azar. La búsqueda se hace con la sesión de
 * quien prueba: solo salen los leads que esa persona puede ver. La prueba no se guarda y no cuenta en los resultados.
 */

interface Lead {
  id: string
  store_name: string
  company: string | null
  status: string
}

export interface ConfiguracionAProbar {
  secciones: SeccionesDeInstrucciones
  ejemplosIds: string[]
  usarGanadores: boolean
  modelo: string | null
}

export function ProbarConLead({ configuracion }: { configuracion: ConfiguracionAProbar }) {
  const supabase = useMemo(() => createClient(), [])
  const [consulta, setConsulta] = useState('')
  const [encontrados, setEncontrados] = useState<Lead[]>([])
  const [buscando, setBuscando] = useState(false)
  const [lead, setLead] = useState<Lead | null>(null)
  const [indicaciones, setIndicaciones] = useState('')
  const [generando, setGenerando] = useState(false)
  const [resultado, setResultado] = useState<RespuestaDePrueba | null>(null)
  const [error, setError] = useState<string | null>(null)
  const turno = useRef(0)

  // Búsqueda por nombre con un poco de espera: no se pide al servidor en cada letra
  useEffect(() => {
    const texto = consulta.trim()
    if (texto.length < 2) {
      setEncontrados([])
      return
    }
    const mio = ++turno.current
    const t = setTimeout(async () => {
      setBuscando(true)
      const limpio = texto.replace(/[%,()]/g, ' ')
      const { data } = await supabase.from('cold_leads').select('id, store_name, company, status').ilike('store_name', `%${limpio}%`).limit(6)
      if (mio !== turno.current) return
      setEncontrados((data ?? []) as Lead[])
      setBuscando(false)
    }, 300)
    return () => clearTimeout(t)
  }, [consulta, supabase])

  async function alAzar() {
    setBuscando(true)
    // Un lead con correo, de los que se escriben de verdad: se piden unos cuantos y se elige uno al azar
    const { data } = await supabase.from('cold_leads').select('id, store_name, company, status').not('email', 'is', null).limit(40)
    setBuscando(false)
    const lista = (data ?? []) as Lead[]
    if (lista.length === 0) return setError('No hay leads con correo que puedas ver.')
    elegir(lista[Math.floor(Math.random() * lista.length)])
  }

  function elegir(l: Lead) {
    setLead(l)
    setConsulta('')
    setEncontrados([])
    setResultado(null)
    setError(null)
  }

  async function generar() {
    if (!lead || generando) return
    setGenerando(true)
    setError(null)
    const r = await enviarJson<RespuestaDePrueba>('/api/correo/laboratorio/probar', 'POST', {
      leadId: lead.id,
      indicaciones: indicaciones.trim() || undefined,
      secciones: configuracion.secciones,
      ejemplosIds: configuracion.ejemplosIds,
      usarGanadores: configuracion.usarGanadores,
      modelo: configuracion.modelo,
    })
    setGenerando(false)
    if (!r.ok) return setError(r.mensaje)
    setResultado(r.datos)
  }

  return (
    <section className="space-y-3 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3" aria-label="Probar con un lead">
      <div>
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--ls-t1)]">
          <Sparkles className="h-3.5 w-3.5 text-[var(--ls-acc)]" aria-hidden /> Probar con un lead
        </h3>
        <p className={AYUDA}>Escribe el correo con lo que hay en el editor ahora mismo, aunque no esté guardado. No se envía ni se guarda.</p>
      </div>

      {lead ? (
        <div className="flex items-center gap-2 rounded-[8px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2.5 py-1.5 text-[12.5px]">
          <span className="min-w-0 flex-1 truncate font-medium text-[var(--ls-t1)]">
            {lead.store_name}
            {lead.company && lead.company !== lead.store_name ? <span className="font-normal text-[var(--ls-t4)]"> · {lead.company}</span> : null}
          </span>
          <button type="button" onClick={() => setLead(null)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--ls-t4)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]" aria-label="Quitar el lead">
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <label htmlFor="probar-lead" className={ETIQUETA}>
            Lead
          </label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--ls-t4)]" aria-hidden />
              <input id="probar-lead" value={consulta} onChange={(e) => setConsulta(e.target.value)} placeholder="Busca por el nombre de la tienda…" autoComplete="off" className={`${LINEA} !pl-8`} />
            </div>
            <button type="button" onClick={() => void alAzar()} disabled={buscando} className={BOTON_SECUNDARIO} title="Elige un lead con correo al azar">
              <Dices className="h-3.5 w-3.5" aria-hidden /> Al azar
            </button>
          </div>
          {buscando && <p className={AYUDA}>Buscando…</p>}
          {encontrados.length > 0 && (
            <ul className="overflow-hidden rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)]">
              {encontrados.map((l) => (
                <li key={l.id}>
                  <button type="button" onClick={() => elegir(l)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] text-[var(--ls-t2)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]">
                    <span className="min-w-0 flex-1 truncate">{l.store_name}</span>
                    <span className="shrink-0 text-[11px] text-[var(--ls-t4)]">{l.status.replace('_', ' ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div>
        <label htmlFor="probar-indicaciones" className={ETIQUETA}>
          Qué le pides al correo (opcional)
        </label>
        <textarea id="probar-indicaciones" value={indicaciones} onChange={(e) => setIndicaciones(e.target.value.slice(0, 600))} rows={2} placeholder="Como haría un comercial: «más corto», «menciona la llamada»…" className={CAJA} />
      </div>

      <button type="button" onClick={() => void generar()} disabled={!lead || generando} className={BOTON_PRIMARIO}>
        {generando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
        {generando ? 'Escribiendo…' : resultado ? 'Escribir otro' : 'Escribir correo de prueba'}
      </button>

      {error && (
        <p className="text-[12px] leading-snug text-[var(--ls-e-ambar)]" role="alert">
          {error}
        </p>
      )}

      {resultado && (
        <div className="space-y-2 rounded-[8px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] p-3">
          <p className="text-[11.5px] text-[var(--ls-t4)]">
            {resultado.modelo} · {resultado.ejemplos} {resultado.ejemplos === 1 ? 'ejemplo' : 'ejemplos'} · {centimos(resultado.coste)}
          </p>
          <p className="text-[13px] font-semibold text-[var(--ls-t1)]">{resultado.asunto}</p>
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--ls-t2)]">{resultado.texto}</p>
          {resultado.avisos.map((a) => (
            <p key={a} className="text-[11.5px] leading-snug text-[var(--ls-e-ambar)]">
              {a}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}

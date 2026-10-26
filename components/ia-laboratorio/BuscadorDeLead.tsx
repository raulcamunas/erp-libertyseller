'use client'

import { Dices, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BOTON } from '@/lib/estilo/denso'
import { LINEA } from '../correo-laboratorio/ui'

/**
 * ELEGIR UN LEAD REAL PARA PROBAR: se busca por el nombre de la tienda o se elige uno al azar.
 *
 * La búsqueda se hace con la sesión de quien prueba: solo salen los leads que esa persona puede ver (el servidor los vuelve a leer con la misma sesión). Probar con un lead real no
 * envía ni apunta nada en él.
 */

export interface LeadElegido {
  id: string
  store_name: string
  company: string | null
  status: string
}

export function BuscadorDeLead({ lead, onElegir, conCampo = 'phone' }: { lead: LeadElegido | null; onElegir: (l: LeadElegido | null) => void; /** «Al azar» elige entre los que tienen móvil (WhatsApp) o correo (correo) */ conCampo?: 'phone' | 'email' }) {
  const supabase = useMemo(() => createClient(), [])
  const [consulta, setConsulta] = useState('')
  const [encontrados, setEncontrados] = useState<LeadElegido[]>([])
  const [buscando, setBuscando] = useState(false)
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
      setEncontrados((data ?? []) as LeadElegido[])
      setBuscando(false)
    }, 300)
    return () => clearTimeout(t)
  }, [consulta, supabase])

  const elegir = (l: LeadElegido) => {
    onElegir(l)
    setConsulta('')
    setEncontrados([])
    setError(null)
  }

  async function alAzar() {
    setBuscando(true)
    setError(null)
    // Un lead con móvil o con correo, de los que se escriben de verdad: se piden unos cuantos y se elige uno al azar
    const { data } = await supabase.from('cold_leads').select('id, store_name, company, status').not(conCampo, 'is', null).limit(40)
    setBuscando(false)
    const lista = (data ?? []) as LeadElegido[]
    if (lista.length === 0) return setError(conCampo === 'email' ? 'No hay leads con correo que puedas ver.' : 'No hay leads con teléfono que puedas ver.')
    elegir(lista[Math.floor(Math.random() * lista.length)])
  }

  if (lead) {
    return (
      <div className="flex items-center gap-2 rounded-[8px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2.5 py-1.5 text-[12.5px]">
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--ls-t1)]">
          {lead.store_name}
          {lead.company && lead.company !== lead.store_name ? <span className="font-normal text-[var(--ls-t4)]"> · {lead.company}</span> : null}
        </span>
        <span className="shrink-0 text-[11px] text-[var(--ls-t4)]">{lead.status.replace('_', ' ')}</span>
        <button type="button" onClick={() => onElegir(null)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--ls-t4)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]" aria-label="Quitar el lead">
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--ls-t4)]" aria-hidden />
          <input value={consulta} onChange={(e) => setConsulta(e.target.value)} placeholder="Busca un lead por el nombre de la tienda…" aria-label="Buscar un lead" autoComplete="off" className={`${LINEA} !pl-8`} />
        </div>
        <button type="button" onClick={() => void alAzar()} disabled={buscando} className={`${BOTON.base} ${BOTON.secundario} !h-8`} title={conCampo === 'email' ? 'Elige un lead con correo al azar' : 'Elige un lead con teléfono al azar'}>
          <Dices className="h-3.5 w-3.5" aria-hidden /> Al azar
        </button>
      </div>
      {buscando && <p className="text-[11.5px] text-[var(--ls-t4)]">Buscando…</p>}
      {error && <p className="text-[11.5px] text-[var(--ls-e-ambar)]">{error}</p>}
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
  )
}

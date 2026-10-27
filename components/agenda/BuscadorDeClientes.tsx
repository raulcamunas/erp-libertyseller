'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link2, Loader2, RefreshCw, Search, Unlink } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { filtroDeBusqueda } from '@/lib/agenda/buscar-leads'
import { CAMPOS_DE_LEAD_PARA_LA_CITA, contactoDelLead, type EnlaceDeLead, type LeadParaLaCita } from '@/lib/agenda/cliente-lead'
import { BOTON, CAMPO, TEXTO } from '@/lib/estilo/denso'
import { COLD_STATUS_LABELS } from '@/lib/types/cold-leads'
import { GlifoDeEstado, InsigniaDeLista } from '@/components/cold-calling/ui'

/**
 * EL CLIENTE DE LA CITA: se busca entre los leads de Cold Calling y se trae de un golpe.
 *
 * Es lo primero de la ficha porque es lo primero que se hace: quien agenda una cita casi siempre la agenda con alguien que ya está en su cartera, y teclear otra vez su
 * nombre, empresa, teléfono, correo, web o CIF —datos que YA están apuntados— es el trabajo más lento y el que más errores mete. Se escribe parte del nombre, la empresa, el
 * teléfono (con o sin espacios), el correo o la web, se elige y la ficha se rellena (lib/agenda/cliente-lead.ts) y queda enlazada al lead.
 *
 * QUIÉN SE ENCUENTRA lo decide la base, no esta pantalla: la búsqueda va con la sesión de quien mira y las políticas de cold_leads (migración 087/212) dejan a un comercial
 * ver SOLO su cartera y a la dirección y a los supervisores, toda. Aquí no hay ningún filtro por persona que alguien pudiera saltarse.
 */

interface Props {
  enlace: EnlaceDeLead | null
  /** Quién puede cambiar el enlace. Si no, solo se enseña el que haya */
  puedeEditar: boolean
  /** Los nombres de las personas (id → nombre), para decir de quién es cada lead */
  nombres: ReadonlyMap<string, string>
  /** El id del campo, para que la ficha pueda ponerle el foco al abrirse */
  idDelCampo: string
  trayendo: boolean
  onElegir: (lead: LeadParaLaCita) => void
  onQuitar: () => void
  /** Volver a traer los datos del lead ya enlazado */
  onActualizar: () => void
}

type Estado = 'quieto' | 'buscando' | 'listo' | 'error'

const ESPERA_MS = 220

export function BuscadorDeClientes({ enlace, puedeEditar, nombres, idDelCampo, trayendo, onElegir, onQuitar, onActualizar }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState<LeadParaLaCita[]>([])
  const [estado, setEstado] = useState<Estado>('quieto')
  const [activo, setActivo] = useState(0)
  const [abierto, setAbierto] = useState(false)
  // Cada búsqueda lleva un número y solo vale la última: la respuesta lenta de «ca» no pisa la de «casa»
  const peticion = useRef(0)

  useEffect(() => {
    const filtro = filtroDeBusqueda(texto)
    if (!filtro) {
      peticion.current += 1
      setResultados([])
      setEstado('quieto')
      return
    }
    setEstado('buscando')
    const temporizador = setTimeout(async () => {
      const numero = ++peticion.current
      const { data, error } = await supabase
        .from('cold_leads')
        .select(CAMPOS_DE_LEAD_PARA_LA_CITA)
        .or(filtro)
        .order('updated_at', { ascending: false })
        .limit(10)
      if (numero !== peticion.current) return
      if (error) {
        console.error('Error buscando leads para la cita:', error)
        setResultados([])
        setEstado('error')
        return
      }
      setResultados((data ?? []) as unknown as LeadParaLaCita[])
      setActivo(0)
      setEstado('listo')
    }, ESPERA_MS)
    return () => clearTimeout(temporizador)
  }, [texto, supabase])

  const elegir = (lead: LeadParaLaCita) => {
    setTexto('')
    setAbierto(false)
    onElegir(lead)
  }

  if (enlace) {
    return (
      <div className="flex items-center gap-2 rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2.5 py-2">
        {enlace.estado ? <GlifoDeEstado estado={enlace.estado} tamano={15} /> : <Link2 className="h-[15px] w-[15px] shrink-0 text-[var(--ls-t3)]" aria-hidden />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] font-semibold text-[var(--ls-t1)]">{enlace.nombre}</span>
            {enlace.estado && <span className={`shrink-0 text-[11px] ${TEXTO.t3}`}>{COLD_STATUS_LABELS[enlace.estado]}</span>}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            {enlace.lista && <InsigniaDeLista nombre={enlace.lista} />}
            {enlace.responsable && nombres.get(enlace.responsable) && <span className={`truncate text-[11px] ${TEXTO.t4}`}>de {nombres.get(enlace.responsable)}</span>}
            {!enlace.lista && !enlace.responsable && <span className={`text-[11px] ${TEXTO.t4}`}>Enlazado a Cold Calling</span>}
          </div>
        </div>
        {puedeEditar && (
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={onActualizar} disabled={trayendo} className={`${BOTON.base} ${BOTON.secundario}`} title="Volver a traer los datos del lead a la ficha">
              {trayendo ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Traer datos
            </button>
            <button type="button" onClick={onQuitar} className={BOTON.icono} title="Quitar el enlace con este lead" aria-label="Quitar el enlace con este lead">
              <Unlink className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    )
  }

  if (!puedeEditar) return null

  const hayTexto = filtroDeBusqueda(texto) !== null
  const idLista = `${idDelCampo}-lista`

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-[7px] h-3.5 w-3.5 text-[var(--ls-t4)]" aria-hidden />
      <input
        id={idDelCampo}
        role="combobox"
        aria-expanded={abierto && hayTexto}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-activedescendant={abierto && resultados[activo] ? `${idDelCampo}-${activo}` : undefined}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value)
          setAbierto(true)
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setAbierto(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && resultados.length > 0) {
            e.preventDefault()
            setActivo((a) => Math.min(a + 1, resultados.length - 1))
          } else if (e.key === 'ArrowUp' && resultados.length > 0) {
            e.preventDefault()
            setActivo((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter' && abierto && resultados[activo]) {
            e.preventDefault()
            elegir(resultados[activo])
          } else if (e.key === 'Escape' && abierto && hayTexto) {
            // Cierra la lista, no la ficha entera
            e.preventDefault()
            e.stopPropagation()
            setAbierto(false)
          }
        }}
        placeholder="Buscar en Cold Calling: tienda, empresa, teléfono, correo…"
        autoComplete="off"
        className={`${CAMPO.input} pl-[27px] pr-7`}
      />
      {estado === 'buscando' && <Loader2 className="absolute right-2 top-[7px] h-3.5 w-3.5 animate-spin text-[var(--ls-t4)]" aria-label="Buscando" />}

      {abierto && hayTexto && estado !== 'buscando' && (
        <ul
          id={idLista}
          role="listbox"
          // Pulsar en la lista (también en su barra de desplazamiento) no le quita el foco al campo: si lo perdiera, la lista se cerraría antes de poder usarla
          onMouseDown={(e) => e.preventDefault()}
          className="absolute inset-x-0 top-[30px] z-50 max-h-[300px] overflow-y-auto rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] py-1 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)]"
        >
          {estado === 'error' && <li className={`px-2.5 py-2 text-[11.5px] ${TEXTO.t3}`}>No se pudo buscar. Prueba otra vez.</li>}
          {estado === 'listo' && resultados.length === 0 && (
            <li className={`px-2.5 py-2 text-[11.5px] ${TEXTO.t3}`}>Ningún lead coincide. Puedes escribir los datos a mano en la ficha.</li>
          )}
          {resultados.map((l, i) => {
            const dueno = l.assigned_to ? nombres.get(l.assigned_to) : null
            const detalle = [contactoDelLead(l) !== l.store_name ? contactoDelLead(l) : null, l.company && l.company !== l.store_name ? l.company : null, l.ciudad ?? null, l.phone ?? null]
              .filter(Boolean)
              .join(' · ')
            return (
              <li
                key={l.id}
                id={`${idDelCampo}-${i}`}
                role="option"
                aria-selected={i === activo}
                // mouseDown y no click: el campo pierde el foco al pulsar fuera de él y cerraría la lista antes de que el clic llegara
                onMouseDown={(e) => {
                  e.preventDefault()
                  elegir(l)
                }}
                onMouseEnter={() => setActivo(i)}
                className={`cursor-pointer px-2.5 py-1.5 ${i === activo ? 'bg-[var(--ls-sup3)]' : ''}`}
              >
                <div className="flex items-center gap-1.5">
                  <GlifoDeEstado estado={l.status} tamano={13} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-[var(--ls-t1)]">{l.store_name}</span>
                  <span className={`shrink-0 text-[11px] ${TEXTO.t3}`}>{COLD_STATUS_LABELS[l.status]}</span>
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 pl-[19px]">
                  <span className={`min-w-0 truncate text-[11.5px] ${TEXTO.t3}`}>{detalle || 'Sin más datos'}</span>
                  {l.source_list && <InsigniaDeLista nombre={l.source_list} />}
                  {dueno && <span className={`shrink-0 text-[11px] ${TEXTO.t4}`}>de {dueno}</span>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

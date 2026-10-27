'use client'

import { Mail, Phone, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ventasCompactas } from '@/lib/cold-calling/cifras'
import { haceCuanto } from '@/lib/cold-calling/fechas'
import {
  FILTRO_DE_LEADS_VACIO,
  LEADS_POR_PAGINA,
  MAXIMO_POR_OPERACION,
  NOMBRE_SIN_LISTA,
  SIN_DUENO,
  SIN_LISTA,
  hayFiltroDeLeads,
  type FilaDeLead,
  type FiltroDeLeads,
  type OrdenDeLeads,
  type PanoramaDeListas,
  type PersonaDelEquipo,
} from '@/lib/cold-calling/listas'
import {
  SELECCION_VACIA,
  alternar,
  alternarPagina,
  aPeticion,
  cuantosHay,
  estaElegido,
  haySeleccion,
  ofrecerElegirElFiltro,
  paginaAMedias,
  paginaCompleta,
  seleccionarElFiltro,
  type PeticionDeSeleccion,
  type Seleccion,
} from '@/lib/cold-calling/seleccion'
import { AVISO, BOTON, CAMPO, COLOR_ESTADO, TABLA } from '@/lib/estilo/denso'
import { COLD_NIVEL_LABELS, COLD_STATUSES, COLD_STATUS_LABELS, type ColdLeadStatus } from '@/lib/types/cold-leads'
import { InsigniaDeLista, InsigniaDeNivel } from '../ui'
import { buscarLeads } from './api'
import { Casilla, EstadoDelLead, Paginador, Selector, Vacio, numero } from './atomos'

/**
 * LA PESTAÑA «LEADS»: ver los leads con filtros y elegir varios a la vez para moverlos de lista o asignarlos.
 *
 * Se elige de tres maneras: uno a uno, la página entera con la casilla de la cabecera, o TODOS los que cumplen el filtro (aunque sean miles y estén en otras páginas) con
 * el botón que aparece al elegir la página entera. En este último caso se puede desmarcar a mano alguno, y el servidor vuelve a preguntar a la base en el momento de actuar
 * (lib/cold-calling/seleccion.ts). La selección vale solo para el filtro con el que se hizo: al cambiar el filtro se vacía.
 */

interface Props {
  filtro: FiltroDeLeads
  onFiltro: (f: FiltroDeLeads) => void
  panorama: PanoramaDeListas
  equipo: readonly PersonaDelEquipo[]
  nombres: Record<string, string>
  /** false = falta la migración 257: se ven los leads pero no se pueden mover */
  puedeCambiar: boolean
  /** Sube cada vez que algo cambia fuera de esta pestaña (se movieron leads…): se vuelve a pedir la página y se vacía la selección */
  version: number
  /** Pide mover o asignar lo elegido: la ventana la abre quien manda en la pantalla */
  onMover: (seleccion: PeticionDeSeleccion, filtro: FiltroDeLeads, cuantos: number) => void
}

const ORDENES: ReadonlyArray<{ valor: OrdenDeLeads; etiqueta: string }> = [
  { valor: 'prioridad', etiqueta: 'Mejores primero' },
  { valor: 'nombre', etiqueta: 'Nombre A-Z' },
  { valor: 'reciente', etiqueta: 'Último contacto' },
  { valor: 'nuevos', etiqueta: 'Más nuevos' },
]

const cifraDe = (l: FilaDeLead): string => {
  if (l.tipo_lead === 'tienda_online') {
    const v = ventasCompactas(l.ventas_estimadas_usd)
    return v ? `≈ ${v}` : '—'
  }
  if (l.revenue_monthly == null) return '—'
  const n = Number(l.revenue_monthly)
  return n >= 1000 ? `${Math.round(n / 1000).toLocaleString('es-ES')} k€` : `${Math.round(n)} €`
}

export function ExplorarLeads({ filtro, onFiltro, panorama, equipo, nombres, puedeCambiar, version, onMover }: Props) {
  const clave = JSON.stringify(filtro)
  const [pag, setPag] = useState({ clave, n: 0 })
  const pagina = pag.clave === clave ? pag.n : 0
  const [datos, setDatos] = useState<{ total: number; filas: FilaDeLead[] } | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [seleccion, setSeleccion] = useState<Seleccion>(SELECCION_VACIA)
  const [texto, setTexto] = useState(filtro.q)
  const aviso = useRef<ReturnType<typeof setTimeout> | null>(null)

  // La búsqueda de texto espera a que se deje de escribir; si el filtro cambia desde fuera (limpiar), la caja se pone al día
  useEffect(() => setTexto(filtro.q), [filtro.q])
  useEffect(
    () => () => {
      if (aviso.current) clearTimeout(aviso.current)
    },
    []
  )
  function escribir(v: string) {
    setTexto(v)
    if (aviso.current) clearTimeout(aviso.current)
    aviso.current = setTimeout(() => onFiltro({ ...filtro, q: v.trim() }), 300)
  }

  // Cambia el filtro o algo fuera de aquí: se vacía lo elegido (valía para el filtro de antes)
  useEffect(() => {
    setSeleccion(SELECCION_VACIA)
  }, [clave, version])

  // Pedir la página
  useEffect(() => {
    let vivo = true
    setCargando(true)
    void buscarLeads(filtro, pagina).then((r) => {
      if (!vivo) return
      setCargando(false)
      if (r.ok) {
        setDatos({ total: r.datos.total, filas: r.datos.filas })
        setError(null)
      } else setError(r.error)
    })
    return () => {
      vivo = false
    }
    // `filtro` se vigila por su clave: un objeto nuevo con lo mismo no vuelve a pedir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, pagina, version])

  const filas = datos?.filas ?? []
  const total = datos?.total ?? 0
  const idsDeLaPagina = useMemo(() => filas.map((f) => f.id), [filas])
  const elegidos = cuantosHay(seleccion, total)
  const nombreDe = (id: string | null) => (id ? (nombres[id] ?? 'Persona desconocida') : null)

  const opcionesDeLista = useMemo(
    () => [
      { valor: '', etiqueta: 'Todas las listas' },
      { valor: SIN_LISTA, etiqueta: NOMBRE_SIN_LISTA },
      ...panorama.listas.filter((l) => !l.archivada).map((l) => ({ valor: l.nombre, etiqueta: l.nombre })),
      ...panorama.listas.filter((l) => l.archivada).map((l) => ({ valor: l.nombre, etiqueta: `${l.nombre} (archivada)` })),
    ],
    [panorama.listas]
  )
  const opcionesDeDueno = useMemo(() => {
    const ids = new Set<string>(equipo.map((p) => p.id))
    for (const l of [...panorama.listas, ...(panorama.sinLista ? [panorama.sinLista] : [])]) for (const d of l.duenos) if (d.id) ids.add(d.id)
    return [
      { valor: '', etiqueta: 'Todos los dueños' },
      { valor: SIN_DUENO, etiqueta: 'Sin dueño' },
      ...[...ids].map((id) => ({ valor: id, etiqueta: nombres[id] ?? 'Persona desconocida' })).sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es')),
    ]
  }, [equipo, panorama, nombres])

  const cambiar = (c: Partial<FiltroDeLeads>) => onFiltro({ ...filtro, ...c })
  const hayFiltros = hayFiltroDeLeads(filtro)

  const puedeElegirElFiltro = total > 0 && total <= MAXIMO_POR_OPERACION
  const ofrecer = ofrecerElegirElFiltro(seleccion, idsDeLaPagina, total)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-[180px] max-w-[280px] flex-1 items-center">
          <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[var(--ls-t4)]" aria-hidden />
          <input value={texto} onChange={(e) => escribir(e.target.value)} placeholder="Buscar tienda, empresa, teléfono, web…" aria-label="Buscar leads" className={`${CAMPO.input} !h-7 pl-8`} />
        </label>
        <Selector valor={filtro.lista ?? ''} onCambiar={(v) => cambiar({ lista: v === '' ? null : v })} rotulo="Lista" opciones={opcionesDeLista} />
        <Selector valor={filtro.dueno ?? ''} onCambiar={(v) => cambiar({ dueno: v === '' ? null : v })} rotulo="Dueño" opciones={opcionesDeDueno} />
        <Selector
          valor={filtro.tipo ?? ''}
          onCambiar={(v) => cambiar({ tipo: v === '' ? null : (v as FiltroDeLeads['tipo']) })}
          rotulo="Si venden en Amazon o no"
          opciones={[
            { valor: '', etiqueta: 'Venden y no venden' },
            { valor: 'seller_amazon', etiqueta: 'Venden en Amazon' },
            { valor: 'tienda_online', etiqueta: 'No venden en Amazon' },
          ]}
        />
        <Selector valor={filtro.estado ?? ''} onCambiar={(v) => cambiar({ estado: v === '' ? null : (v as ColdLeadStatus) })} rotulo="Estado" opciones={[{ valor: '', etiqueta: 'Todos los estados' }, ...COLD_STATUSES.map((e) => ({ valor: e, etiqueta: COLD_STATUS_LABELS[e] }))]} />
        <Selector
          valor={filtro.vende ?? ''}
          onCambiar={(v) => cambiar({ vende: v === '' ? null : (v as FiltroDeLeads['vende']) })}
          rotulo="Lo comprobado de si vende en Amazon"
          opciones={[
            { valor: '', etiqueta: '¿Vende en Amazon? (todos)' },
            { valor: 'sin_comprobar', etiqueta: 'Sin comprobar' },
            { valor: 'vende', etiqueta: 'Comprobado: vende' },
            { valor: 'no_vende', etiqueta: 'Comprobado: no vende' },
          ]}
        />
        <Selector valor={filtro.nivel ? String(filtro.nivel) : ''} onCambiar={(v) => cambiar({ nivel: v === '' ? null : (Number(v) as 1 | 2 | 3) })} rotulo="Nivel de la tienda" opciones={[{ valor: '', etiqueta: 'Todos los niveles' }, ...[1, 2, 3].map((n) => ({ valor: String(n), etiqueta: `Nivel ${n} · ${COLD_NIVEL_LABELS[n]}` }))]} />
        <Selector
          valor={filtro.empresa ?? ''}
          onCambiar={(v) => cambiar({ empresa: v === '' ? null : (v as FiltroDeLeads['empresa']) })}
          rotulo="Tipo de empresa"
          opciones={[
            { valor: '', etiqueta: 'Sociedad y autónomo' },
            { valor: 'sociedad', etiqueta: 'Sociedad' },
            { valor: 'autonomo', etiqueta: 'Autónomo' },
            { valor: 'sin_tipo', etiqueta: 'Sin tipo de empresa' },
          ]}
        />
        <Selector valor={filtro.orden} onCambiar={(v) => cambiar({ orden: v as OrdenDeLeads })} rotulo="Orden" opciones={ORDENES.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta }))} />
        {hayFiltros && (
          <button type="button" onClick={() => onFiltro({ ...FILTRO_DE_LEADS_VACIO, orden: filtro.orden })} className={`${BOTON.chip} !h-7`}>
            <X className="h-3 w-3" aria-hidden /> Limpiar filtros
          </button>
        )}
      </div>

      {/* La selección y lo que se puede hacer con ella */}
      <div className="flex min-h-7 flex-wrap items-center gap-2 text-[12px] text-[var(--ls-t2)]" role="status" aria-live="polite">
        {haySeleccion(seleccion, total) ? (
          <>
            <span className="font-medium text-[var(--ls-t1)]">
              {seleccion.modo === 'filtro'
                ? `Elegidos los ${numero(elegidos)} que cumplen el filtro${seleccion.excluidos.size > 0 ? ` (menos ${numero(seleccion.excluidos.size)} que has quitado)` : ''}`
                : `${numero(elegidos)} ${elegidos === 1 ? 'elegido' : 'elegidos'}`}
            </span>
            <button type="button" disabled={!puedeCambiar} onClick={() => onMover(aPeticion(seleccion), filtro, elegidos)} className={`${BOTON.base} ${BOTON.primario} ${BOTON.alto}`} title={puedeCambiar ? undefined : 'Falta lanzar la migración 257'}>
              Mover o asignar…
            </button>
            <button type="button" onClick={() => setSeleccion(SELECCION_VACIA)} className={`${BOTON.base} ${BOTON.secundario}`}>
              Quitar la selección
            </button>
          </>
        ) : (
          <span className="text-[var(--ls-t3)]">
            {datos ? `${numero(total)} ${total === 1 ? 'lead' : 'leads'}${hayFiltros ? ' con estos filtros' : ''}` : 'Cargando…'} · Marca los que quieras mover o asignar.
          </span>
        )}
        {ofrecer &&
          (puedeElegirElFiltro ? (
            <button type="button" onClick={() => setSeleccion(seleccionarElFiltro())} className={`${BOTON.base} ${BOTON.secundario}`}>
              Elegir los {numero(total)} que cumplen el filtro
            </button>
          ) : (
            <span className="text-[var(--ls-e-ambar)]">Son {numero(total)}: de una vez se pueden mover hasta {numero(MAXIMO_POR_OPERACION)}. Afina el filtro.</span>
          ))}
      </div>

      {error && (
        <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.ambar }} role="alert">
          <p>{error}</p>
        </div>
      )}

      {/* La tabla */}
      <div className={`${TABLA.caja} !min-h-[300px]`}>
        <table className={TABLA.tabla}>
          <thead>
            <tr>
              <th className={`${TABLA.cabecera} w-8`}>
                <Casilla marcada={paginaCompleta(seleccion, idsDeLaPagina)} aMedias={paginaAMedias(seleccion, idsDeLaPagina)} onCambiar={() => setSeleccion(alternarPagina(seleccion, idsDeLaPagina))} rotulo="Elegir todos los de esta página" desactivada={filas.length === 0} />
              </th>
              <th className={TABLA.cabecera}>Tienda</th>
              <th className={TABLA.cabecera}>Ciudad</th>
              <th className={TABLA.cabecera}>Lista</th>
              <th className={TABLA.cabecera}>Dueño</th>
              <th className={TABLA.cabecera}>Estado</th>
              <th className={`${TABLA.cabecera} text-right`}>Intentos</th>
              <th className={TABLA.cabecera}>Último contacto</th>
              <th className={TABLA.cabecera}>Nivel</th>
              <th className={`${TABLA.cabecera} text-right`}>Ventas</th>
              <th className={TABLA.cabecera}>Datos</th>
            </tr>
          </thead>
          <tbody className={cargando && filas.length > 0 ? 'opacity-60' : ''}>
            {filas.length === 0 && (
              <tr>
                <td colSpan={11}>
                  <Vacio>{cargando ? 'Cargando leads…' : hayFiltros ? 'Ningún lead con estos filtros.' : 'Todavía no hay leads.'}</Vacio>
                </td>
              </tr>
            )}
            {filas.map((l) => {
              const elegido = estaElegido(seleccion, l.id)
              return (
                <tr key={l.id} className={`${TABLA.fila} ${elegido ? TABLA.filaSel : ''}`}>
                  <td className={TABLA.celda}>
                    <Casilla marcada={elegido} onCambiar={() => setSeleccion(alternar(seleccion, l.id))} rotulo={`Elegir ${l.store_name}`} />
                  </td>
                  <td className={`${TABLA.celda} max-w-[280px]`}>
                    <span className="block overflow-hidden text-ellipsis text-[var(--ls-t1)]" title={[l.store_name, l.company, l.web].filter(Boolean).join(' · ')}>
                      {l.store_name}
                      {l.company && l.company !== l.store_name && <span className="ml-1.5 text-[11px] text-[var(--ls-t4)]">{l.company}</span>}
                    </span>
                  </td>
                  <td className={`${TABLA.celda} text-[var(--ls-t3)]`}>{l.ciudad ?? '—'}</td>
                  <td className={TABLA.celda}>{l.source_list ? <InsigniaDeLista nombre={l.source_list.trim()} /> : <span className="text-[var(--ls-t4)]">—</span>}</td>
                  <td className={TABLA.celda}>{nombreDe(l.assigned_to) ?? <span className="text-[var(--ls-e-ambar)]">Sin dueño</span>}</td>
                  <td className={TABLA.celda}>
                    <EstadoDelLead estado={l.status as ColdLeadStatus} />
                  </td>
                  <td className={`${TABLA.celda} ${TABLA.numero}`}>{l.call_attempts > 0 ? numero(l.call_attempts) : <span className="text-[var(--ls-t4)]">0</span>}</td>
                  <td className={`${TABLA.celda} text-[var(--ls-t3)]`}>{l.last_contacted_at ? haceCuanto(l.last_contacted_at) : '—'}</td>
                  <td className={TABLA.celda}>{l.nivel ? <InsigniaDeNivel nivel={l.nivel} corta /> : <span className="text-[var(--ls-t4)]">—</span>}</td>
                  <td className={`${TABLA.celda} ${TABLA.numero} text-[var(--ls-t3)]`}>{cifraDe(l)}</td>
                  <td className={TABLA.celda}>
                    <span className="inline-flex items-center gap-1.5 text-[var(--ls-t4)]">
                      <Phone className={`h-3 w-3 ${l.phone ? 'text-[var(--ls-t2)]' : 'opacity-30'}`} aria-label={l.phone ? 'Tiene teléfono' : 'Sin teléfono'} />
                      <Mail className={`h-3 w-3 ${l.email ? 'text-[var(--ls-t2)]' : 'opacity-30'}`} aria-label={l.email ? 'Tiene correo' : 'Sin correo'} />
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] text-[var(--ls-t4)]">
          {datos && total > 0 ? `${numero(pagina * LEADS_POR_PAGINA + 1)}–${numero(Math.min((pagina + 1) * LEADS_POR_PAGINA, total))} de ${numero(total)}` : ''}
        </span>
        <Paginador pagina={pagina} porPagina={LEADS_POR_PAGINA} total={total} cargando={cargando} onPagina={(n) => setPag({ clave, n })} />
      </div>
    </div>
  )
}


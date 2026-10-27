'use client'

import { Archive, ArchiveRestore, Eye, Pencil, PlusCircle, Search, UserPlus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  ETIQUETA_DE_ORDEN_DE_LISTAS,
  ETIQUETA_DE_SITUACION,
  NOMBRE_SIN_LISTA,
  SIN_DUENO,
  SIN_LISTA,
  ordenarListas,
  situacionDeLista,
  type CriterioDeOrdenDeListas,
  type FilaDeResumen,
  type PanoramaDeListas,
  type PersonaDelEquipo,
  type ResumenDeLista,
  type TipoDeLista,
} from '@/lib/cold-calling/listas'
import { cargaPorPersona, filtrarListas, leadsTexto } from '@/lib/cold-calling/listas-vista'
import { haceCuanto } from '@/lib/cold-calling/fechas'
import { BOTON, CAMPO, TABLA, TARJETA, TITULO } from '@/lib/estilo/denso'
import { InsigniaDeLista } from '../ui'
import { BarraDeEstados, BarraDeUso, InsigniaDeTipo, Selector, Vacio, numero } from './atomos'

/**
 * LA PESTAÑA «LISTAS»: todas las listas de un vistazo y lo usadas y llamadas que están.
 *
 * Una fila por lista: de qué tipo es (los que venden en Amazon, los que no, o mezcla), a quién está asignada, cuántos leads tiene, cuánto de ella se ha trabajado, cómo
 * se reparten sus estados, cuántos se han llamado y cuándo fue la última vez que alguien la tocó. Debajo, lo mismo por persona: para decidir a quién asignar la
 * siguiente lista hay que ver cuánto trabajo pendiente tiene cada uno.
 */

interface Props {
  panorama: PanoramaDeListas
  filas: readonly FilaDeResumen[]
  equipo: readonly PersonaDelEquipo[]
  nombres: Record<string, string>
  /** false = falta la migración 257: se ve todo pero no se puede cambiar nada */
  puedeCambiar: boolean
  onVerLeads: (lista: string | null, persona: string | null) => void
  onAnadirTiendas: (lista: string) => void
  onNueva: () => void
  onRenombrar: (l: ResumenDeLista) => void
  onAsignar: (l: ResumenDeLista) => void
  onArchivar: (l: ResumenDeLista, archivar: boolean) => void
}

const TIPOS: ReadonlyArray<{ valor: TipoDeLista | 'todas'; etiqueta: string }> = [
  { valor: 'todas', etiqueta: 'Todas' },
  { valor: 'seller_amazon', etiqueta: 'Venden en Amazon' },
  { valor: 'tienda_online', etiqueta: 'No venden en Amazon' },
  { valor: 'mixto', etiqueta: 'Mezcla' },
]

const SITUACION_TITULO: Record<ReturnType<typeof situacionDeLista>, string> = {
  vacia: 'Todavía no tiene ningún lead',
  sin_tocar: 'Nadie ha empezado con esta lista',
  empezada: 'Menos de la cuarta parte trabajada',
  en_marcha: 'Entre la cuarta parte y los cuatro quintos trabajados',
  casi_agotada: 'Casi toda trabajada: toca meterle leads nuevos',
}

export function ResumenDeListas({ panorama, filas, equipo, nombres, puedeCambiar, onVerLeads, onAnadirTiendas, onNueva, onRenombrar, onAsignar, onArchivar }: Props) {
  const [texto, setTexto] = useState('')
  const [tipo, setTipo] = useState<TipoDeLista | 'todas'>('todas')
  const [archivadas, setArchivadas] = useState(false)
  const [persona, setPersona] = useState<string | null>(null)
  const [orden, setOrden] = useState<CriterioDeOrdenDeListas>('leads')

  const nombreDe = (id: string | null) => (id ? (nombres[id] ?? 'Persona desconocida') : 'Sin dueño')
  const hayArchivadas = panorama.listas.some((l) => l.archivada)

  const visibles = useMemo(() => ordenarListas(filtrarListas(panorama.listas, { texto, tipo, archivadas, persona }), orden), [panorama.listas, texto, tipo, archivadas, persona, orden])
  const carga = useMemo(() => cargaPorPersona(filas), [filas])
  const hayFiltros = texto !== '' || tipo !== 'todas' || persona !== null

  const opcionesDePersona = [
    { valor: '', etiqueta: 'Todas las personas' },
    { valor: SIN_DUENO, etiqueta: 'Con leads sin dueño' },
    ...equipo.map((p) => ({ valor: p.id, etiqueta: p.nombre })),
  ]

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* Barra de herramientas */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-[160px] max-w-[260px] flex-1 items-center">
          <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[var(--ls-t4)]" aria-hidden />
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar una lista…" aria-label="Buscar una lista" className={`${CAMPO.input} !h-7 pl-8`} />
        </label>
        <div role="group" aria-label="Tipo de lista" className="flex items-center gap-1">
          {TIPOS.map((t) => (
            <button key={t.valor} type="button" aria-pressed={tipo === t.valor} onClick={() => setTipo(t.valor)} className={`${BOTON.chip} !h-7 ${tipo === t.valor ? BOTON.chipEncendido : ''}`}>
              {t.etiqueta}
            </button>
          ))}
        </div>
        <Selector valor={persona ?? ''} onCambiar={(v) => setPersona(v === '' ? null : v)} rotulo="Filtrar por persona" opciones={opcionesDePersona} />
        <Selector valor={orden} onCambiar={(v) => setOrden(v as CriterioDeOrdenDeListas)} rotulo="Ordenar las listas" opciones={(Object.keys(ETIQUETA_DE_ORDEN_DE_LISTAS) as CriterioDeOrdenDeListas[]).map((k) => ({ valor: k, etiqueta: ETIQUETA_DE_ORDEN_DE_LISTAS[k] }))} />
        {hayArchivadas && (
          <button type="button" aria-pressed={archivadas} onClick={() => setArchivadas((v) => !v)} className={`${BOTON.chip} !h-7 ${archivadas ? BOTON.chipEncendido : ''}`}>
            <Archive className="h-3 w-3" aria-hidden /> Archivadas
          </button>
        )}
        {hayFiltros && (
          <button
            type="button"
            onClick={() => {
              setTexto('')
              setTipo('todas')
              setPersona(null)
            }}
            className={`${BOTON.chip} !h-7`}
          >
            <X className="h-3 w-3" aria-hidden /> Limpiar
          </button>
        )}
        <button type="button" onClick={onNueva} disabled={!puedeCambiar} className={`${BOTON.base} ${BOTON.primario} ${BOTON.alto} ml-auto`} title={puedeCambiar ? 'Crear una lista vacía' : 'Falta lanzar la migración 257'}>
          <PlusCircle className="h-3.5 w-3.5" aria-hidden /> Nueva lista
        </button>
      </div>

      {/* Las listas */}
      <div className={`${TABLA.caja} !flex-none max-h-[56vh]`}>
        <table className={TABLA.tabla}>
          <thead>
            <tr>
              <th className={`${TABLA.cabecera} ${TABLA.cabeceraFija} min-w-[190px]`}>Lista</th>
              <th className={TABLA.cabecera}>Tipo</th>
              <th className={TABLA.cabecera}>Asignada a</th>
              <th className={`${TABLA.cabecera} text-right`}>Leads</th>
              <th className={TABLA.cabecera}>Trabajados</th>
              <th className={TABLA.cabecera}>Estados</th>
              <th className={`${TABLA.cabecera} text-right`}>Llamados</th>
              <th className={TABLA.cabecera}>Última actividad</th>
              <th className={`${TABLA.cabecera} text-right`}>
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <Vacio>{hayFiltros ? 'Ninguna lista coincide con estos filtros.' : 'Todavía no hay ninguna lista. Crea la primera con «Nueva lista».'}</Vacio>
                </td>
              </tr>
            )}
            {visibles.map((l) => {
              const sit = situacionDeLista(l)
              const sinDueno = l.duenos.find((d) => d.id === null)?.n ?? 0
              const otros = l.duenos.filter((d) => d.id !== l.responsable)
              return (
                <tr key={l.clave} className={`${TABLA.fila} ${l.archivada ? 'opacity-60' : ''}`}>
                  <td className={`${TABLA.celda} ${TABLA.celdaFija}`}>
                    <button type="button" onClick={() => onVerLeads(l.nombre, null)} className="inline-flex items-center gap-1.5 text-left hover:underline" title={l.descripcion ?? `Ver los leads de ${l.nombre}`}>
                      <InsigniaDeLista nombre={l.nombre} />
                      {l.archivada && <span className="text-[10.5px] text-[var(--ls-t4)]">archivada</span>}
                      {!l.registrada && (
                        <span className="text-[10.5px] text-[var(--ls-t4)]" title="Tiene leads pero nadie la ha creado en el registro: se registra sola al lanzar la migración 257">
                          sin registrar
                        </span>
                      )}
                    </button>
                  </td>
                  <td className={TABLA.celda}>
                    <InsigniaDeTipo tipo={l.tipo} />
                  </td>
                  <td className={`${TABLA.celda} max-w-[260px]`}>
                    <div className="flex flex-col leading-tight">
                      <span className={l.responsable ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t4)]'}>{l.responsable ? nombreDe(l.responsable) : 'Sin responsable'}</span>
                      {otros.length > 0 && (
                        <span className="overflow-hidden text-ellipsis text-[10.5px] text-[var(--ls-t4)]" title={otros.map((d) => `${nombreDe(d.id)}: ${numero(d.n)}`).join(' · ')}>
                          {otros.slice(0, 3).map((d) => `${d.id ? nombreDe(d.id) : 'Sin dueño'} ${numero(d.n)}`).join(' · ')}
                          {otros.length > 3 ? ` · +${otros.length - 3}` : ''}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={`${TABLA.celda} ${TABLA.numero} font-medium text-[var(--ls-t1)]`}>
                    {numero(l.total)}
                    {sinDueno > 0 && (
                      <span className="ml-1 text-[10.5px] font-normal text-[var(--ls-e-ambar)]" title={`${leadsTexto(sinDueno)} sin dueño`}>
                        ({numero(sinDueno)} sin dueño)
                      </span>
                    )}
                  </td>
                  <td className={TABLA.celda}>
                    {l.total === 0 ? (
                      <span className="text-[11.5px] text-[var(--ls-t4)]">{ETIQUETA_DE_SITUACION.vacia}</span>
                    ) : (
                      <span className="inline-flex items-center gap-2" title={`${SITUACION_TITULO[sit]}. ${numero(l.trabajados)} de ${numero(l.total)} leads ya se han tocado.`}>
                        <BarraDeUso pct={l.pctTrabajados} />
                        <span className="text-[10.5px] text-[var(--ls-t4)]">{ETIQUETA_DE_SITUACION[sit]}</span>
                      </span>
                    )}
                  </td>
                  <td className={TABLA.celda}>
                    <BarraDeEstados estados={l.estados} />
                  </td>
                  <td className={`${TABLA.celda} ${TABLA.numero}`} title={`${numero(l.llamados)} leads con al menos un intento de llamada · ${numero(l.intentos)} intentos en total`}>
                    {numero(l.llamados)}
                    <span className="ml-1 text-[10.5px] text-[var(--ls-t4)]">/ {numero(l.intentos)} int.</span>
                  </td>
                  <td className={`${TABLA.celda} text-[var(--ls-t3)]`}>{l.ultimoContacto ? haceCuanto(l.ultimoContacto) : '—'}</td>
                  <td className={`${TABLA.celda} text-right`}>
                    <span className="inline-flex items-center gap-0.5">
                      <button type="button" className={BOTON.icono} onClick={() => onVerLeads(l.nombre, null)} title="Ver los leads de esta lista" aria-label={`Ver los leads de ${l.nombre}`}>
                        <Eye className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      {l.registrada && !l.archivada && (
                        <>
                          <button type="button" className={BOTON.icono} disabled={!puedeCambiar} onClick={() => onAsignar(l)} title="Asignar la lista a una persona" aria-label={`Asignar ${l.nombre} a una persona`}>
                            <UserPlus className="h-3.5 w-3.5" aria-hidden />
                          </button>
                          <button type="button" className={BOTON.icono} disabled={!puedeCambiar} onClick={() => onAnadirTiendas(l.nombre)} title="Añadir tiendas del banco a esta lista" aria-label={`Añadir tiendas a ${l.nombre}`}>
                            <PlusCircle className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </>
                      )}
                      {l.registrada && (
                        <>
                          <button type="button" className={BOTON.icono} disabled={!puedeCambiar} onClick={() => onRenombrar(l)} title="Cambiar el nombre" aria-label={`Renombrar ${l.nombre}`}>
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                          </button>
                          <button type="button" className={BOTON.icono} disabled={!puedeCambiar} onClick={() => onArchivar(l, !l.archivada)} title={l.archivada ? 'Recuperar la lista' : 'Archivar la lista (deja de ofrecerse como destino; sus leads no se tocan)'} aria-label={l.archivada ? `Recuperar ${l.nombre}` : `Archivar ${l.nombre}`}>
                            {l.archivada ? <ArchiveRestore className="h-3.5 w-3.5" aria-hidden /> : <Archive className="h-3.5 w-3.5" aria-hidden />}
                          </button>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              )
            })}
            {panorama.sinLista && !hayFiltros && (
              <tr className={TABLA.fila}>
                <td className={`${TABLA.celda} ${TABLA.celdaFija} italic text-[var(--ls-t3)]`}>
                  <button type="button" onClick={() => onVerLeads(SIN_LISTA, null)} className="hover:underline">
                    {NOMBRE_SIN_LISTA}
                  </button>
                </td>
                <td className={TABLA.celda}>
                  <InsigniaDeTipo tipo={panorama.sinLista.tipo} />
                </td>
                <td className={`${TABLA.celda} text-[var(--ls-t4)]`}>—</td>
                <td className={`${TABLA.celda} ${TABLA.numero} font-medium text-[var(--ls-t1)]`}>{numero(panorama.sinLista.total)}</td>
                <td className={TABLA.celda}>
                  <BarraDeUso pct={panorama.sinLista.pctTrabajados} />
                </td>
                <td className={TABLA.celda}>
                  <BarraDeEstados estados={panorama.sinLista.estados} />
                </td>
                <td className={`${TABLA.celda} ${TABLA.numero}`}>{numero(panorama.sinLista.llamados)}</td>
                <td className={`${TABLA.celda} text-[var(--ls-t3)]`}>{panorama.sinLista.ultimoContacto ? haceCuanto(panorama.sinLista.ultimoContacto) : '—'}</td>
                <td className={`${TABLA.celda} text-right`}>
                  <button type="button" className={BOTON.icono} onClick={() => onVerLeads(SIN_LISTA, null)} title="Ver los leads que no están en ninguna lista" aria-label="Ver los leads sin lista">
                    <Eye className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Por persona */}
      <section aria-labelledby="listas-por-persona" className={TARJETA.base}>
        <div className={`${TARJETA.cabecera} !h-auto min-h-[30px] flex-wrap py-1`}>
          <h3 id="listas-por-persona" className={TITULO.seccion}>
            Trabajo de cada persona
          </h3>
          <span className="text-[11px] text-[var(--ls-t4)]">Para decidir a quién asignar la siguiente lista</span>
        </div>
        <div className="overflow-x-auto">
          <table className={`${TABLA.tabla} !min-w-0`}>
            <thead>
              <tr>
                <th className={TABLA.cabecera}>Persona</th>
                <th className={`${TABLA.cabecera} text-right`}>Listas</th>
                <th className={`${TABLA.cabecera} text-right`}>Leads</th>
                <th className={`${TABLA.cabecera} text-right`}>Sin tocar</th>
                <th className={TABLA.cabecera}>Trabajados</th>
                <th className={`${TABLA.cabecera} text-right`}>Llamados</th>
                <th className={TABLA.cabecera}>Última actividad</th>
                <th className={`${TABLA.cabecera} text-right`}>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {carga.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <Vacio>Todavía no hay leads asignados a nadie.</Vacio>
                  </td>
                </tr>
              )}
              {carga.map((c) => {
                const p = c.id ? equipo.find((x) => x.id === c.id) : undefined
                return (
                  <tr key={c.id ?? 'sin-dueno'} className={TABLA.fila}>
                    <td className={`${TABLA.celda} ${c.id ? 'text-[var(--ls-t1)]' : 'italic text-[var(--ls-t3)]'}`}>
                      {nombreDe(c.id)}
                      {p && !p.coldCalling && (
                        <span className="ml-1.5 text-[10.5px] text-[var(--ls-e-ambar)]" title="No tiene la casilla de Cold Calling: no ve estos leads">
                          sin acceso a Cold Calling
                        </span>
                      )}
                    </td>
                    <td className={`${TABLA.celda} ${TABLA.numero}`}>{numero(c.listas)}</td>
                    <td className={`${TABLA.celda} ${TABLA.numero} font-medium text-[var(--ls-t1)]`}>{numero(c.total)}</td>
                    <td className={`${TABLA.celda} ${TABLA.numero}`}>{numero(c.pendientes)}</td>
                    <td className={TABLA.celda}>
                      <BarraDeUso pct={c.pctTrabajados} />
                    </td>
                    <td className={`${TABLA.celda} ${TABLA.numero}`} title={`${numero(c.intentos)} intentos de llamada en total`}>
                      {numero(c.llamados)}
                    </td>
                    <td className={`${TABLA.celda} text-[var(--ls-t3)]`}>{c.ultimoContacto ? haceCuanto(c.ultimoContacto) : '—'}</td>
                    <td className={`${TABLA.celda} text-right`}>
                      <span className="inline-flex items-center gap-1">
                        <button type="button" className={`${BOTON.base} ${BOTON.secundario}`} onClick={() => setPersona(c.id ?? SIN_DUENO)} title="Enseñar solo sus listas">
                          Sus listas
                        </button>
                        <button type="button" className={`${BOTON.base} ${BOTON.secundario}`} onClick={() => onVerLeads(null, c.id ?? SIN_DUENO)} title="Ver sus leads">
                          <Eye className="h-3 w-3" aria-hidden /> Sus leads
                        </button>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

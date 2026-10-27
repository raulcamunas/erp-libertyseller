'use client'

import { Mail, Phone, PlusCircle, Search, UserRound, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ETIQUETA_DE_TRAMO,
  FILTRO_DE_BANCO_VACIO,
  MAXIMO_DEL_BANCO_POR_OPERACION,
  TIENDAS_POR_PAGINA,
  type FilaDelBanco,
  type FiltroDeBanco,
  type PanoramaDeListas,
  type PersonaDelEquipo,
  type ResumenDelBanco,
} from '@/lib/cold-calling/listas'
import { tiendasTexto } from '@/lib/cold-calling/listas-vista'
import { ventasCompactas } from '@/lib/cold-calling/cifras'
import { SELECCION_VACIA, alternar, alternarPagina, cuantosHay, paginaAMedias, paginaCompleta, type Seleccion } from '@/lib/cold-calling/seleccion'
import { AVISO, BOTON, CAMPO, CIFRAS, COLOR_ESTADO, TABLA, TARJETA } from '@/lib/estilo/denso'
import { InsigniaDeLista, InsigniaDeNivel } from '../ui'
import { buscarEnElBanco, cargarResumenDelBanco } from './api'
import { Casilla, Paginador, Selector, Vacio, numero } from './atomos'
import { opcionesDePersonas } from './DialogosDeListas'

/**
 * LA PESTAÑA «BANCO»: las tiendas del Excel «Tienda no Amazon» que todavía no se han repartido, para meterlas en una lista.
 *
 * Se filtran por nivel (el 1 son las mejores), tramo, tipo de empresa, categoría, plataforma, ciudad, si tienen teléfono, correo o decisor y cuánto venden. Se pueden
 * elegir a mano o pedir «las primeras N que cumplen el filtro», que salen por orden de prioridad (nivel y ventas). Siempre hay que decir a qué lista van y de quién serán.
 * Una tienda cuya web ya está entre los leads no se duplica: el servidor la enlaza y lo cuenta.
 */

const POR_LA_LISTA = '__la_lista__'

/**
 * Se abre en «A y B · Para llamar»: dentro de los niveles 1 a 3 hay tiendas de solo correo (C) y las grandes cuentas de Alejandro (G), que son las que más venden, y sin
 * elegir tramo «las primeras N» las cogería antes que ninguna otra. Elegir «Todos los tramos» o cualquier otro es una decisión, no un descuido.
 */
const FILTRO_INICIAL: FiltroDeBanco = { ...FILTRO_DE_BANCO_VACIO, tramo: 'AB' }

const esDescartada = (t: FilaDelBanco): boolean => t.nivel === 4 || (t.tramo ?? '').trim().toUpperCase().startsWith('D')

/** Una tienda se puede añadir a una lista si no se ha repartido ya y no está descartada (nivel 4 o tramo D) */
const sePuedeAnadir = (t: FilaDelBanco): boolean => !t.repartida && !esDescartada(t)

/** Lo que conviene saber del tramo elegido antes de añadir */
const AVISO_DEL_TRAMO: Partial<Record<NonNullable<FiltroDeBanco['tramo']> | 'todos', string>> = {
  todos: 'Sin elegir tramo entran también las de solo correo (C) y las grandes cuentas de Alejandro (G), que son las que más venden.',
  C: 'Las de tramo C son para correo (Instantly), no para llamar.',
  G: 'Las de tramo G son las grandes cuentas de Alejandro.',
  D: 'Las de tramo D están descartadas: se pueden mirar pero no se reparten.',
}

interface Props {
  panorama: PanoramaDeListas
  equipo: readonly PersonaDelEquipo[]
  nombres: Record<string, string>
  /** false = falta la migración 257 */
  puedeCambiar: boolean
  /** Sube cuando algo cambia fuera de aquí: se vuelve a pedir y se vacía lo elegido */
  version: number
  /** La lista de destino elegida. Vive en la pantalla para que no se pierda al cambiar de pestaña, y viene preelegida al pulsar «Añadir tiendas» en una fila de la tabla de listas */
  lista: string
  onLista: (nombre: string) => void
  onNuevaLista: () => void
  /** Pide añadir: a mano (dominios) o las primeras N de un filtro. La ventana de confirmar la abre quien manda en la pantalla */
  onAnadir: (peticion: { dominios: string[] } | { filtro: FiltroDeBanco; primeras: number }, cuantas: number, lista: string, dueno: string | null) => void
}

const VENTAS_MINIMAS = [
  { valor: '', etiqueta: 'Cualquier venta' },
  { valor: '5000', etiqueta: 'Más de 5 k$ al mes' },
  { valor: '10000', etiqueta: 'Más de 10 k$ al mes' },
  { valor: '25000', etiqueta: 'Más de 25 k$ al mes' },
  { valor: '50000', etiqueta: 'Más de 50 k$ al mes' },
  { valor: '100000', etiqueta: 'Más de 100 k$ al mes' },
]

export function BancoDeTiendas({ panorama, equipo, nombres, puedeCambiar, version, lista, onLista, onNuevaLista, onAnadir }: Props) {
  const [filtro, setFiltro] = useState<FiltroDeBanco>(FILTRO_INICIAL)
  const clave = JSON.stringify(filtro)
  const [pag, setPag] = useState({ clave, n: 0 })
  const pagina = pag.clave === clave ? pag.n : 0
  const [datos, setDatos] = useState<{ total: number; filas: FilaDelBanco[] } | null>(null)
  const [resumen, setResumen] = useState<ResumenDelBanco | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [seleccion, setSeleccion] = useState<Seleccion>(SELECCION_VACIA)
  const [texto, setTexto] = useState('')
  const [ciudad, setCiudad] = useState('')
  const [dueno, setDueno] = useState(POR_LA_LISTA)
  const [primeras, setPrimeras] = useState('100')
  const aviso = useRef<ReturnType<typeof setTimeout> | null>(null)

  const listasDestino = useMemo(() => panorama.listas.filter((l) => l.registrada && !l.archivada), [panorama.listas])
  // Si la lista elegida todavía no está en el panel (se acaba de crear y el panel se está poniendo al día) o se ha archivado, no hay destino: los botones esperan
  const listaElegida = listasDestino.find((l) => l.nombre === lista) ?? null

  useEffect(
    () => () => {
      if (aviso.current) clearTimeout(aviso.current)
    },
    []
  )
  function escribir(v: string, campo: 'q' | 'ciudad') {
    if (campo === 'q') setTexto(v)
    else setCiudad(v)
    if (aviso.current) clearTimeout(aviso.current)
    aviso.current = setTimeout(() => setFiltro((f) => ({ ...f, [campo]: v.trim() })), 300)
  }

  useEffect(() => {
    setSeleccion(SELECCION_VACIA)
  }, [clave, version])

  // El resumen del banco (cuántas quedan, por nivel, categorías y plataformas)
  useEffect(() => {
    let vivo = true
    void cargarResumenDelBanco().then((r) => {
      if (!vivo) return
      if (r.ok) setResumen(r.datos.resumen)
      else setError(r.error)
    })
    return () => {
      vivo = false
    }
  }, [version])

  // Las tiendas
  useEffect(() => {
    let vivo = true
    setCargando(true)
    void buscarEnElBanco(filtro, pagina).then((r) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, pagina, version])

  const filas = datos?.filas ?? []
  const total = datos?.total ?? 0
  const libresEnPagina = useMemo(() => filas.filter(sePuedeAnadir).map((f) => f.dominio), [filas])
  const elegidas = cuantosHay(seleccion, total)
  const cambiar = (c: Partial<FiltroDeBanco>) => setFiltro((f) => ({ ...f, ...c }))
  const hayFiltros = JSON.stringify({ ...filtro, incluirRepartidas: false }) !== JSON.stringify(FILTRO_INICIAL)
  const avisoDelTramo = AVISO_DEL_TRAMO[filtro.tramo ?? 'todos']

  const duenoFinal: string | null = dueno === POR_LA_LISTA ? (listaElegida?.responsable ?? null) : dueno === '' ? null : dueno
  const nPrimeras = Math.min(Math.max(Math.trunc(Number(primeras)) || 0, 0), MAXIMO_DEL_BANCO_POR_OPERACION)
  // «las primeras N» solo tiene sentido sobre las que quedan libres: con «Ya repartidas» puesto, la cuenta incluiría las que ya no se pueden añadir
  const hayLibres = !!datos && total > 0 && !filtro.incluirRepartidas
  const nombreDelDueno = duenoFinal ? (nombres[duenoFinal] ?? 'esa persona') : null

  const opcionesDeCategoria = [{ valor: '', etiqueta: 'Todas las categorías' }, ...(resumen?.categorias ?? []).map((c) => ({ valor: c.nombre, etiqueta: `${c.nombre} (${numero(c.n)})` }))]
  const opcionesDePlataforma = [{ valor: '', etiqueta: 'Todas las plataformas' }, ...(resumen?.plataformas ?? []).map((c) => ({ valor: c.nombre, etiqueta: `${c.nombre} (${numero(c.n)})` }))]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Cuántas quedan */}
      {resumen && (
        <div className={`${CIFRAS.tira} max-w-full overflow-x-auto`} role="group" aria-label="Resumen del banco">
          <div className={CIFRAS.celda} title="Las que se pueden añadir a una lista ahora mismo: no están repartidas ni descartadas">
            <span className={CIFRAS.valor}>{numero(resumen.libres)}</span>
            <span className={CIFRAS.rotulo}>por repartir</span>
          </div>
          {[1, 2, 3].map((n) => (
            <div key={n} className={CIFRAS.celda}>
              <span className={CIFRAS.valor}>{numero(resumen.por_nivel[String(n)] ?? 0)}</span>
              <span className={CIFRAS.rotulo}>de nivel {n}</span>
            </div>
          ))}
          {resumen.total - resumen.libres - resumen.descartadas > 0 && (
            <div className={CIFRAS.celda} title="Ya son un lead de alguna lista">
              <span className={CIFRAS.valor}>{numero(resumen.total - resumen.libres - resumen.descartadas)}</span>
              <span className={CIFRAS.rotulo}>ya repartidas</span>
            </div>
          )}
          {resumen.descartadas > 0 && (
            <div className={CIFRAS.celda} title="Las descartadas (nivel 4 o tramo D) no se pueden repartir">
              <span className={CIFRAS.valor}>{numero(resumen.descartadas)}</span>
              <span className={CIFRAS.rotulo}>descartadas</span>
            </div>
          )}
        </div>
      )}

      {resumen && resumen.total === 0 && (
        <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
          <p>
            <span className={AVISO.fuerte}>El banco está vacío.</span> Las tiendas del Excel «Tienda no Amazon» todavía no se han cargado. Cuando se carguen, salen aquí.
          </p>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-[170px] max-w-[260px] flex-1 items-center">
          <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[var(--ls-t4)]" aria-hidden />
          <input value={texto} onChange={(e) => escribir(e.target.value, 'q')} placeholder="Buscar tienda, empresa o dominio…" aria-label="Buscar en el banco" className={`${CAMPO.input} !h-7 pl-8`} />
        </label>
        <div role="group" aria-label="Nivel" className="flex items-center gap-1">
          {[1, 2, 3].map((n) => (
            <button key={n} type="button" aria-pressed={filtro.nivel === n} onClick={() => cambiar({ nivel: filtro.nivel === n ? null : (n as 1 | 2 | 3) })} className={`${BOTON.chip} !h-7 ${filtro.nivel === n ? BOTON.chipEncendido : ''}`}>
              Nivel {n}
            </button>
          ))}
        </div>
        <Selector
          valor={filtro.tramo ?? ''}
          onCambiar={(v) => cambiar({ tramo: v === '' ? null : (v as FiltroDeBanco['tramo']) })}
          rotulo="Tramo"
          opciones={[{ valor: '', etiqueta: 'Todos los tramos (sin descartadas)' }, ...(Object.keys(ETIQUETA_DE_TRAMO) as Array<keyof typeof ETIQUETA_DE_TRAMO>).map((k) => ({ valor: k, etiqueta: ETIQUETA_DE_TRAMO[k] }))]}
        />
        <Selector
          valor={filtro.empresa ?? ''}
          onCambiar={(v) => cambiar({ empresa: v === '' ? null : (v as FiltroDeBanco['empresa']) })}
          rotulo="Tipo de empresa"
          opciones={[
            { valor: '', etiqueta: 'Sociedad y autónomo' },
            { valor: 'sociedad', etiqueta: 'Sociedad' },
            { valor: 'autonomo', etiqueta: 'Autónomo' },
            { valor: 'sin_tipo', etiqueta: 'Sin tipo de empresa' },
          ]}
        />
        <Selector valor={filtro.categoria ?? ''} onCambiar={(v) => cambiar({ categoria: v === '' ? null : v })} rotulo="Categoría" opciones={opcionesDeCategoria} ancho="max-w-[220px]" />
        <Selector valor={filtro.plataforma ?? ''} onCambiar={(v) => cambiar({ plataforma: v === '' ? null : v })} rotulo="Plataforma de la tienda" opciones={opcionesDePlataforma} />
        <input value={ciudad} onChange={(e) => escribir(e.target.value, 'ciudad')} placeholder="Ciudad…" aria-label="Ciudad" className={`${CAMPO.input} !h-7 !w-[110px]`} />
        <Selector valor={filtro.ventasMin === null ? '' : String(filtro.ventasMin)} onCambiar={(v) => cambiar({ ventasMin: v === '' ? null : Number(v) })} rotulo="Ventas mínimas al mes" opciones={VENTAS_MINIMAS} />
        {(
          [
            ['conTelefono', 'Con teléfono'],
            ['conEmail', 'Con correo'],
            ['conDecisor', 'Con decisor'],
          ] as const
        ).map(([campo, etiqueta]) => (
          <button key={campo} type="button" aria-pressed={filtro[campo]} onClick={() => cambiar({ [campo]: !filtro[campo] })} className={`${BOTON.chip} !h-7 ${filtro[campo] ? BOTON.chipEncendido : ''}`}>
            {etiqueta}
          </button>
        ))}
        <button type="button" aria-pressed={filtro.incluirRepartidas} onClick={() => cambiar({ incluirRepartidas: !filtro.incluirRepartidas })} className={`${BOTON.chip} !h-7 ${filtro.incluirRepartidas ? BOTON.chipEncendido : ''}`} title="Enseñar también las que ya se han repartido">
          Ya repartidas
        </button>
        {hayFiltros && (
          <button
            type="button"
            onClick={() => {
              setFiltro(FILTRO_INICIAL)
              setTexto('')
              setCiudad('')
            }}
            className={`${BOTON.chip} !h-7`}
          >
            <X className="h-3 w-3" aria-hidden /> Limpiar filtros
          </button>
        )}
      </div>

      {/* A qué lista van y de quién serán */}
      <section className={`${TARJETA.base} px-2.5 py-2`} aria-label="Añadir a una lista">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-[var(--ls-t4)]">Añadir a</span>
          <Selector valor={listaElegida ? lista : ''} onCambiar={onLista} rotulo="Lista de destino" ancho="max-w-[220px]" opciones={[{ valor: '', etiqueta: 'Elige una lista…' }, ...listasDestino.map((l) => ({ valor: l.nombre, etiqueta: l.nombre }))]} />
          <button type="button" onClick={onNuevaLista} disabled={!puedeCambiar} className={`${BOTON.chip} !h-7`} title="Crear una lista nueva para estas tiendas">
            <PlusCircle className="h-3 w-3" aria-hidden /> Nueva lista
          </button>
          <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--ls-t4)]">
            <UserRound className="h-3 w-3" aria-hidden /> Serán de
          </span>
          <Selector
            valor={dueno}
            onCambiar={setDueno}
            rotulo="De quién serán los leads"
            ancho="max-w-[220px]"
            opciones={[
              { valor: POR_LA_LISTA, etiqueta: listaElegida?.responsable ? `El responsable de la lista (${nombres[listaElegida.responsable] ?? '…'})` : 'El responsable de la lista (nadie)' },
              { valor: '', etiqueta: 'Nadie (sin dueño)' },
              ...opcionesDePersonas(equipo),
            ]}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!puedeCambiar || !listaElegida || elegidas === 0}
            onClick={() => listaElegida && seleccion.modo === 'ids' && onAnadir({ dominios: [...seleccion.ids] }, elegidas, listaElegida.nombre, duenoFinal)}
            className={`${BOTON.base} ${BOTON.primario} ${BOTON.alto}`}
            title={!puedeCambiar ? 'Falta lanzar la migración 257' : !listaElegida ? 'Elige primero la lista' : elegidas === 0 ? 'Marca las tiendas de la tabla' : undefined}
          >
            Añadir las {numero(elegidas)} elegidas
          </button>
          <span className="text-[11.5px] text-[var(--ls-t4)]">o</span>
          <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ls-t2)]">
            las primeras
            <input
              type="number"
              min={1}
              max={MAXIMO_DEL_BANCO_POR_OPERACION}
              value={primeras}
              onChange={(e) => setPrimeras(e.target.value)}
              aria-label="Cuántas tiendas añadir"
              className={`${CAMPO.input} !h-7 !w-[78px] text-right tabular-nums`}
            />
            que cumplen los filtros
          </span>
          <button
            type="button"
            disabled={!puedeCambiar || !listaElegida || nPrimeras === 0 || !hayLibres}
            onClick={() => listaElegida && onAnadir({ filtro, primeras: nPrimeras }, Math.min(nPrimeras, total), listaElegida.nombre, duenoFinal)}
            className={`${BOTON.base} ${BOTON.secundario} ${BOTON.alto}`}
            title={!listaElegida ? 'Elige primero la lista' : filtro.incluirRepartidas ? 'Quita «Ya repartidas» para añadir las primeras' : `Por orden de prioridad: nivel y ventas. Como mucho ${numero(MAXIMO_DEL_BANCO_POR_OPERACION)} de una vez.`}
          >
            Añadir las {numero(Math.min(nPrimeras, Math.max(total, 0)))}
          </button>
          {listaElegida && (
            <span className="text-[11.5px] text-[var(--ls-t3)]">
              Irán a «{listaElegida.nombre}», {nombreDelDueno ? `asignadas a ${nombreDelDueno}` : 'sin dueño'}.
            </span>
          )}
        </div>
        {avisoDelTramo && <p className={`mt-1.5 text-[11.5px] ${filtro.tramo === null ? 'text-[var(--ls-e-ambar)]' : 'text-[var(--ls-t3)]'}`}>{avisoDelTramo}</p>}
      </section>

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
                <Casilla marcada={paginaCompleta(seleccion, libresEnPagina)} aMedias={paginaAMedias(seleccion, libresEnPagina)} onCambiar={() => setSeleccion(alternarPagina(seleccion, libresEnPagina))} rotulo="Elegir todas las libres de esta página" desactivada={libresEnPagina.length === 0} />
              </th>
              <th className={TABLA.cabecera}>Tienda</th>
              <th className={TABLA.cabecera}>Ciudad</th>
              <th className={TABLA.cabecera}>Categoría</th>
              <th className={TABLA.cabecera}>Nivel</th>
              <th className={TABLA.cabecera}>Tramo</th>
              <th className={`${TABLA.cabecera} text-right`}>Ventas al mes</th>
              <th className={TABLA.cabecera}>Plataforma</th>
              <th className={TABLA.cabecera}>Empresa</th>
              <th className={TABLA.cabecera}>Datos</th>
              <th className={TABLA.cabecera}>Situación</th>
            </tr>
          </thead>
          <tbody className={cargando && filas.length > 0 ? 'opacity-60' : ''}>
            {filas.length === 0 && (
              <tr>
                <td colSpan={11}>
                  <Vacio>{cargando ? 'Cargando tiendas…' : resumen && resumen.total === 0 ? 'El banco está vacío.' : hayFiltros ? 'Ninguna tienda con estos filtros.' : 'No queda ninguna tienda por repartir.'}</Vacio>
                </td>
              </tr>
            )}
            {filas.map((t) => {
              const elegida = seleccion.modo === 'ids' && seleccion.ids.has(t.dominio)
              return (
                <tr key={t.dominio} className={`${TABLA.fila} ${elegida ? TABLA.filaSel : ''} ${!sePuedeAnadir(t) ? 'opacity-60' : ''}`}>
                  <td className={TABLA.celda}>
                    <Casilla marcada={elegida} desactivada={!sePuedeAnadir(t)} onCambiar={() => setSeleccion(alternar(seleccion, t.dominio))} rotulo={`Elegir ${t.tienda}`} />
                  </td>
                  <td className={`${TABLA.celda} max-w-[260px]`}>
                    <span className="block overflow-hidden text-ellipsis text-[var(--ls-t1)]" title={`${t.tienda} · ${t.dominio}${t.razon_social ? ` · ${t.razon_social}` : ''}`}>
                      {t.tienda}
                      <span className="ml-1.5 text-[11px] text-[var(--ls-t4)]">{t.dominio}</span>
                    </span>
                  </td>
                  <td className={`${TABLA.celda} text-[var(--ls-t3)]`}>{t.ciudad ?? '—'}</td>
                  <td className={`${TABLA.celda} max-w-[170px] text-[var(--ls-t3)]`}>
                    <span className={TABLA.corta}>{t.categoria}</span>
                  </td>
                  <td className={TABLA.celda}>{t.nivel && t.nivel <= 3 ? <InsigniaDeNivel nivel={t.nivel} corta /> : <span className="text-[var(--ls-t4)]">—</span>}</td>
                  <td className={`${TABLA.celda} text-[var(--ls-t3)]`}>{t.tramo ?? '—'}</td>
                  <td className={`${TABLA.celda} ${TABLA.numero} text-[var(--ls-t2)]`}>{ventasCompactas(t.ventas) ?? '—'}</td>
                  <td className={`${TABLA.celda} text-[var(--ls-t3)]`}>{t.plataforma ?? '—'}</td>
                  <td className={`${TABLA.celda} text-[var(--ls-t3)]`}>{t.tipo_empresa === 'sociedad' ? 'Sociedad' : t.tipo_empresa === 'autonomo' ? 'Autónomo' : '—'}</td>
                  <td className={TABLA.celda}>
                    <span className="inline-flex items-center gap-1.5">
                      <Phone className={`h-3 w-3 ${t.telefono ? 'text-[var(--ls-t2)]' : 'opacity-30'}`} aria-label={t.telefono ? 'Tiene teléfono' : 'Sin teléfono'} />
                      <Mail className={`h-3 w-3 ${t.email ? 'text-[var(--ls-t2)]' : 'opacity-30'}`} aria-label={t.email ? 'Tiene correo' : 'Sin correo'} />
                      <UserRound className={`h-3 w-3 ${t.decisor ? 'text-[var(--ls-t2)]' : 'opacity-30'}`} aria-label={t.decisor ? `Decisor: ${t.decisor}` : 'Sin decisor'} />
                    </span>
                  </td>
                  <td className={TABLA.celda}>
                    {t.repartida ? (
                      <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--ls-t3)]">
                        Repartida{t.lista && <InsigniaDeLista nombre={t.lista} />}
                      </span>
                    ) : esDescartada(t) ? (
                      <span className="text-[11.5px] text-[var(--ls-t4)]" title="Descartada: no se puede repartir">
                        Descartada
                      </span>
                    ) : (
                      <span className="text-[11.5px] text-[var(--ls-e-verde)]">Libre</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] text-[var(--ls-t4)]">{datos ? `${numero(total)} ${total === 1 ? 'tienda' : 'tiendas'}${hayFiltros ? ' con estos filtros' : ''}${total > 0 ? ` · ${tiendasTexto(libresEnPagina.length)} libres en esta página` : ''}` : ''}</span>
        <Paginador pagina={pagina} porPagina={TIENDAS_POR_PAGINA} total={total} cargando={cargando} onPagina={(n) => setPag({ clave, n })} />
      </div>
    </div>
  )
}

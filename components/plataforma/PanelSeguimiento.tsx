'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Hand,
  Inbox,
  Info,
  RotateCcw,
  Save,
  Search,
  Settings2,
} from 'lucide-react'
import { toast } from 'sonner'
import { getAmazon, patchAmazon } from '@/lib/amazon/client'
import type {
  CatalogoRespuesta,
  ClienteConIngesta,
  FilaCatalogo,
  FiltroSeguimiento,
  MarcarRespuesta,
  ReglaActivos,
  ReglaRespuesta,
} from '@/lib/plataforma/cliente'
import type { OrdenTope } from '@/lib/plataforma/tipos'
import {
  BOTON,
  CAMPO,
  COLOR_ESTADO,
  ESTADO,
  LINEA,
  PANTALLA,
  RADIO,
  SUPERFICIE,
  TABLA,
  TEXTO,
  TIPO,
  TITULO,
} from '@/lib/estilo/denso'
import type { SkuAbierto } from './PlataformaBoard'
import { Aviso, Cargando, Dialogo, Panel, Vacio, cifra, dinero, nombreMarketplace } from './comun'

/**
 * EL CRITERIO DE «SKU ACTIVO» Y LA TABLA DE SKU.
 *
 * Las dos mitades de la misma decisión, y por eso están en la misma pantalla:
 *
 *   · ARRIBA, LA REGLA. El criterio del cliente, configurable sin tocar código,
 *     que es lo que pide la especificación literalmente. Decide de qué SKU nos
 *     ocupamos CADA NOCHE.
 *   · ABAJO, LA TABLA. Los SKU de verdad, con lo que decidió la regla en cada
 *     uno y su motivo, y la posibilidad de contradecirla a mano.
 *
 * Sin la tabla, la regla se configura a ciegas: nueve interruptores no dicen
 * cuántas referencias van a entrar. Sin la regla, la tabla obliga a marcar trece
 * mil SKU a mano. Juntas se ve el efecto de lo que se acaba de cambiar.
 *
 *
 * ============ POR QUÉ LO MANUAL Y LO CALCULADO SON DOS COLUMNAS ============
 *
 * Con una sola, el recálculo nocturno se llevaría por delante lo que un gestor
 * marcó ayer y al día siguiente nadie entendería por qué un producto ha dejado
 * de seguirse. El valor efectivo es COALESCE(activo_manual, activo_calculado):
 * lo que dijo una persona gana siempre, EN LOS DOS SENTIDOS. Por eso la tabla
 * enseña las dos cosas —qué está pasando y quién lo decidió— y no solo el
 * resultado.
 *
 *
 * ============ GUARDAR LA REGLA NO RECALCULA NADA ============
 *
 * Cambia el criterio; el conjunto activo se mueve en el próximo
 * «recalcular_activos». Es a propósito: recalcular trece mil filas dentro de una
 * petición HTTP la deja colgada dos minutos. Por eso el botón de guardar ofrece
 * lanzar el recálculo justo después, que es lo que casi siempre se quiere.
 */

export function PanelSeguimiento({
  cliente,
  onAbrirSku,
}: {
  cliente: ClienteConIngesta
  onAbrirSku: (sku: SkuAbierto) => void
}) {
  const [regla, setRegla] = useState<ReglaRespuesta | null>(null)
  const [editandoRegla, setEditandoRegla] = useState(false)

  const [catalogo, setCatalogo] = useState<CatalogoRespuesta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  const [filtro, setFiltro] = useState<FiltroSeguimiento>('todos')
  const [texto, setTexto] = useState('')
  const [buscado, setBuscado] = useState('')
  const [unidad, setUnidad] = useState('')
  const [desde, setDesde] = useState(0)
  const [marcando, setMarcando] = useState<FilaCatalogo[] | null>(null)
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())

  const clienteRef = useRef(cliente.id)
  clienteRef.current = cliente.id

  const unidades = useMemo(
    () =>
      cliente.conexiones.flatMap((c) =>
        c.marketplace_ids.map((m) => ({
          clave: `${c.id}|${m}`,
          conexion: c.name,
          connectionId: c.id,
          marketplaceId: m,
        }))
      ),
    [cliente]
  )

  const cargarRegla = useCallback(async (clientId: string) => {
    const res = await getAmazon<ReglaRespuesta>(`/api/plataforma/reglas?clientId=${clientId}`)
    if (clienteRef.current !== clientId) return
    if (res.ok) setRegla(res.data)
  }, [])

  const cargarCatalogo = useCallback(
    async (clientId: string, params: { filtro: FiltroSeguimiento; q: string; unidad: string; desde: number }) => {
      setCargando(true)
      const [connectionId, marketplaceId] = params.unidad ? params.unidad.split('|') : ['', '']
      const query = new URLSearchParams({ clientId, filtro: params.filtro, desde: String(params.desde) })
      if (params.q) query.set('q', params.q)
      if (connectionId) query.set('connectionId', connectionId)
      if (marketplaceId) query.set('marketplaceId', marketplaceId)

      const res = await getAmazon<CatalogoRespuesta>(`/api/plataforma/catalogo?${query.toString()}`)
      if (clienteRef.current !== clientId) return
      setCargando(false)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setError(null)
      setCatalogo(res.data)
      setSeleccion(new Set())
    },
    []
  )

  useEffect(() => {
    void cargarRegla(cliente.id)
  }, [cargarRegla, cliente.id])

  useEffect(() => {
    void cargarCatalogo(cliente.id, { filtro, q: buscado, unidad, desde })
  }, [cargarCatalogo, cliente.id, filtro, buscado, unidad, desde])

  const recargar = useCallback(() => {
    void cargarCatalogo(cliente.id, { filtro, q: buscado, unidad, desde })
    void cargarRegla(cliente.id)
  }, [cargarCatalogo, cargarRegla, cliente.id, filtro, buscado, unidad, desde])

  const seleccionadas = useMemo(
    () => (catalogo?.filas ?? []).filter((f) => seleccion.has(f.id)),
    [catalogo, seleccion]
  )

  return (
    <div className="flex flex-col gap-2 pb-4">
      {/* -------- La regla -------- */}
      <Panel
        titulo="Criterio de SKU en seguimiento"
        derecha={
          <button
            type="button"
            onClick={() => setEditandoRegla(true)}
            className={`${BOTON.base} ${BOTON.secundario}`}
          >
            <Settings2 className="h-3 w-3" />
            {regla?.regla ? 'Cambiar' : 'Crear'}
          </button>
        }
      >
        {regla ? (
          <div className="space-y-[6px]">
            <p className={`${TIPO.m} ${TEXTO.t1}`}>{regla.descripcion}</p>
            {regla.regla ? (
              <p className={`${TIPO.s} ${TEXTO.t3}`}>
                «{regla.regla.name}» · se recorta por{' '}
                {ETIQUETA_ORDEN[regla.regla.orden_tope as OrdenTope]} al llegar a{' '}
                {cifra(regla.regla.tope_skus)} SKU
                {regla.regla.marketplace_ids.length > 0
                  ? ` · solo en ${regla.regla.marketplace_ids.map(nombreMarketplace).join(', ')}`
                  : ' · en todos los países del cliente'}
              </p>
            ) : (
              <Aviso tono="ambar" icono={AlertTriangle}>
                Este cliente no tiene ningún criterio activo. Sin criterio, el recálculo nocturno se
                salta su cuenta y ningún SKU entra en el refresco diario — sin dar ningún error.
              </Aviso>
            )}
          </div>
        ) : (
          <Cargando texto="Leyendo el criterio…" />
        )}
      </Panel>

      {/* -------- Filtros -------- */}
      <div className="flex flex-wrap items-center gap-[6px]">
        <form
          className="flex items-center gap-[6px]"
          onSubmit={(e) => {
            e.preventDefault()
            setDesde(0)
            setBuscado(texto.trim())
          }}
        >
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className={`${CAMPO.input} w-[200px]`}
            placeholder="SKU, ASIN o título"
            aria-label="Buscar en el catálogo"
          />
          <button type="submit" className={`${BOTON.base} ${BOTON.secundario}`}>
            <Search className="h-3 w-3" />
            Buscar
          </button>
        </form>

        <div className={PANTALLA.separador} />

        {(
          [
            ['todos', 'Todos'],
            ['dentro', 'En seguimiento'],
            ['fuera', 'Fuera'],
            ['manual', 'Decididos a mano'],
          ] as Array<[FiltroSeguimiento, string]>
        ).map(([id, nombre]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setDesde(0)
              setFiltro(id)
            }}
            className={`${BOTON.chip} ${filtro === id ? BOTON.chipEncendido : ''}`}
          >
            {nombre}
          </button>
        ))}

        {unidades.length > 1 && (
          <>
            <div className={PANTALLA.separador} />
            <select
              value={unidad}
              onChange={(e) => {
                setDesde(0)
                setUnidad(e.target.value)
              }}
              className={`${CAMPO.input} w-auto`}
              aria-label="Cuenta y país"
            >
              <option value="">Todas las cuentas</option>
              {unidades.map((u) => (
                <option key={u.clave} value={u.clave}>
                  {u.conexion} · {nombreMarketplace(u.marketplaceId)}
                </option>
              ))}
            </select>
          </>
        )}

        {seleccionadas.length > 0 && (
          <>
            <div className={PANTALLA.separador} />
            <span className={`${TIPO.s} ${TEXTO.t2}`}>{seleccionadas.length} elegidos</span>
            <button
              type="button"
              onClick={() => setMarcando(seleccionadas)}
              className={`${BOTON.base} ${BOTON.primario}`}
            >
              <Hand className="h-3 w-3" />
              Decidir a mano
            </button>
          </>
        )}
      </div>

      {/* -------- La tabla -------- */}
      {error ? (
        <Aviso tono="rojo" icono={AlertTriangle}>
          {error}
        </Aviso>
      ) : cargando && !catalogo ? (
        <Cargando texto="Leyendo el catálogo…" />
      ) : !catalogo || catalogo.total === 0 ? (
        <VacioCatalogo hayFiltro={buscado !== '' || filtro !== 'todos'} />
      ) : (
        <>
          <TablaSku
            filas={catalogo.filas}
            seleccion={seleccion}
            onSeleccion={setSeleccion}
            onAbrirSku={onAbrirSku}
            onMarcar={(fila) => setMarcando([fila])}
          />
          <Paginacion
            total={catalogo.total}
            desde={catalogo.desde}
            limite={catalogo.limite}
            cuantas={catalogo.filas.length}
            onIr={setDesde}
          />
        </>
      )}

      {editandoRegla && regla && (
        <DialogoRegla
          cliente={cliente}
          regla={regla.regla}
          unidades={unidades}
          onCerrar={() => setEditandoRegla(false)}
          onGuardado={() => {
            setEditandoRegla(false)
            recargar()
          }}
        />
      )}

      {marcando && (
        <DialogoMarcar
          cliente={cliente}
          filas={marcando}
          onCerrar={() => setMarcando(null)}
          onHecho={() => {
            setMarcando(null)
            recargar()
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La tabla                                                            */
/* ------------------------------------------------------------------ */

/** El valor efectivo: lo que dijo una persona gana sobre lo que calculó la regla */
function enSeguimiento(fila: FilaCatalogo): boolean {
  return fila.activo_manual ?? fila.activo_calculado
}

function TablaSku({
  filas,
  seleccion,
  onSeleccion,
  onAbrirSku,
  onMarcar,
}: {
  filas: FilaCatalogo[]
  seleccion: Set<string>
  onSeleccion: (s: Set<string>) => void
  onAbrirSku: (sku: SkuAbierto) => void
  onMarcar: (fila: FilaCatalogo) => void
}) {
  const todasElegidas = filas.length > 0 && filas.every((f) => seleccion.has(f.id))

  return (
    <div className={`${TABLA.caja} max-h-[60vh]`}>
      <table className={TABLA.tabla}>
        <thead>
          <tr>
            <th className={`${TABLA.cabecera} ${TABLA.cabeceraFija} w-[26px]`}>
              <input
                type="checkbox"
                checked={todasElegidas}
                onChange={(e) =>
                  onSeleccion(e.target.checked ? new Set(filas.map((f) => f.id)) : new Set())
                }
                className="h-[13px] w-[13px] accent-[var(--ls-acc-relleno)]"
                aria-label="Elegir todos los de esta página"
              />
            </th>
            <th className={TABLA.cabecera}>SKU</th>
            <th className={TABLA.cabecera}>Título</th>
            <th className={TABLA.cabecera}>ASIN</th>
            <th className={TABLA.cabecera}>Canal</th>
            <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Precio</th>
            <th className={TABLA.cabecera}>Marca</th>
            <th className={TABLA.cabecera}>Seguimiento</th>
            <th className={TABLA.cabecera}>Lo decidió</th>
            <th className={TABLA.cabecera}>Por qué</th>
            <th className={TABLA.cabecera} />
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const dentro = enSeguimiento(f)
            const manual = f.activo_manual !== null
            return (
              <tr
                key={f.id}
                className={`${TABLA.fila} ${seleccion.has(f.id) ? TABLA.filaSel : ''}`}
              >
                <td className={`${TABLA.celda} ${TABLA.celdaFija}`}>
                  <input
                    type="checkbox"
                    checked={seleccion.has(f.id)}
                    onChange={(e) => {
                      const s = new Set(seleccion)
                      if (e.target.checked) s.add(f.id)
                      else s.delete(f.id)
                      onSeleccion(s)
                    }}
                    className="h-[13px] w-[13px] accent-[var(--ls-acc-relleno)]"
                    aria-label={`Elegir ${f.sku}`}
                  />
                </td>
                <td className={`${TABLA.celda} ${TEXTO.t1}`}>
                  <button
                    type="button"
                    onClick={() =>
                      onAbrirSku({
                        connectionId: f.connection_id,
                        marketplaceId: f.marketplace_id,
                        sku: f.sku,
                      })
                    }
                    className="underline decoration-transparent hover:decoration-inherit"
                    title="Abrir la ficha"
                  >
                    {f.sku}
                  </button>
                </td>
                <td className={`${TABLA.celda} ${TEXTO.t3} max-w-[280px]`}>
                  <span className={TABLA.corta} title={f.title ?? ''}>
                    {f.title ?? '—'}
                  </span>
                </td>
                <td className={`${TABLA.celda} ${TEXTO.t3}`}>{f.asin ?? '—'}</td>
                <td className={TABLA.celda}>{f.is_fba ? 'FBA' : 'FBM'}</td>
                <td className={`${TABLA.celda} ${TABLA.numero}`}>{dinero(f.price, f.currency)}</td>
                <td className={`${TABLA.celda} ${TEXTO.t3}`}>{f.marca ?? '—'}</td>
                <td className={TABLA.celda}>
                  <span className={ESTADO.linea}>
                    <span
                      style={{ color: dentro ? COLOR_ESTADO.verde : COLOR_ESTADO.gris }}
                      aria-hidden
                    >
                      {dentro ? '●' : '○'}
                    </span>
                    {dentro ? 'sí' : 'no'}
                  </span>
                </td>
                <td className={TABLA.celda}>
                  {manual ? (
                    <span className={ESTADO.linea}>
                      <Hand className="h-3 w-3" style={{ color: COLOR_ESTADO.naranja }} />
                      una persona
                    </span>
                  ) : (
                    <span className={TEXTO.t4}>la regla</span>
                  )}
                </td>
                <td className={`${TABLA.celda} ${TEXTO.t3} max-w-[380px]`}>
                  <span className={TABLA.corta} title={f.activo_motivo ?? ''}>
                    {f.activo_motivo ?? '—'}
                  </span>
                </td>
                <td className={TABLA.celda}>
                  <button
                    type="button"
                    onClick={() => onMarcar(f)}
                    className={BOTON.icono}
                    title="Decidir a mano"
                  >
                    <Hand className="h-[13px] w-[13px]" />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Paginacion({
  total,
  desde,
  limite,
  cuantas,
  onIr,
}: {
  total: number
  desde: number
  limite: number
  cuantas: number
  onIr: (desde: number) => void
}) {
  return (
    <div className="flex items-center gap-[6px]">
      <span className={`${TIPO.s} ${TEXTO.t3} tabular-nums`}>
        {cifra(desde + 1)}–{cifra(desde + cuantas)} de {cifra(total)}
      </span>
      <button
        type="button"
        disabled={desde === 0}
        onClick={() => onIr(Math.max(0, desde - limite))}
        className={`${BOTON.base} ${BOTON.secundario}`}
      >
        <ChevronLeft className="h-3 w-3" />
        Anterior
      </button>
      <button
        type="button"
        disabled={desde + cuantas >= total}
        onClick={() => onIr(desde + limite)}
        className={`${BOTON.base} ${BOTON.secundario}`}
      >
        Siguiente
        <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  )
}

function VacioCatalogo({ hayFiltro }: { hayFiltro: boolean }) {
  if (hayFiltro) {
    return (
      <Vacio icono={Search} titulo="Ningún SKU encaja con esto">
        Prueba a quitar el filtro o a buscar otra cosa. La búsqueda mira en el SKU, el ASIN y el
        título, y no distingue mayúsculas.
      </Vacio>
    )
  }
  return (
    <Vacio icono={Inbox} titulo="El espejo del catálogo está vacío">
      Todavía no se ha traído ni un SKU de Amazon. Lanza{' '}
      <span className={TEXTO.t1}>«Censo del catálogo»</span> desde la pestaña de Ingesta: es el
      trabajo que descubre los SKU y los ASIN, y de él cuelga todo lo demás. Mientras el catálogo
      esté vacío, el criterio de arriba se puede configurar pero no tiene nada sobre lo que
      aplicarse.
    </Vacio>
  )
}

/* ------------------------------------------------------------------ */
/* Marcar a mano                                                       */
/* ------------------------------------------------------------------ */

function DialogoMarcar({
  cliente,
  filas,
  onCerrar,
  onHecho,
}: {
  cliente: ClienteConIngesta
  filas: FilaCatalogo[]
  onCerrar: () => void
  onHecho: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const hayManuales = filas.some((f) => f.activo_manual !== null)

  async function marcar(activo: boolean | null) {
    if (activo !== null && motivo.trim() === '') {
      toast.error('Di por qué')
      return
    }
    setEnviando(true)
    const res = await patchAmazon<MarcarRespuesta>('/api/plataforma/catalogo', {
      clientId: cliente.id,
      listingIds: filas.map((f) => f.id),
      activo,
      motivo: motivo.trim() || null,
    })
    setEnviando(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(res.data.mensaje)
    onHecho()
  }

  return (
    <Dialogo
      titulo={filas.length === 1 ? `Decidir a mano «${filas[0].sku}»` : `Decidir a mano ${filas.length} SKU`}
      entradilla="Lo que decides aquí gana sobre la regla, en los dos sentidos, y el recálculo nocturno no lo va a deshacer. Es lo que permite vigilar un candidato que todavía no cumple nada, o dejar de gastar cupo en algo que no interesa."
      onCerrar={onCerrar}
      pie={
        <>
          {hayManuales && (
            <button
              type="button"
              onClick={() => void marcar(null)}
              disabled={enviando}
              className={`${BOTON.base} ${BOTON.secundario} mr-auto`}
              title="Quita la marca manual: la fila vuelve a decidirse por el criterio del cliente"
            >
              <RotateCcw className="h-3 w-3" />
              Devolvérselo a la regla
            </button>
          )}
          <button
            type="button"
            onClick={() => void marcar(false)}
            disabled={enviando}
            className={`${BOTON.base} ${BOTON.secundario}`}
          >
            No seguir
          </button>
          <button
            type="button"
            onClick={() => void marcar(true)}
            disabled={enviando}
            className={`${BOTON.base} ${BOTON.primario}`}
          >
            Seguir a diario
          </button>
        </>
      }
    >
      {filas.length <= 8 && (
        <ul className={`${TIPO.s} ${TEXTO.t3} space-y-[2px]`}>
          {filas.map((f) => (
            <li key={f.id} className="flex items-baseline gap-[6px]">
              <span className={TEXTO.t1}>{f.sku}</span>
              <span className="truncate">{f.title ?? '—'}</span>
              <span className={`${TEXTO.t4} ml-auto shrink-0`}>
                {enSeguimiento(f) ? 'ahora se sigue' : 'ahora no se sigue'}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className={CAMPO.contenedor}>
        <label className={CAMPO.etiqueta} htmlFor="motivo-marcar">
          Por qué <span className={CAMPO.obligatorio}>*</span>
        </label>
        <input
          id="motivo-marcar"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className={CAMPO.input}
          placeholder="Candidato a FBA: lo vigilamos aunque hoy venda poco"
          autoFocus
        />
        <p className={CAMPO.nota}>
          Obligatorio, y también lo exige la base. Es lo que contesta dentro de tres meses «¿por qué
          este producto no se refresca?» sin que nadie tenga que reconstruir la decisión.
        </p>
      </div>
    </Dialogo>
  )
}

/* ------------------------------------------------------------------ */
/* La regla                                                            */
/* ------------------------------------------------------------------ */

const ETIQUETA_ORDEN: Record<OrdenTope, string> = {
  ventas: 'unidades vendidas',
  bsr: 'ranking de ventas',
  precio: 'precio',
  sku: 'SKU',
}

function DialogoRegla({
  cliente,
  regla,
  unidades,
  onCerrar,
  onGuardado,
}: {
  cliente: ClienteConIngesta
  regla: ReglaActivos | null
  unidades: Array<{ clave: string; conexion: string; marketplaceId: string }>
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [f, setF] = useState({
    name: regla?.name ?? 'Criterio del cliente',
    marketplace_ids: regla?.marketplace_ids ?? [],
    incluir_fba: regla?.incluir_fba ?? true,
    incluir_fbm: regla?.incluir_fbm ?? false,
    incluir_marca_propia: regla?.incluir_marca_propia ?? true,
    min_unidades: regla?.min_unidades ?? null,
    ventana_dias: regla?.ventana_dias ?? 30,
    solo_listados_activos: regla?.solo_listados_activos ?? true,
    excluir_sin_precio: regla?.excluir_sin_precio ?? true,
    excluir_variacion_padre: regla?.excluir_variacion_padre ?? true,
    marcas_excluidas: (regla?.marcas_excluidas ?? []).join('\n'),
    skus_excluidos: (regla?.skus_excluidos ?? []).join('\n'),
    skus_incluidos: (regla?.skus_incluidos ?? []).join('\n'),
    tope_skus: regla?.tope_skus ?? 2000,
    orden_tope: (regla?.orden_tope ?? 'ventas') as OrdenTope,
    notes: regla?.notes ?? '',
  })
  const [enviando, setEnviando] = useState(false)

  /** Los países del cliente, sin repetir. Vacío = todos */
  const marketplaces = useMemo(
    () => [...new Set(unidades.map((u) => u.marketplaceId))],
    [unidades]
  )

  async function guardar() {
    setEnviando(true)
    const res = await patchAmazon<ReglaRespuesta>('/api/plataforma/reglas', {
      clientId: cliente.id,
      ...f,
      marcas_excluidas: enLineas(f.marcas_excluidas),
      skus_excluidos: enLineas(f.skus_excluidos),
      skus_incluidos: enLineas(f.skus_incluidos),
    })
    setEnviando(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(res.data.mensaje ?? 'Criterio guardado')
    onGuardado()
  }

  return (
    <Dialogo
      titulo="Criterio de SKU en seguimiento"
      ancho="max-w-[720px]"
      entradilla={
        <>
          Decide de qué SKU nos ocupamos <span className={TEXTO.t1}>cada noche</span>. Demasiado
          ancho revienta el cupo de Amazon de esa cuenta; demasiado estrecho deja SKU sin histórico,
          y el histórico no se recupera hacia atrás.
        </>
      }
      onCerrar={onCerrar}
      pie={
        <>
          <button type="button" onClick={onCerrar} className={`${BOTON.base} ${BOTON.secundario}`}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={enviando}
            className={`${BOTON.base} ${BOTON.primario}`}
          >
            <Save className="h-3 w-3" />
            {enviando ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <div className="space-y-[9px]">
        <Grupo titulo="Qué entra">
          <Interruptor
            valor={f.incluir_fba}
            onCambio={(v) => setF({ ...f, incluir_fba: v })}
            nombre="Todo lo de FBA"
            nota="Si está en un almacén de Amazon, cuesta dinero cada día y hay que mirarlo."
          />
          <Interruptor
            valor={f.incluir_fbm}
            onCambio={(v) => setF({ ...f, incluir_fbm: v })}
            nombre="Todo lo de FBM"
            nota="Con catálogos grandes esto lo mete casi todo: en ShoesF son 13.700 referencias en la ventana nocturna. Para FBM la puerta suele ser la rotación, no el canal."
            aviso={f.incluir_fbm}
          />
          <Interruptor
            valor={f.incluir_marca_propia}
            onCambio={(v) => setF({ ...f, incluir_marca_propia: v })}
            nombre="La marca propia del cliente"
            nota="Si es suya, se mira aunque venda poco."
          />
        </Grupo>

        <Grupo titulo="Rotación">
          <div className={CAMPO.rejilla}>
            <div className={CAMPO.contenedor}>
              <label className={CAMPO.etiqueta} htmlFor="min-unidades">
                Mínimo de unidades
              </label>
              <input
                id="min-unidades"
                type="number"
                min={0}
                value={f.min_unidades ?? ''}
                onChange={(e) =>
                  setF({ ...f, min_unidades: e.target.value === '' ? null : Number(e.target.value) })
                }
                className={`${CAMPO.input} ${CAMPO.numero}`}
                placeholder="apagado"
              />
              <p className={CAMPO.nota}>
                En blanco = esta vía está apagada. Un SKU sin datos de ventas{' '}
                <span className={TEXTO.t1}>no se descarta</span> por esto: no se le castiga por un
                dato que nos falta a nosotros.
              </p>
            </div>
            <div className={CAMPO.contenedor}>
              <label className={CAMPO.etiqueta} htmlFor="ventana-dias">
                En los últimos … días
              </label>
              <input
                id="ventana-dias"
                type="number"
                min={1}
                max={365}
                value={f.ventana_dias}
                onChange={(e) => setF({ ...f, ventana_dias: Number(e.target.value) })}
                className={`${CAMPO.input} ${CAMPO.numero}`}
              />
              <p className={CAMPO.nota}>
                Las unidades salen de las ventas importadas. Hasta que llegue el rol de Análisis de
                marcas, eso es un CSV de Sellerboard o de Business Reports.
              </p>
            </div>
          </div>
        </Grupo>

        <Grupo titulo="Qué se cae">
          <Interruptor
            valor={f.solo_listados_activos}
            onCambio={(v) => setF({ ...f, solo_listados_activos: v })}
            nombre="Solo lo que está a la venta"
            nota="Un listing que no se puede comprar no tiene Buy Box que perder."
          />
          <Interruptor
            valor={f.excluir_sin_precio}
            onCambio={(v) => setF({ ...f, excluir_sin_precio: v })}
            nombre="Fuera lo que no tiene precio"
            nota="Sin precio no hay margen que calcular."
          />
          <Interruptor
            valor={f.excluir_variacion_padre}
            onCambio={(v) => setF({ ...f, excluir_variacion_padre: v })}
            nombre="Fuera las variaciones padre"
            nota="El nodo que agrupa las tallas no se compra ni se vende."
          />
        </Grupo>

        <Grupo titulo="El freno">
          <div className={CAMPO.rejilla}>
            <div className={CAMPO.contenedor}>
              <label className={CAMPO.etiqueta} htmlFor="tope-skus">
                Tope de SKU en seguimiento <span className={CAMPO.obligatorio}>*</span>
              </label>
              <input
                id="tope-skus"
                type="number"
                min={1}
                value={f.tope_skus}
                onChange={(e) => setF({ ...f, tope_skus: Number(e.target.value) })}
                className={`${CAMPO.input} ${CAMPO.numero}`}
              />
              <p className={CAMPO.nota}>
                No es una preferencia: es la protección del cupo. Al alcanzarlo se recorta y se
                levanta un aviso ruidoso, porque quedarse callado convertiría el freno en una
                pérdida silenciosa de cobertura.
              </p>
            </div>
            <div className={CAMPO.contenedor}>
              <label className={CAMPO.etiqueta} htmlFor="orden-tope">
                A quién se corta primero
              </label>
              <select
                id="orden-tope"
                value={f.orden_tope}
                onChange={(e) => setF({ ...f, orden_tope: e.target.value as OrdenTope })}
                className={CAMPO.input}
              >
                {(Object.keys(ETIQUETA_ORDEN) as OrdenTope[]).map((o) => (
                  <option key={o} value={o}>
                    Se ordena por {ETIQUETA_ORDEN[o]}
                  </option>
                ))}
              </select>
              <p className={CAMPO.nota}>
                Con desempate final por SKU, para que dos recálculos seguidos den exactamente la
                misma lista. Sin él, un SKU entraría y saldría cada noche y su serie quedaría llena
                de huecos inexplicables.
              </p>
            </div>
          </div>
        </Grupo>

        <Grupo titulo="Excepciones">
          <div className={CAMPO.rejilla}>
            <ListaTexto
              id="skus-incluidos"
              etiqueta="SKU que se siguen siempre"
              valor={f.skus_incluidos}
              onCambio={(v) => setF({ ...f, skus_incluidos: v })}
              nota="Entran aunque no cumplan nada. Es como se vigila un candidato antes de que tenga historia."
            />
            <ListaTexto
              id="skus-excluidos"
              etiqueta="SKU excluidos"
              valor={f.skus_excluidos}
              onCambio={(v) => setF({ ...f, skus_excluidos: v })}
              nota="No entran por ninguna vía."
            />
            <ListaTexto
              id="marcas-excluidas"
              etiqueta="Marcas excluidas"
              valor={f.marcas_excluidas}
              onCambio={(v) => setF({ ...f, marcas_excluidas: v })}
              nota="No distingue mayúsculas. Una marca excluida no entra ni siendo FBA."
            />
          </div>
        </Grupo>

        {marketplaces.length > 1 && (
          <Grupo titulo="Países">
            <div className="flex flex-wrap gap-[6px]">
              {marketplaces.map((m) => {
                const puesto = f.marketplace_ids.includes(m)
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() =>
                      setF({
                        ...f,
                        marketplace_ids: puesto
                          ? f.marketplace_ids.filter((x) => x !== m)
                          : [...f.marketplace_ids, m],
                      })
                    }
                    className={`${BOTON.chip} ${puesto ? BOTON.chipEncendido : ''}`}
                  >
                    {nombreMarketplace(m)}
                  </button>
                )
              })}
            </div>
            <p className={CAMPO.nota}>
              Ninguno marcado = vale para todos los países del cliente. Existe porque un cliente
              puede tener cuarenta referencias en Estados Unidos y trece mil en España: el criterio
              que sirve para uno arruina el otro.
            </p>
          </Grupo>
        )}

        <Aviso tono="azul" icono={Info}>
          Guardar cambia el criterio, <span className={TEXTO.t1}>no el conjunto de SKU</span>. Eso se
          mueve en el próximo «Recalcular SKU en seguimiento»: lánzalo desde la pestaña de Ingesta
          si quieres verlo aplicado ahora. No gasta ni una llamada a Amazon.
        </Aviso>
      </div>
    </Dialogo>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas del formulario                                               */
/* ------------------------------------------------------------------ */

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className={`${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup2} px-[9px] py-[7px]`}>
      <legend className={`${TITULO.rotulo} px-[4px]`}>{titulo}</legend>
      <div className="space-y-[6px]">{children}</div>
    </fieldset>
  )
}

function Interruptor({
  valor,
  onCambio,
  nombre,
  nota,
  aviso,
}: {
  valor: boolean
  onCambio: (v: boolean) => void
  nombre: string
  nota: string
  aviso?: boolean
}) {
  return (
    <label className="flex items-start gap-[6px]">
      <input
        type="checkbox"
        checked={valor}
        onChange={(e) => onCambio(e.target.checked)}
        className="mt-[2px] h-[13px] w-[13px] shrink-0 accent-[var(--ls-acc-relleno)]"
      />
      <span className="min-w-0">
        <span className={`${TIPO.m} ${TEXTO.t1}`}>{nombre}</span>
        <span
          className={`${TIPO.s} block leading-[1.5]`}
          style={aviso ? { color: COLOR_ESTADO.ambar } : undefined}
        >
          <span className={aviso ? '' : TEXTO.t3}>{nota}</span>
        </span>
      </span>
    </label>
  )
}

function ListaTexto({
  id,
  etiqueta,
  valor,
  onCambio,
  nota,
}: {
  id: string
  etiqueta: string
  valor: string
  onCambio: (v: string) => void
  nota: string
}) {
  const cuantos = enLineas(valor).length
  return (
    <div className={CAMPO.contenedor}>
      <label className={CAMPO.etiqueta} htmlFor={id}>
        {etiqueta} {cuantos > 0 && <span className={TEXTO.acento}>· {cuantos}</span>}
      </label>
      <textarea
        id={id}
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        rows={3}
        className={`${CAMPO.input} h-auto py-[5px] leading-[1.5] resize-y`}
        placeholder="Uno por línea"
      />
      <p className={CAMPO.nota}>{nota}</p>
    </div>
  )
}

/** Una lista escrita a mano, admitiendo saltos de línea, comas y punto y coma */
function enLineas(texto: string): string[] {
  return [
    ...new Set(
      texto
        .split(/[\n,;\t]+/)
        .map((s) => s.trim())
        .filter((s) => s !== '')
    ),
  ]
}

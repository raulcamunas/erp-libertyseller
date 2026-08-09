'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Hand,
  Inbox,
  RotateCcw,
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
  ReglaRespuesta,
} from '@/lib/plataforma/cliente'
import type { OrdenTope } from '@/lib/plataforma/tipos'
import {
  BOTON,
  CAMPO,
  COLOR_ESTADO,
  ESTADO,
  PANTALLA,
  TABLA,
  TEXTO,
  TIPO,
} from '@/lib/estilo/denso'
import { PARAM_PESTANA } from '@/components/amazon-api/pestanas'
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
      {/* -------- La regla: SOLO LECTURA. Se edita en la pestaña Seguimiento --------

          Aquí había un segundo editor del MISMO criterio: dos pantallas dentro
          de Amazon API con la palabra «Seguimiento», las dos haciendo PATCH a
          /api/plataforma/reglas y sin avisarse entre ellas, así que quien
          cambiara el criterio en una veía el viejo en la otra hasta recargar.
          El de la pestaña es estrictamente mayor —tiene además el simulacro— y
          es el que se ha quedado. Esto enseña lo que hay y manda allí. */}
      <Panel
        titulo="Criterio de SKU en seguimiento"
        derecha={
          <a
            href={`/dashboard/amazon-api?${PARAM_PESTANA}=seguimiento`}
            className={`${BOTON.base} ${BOTON.secundario}`}
          >
            <Settings2 className="h-3 w-3" />
            Cambiarlo en Seguimiento
          </a>
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
      <Vacio icono={<Search />} titulo="Ningún SKU encaja con esto">
        Prueba a quitar el filtro o a buscar otra cosa. La búsqueda mira en el SKU, el ASIN y el
        título, y no distingue mayúsculas.
      </Vacio>
    )
  }
  return (
    <Vacio icono={<Inbox />} titulo="El espejo del catálogo está vacío">
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
        {/* El «para qué sirve» está en el botón de información; aquí solo lo que
            hace falta para rellenar el campo. */}
        <p className={CAMPO.nota}>Obligatorio.</p>
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

/* El editor del criterio VIVÍA AQUÍ y se ha ido a la pestaña «Seguimiento»
   (components/amazon-api/paneles/PanelSeguimiento.tsx). Eran dos editores de
   la misma regla dentro del mismo módulo, sin avisarse entre ellos. El que se
   quedó es el de la pestaña: hace lo mismo y además simula el resultado antes
   de guardar. Esta pantalla enseña el criterio y enlaza allí. */

/* ------------------------------------------------------------------ */
/* Piezas del formulario                                               */
/* ------------------------------------------------------------------ */





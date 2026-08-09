'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Coins,
  FileUp,
  Inbox,
  Pencil,
  Plug,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { deleteAmazon, getAmazon, patchAmazon, postAmazon, subirAmazon } from '@/lib/amazon/client'
import type {
  CoberturaRespuesta,
  CostesRespuesta,
  FichaRespuesta,
  FilaCoste,
  GuardarCosteRespuesta,
  ImportacionRespuesta,
  ImportacionCostes,
  InformeImportacion,
  PerfilCostes,
  PerfilesRespuesta,
  PoliticaCostes,
  ResumenCobertura,
} from '@/lib/plataforma/costes/cliente'
import {
  ESTADO_COSTE_LABELS,
  evaluarCosteEnCanales,
  exigenciasDe,
  type CosteEvaluable,
  type EstadoCoste,
} from '@/lib/plataforma/costes/completitud'
import {
  FILTRO_ESTADO_LABELS,
  canalesEnPantalla,
  type CanalCoste,
  type FiltroEstado,
} from '@/lib/plataforma/costes/tipos'
import { hoyIso } from '@/lib/plataforma/costes/vigencia'
import {
  BOTON,
  CAMPO,
  CIFRAS,
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
  type TonoEstado,
} from '@/lib/estilo/denso'
import {
  Aviso,
  Barra,
  Cargando,
  Dialogo,
  Vacio,
  cifra,
  dinero,
  fechaHora,
  hace,
} from '@/components/plataforma/comun'
import { ListaInfo, SeccionInfo } from '@/components/ui/BotonInfo'
import type { PropsPanel } from '../tipos'

/**
 * PESTAÑA «COSTES» — LO QUE NOS CUESTA CADA PRODUCTO.
 *
 * Amazon NO da el coste de nada. Sabe a cuánto se vende y cuánto se lleva de
 * comisión, pero no lo que le costó al cliente comprar el producto. Sin ese dato
 * no hay margen, y sin margen no hay ni FBM→FBA ni suelo de precio: es la
 * pantalla que desbloquea más cosas del proyecto.
 *
 *
 * ============ AQUÍ NO SE DECIDE NADA ============
 *
 * El juicio entero está escrito y probado en lib/plataforma/costes/**: la
 * vigencia por tramos (vigencia.ts), el veredicto de completitud
 * (completitud.ts), el cruce referencia→SKU reutilizando el motor de la
 * sincronización de stock (cruce.ts) y el plan de escritura con simulacro
 * (plan.ts). Este fichero PINTA eso y nada más. La única función pura que se
 * llama desde el navegador es `evaluarCosteEnCanales()`, y se llama para que el
 * veredicto que se ve mientras se teclea un coste sea EL MISMO que va a aplicar
 * el servidor al guardarlo — no una segunda regla escrita en la pantalla.
 *
 *
 * ============ LAS TRES COSAS QUE NO SE PUEDEN ROMPER AQUÍ ============
 *
 * 1. «SIN DATO» NUNCA ES UN CERO. Ni el coste, ni el total, ni la antigüedad, ni
 *    la cobertura. Cuando no hay número se pinta «—» y el porqué va en el
 *    `title`, que es lo que separa «cuesta cero» de «no lo sabemos». Un margen
 *    calculado sobre un coste a medias sale mejor que el real, es perfectamente
 *    creíble y acaba en una presentación para el cliente.
 *
 * 2. NINGÚN UMBRAL INVENTADO. Mientras el cliente no tenga decidido a partir de
 *    cuántos días un coste caduca, la cifra de «caducados» es «—» y no cero: con
 *    la política vacía NO PUEDE haber ni un caducado, así que un cero ahí diría
 *    «está todo al día» cuando lo que pasa es que nadie lo ha mirado.
 *
 * 3. UN CLIENTE, UNA PETICIÓN. Todas las rutas de A5 llevan `clientId` y ninguna
 *    devuelve, agrega ni compara costes de varios clientes. Los costes de compra
 *    de un vendedor son de lo más sensible que hay en esta base.
 *
 *
 * ============ POR QUÉ CASI NO HAY TEXTO EN LA PANTALLA ============
 *
 * Porque se pidió así, literalmente. Lo que se queda fuera es la etiqueta de un
 * campo y, como mucho, una línea cuando sin ella el control es ambiguo. El
 * porqué de la vigencia, qué significa un coste incompleto y por qué la cifra de
 * incompletos es una cota superior están en el botón de información de arriba a
 * la derecha, en `InfoCostes`. No se ha borrado ni una explicación: se han
 * movido todas.
 */

/* ================================================================== */
/* Estado -> color y glifo                                             */
/* ================================================================== */

/**
 * El color del estado, y el glifo ANTES que el color.
 *
 * «Sin coste» va en GRIS y no en rojo, y es una decisión: un cliente recién
 * conectado tiene el catálogo entero sin coste y eso no es una avería, es el
 * punto de partida. Pintarlo de rojo haría que la pantalla gritara el primer día
 * y que nadie mirara el ámbar de los incompletos, que sí es el que engaña.
 */
const TONO_ESTADO: Record<EstadoCoste, TonoEstado> = {
  completo: 'verde',
  incompleto: 'ambar',
  sin_coste: 'gris',
}

const ICONO_ESTADO: Record<EstadoCoste, LucideIcon> = {
  completo: CheckCircle2,
  incompleto: AlertTriangle,
  sin_coste: CircleDashed,
}

function EstadoCosteLinea({ estado }: { estado: EstadoCoste }) {
  const Icono = ICONO_ESTADO[estado]
  return (
    <span className={ESTADO.linea}>
      <Icono className={ESTADO.icono} style={{ color: COLOR_ESTADO[TONO_ESTADO[estado]] }} />
      <span className={ESTADO.palabra}>{ESTADO_COSTE_LABELS[estado]}</span>
    </span>
  )
}

/* ================================================================== */
/* El panel                                                            */
/* ================================================================== */

export function PanelCostes({ data, conexionId, onConexionId }: PropsPanel) {
  /**
   * Los clientes que tienen alguna conexión, uno por cliente y no por conexión.
   *
   * EL COSTE ES POR CLIENTE Y POR SKU, no por país ni por región: lo que costó
   * comprar una unidad no cambia porque se venda en Francia. Por eso aquí se
   * agrupa, mientras que el catálogo enseña un botón por conexión.
   *
   * Se guarda la primera conexión de cada cliente porque el selector que
   * comparten las ocho pestañas es de CONEXIÓN: elegir aquí a un cliente lo deja
   * elegido al saltar al catálogo, y al revés.
   *
   * Orden alfabético, y no por número de referencias ni de nada: un orden por
   * volumen sería una comparación entre clientes hecha con el orden de una lista.
   */
  const clientes = useMemo(() => {
    const nombres = new Map(data.clients.map((c) => [c.id, c.name]))
    const porCliente = new Map<string, { id: string; nombre: string; conexionId: string }>()
    for (const conn of data.connections) {
      if (porCliente.has(conn.client_id)) continue
      porCliente.set(conn.client_id, {
        id: conn.client_id,
        nombre: nombres.get(conn.client_id) ?? conn.name,
        conexionId: conn.id,
      })
    }
    return [...porCliente.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [data.clients, data.connections])

  const clienteId = useMemo(
    () => data.connections.find((c) => c.id === conexionId)?.client_id ?? null,
    [data.connections, conexionId]
  )
  const clienteNombre = clientes.find((c) => c.id === clienteId)?.nombre ?? ''

  /**
   * Con UN solo cliente conectado, elegirlo a mano es un clic que no decide
   * nada. Con dos o más no se elige por nadie: abrir la pantalla y encontrarse
   * los costes de un cliente que no habías pedido es cómo se acaba metiendo una
   * tarifa en la cuenta equivocada.
   */
  useEffect(() => {
    if (conexionId === null && clientes.length === 1) onConexionId(clientes[0].conexionId)
  }, [conexionId, clientes, onConexionId])

  /* ---------------- Filtros ---------------- */

  const [texto, setTexto] = useState('')
  const [buscado, setBuscado] = useState('')
  const [estado, setEstado] = useState<FiltroEstado>('todos')
  /** La fecha EN LA QUE SE MIRA. El margen de marzo se calcula con el coste de marzo */
  const [fecha, setFecha] = useState(() => hoyIso())
  const [soloSeguimiento, setSoloSeguimiento] = useState(false)
  const [pagina, setPagina] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setBuscado(texto.trim()), 300)
    return () => clearTimeout(t)
  }, [texto])

  useEffect(() => {
    setPagina(0)
  }, [clienteId, estado, buscado, soloSeguimiento, fecha])

  /* ---------------- Datos ---------------- */

  const [vista, setVista] = useState<CostesRespuesta | null>(null)
  const [cobertura, setCobertura] = useState<CoberturaRespuesta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  /**
   * El contador de peticiones: la respuesta que llega tarde NO pisa a la que
   * llegó después. Sin esto, teclear en el buscador y cambiar de cliente deja la
   * tabla enseñando el catálogo del cliente anterior, que aquí no es un detalle
   * de refresco: son los costes de otra tienda.
   */
  const turno = useRef(0)
  const turnoCobertura = useRef(0)

  const cargarTabla = useCallback(async () => {
    if (!clienteId) {
      setVista(null)
      return
    }
    const mio = ++turno.current
    setCargando(true)

    const params = new URLSearchParams({
      clientId: clienteId,
      estado,
      fecha,
      pagina: String(pagina),
    })
    if (buscado) params.set('texto', buscado)
    if (soloSeguimiento) params.set('soloSeguimiento', '1')

    const res = await getAmazon<CostesRespuesta>(`/api/plataforma/costes?${params.toString()}`)
    if (mio !== turno.current) return
    setCargando(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(null)
    setVista(res.data)
  }, [clienteId, estado, fecha, pagina, buscado, soloSeguimiento])

  const cargarCobertura = useCallback(async () => {
    if (!clienteId) {
      setCobertura(null)
      return
    }
    const mio = ++turnoCobertura.current
    const res = await getAmazon<CoberturaRespuesta>(
      `/api/plataforma/costes/cobertura?clientId=${clienteId}&fecha=${fecha}`
    )
    if (mio !== turnoCobertura.current) return
    if (res.ok) setCobertura(res.data)
  }, [clienteId, fecha])

  useEffect(() => {
    void cargarTabla()
  }, [cargarTabla])

  useEffect(() => {
    void cargarCobertura()
  }, [cargarCobertura])

  const recargar = useCallback(() => {
    void cargarTabla()
    void cargarCobertura()
  }, [cargarTabla, cargarCobertura])

  /* ---------------- Ventanas ---------------- */

  const [editando, setEditando] = useState<{ sku: string; fila: FilaCoste | null } | null>(null)
  const [fichaSku, setFichaSku] = useState<string | null>(null)
  const [importando, setImportando] = useState(false)
  const [politicaAbierta, setPoliticaAbierta] = useState(false)
  const [coberturaAbierta, setCoberturaAbierta] = useState(false)

  const politica = vista?.politica ?? null

  /* ---------------- Sin cliente ---------------- */

  if (clientes.length === 0) {
    return (
      <Vacio icono={<Plug />} titulo="Todavía no hay ninguna cuenta de Amazon conectada">
        El coste se guarda por cliente y por SKU, así que hasta que no haya una cuenta dada de alta
        no hay a quién asignárselo. Se hace en la pestaña <span className={TEXTO.t1}>Cuentas</span>.
      </Vacio>
    )
  }

  const totalSku = vista
    ? vista.porEstado.sin_coste + vista.porEstado.incompleto + vista.porEstado.completo
    : 0
  const conCoste = vista ? vista.porEstado.completo + vista.porEstado.incompleto : 0
  const paginas = vista ? Math.max(1, Math.ceil(vista.total / vista.limite)) : 1

  return (
    <div className={`${PANTALLA.cuerpo} h-full`}>
      {/* ----------------------------------------------------------------
          Barra de filtros, en DOS FILAS.

          No usa PANTALLA.filtros, que fija 32 px de alto: en cuanto los
          controles envuelven, las líneas de debajo se salen de esos 32 px y
          se montan unas encima de otras. Aquí hay dos filas declaradas, y
          cada una envuelve por su cuenta sin pisar a la otra.

          Y los anchos van con `!`: CAMPO.input trae `w-full` y las dos clases
          tienen la misma especificidad, así que decide el orden de la hoja
          compilada y no el del atributo. Es exactamente el caso que documenta
          BOTON.chipEncendido en denso.ts, y aquí se veía igual de claro: el
          selector de cliente ocupaba la pantalla de lado a lado.
      ---------------------------------------------------------------- */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-[6px] gap-y-[5px] min-w-0">
        <label className="sr-only" htmlFor="costes-cliente">
          Cliente
        </label>
        <select
          id="costes-cliente"
          value={clienteId ?? ''}
          onChange={(e) => {
            const elegido = clientes.find((c) => c.id === e.target.value)
            onConexionId(elegido ? elegido.conexionId : null)
          }}
          className={`${CAMPO.input} !w-[186px] shrink-0`}
        >
          <option value="">Elige un cliente…</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>

        <span className={PANTALLA.separador} />

        {/* La fecha en la que se mira. Es el control que convierte esto en un
            histórico y no en una columna: cambiarla enseña lo que regía ese día. */}
        <label className={`${TIPO.xs} ${TEXTO.t4} shrink-0`} htmlFor="costes-fecha">
          A fecha
        </label>
        <input
          id="costes-fecha"
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value || hoyIso())}
          className={`${CAMPO.input} !w-[140px] shrink-0`}
        />

        <span className={PANTALLA.separador} />

        <div className="relative w-[210px] shrink-0">
          <Search
            className={`pointer-events-none absolute left-[7px] top-1/2 h-3 w-3 -translate-y-1/2 ${TEXTO.t4}`}
          />
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="SKU, ASIN o título"
            aria-label="Buscar una referencia"
            className={`${CAMPO.input} pl-[24px]`}
          />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-[6px]">
          <button
            type="button"
            onClick={recargar}
            disabled={!clienteId}
            className={`${BOTON.base} ${BOTON.secundario}`}
            aria-label="Volver a leer"
            title="Volver a leer"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setPoliticaAbierta(true)}
            disabled={!politica}
            className={`${BOTON.base} ${BOTON.secundario}`}
          >
            <Settings2 className="h-3 w-3" />
            Política
          </button>
          <button
            type="button"
            onClick={() => setImportando(true)}
            disabled={!clienteId}
            className={`${BOTON.base} ${BOTON.secundario}`}
          >
            <FileUp className="h-3 w-3" />
            Importar
          </button>
          <button
            type="button"
            onClick={() => setEditando({ sku: '', fila: null })}
            disabled={!politica}
            className={`${BOTON.base} ${BOTON.primario}`}
          >
            <Plus className="h-3 w-3" />
            Coste a mano
          </button>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-[4px] gap-y-[5px] min-w-0">
        {(Object.keys(FILTRO_ESTADO_LABELS) as FiltroEstado[]).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setEstado(id)}
            aria-pressed={estado === id}
            className={`${BOTON.chip} ${estado === id ? BOTON.chipEncendido : ''}`}
          >
            {FILTRO_ESTADO_LABELS[id]}
          </button>
        ))}

        <span className={`${PANTALLA.separador} mx-[3px]`} />

        <button
          type="button"
          onClick={() => setSoloSeguimiento((v) => !v)}
          aria-pressed={soloSeguimiento}
          className={`${BOTON.chip} ${soloSeguimiento ? BOTON.chipEncendido : ''}`}
          title="Solo las referencias que entran en el refresco diario"
        >
          En seguimiento
        </button>
      </div>

      {/* ---------------- La tira de cifras ---------------- */}
      {clienteId && vista && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className={CIFRAS.tira}>
            <Cifra rotulo="referencias" valor={totalSku > 0 ? cifra(totalSku) : '—'} />
            <Cifra
              rotulo="con coste"
              valor={totalSku > 0 ? `${cifra(conCoste)} · ${porcentaje(conCoste, totalSku)}` : '—'}
            />
            <Cifra
              rotulo="sin coste"
              valor={totalSku > 0 ? cifra(vista.porEstado.sin_coste) : '—'}
            />
            <Cifra
              rotulo="incompletos"
              valor={totalSku > 0 ? cifra(vista.porEstado.incompleto) : '—'}
            />
            {/**
             * Con la política vacía NO PUEDE haber ningún caducado: el estado de
             * vigencia es «sin política» para todos. Enseñar un 0 aquí sería
             * decir «está todo al día» cuando lo que pasa es que nadie ha
             * decidido cuántos días vale un coste.
             */}
            <Cifra
              rotulo={
                politica?.dias_caducidad === null || politica?.dias_caducidad === undefined
                  ? 'caducados · sin política'
                  : 'caducados'
              }
              valor={
                politica?.dias_caducidad === null || politica?.dias_caducidad === undefined
                  ? '—'
                  : cifra(vista.caducados)
              }
              urgente={(politica?.dias_caducidad ?? null) !== null && vista.caducados > 0}
            />
          </div>

          {cobertura && cobertura.unidades.length > 0 && (
            <button
              type="button"
              onClick={() => setCoberturaAbierta(true)}
              className={`${BOTON.base} ${BOTON.secundario}`}
            >
              Cobertura por país
            </button>
          )}

          {cobertura && cobertura.monedas.length > 1 && (
            <span className={`${TIPO.s} ${TEXTO.t3}`}>
              {cobertura.monedas.join(' · ')}
            </span>
          )}
        </div>
      )}

      {/* ---------------- El cuerpo ---------------- */}
      {error && (
        <Aviso tono="rojo" icono={AlertTriangle}>
          {error}
        </Aviso>
      )}

      {!clienteId ? (
        <Vacio icono={<Coins />} titulo="Elige un cliente para ver sus costes">
          El coste se guarda por cliente y por SKU. Nunca se mezclan ni se comparan los de dos
          cuentas.
        </Vacio>
      ) : cargando && !vista ? (
        <Cargando texto="Cruzando el catálogo con el histórico de costes…" />
      ) : !vista ? null : vista.catalogoVacio ? (
        <Vacio icono={<Inbox />} titulo="El espejo del catálogo de este cliente está vacío">
          No hay ni un SKU al que asignarle un coste, así que la cobertura no es del 0 %: no se
          puede medir. Lo primero es el trabajo{' '}
          <span className={TEXTO.t1}>«Censo del catálogo»</span> de la pestaña Ingesta. Un coste a
          mano sí se puede meter ya, pero se queda esperando a que su SKU exista.
        </Vacio>
      ) : vista.filas.length === 0 ? (
        <Vacio icono={<Search />} titulo="Ninguna referencia cumple este filtro">
          <button
            type="button"
            onClick={() => {
              setTexto('')
              setEstado('todos')
              setSoloSeguimiento(false)
            }}
            className={`${BOTON.base} ${BOTON.secundario} mt-2`}
          >
            Quitar los filtros
          </button>
        </Vacio>
      ) : (
        <>
          <TablaCostes
            filas={vista.filas}
            onFicha={setFichaSku}
            onEditar={(fila) => setEditando({ sku: fila.sku, fila })}
          />

          <div className="flex shrink-0 items-center gap-2">
            <span className={`${TIPO.s} ${TEXTO.t4} tabular-nums`}>
              {cifra(vista.total)} {vista.total === 1 ? 'referencia' : 'referencias'}
              {vista.total > vista.limite && ` · página ${pagina + 1} de ${paginas}`}
            </span>
            {vista.total > vista.limite && (
              <>
                <button
                  type="button"
                  disabled={pagina === 0}
                  onClick={() => setPagina((p) => Math.max(0, p - 1))}
                  className={`${BOTON.base} ${BOTON.secundario}`}
                >
                  <ChevronLeft className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  disabled={pagina + 1 >= paginas}
                  onClick={() => setPagina((p) => p + 1)}
                  className={`${BOTON.base} ${BOTON.secundario}`}
                >
                  <ChevronRight className="h-3 w-3" />
                </button>
              </>
            )}
            <span className={`${TIPO.s} ${TEXTO.t4} ml-auto`}>Leído {hace(vista.leidoAt)}</span>
          </div>
        </>
      )}

      {/* ---------------- Ventanas ---------------- */}
      {editando && clienteId && politica && (
        <DialogoCoste
          clientId={clienteId}
          clienteNombre={clienteNombre}
          skuInicial={editando.sku}
          fila={editando.fila}
          politica={politica}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null)
            recargar()
          }}
        />
      )}

      {fichaSku && clienteId && (
        <DialogoFicha
          clientId={clienteId}
          sku={fichaSku}
          fecha={fecha}
          onCerrar={() => setFichaSku(null)}
          onEditar={(fila) => {
            setFichaSku(null)
            setEditando({ sku: fila?.sku ?? fichaSku, fila })
          }}
          onCambio={recargar}
        />
      )}

      {importando && clienteId && (
        <DialogoImportar
          clientId={clienteId}
          onCerrar={() => setImportando(false)}
          onAplicado={recargar}
        />
      )}

      {politicaAbierta && clienteId && politica && (
        <DialogoPolitica
          clientId={clienteId}
          politica={politica}
          onCerrar={() => setPoliticaAbierta(false)}
          onGuardado={() => {
            setPoliticaAbierta(false)
            recargar()
          }}
        />
      )}

      {coberturaAbierta && cobertura && (
        <DialogoCobertura cobertura={cobertura} onCerrar={() => setCoberturaAbierta(false)} />
      )}
    </div>
  )
}

/* ================================================================== */
/* La tabla                                                            */
/* ================================================================== */

/**
 * La tabla de costes.
 *
 * LA COLUMNA «FALTA» ES LA RAZÓN DE SER DE ESTA PANTALLA. Un coste al que le
 * falta el porte de un envío propio o el almacenamiento de FBA no se calcula con
 * ceros: se marca, y la columna dice EXACTAMENTE qué pata falta. La alternativa
 * —rellenar con cero— produce el margen más alto de la tabla justo en los
 * productos de los que menos sabemos.
 */
function TablaCostes({
  filas,
  onFicha,
  onEditar,
}: {
  filas: FilaCoste[]
  onFicha: (sku: string) => void
  onEditar: (fila: FilaCoste) => void
}) {
  return (
    <div className={TABLA.caja}>
      <table className={TABLA.tabla}>
        <thead>
          <tr>
            <th className={`${TABLA.cabecera} ${TABLA.cabeceraFija}`}>SKU</th>
            <th className={TABLA.cabecera}>Producto</th>
            <th className={TABLA.cabecera}>Canal</th>
            <th className={TABLA.cabecera}>Estado</th>
            <th className={TABLA.cabecera}>Falta</th>
            <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Compra</th>
            <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Total</th>
            {/* La fecha y su antigüedad van JUNTAS: son la misma pregunta —«¿de
                cuándo es este coste?»— y separadas gastan una columna de las
                once que ya no caben a 1.200 px sin barra horizontal. */}
            <th className={TABLA.cabecera}>Rige desde</th>
            <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Tramos</th>
            <th className={TABLA.cabecera} />
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.sku} className={TABLA.fila}>
              <td className={`${TABLA.celda} ${TABLA.celdaFija}`}>
                <button
                  type="button"
                  onClick={() => onFicha(f.sku)}
                  className={`${TEXTO.t1} max-w-[190px] truncate text-left hover:underline`}
                  title="Ver los tramos y el rastro de este SKU"
                >
                  {f.sku}
                </button>
              </td>

              {/* El tope va en el <span> y no en el <td>: la tabla lleva
                  `min-w-max` y con el reparto automático de columnas un
                  max-width sobre la celda no se respeta. Sobre un hijo en
                  bloque sí, y es lo que impide que un título largo empuje las
                  columnas de la derecha fuera de la pantalla. */}
              <td className={`${TABLA.celda} ${TEXTO.t3}`}>
                <span className={`${TABLA.corta} max-w-[190px]`} title={f.titulo ?? ''}>
                  {f.titulo ?? '—'}
                </span>
              </td>

              <td className={`${TABLA.celda} ${TEXTO.t3}`}>{canalesEnPantalla(f.canales)}</td>

              <td className={TABLA.celda}>
                <EstadoCosteLinea estado={f.estado} />
              </td>

              {/* Lo que falta, con el porqué entero en el title. La frase larga
                  no cabe en una celda y esconderla del todo obligaría a abrir la
                  ficha de cada SKU para saber por qué no hay margen. */}
              <td className={`${TABLA.celda} ${TEXTO.t3}`} title={f.motivo}>
                <span className={`${TABLA.corta} max-w-[180px]`}>
                  {f.faltan.length > 0 ? f.faltan.join(', ') : '—'}
                </span>
              </td>

              <td className={`${TABLA.celda} ${TABLA.numero}`}>
                {f.coste ? dinero(f.coste.coste, f.coste.moneda) : <SinDato motivo={f.motivo} />}
              </td>

              <td className={`${TABLA.celda} ${TABLA.numero} ${TEXTO.t1}`}>
                {f.total !== null ? dinero(f.total, f.moneda) : <SinDato motivo={f.motivo} />}
              </td>

              <td className={TABLA.celda} title={f.vigenciaMotivo}>
                {f.coste ? (
                  <span className="flex items-baseline gap-[6px] whitespace-nowrap">
                    <span className={`${TEXTO.t3} tabular-nums`}>{f.coste.valido_desde}</span>
                    {f.dias !== null && (
                      <span
                        className={`${TIPO.xs} tabular-nums`}
                        style={{
                          color:
                            f.vigencia === 'caducado'
                              ? COLOR_ESTADO.rojo
                              : 'var(--ls-t4)',
                        }}
                      >
                        {cifra(f.dias)} d
                      </span>
                    )}
                  </span>
                ) : (
                  <SinDato motivo={f.vigenciaMotivo} />
                )}
              </td>

              <td className={`${TABLA.celda} ${TABLA.numero} ${TEXTO.t3}`}>
                {f.tramos > 0 ? cifra(f.tramos) : '—'}
              </td>

              <td className={TABLA.celda}>
                <button
                  type="button"
                  onClick={() => onEditar(f)}
                  className={BOTON.icono}
                  aria-label={`Poner o corregir el coste de ${f.sku}`}
                  title="Poner o corregir el coste"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * El hueco explicado.
 *
 * No es un guion decorativo: lleva el motivo en el `title`, que es lo que
 * distingue «cuesta cero» de «no lo sabemos». Es el mismo criterio que
 * porQueSinMargen() en el motor.
 */
function SinDato({ motivo }: { motivo?: string }) {
  return (
    <span className={TEXTO.t4} title={motivo}>
      —
    </span>
  )
}

function Cifra({
  rotulo,
  valor,
  urgente,
}: {
  rotulo: string
  valor: string
  urgente?: boolean
}) {
  return (
    <span className={CIFRAS.celda}>
      <span className={`${CIFRAS.valor} ${urgente ? CIFRAS.urgente : ''}`}>{valor}</span>
      <span className={CIFRAS.rotulo}>{rotulo}</span>
    </span>
  )
}

/* ================================================================== */
/* Meter un coste a mano                                               */
/* ================================================================== */

/**
 * EL ALTA A MANO, que es lo que se pidió expresamente.
 *
 * DOS CAMPOS SON OBLIGATORIOS Y NO SE PUEDEN QUITAR:
 *
 *   · «RIGE DESDE» NACE VACÍO A PROPÓSITO. Ponerle hoy por defecto es cómo se
 *     escribe un coste con fecha de hoy que en realidad rige desde marzo, y
 *     entonces los márgenes de marzo, abril y mayo se calculan con el coste
 *     viejo y nadie se entera. El servidor lo exige igual; aquí solo no se
 *     rellena solo.
 *   · EL MOTIVO. Lo exige también el CHECK de la base para todo lo que entra a
 *     mano. Un coste cambiado sin explicación es imposible de auditar tres meses
 *     después, que es justo cuando alguien pregunta por qué ese margen no cuadra.
 *
 * El veredicto de completitud se pinta MIENTRAS SE TECLEA y lo calcula la misma
 * función pura que aplicará el servidor: no hay dos reglas.
 */
function DialogoCoste({
  clientId,
  clienteNombre,
  skuInicial,
  fila,
  politica,
  onCerrar,
  onGuardado,
}: {
  clientId: string
  clienteNombre: string
  skuInicial: string
  fila: FilaCoste | null
  politica: PoliticaCostes
  onCerrar: () => void
  onGuardado: () => void
}) {
  const vigente = fila?.coste ?? null

  const [sku, setSku] = useState(skuInicial)
  const [validoDesde, setValidoDesde] = useState('')
  const [compra, setCompra] = useState(vigente ? String(vigente.coste) : '')
  const [moneda, setMoneda] = useState(vigente?.moneda ?? politica.moneda_defecto ?? '')
  const [envio, setEnvio] = useState(textoNumero(vigente?.coste_envio))
  const [almacen, setAlmacen] = useState(textoNumero(vigente?.coste_almacen_fba))
  const [flete, setFlete] = useState(textoNumero(vigente?.coste_flete_fba))
  const [ivaIncluido, setIvaIncluido] = useState(vigente?.iva_incluido ?? false)
  const [ivaPorcentaje, setIvaPorcentaje] = useState(textoNumero(vigente?.iva_porcentaje))
  const [motivo, setMotivo] = useState('')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)

  /**
   * Los canales por los que se vende este SKU, y por tanto qué patas se le
   * exigen al coste. Va en useMemo porque `?? []` fabrica un array nuevo en cada
   * render y sin esto el veredicto se recalcularía con cada tecla del formulario.
   */
  const canales = useMemo<CanalCoste[]>(() => fila?.canales ?? [], [fila])

  /** El mismo veredicto que va a aplicar el servidor, calculado mientras se teclea */
  const veredicto = useMemo(() => {
    const compraNum = numero(compra)
    if (compraNum === null || moneda.trim() === '') return null
    const evaluable: CosteEvaluable = {
      coste: compraNum,
      moneda: moneda.trim().toUpperCase(),
      coste_envio: numero(envio),
      coste_almacen_fba: numero(almacen),
      coste_flete_fba: numero(flete),
      iva_incluido: ivaIncluido,
      iva_porcentaje: numero(ivaPorcentaje),
    }
    return evaluarCosteEnCanales(evaluable, canales, exigenciasDe(politica))
  }, [compra, moneda, envio, almacen, flete, ivaIncluido, ivaPorcentaje, canales, politica])

  const listo =
    sku.trim() !== '' &&
    /^\d{4}-\d{2}-\d{2}$/.test(validoDesde) &&
    numero(compra) !== null &&
    moneda.trim() !== '' &&
    motivo.trim() !== ''

  async function guardar() {
    setGuardando(true)
    const res = await postAmazon<GuardarCosteRespuesta>('/api/plataforma/costes', {
      clientId,
      sku: sku.trim(),
      valido_desde: validoDesde,
      coste: compra.trim(),
      moneda: moneda.trim(),
      coste_envio: envio.trim() === '' ? null : envio.trim(),
      coste_almacen_fba: almacen.trim() === '' ? null : almacen.trim(),
      coste_flete_fba: flete.trim() === '' ? null : flete.trim(),
      iva_incluido: ivaIncluido,
      iva_porcentaje: ivaIncluido ? ivaPorcentaje.trim() : null,
      motivo: motivo.trim(),
      notes: notas.trim() === '' ? null : notas.trim(),
    })
    setGuardando(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }
    if (!res.data.cambiado) {
      toast.info(res.data.mensaje ?? 'No había nada que cambiar')
      onGuardado()
      return
    }
    toast.success(
      res.data.alta
        ? `Coste guardado para ${sku.trim()}`
        : `Coste corregido: ${(res.data.cambios ?? []).join(', ') || 'sin detalle'}`
    )
    onGuardado()
  }

  return (
    <Dialogo
      titulo="Coste de una referencia"
      entradilla={clienteNombre}
      onCerrar={onCerrar}
      ancho="max-w-[620px]"
      pie={
        <>
          <button type="button" onClick={onCerrar} className={`${BOTON.base} ${BOTON.secundario}`}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={!listo || guardando}
            onClick={() => void guardar()}
            className={`${BOTON.base} ${BOTON.primario}`}
          >
            {guardando ? 'Guardando…' : 'Guardar el coste'}
          </button>
        </>
      }
    >
      <div className={CAMPO.rejilla}>
        <Campo etiqueta="SKU" obligatorio>
          <input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            readOnly={fila !== null}
            className={CAMPO.input}
            placeholder="El SKU exacto de Amazon"
          />
        </Campo>

        <Campo etiqueta="Rige desde" obligatorio nota="No se rellena solo: es la fecha del tramo, no la de hoy.">
          <input
            type="date"
            value={validoDesde}
            onChange={(e) => setValidoDesde(e.target.value)}
            className={CAMPO.input}
          />
        </Campo>

        <Campo etiqueta="Precio de compra" obligatorio>
          <input
            inputMode="decimal"
            value={compra}
            onChange={(e) => setCompra(e.target.value)}
            className={`${CAMPO.input} ${CAMPO.numero}`}
            placeholder="0,00"
          />
        </Campo>

        <Campo etiqueta="Divisa" obligatorio>
          <input
            value={moneda}
            onChange={(e) => setMoneda(e.target.value)}
            maxLength={8}
            className={CAMPO.input}
            placeholder="EUR"
          />
        </Campo>

        <Campo etiqueta="Coste de envío" nota="Si lo mandamos nosotros (FBM o SFP).">
          <input
            inputMode="decimal"
            value={envio}
            onChange={(e) => setEnvio(e.target.value)}
            className={`${CAMPO.input} ${CAMPO.numero}`}
            placeholder="—"
          />
        </Campo>

        <Campo etiqueta="Almacenamiento FBA">
          <input
            inputMode="decimal"
            value={almacen}
            onChange={(e) => setAlmacen(e.target.value)}
            className={`${CAMPO.input} ${CAMPO.numero}`}
            placeholder="—"
          />
        </Campo>

        <Campo etiqueta="Flete de entrada FBA">
          <input
            inputMode="decimal"
            value={flete}
            onChange={(e) => setFlete(e.target.value)}
            className={`${CAMPO.input} ${CAMPO.numero}`}
            placeholder="—"
          />
        </Campo>

        <Campo etiqueta="IVA">
          <div className="flex items-center gap-[6px]">
            <label className={`${TIPO.s} ${TEXTO.t2} flex items-center gap-[5px] whitespace-nowrap`}>
              <input
                type="checkbox"
                checked={ivaIncluido}
                onChange={(e) => setIvaIncluido(e.target.checked)}
                className="h-3 w-3 accent-[var(--ls-acc)]"
              />
              incluido
            </label>
            <input
              inputMode="decimal"
              value={ivaPorcentaje}
              onChange={(e) => setIvaPorcentaje(e.target.value)}
              disabled={!ivaIncluido}
              className={`${CAMPO.input} ${CAMPO.numero} !w-[70px]`}
              placeholder="%"
              aria-label="Tipo de IVA en tanto por ciento"
            />
          </div>
        </Campo>
      </div>

      <div className="mt-[9px]">
        <Campo etiqueta="Por qué" obligatorio>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className={CAMPO.input}
            placeholder="Tarifa nueva del proveedor de marzo, corrección de un céntimo…"
          />
        </Campo>
      </div>

      <div className="mt-[9px]">
        <Campo etiqueta="Nota">
          <input
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            className={CAMPO.input}
            placeholder="Opcional"
          />
        </Campo>
      </div>

      {/* El veredicto en vivo. Es lo que impide guardar un coste a medias
          creyendo que está entero: lo dice ANTES de guardar, no después. */}
      <div className={`mt-[9px] ${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup2} px-[9px] py-[7px]`}>
        {canales.length === 0 ? (
          <p className={`${TIPO.s} ${TEXTO.t3}`}>
            Este SKU no está en el catálogo, así que todavía no se sabe si se vende por FBA o por
            envío propio y no se puede juzgar si su coste está completo.
          </p>
        ) : veredicto === null ? (
          <p className={`${TIPO.s} ${TEXTO.t4}`}>
            Pon el precio de compra y la divisa para ver si el coste queda completo.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-[3px]">
            <EstadoCosteLinea estado={veredicto.estado} />
            {veredicto.total !== null ? (
              <span className={`${TIPO.m} ${TEXTO.t1} font-semibold tabular-nums`}>
                {dinero(veredicto.total, veredicto.moneda)} por unidad
              </span>
            ) : (
              <span className={`${TIPO.s} ${TEXTO.t3}`}>{veredicto.motivo}</span>
            )}
          </div>
        )}
      </div>
    </Dialogo>
  )
}

/* ================================================================== */
/* La ficha de un SKU: sus tramos y su rastro                          */
/* ================================================================== */

function DialogoFicha({
  clientId,
  sku,
  fecha,
  onCerrar,
  onEditar,
  onCambio,
}: {
  clientId: string
  sku: string
  fecha: string
  onCerrar: () => void
  onEditar: (fila: FilaCoste | null) => void
  onCambio: () => void
}) {
  const [ficha, setFicha] = useState<FichaRespuesta['ficha'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [borrando, setBorrando] = useState<string | null>(null)
  const [motivoBorrado, setMotivoBorrado] = useState('')

  const cargar = useCallback(async () => {
    const res = await getAmazon<FichaRespuesta>(
      `/api/plataforma/costes/sku?clientId=${clientId}&sku=${encodeURIComponent(sku)}&fecha=${fecha}`
    )
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(null)
    setFicha(res.data.ficha)
  }, [clientId, sku, fecha])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function borrarTramo(id: string) {
    const res = await postAmazon<{ borrado: boolean }>('/api/plataforma/costes/sku', {
      accion: 'borrar_tramo',
      clientId,
      id,
      motivo: motivoBorrado.trim(),
    })
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Tramo borrado. Queda anotado con lo que decía.')
    setBorrando(null)
    setMotivoBorrado('')
    await cargar()
    onCambio()
  }

  return (
    <Dialogo
      titulo={sku}
      entradilla={
        ficha
          ? `${canalesEnPantalla(ficha.canales)} · ${ficha.marketplaces.join(', ') || 'sin país'}`
          : undefined
      }
      onCerrar={onCerrar}
      ancho="max-w-[860px]"
      pie={
        <button
          type="button"
          onClick={() => onEditar(ficha?.vigente ?? null)}
          className={`${BOTON.base} ${BOTON.primario}`}
        >
          <Plus className="h-3 w-3" />
          Poner o corregir el coste
        </button>
      }
    >
      {error && (
        <Aviso tono="rojo" icono={AlertTriangle}>
          {error}
        </Aviso>
      )}

      {!ficha ? (
        <Cargando />
      ) : (
        <div className="space-y-2">
          {/* Lo que rige el día que se está mirando */}
          <div className={`${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup2} px-[9px] py-[7px]`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-[3px]">
              <span className={TITULO.rotulo}>El {ficha.fecha}</span>
              {ficha.vigente ? (
                <>
                  <EstadoCosteLinea estado={ficha.vigente.estado} />
                  {ficha.vigente.total !== null ? (
                    <span className={`${TIPO.m} ${TEXTO.t1} font-semibold tabular-nums`}>
                      {dinero(ficha.vigente.total, ficha.vigente.moneda)} por unidad
                    </span>
                  ) : (
                    <span className={`${TIPO.s} ${TEXTO.t3}`}>{ficha.vigente.motivo}</span>
                  )}
                </>
              ) : (
                <span className={`${TIPO.s} ${TEXTO.t3}`}>
                  Este SKU no está en el catálogo de este cliente.
                </span>
              )}
            </div>
            {ficha.vigente && ficha.vigente.vigenciaMotivo && (
              <p className={`${TIPO.s} ${TEXTO.t4} mt-[3px]`}>{ficha.vigente.vigenciaMotivo}</p>
            )}
          </div>

          {/* Los tramos */}
          {ficha.tramos.length === 0 ? (
            <p className={`${TIPO.s} ${TEXTO.t3}`}>
              No hay ningún coste guardado de esta referencia.
            </p>
          ) : (
            <div className={`${TABLA.caja} max-h-[40vh]`}>
              <table className={TABLA.tabla}>
                <thead>
                  <tr>
                    <th className={TABLA.cabecera}>Rige desde</th>
                    <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Compra</th>
                    <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Envío</th>
                    <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Almacén</th>
                    <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Flete</th>
                    <th className={TABLA.cabecera}>IVA</th>
                    <th className={TABLA.cabecera}>Origen</th>
                    <th className={TABLA.cabecera}>Guardado</th>
                    <th className={TABLA.cabecera} />
                  </tr>
                </thead>
                <tbody>
                  {ficha.tramos.map((t) => (
                    <tr key={t.id} className={TABLA.fila}>
                      <td className={`${TABLA.celda} ${TEXTO.t1}`}>{t.valido_desde}</td>
                      <td className={`${TABLA.celda} ${TABLA.numero}`}>
                        {dinero(t.coste, t.moneda)}
                      </td>
                      <td className={`${TABLA.celda} ${TABLA.numero}`}>
                        {t.coste_envio !== null ? dinero(t.coste_envio, t.moneda) : <SinDato />}
                      </td>
                      <td className={`${TABLA.celda} ${TABLA.numero}`}>
                        {t.coste_almacen_fba !== null ? (
                          dinero(t.coste_almacen_fba, t.moneda)
                        ) : (
                          <SinDato />
                        )}
                      </td>
                      <td className={`${TABLA.celda} ${TABLA.numero}`}>
                        {t.coste_flete_fba !== null ? dinero(t.coste_flete_fba, t.moneda) : <SinDato />}
                      </td>
                      <td className={`${TABLA.celda} ${TEXTO.t3}`}>
                        {t.iva_incluido
                          ? t.iva_porcentaje !== null
                            ? `incluido ${t.iva_porcentaje}%`
                            : 'incluido, sin tipo'
                          : 'sin IVA'}
                      </td>
                      <td className={`${TABLA.celda} ${TEXTO.t3}`} title={t.fuente_ref ?? ''}>
                        {t.origen}
                      </td>
                      <td className={`${TABLA.celda} ${TEXTO.t3}`}>{fechaHora(t.created_at)}</td>
                      <td className={TABLA.celda}>
                        <button
                          type="button"
                          onClick={() => {
                            setBorrando(borrando === t.id ? null : t.id)
                            setMotivoBorrado('')
                          }}
                          className={BOTON.icono}
                          aria-label={`Borrar el tramo del ${t.valido_desde}`}
                          title="Borrar este tramo"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Borrar un tramo pide el motivo. Un tramo con la fecha equivocada no
              se arregla metiendo otro: se queda rigiendo un trozo de histórico. */}
          {borrando && (
            <div className="flex flex-wrap items-end gap-[6px]">
              <div className={`${CAMPO.contenedor} flex-1 min-w-[240px]`}>
                <label className={CAMPO.etiqueta}>
                  Por qué se borra el tramo <span className={CAMPO.obligatorio}>*</span>
                </label>
                <input
                  value={motivoBorrado}
                  onChange={(e) => setMotivoBorrado(e.target.value)}
                  className={CAMPO.input}
                  autoFocus
                />
              </div>
              <button
                type="button"
                disabled={motivoBorrado.trim() === ''}
                onClick={() => void borrarTramo(borrando)}
                className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}
              >
                Borrar
              </button>
              <button
                type="button"
                onClick={() => setBorrando(null)}
                className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario}`}
              >
                Dejarlo
              </button>
            </div>
          )}

          {/* El rastro */}
          {ficha.auditoria.length > 0 && (
            <div>
              <p className={`${TITULO.rotulo} mb-[5px]`}>Quién tocó qué</p>
              <ul className="space-y-[3px]">
                {ficha.auditoria.slice(0, 12).map((a) => (
                  <li key={a.id} className={`${TIPO.s} ${TEXTO.t3} flex flex-wrap gap-x-2`}>
                    <span className={TEXTO.t2}>{a.accion}</span>
                    <span>{a.valido_desde}</span>
                    <span className={TEXTO.t4}>{fechaHora(a.created_at)}</span>
                    {a.motivo && <span className="min-w-0 flex-1 truncate">{a.motivo}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Dialogo>
  )
}

/* ================================================================== */
/* Importar el fichero del cliente                                     */
/* ================================================================== */

/**
 * IMPORTAR EL FICHERO DE COSTES.
 *
 * NACE EN SIMULACRO Y NO SE PUEDE SALTAR: el botón de aplicar no existe hasta
 * que se ha visto un simulacro, y el simulacro hace exactamente el mismo trabajo
 * —leer, cruzar, planificar— sin escribir ni una fila. Como el plan sale del
 * mismo camino que la escritura, lo que se ve es lo que va a pasar.
 *
 * El cruce referencia→SKU NO SE ESCRIBE AQUÍ: lo hace el mismo motor que decide
 * todas las noches qué unidades se publican en cada listing, probado contra los
 * ficheros reales de un cliente. De ahí que el perfil pida de qué cliente de la
 * sincronización de stock se toma el mapeo.
 */
function DialogoImportar({
  clientId,
  onCerrar,
  onAplicado,
}: {
  clientId: string
  onCerrar: () => void
  onAplicado: () => void
}) {
  const [datos, setDatos] = useState<PerfilesRespuesta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [perfilId, setPerfilId] = useState('')
  const [ajustando, setAjustando] = useState(false)

  const [fichero, setFichero] = useState<File | null>(null)
  const [validoDesde, setValidoDesde] = useState(() => hoyIso())
  const [motivo, setMotivo] = useState('')
  const [informe, setInforme] = useState<InformeImportacion | null>(null)
  const [trabajando, setTrabajando] = useState(false)

  const cargar = useCallback(async () => {
    const res = await getAmazon<PerfilesRespuesta>(
      `/api/plataforma/costes/perfiles?clientId=${clientId}`
    )
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(null)
    setDatos(res.data)
    setPerfilId((actual) => actual || res.data.perfiles[0]?.id || '')
  }, [clientId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const perfil = datos?.perfiles.find((p) => p.id === perfilId) ?? null

  async function crearPerfil() {
    const nombre = window.prompt('Nombre del perfil de lectura', 'Tarifa del proveedor')
    if (!nombre) return
    const res = await postAmazon<{ perfil: PerfilCostes }>('/api/plataforma/costes/perfiles', {
      clientId,
      name: nombre,
    })
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setPerfilId(res.data.perfil.id)
    setAjustando(true)
    await cargar()
  }

  async function borrarPerfilActual() {
    if (!perfil) return
    if (!window.confirm(`¿Borrar el perfil «${perfil.name}»? Los costes ya importados se quedan.`)) {
      return
    }
    const res = await deleteAmazon<{ borrado: boolean }>(
      `/api/plataforma/costes/perfiles/${perfil.id}`
    )
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setPerfilId('')
    await cargar()
  }

  async function lanzar(modo: 'simulacro' | 'aplicado') {
    if (!fichero || !perfil) return
    setTrabajando(true)

    const form = new FormData()
    form.set('clientId', clientId)
    form.set('profileId', perfil.id)
    form.set('fichero', fichero)
    form.set('validoDesde', validoDesde)
    form.set('modo', modo)
    if (motivo.trim()) form.set('motivo', motivo.trim())

    const res = await subirAmazon<ImportacionRespuesta>(
      '/api/plataforma/costes/importar',
      form
    )
    setTrabajando(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setInforme(res.data.informe)
    await cargar()

    if (modo === 'aplicado') {
      toast.success(
        `${res.data.informe.altas} altas y ${res.data.informe.correcciones} correcciones aplicadas`
      )
      onAplicado()
    }
  }

  const puedeAplicar =
    informe !== null &&
    informe.modo === 'simulacro' &&
    informe.altas + informe.correcciones > 0 &&
    fichero !== null

  return (
    <Dialogo
      titulo="Importar el fichero de costes"
      onCerrar={onCerrar}
      ancho="max-w-[900px]"
      pie={
        <>
          <button type="button" onClick={onCerrar} className={`${BOTON.base} ${BOTON.secundario}`}>
            Cerrar
          </button>
          <button
            type="button"
            disabled={!fichero || !perfil || trabajando}
            onClick={() => void lanzar('simulacro')}
            className={`${BOTON.base} ${BOTON.primario}`}
          >
            {trabajando ? 'Leyendo…' : 'Simulacro'}
          </button>
          <button
            type="button"
            disabled={!puedeAplicar || trabajando}
            onClick={() => void lanzar('aplicado')}
            className={`${BOTON.base} ${BOTON.secundario}`}
          >
            Aplicar de verdad
          </button>
        </>
      }
    >
      {error && (
        <Aviso tono="rojo" icono={AlertTriangle}>
          {error}
        </Aviso>
      )}

      {!datos ? (
        <Cargando />
      ) : (
        <div className="space-y-2">
          {/* -------- El perfil -------- */}
          <div className="flex flex-wrap items-end gap-[6px]">
            <div className={`${CAMPO.contenedor} w-[240px]`}>
              <label className={CAMPO.etiqueta} htmlFor="costes-perfil">
                Perfil de lectura
              </label>
              <select
                id="costes-perfil"
                value={perfilId}
                onChange={(e) => setPerfilId(e.target.value)}
                className={CAMPO.input}
              >
                <option value="">Elige uno…</option>
                {datos.perfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => void crearPerfil()}
              className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario}`}
            >
              <Plus className="h-3 w-3" />
              Nuevo
            </button>
            {perfil && (
              <>
                <button
                  type="button"
                  onClick={() => setAjustando((v) => !v)}
                  aria-expanded={ajustando}
                  className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario}`}
                >
                  <Settings2 className="h-3 w-3" />
                  Ajustar la lectura
                </button>
                <button
                  type="button"
                  onClick={() => void borrarPerfilActual()}
                  className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </>
            )}
            {perfil?.last_error && (
              <span className={`${TIPO.s} basis-full`} style={{ color: COLOR_ESTADO.rojo }}>
                Último intento: {perfil.last_error}
              </span>
            )}
          </div>

          {perfil && ajustando && (
            <EditorPerfil
              perfil={perfil}
              stockClientes={datos.stockClientes}
              onGuardado={cargar}
            />
          )}

          {/* -------- El fichero --------
              Rejilla y no `flex items-end`: con flex, el campo que lleva nota
              es más alto que los otros dos y al alinearse por abajo su etiqueta
              sube por encima de las demás, que es como se leía antes: tres
              etiquetas a tres alturas distintas. */}
          <div className={CAMPO.rejilla}>
            <Campo etiqueta="Fichero del cliente" obligatorio>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => {
                  setFichero(e.target.files?.[0] ?? null)
                  setInforme(null)
                }}
                className={`${CAMPO.input} py-[3px] file:mr-2 file:h-[18px] file:rounded-[4px] file:border-0 file:bg-[var(--ls-sup3)] file:px-2 file:text-[11px] file:text-[var(--ls-t2)]`}
              />
            </Campo>

            <Campo etiqueta="Rige desde" nota="Solo si el fichero no trae fecha.">
              <input
                type="date"
                value={validoDesde}
                onChange={(e) => setValidoDesde(e.target.value)}
                className={CAMPO.input}
              />
            </Campo>

            <Campo etiqueta="Por qué">
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className={CAMPO.input}
                placeholder="Opcional"
              />
            </Campo>
          </div>

          {informe && <Informe informe={informe} />}

          {/* -------- El historial -------- */}
          {datos.importaciones.length > 0 && (
            <div>
              <p className={`${TITULO.rotulo} mb-[5px]`}>Últimas importaciones</p>
              <ul className="space-y-[3px]">
                {datos.importaciones.slice(0, 8).map((i) => (
                  <li key={i.id}>
                    <LineaImportacion imp={i} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Dialogo>
  )
}

function LineaImportacion({ imp }: { imp: ImportacionCostes }) {
  return (
    <span className={`${TIPO.s} ${TEXTO.t3} flex flex-wrap items-baseline gap-x-2`}>
      <span
        className="text-[11px] leading-none"
        style={{ color: COLOR_ESTADO[imp.estado === 'ok' ? 'verde' : 'rojo'] }}
        aria-hidden
      >
        ●
      </span>
      <span className={TEXTO.t2}>{imp.fichero ?? 'sin nombre'}</span>
      <span>{imp.modo}</span>
      <span className="tabular-nums">
        {cifra(imp.altas)} altas · {cifra(imp.correcciones)} correcciones ·{' '}
        {cifra(imp.sin_casar)} sin casar
      </span>
      <span className={TEXTO.t4}>{fechaHora(imp.created_at)}</span>
      {imp.error_message && (
        <span className="basis-full" style={{ color: COLOR_ESTADO.rojo }}>
          {imp.error_message}
        </span>
      )}
    </span>
  )
}

/** El informe del simulacro o de la aplicación. El mismo en los dos casos */
function Informe({ informe }: { informe: InformeImportacion }) {
  return (
    <div className={`${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup2} px-[9px] py-[7px] space-y-2`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-[3px]">
        <span className={TITULO.rotulo}>
          {informe.aplicado ? 'Aplicado' : 'Simulacro'} · {informe.hoja}
        </span>
        <span className={`${TIPO.s} ${TEXTO.t3} tabular-nums`}>
          {cifra(informe.filasLeidas)} filas leídas · {cifra(informe.casados)} casadas ·{' '}
          {cifra(informe.sinCasar)} sin casar
        </span>
      </div>

      <div className={CIFRAS.tira}>
        <Cifra rotulo="altas" valor={cifra(informe.altas)} />
        <Cifra rotulo="correcciones" valor={cifra(informe.correcciones)} />
        <Cifra rotulo="sin cambio" valor={cifra(informe.sinCambio)} />
        <Cifra
          rotulo="filas sin coste"
          valor={cifra(informe.filasSinCoste)}
          urgente={informe.filasSinCoste > 0}
        />
      </div>

      {informe.monedas.length > 0 && (
        <p className={`${TIPO.s} ${TEXTO.t3}`}>
          Divisas: {informe.monedas.join(', ')} · fechas: {informe.fechas.join(', ')}
        </p>
      )}

      {informe.avisos.map((aviso, i) => (
        <Aviso key={i} tono="ambar" icono={AlertTriangle}>
          {aviso}
        </Aviso>
      ))}

      {informe.muestraSinSku.length > 0 && (
        <div>
          <p className={`${TITULO.rotulo} mb-[5px]`}>
            Líneas que no han llegado a ningún SKU (muestra)
          </p>
          <div className={`${TABLA.caja} max-h-[180px]`}>
            <table className={TABLA.tabla}>
              <thead>
                <tr>
                  <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Fila</th>
                  <th className={TABLA.cabecera}>Artículo</th>
                  <th className={TABLA.cabecera}>Por qué</th>
                </tr>
              </thead>
              <tbody>
                {informe.muestraSinSku.map((s) => (
                  <tr key={`${s.fila}-${s.articulo}`} className={TABLA.fila}>
                    <td className={`${TABLA.celda} ${TABLA.numero}`}>{s.fila}</td>
                    <td className={`${TABLA.celda} ${TEXTO.t2}`}>{s.articulo}</td>
                    <td className={`${TABLA.celda} ${TEXTO.t3}`} title={s.detalle}>
                      {s.motivo}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {informe.muestraCorrecciones.length > 0 && (
        <div>
          <p className={`${TITULO.rotulo} mb-[5px]`}>Correcciones (muestra)</p>
          <div className={`${TABLA.caja} max-h-[180px]`}>
            <table className={TABLA.tabla}>
              <thead>
                <tr>
                  <th className={TABLA.cabecera}>SKU</th>
                  <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Antes</th>
                  <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Ahora</th>
                  <th className={TABLA.cabecera}>Qué cambia</th>
                </tr>
              </thead>
              <tbody>
                {informe.muestraCorrecciones.map((m) => (
                  <tr key={`${m.sku}-${m.validoDesde}`} className={TABLA.fila}>
                    <td className={`${TABLA.celda} ${TEXTO.t1}`}>{m.sku}</td>
                    <td className={`${TABLA.celda} ${TABLA.numero}`}>
                      {m.antes !== undefined ? dinero(m.antes, m.moneda) : <SinDato />}
                    </td>
                    <td className={`${TABLA.celda} ${TABLA.numero}`}>
                      {dinero(m.coste, m.moneda)}
                    </td>
                    <td className={`${TABLA.celda} ${TEXTO.t3}`}>{(m.cambia ?? []).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

/* ================================================================== */
/* El perfil de lectura                                                */
/* ================================================================== */

/**
 * Cómo se lee el fichero de ESTE cliente.
 *
 * Los alias van separados por comas y el servidor los parte: el lector prueba
 * uno detrás de otro contra la cabecera del fichero, así que con varios puestos
 * el mismo perfil aguanta que el cliente cambie el nombre de la columna.
 *
 * La DIVISA no tiene valor por defecto y es lo único que puede parar la
 * importación entera. Está así a propósito, y el porqué está en el botón de
 * información.
 */
function EditorPerfil({
  perfil,
  stockClientes,
  onGuardado,
}: {
  perfil: PerfilCostes
  stockClientes: PerfilesRespuesta['stockClientes']
  onGuardado: () => Promise<void> | void
}) {
  const [borrador, setBorrador] = useState<Record<string, string | boolean | null>>({})
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    setBorrador({})
  }, [perfil.id])

  function valor(campo: keyof PerfilCostes): string {
    if (campo in borrador) return String(borrador[campo] ?? '')
    const actual = perfil[campo]
    if (Array.isArray(actual)) return actual.join(', ')
    return actual === null || actual === undefined ? '' : String(actual)
  }

  function poner(campo: string, v: string | boolean | null) {
    setBorrador((prev) => ({ ...prev, [campo]: v }))
  }

  async function guardar() {
    if (Object.keys(borrador).length === 0) return
    setGuardando(true)
    const res = await patchAmazon<{ perfil: PerfilCostes }>(
      `/api/plataforma/costes/perfiles/${perfil.id}`,
      borrador
    )
    setGuardando(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setBorrador({})
    toast.success('Perfil guardado')
    await onGuardado()
  }

  const ivaIncluido =
    'iva_incluido' in borrador ? Boolean(borrador.iva_incluido) : perfil.iva_incluido

  return (
    <div className={`${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup2} px-[9px] py-[7px]`}>
      <div className={CAMPO.rejilla}>
        <Campo etiqueta="Nombre">
          <input
            value={valor('name')}
            onChange={(e) => poner('name', e.target.value)}
            className={CAMPO.input}
          />
        </Campo>

        <Campo
          etiqueta="Mapeo referencia → SKU"
          nota="De qué cliente de la sincronización de stock se toma."
        >
          <select
            value={valor('stock_client_id')}
            onChange={(e) => poner('stock_client_id', e.target.value || null)}
            className={CAMPO.input}
          >
            <option value="">Ninguno: solo el catálogo de Amazon</option>
            {stockClientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.mapeos} filas
              </option>
            ))}
          </select>
        </Campo>

        <Campo etiqueta="Hoja">
          <input
            value={valor('hoja')}
            onChange={(e) => poner('hoja', e.target.value || null)}
            className={CAMPO.input}
            placeholder="La primera"
          />
        </Campo>

        <Campo etiqueta="Fila de la cabecera">
          <input
            inputMode="numeric"
            value={valor('fila_cabecera')}
            onChange={(e) => poner('fila_cabecera', e.target.value || null)}
            className={`${CAMPO.input} ${CAMPO.numero}`}
            placeholder="se busca sola"
          />
        </Campo>

        <Campo etiqueta="Divisa del fichero" obligatorio nota="Sin ella no se importa nada.">
          <input
            value={valor('moneda')}
            onChange={(e) => poner('moneda', e.target.value || null)}
            maxLength={8}
            className={CAMPO.input}
            placeholder="EUR"
          />
        </Campo>

        <Campo etiqueta="IVA del fichero">
          <div className="flex items-center gap-[6px]">
            <label className={`${TIPO.s} ${TEXTO.t2} flex items-center gap-[5px] whitespace-nowrap`}>
              <input
                type="checkbox"
                checked={ivaIncluido}
                onChange={(e) => poner('iva_incluido', e.target.checked)}
                className="h-3 w-3 accent-[var(--ls-acc)]"
              />
              incluido
            </label>
            <input
              inputMode="decimal"
              value={valor('iva_porcentaje')}
              onChange={(e) => poner('iva_porcentaje', e.target.value || null)}
              disabled={!ivaIncluido}
              className={`${CAMPO.input} ${CAMPO.numero} !w-[70px]`}
              placeholder="%"
              aria-label="Tipo de IVA del fichero"
            />
          </div>
        </Campo>
      </div>

      <p className={`${TITULO.rotulo} mb-[5px] mt-[9px]`}>
        Columnas del fichero · varios nombres separados por comas
      </p>
      <div className={CAMPO.rejilla}>
        {(
          [
            ['col_referencia', 'Referencia'],
            ['col_sku', 'SKU'],
            ['col_ean', 'EAN'],
            ['col_coste', 'Precio de compra'],
            ['col_envio', 'Coste de envío'],
            ['col_almacen', 'Almacenamiento'],
            ['col_flete', 'Flete de entrada'],
            ['col_moneda', 'Divisa'],
            ['col_valido_desde', 'Rige desde'],
          ] as Array<[keyof PerfilCostes, string]>
        ).map(([campo, etiqueta]) => (
          <Campo key={campo} etiqueta={etiqueta}>
            <input
              value={valor(campo)}
              onChange={(e) => poner(campo, e.target.value)}
              className={CAMPO.input}
            />
          </Campo>
        ))}
      </div>

      <div className="mt-[9px] flex items-center gap-[6px]">
        <button
          type="button"
          disabled={Object.keys(borrador).length === 0 || guardando}
          onClick={() => void guardar()}
          className={`${BOTON.base} ${BOTON.primario}`}
        >
          {guardando ? 'Guardando…' : 'Guardar el perfil'}
        </button>
        {perfil.last_ok_at && (
          <span className={`${TIPO.s} ${TEXTO.t4}`}>
            Última lectura correcta {hace(perfil.last_ok_at)}
          </span>
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/* La política del cliente                                             */
/* ================================================================== */

/**
 * Lo único de esta pestaña que es una DECISIÓN y no un dato.
 *
 * `dias_caducidad` NACE VACÍO Y SE PUEDE VOLVER A VACIAR. Cuántos días vale un
 * coste depende del proveedor y del sector, y un número inventado pinta de rojo
 * costes perfectamente vigentes —o de verde los que llevan dos años sin tocarse—.
 * Mientras esté vacío, la pantalla enseña la antigüedad, que es un hecho, y dice
 * que no hay política, que también lo es.
 */
function DialogoPolitica({
  clientId,
  politica,
  onCerrar,
  onGuardado,
}: {
  clientId: string
  politica: PoliticaCostes
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [dias, setDias] = useState(textoNumero(politica.dias_caducidad))
  const [monedaDefecto, setMonedaDefecto] = useState(politica.moneda_defecto ?? '')
  const [exigirEnvio, setExigirEnvio] = useState(politica.exigir_envio_propio)
  const [exigirFba, setExigirFba] = useState(politica.exigir_costes_fba)
  const [notas, setNotas] = useState(politica.notes ?? '')
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    setGuardando(true)
    const res = await patchAmazon<{ politica: PoliticaCostes }>(
      '/api/plataforma/costes/politica',
      {
        clientId,
        dias_caducidad: dias.trim() === '' ? null : dias.trim(),
        moneda_defecto: monedaDefecto.trim() === '' ? null : monedaDefecto.trim(),
        exigir_envio_propio: exigirEnvio,
        exigir_costes_fba: exigirFba,
        notes: notas.trim() === '' ? null : notas.trim(),
      }
    )
    setGuardando(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Política guardada')
    onGuardado()
  }

  return (
    <Dialogo
      titulo="Política de costes de este cliente"
      onCerrar={onCerrar}
      ancho="max-w-[520px]"
      pie={
        <>
          <button type="button" onClick={onCerrar} className={`${BOTON.base} ${BOTON.secundario}`}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={guardando}
            onClick={() => void guardar()}
            className={`${BOTON.base} ${BOTON.primario}`}
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <div className={CAMPO.rejilla}>
        <Campo etiqueta="Un coste caduca a los" nota="En días. Vacío = sin decidir.">
          <input
            inputMode="numeric"
            value={dias}
            onChange={(e) => setDias(e.target.value)}
            className={`${CAMPO.input} ${CAMPO.numero}`}
            placeholder="sin decidir"
          />
        </Campo>

        <Campo etiqueta="Divisa por defecto">
          <input
            value={monedaDefecto}
            onChange={(e) => setMonedaDefecto(e.target.value)}
            maxLength={8}
            className={CAMPO.input}
            placeholder="ninguna"
          />
        </Campo>
      </div>

      <div className="mt-[9px] space-y-[5px]">
        <label className={`${TIPO.m} ${TEXTO.t2} flex items-center gap-[6px]`}>
          <input
            type="checkbox"
            checked={exigirEnvio}
            onChange={(e) => setExigirEnvio(e.target.checked)}
            className="h-3 w-3 accent-[var(--ls-acc)]"
          />
          Exigir el coste de envío en lo que mandamos nosotros
        </label>
        <label className={`${TIPO.m} ${TEXTO.t2} flex items-center gap-[6px]`}>
          <input
            type="checkbox"
            checked={exigirFba}
            onChange={(e) => setExigirFba(e.target.checked)}
            className="h-3 w-3 accent-[var(--ls-acc)]"
          />
          Exigir almacenamiento y flete en FBA
        </label>
      </div>

      <div className="mt-[9px]">
        <Campo etiqueta="Nota">
          <input
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            className={CAMPO.input}
            placeholder="Opcional"
          />
        </Campo>
      </div>
    </Dialogo>
  )
}

/* ================================================================== */
/* La cobertura, país a país                                           */
/* ================================================================== */

/**
 * De qué análisis fiarse.
 *
 * La cifra de INCOMPLETOS es una COTA SUPERIOR y aquí se dice: un mismo SKU de
 * FBA al que le faltan el almacenamiento y el flete cuenta en los dos
 * predicados. Contar los distintos de verdad obligaría a traerse el catálogo
 * entero al servidor, que es justo lo que la función de la base evita. Para lo
 * que sirve la cifra —saber si el margen de este cliente es fiable— la cota
 * superior es la prudente.
 */
function DialogoCobertura({
  cobertura,
  onCerrar,
}: {
  cobertura: CoberturaRespuesta
  onCerrar: () => void
}) {
  return (
    <Dialogo
      titulo="Cobertura de costes"
      entradilla={`A fecha ${cobertura.fecha}`}
      onCerrar={onCerrar}
      ancho="max-w-[760px]"
    >
      <div className="space-y-2">
        {cobertura.unidades.map((u) => (
          <UnidadCobertura key={`${u.connection_id}|${u.marketplace_id}`} unidad={u} />
        ))}
      </div>
    </Dialogo>
  )
}

function UnidadCobertura({ unidad }: { unidad: ResumenCobertura & { pais: string } }) {
  return (
    <div className={`${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup2} px-[9px] py-[7px]`}>
      <div className="mb-[5px] flex flex-wrap items-baseline gap-x-3">
        <span className={TITULO.seccion}>{unidad.pais}</span>
        <span className={`${TIPO.s} ${TEXTO.t4} tabular-nums`}>
          {cifra(unidad.skus)} SKU · {cifra(unidad.en_seguimiento)} en seguimiento
        </span>
        {unidad.monedas.length > 0 && (
          <span className={`${TIPO.s} ${TEXTO.t3}`}>{unidad.monedas.join(' · ')}</span>
        )}
      </div>

      {unidad.skus === 0 ? (
        <p className={`${TIPO.s} ${TEXTO.t3}`}>
          No hay catálogo en este país, así que no hay cobertura que medir.
        </p>
      ) : (
        <table className="w-full max-w-[560px]">
          <tbody>
            <FilaBarra nombre="Con coste" valor={unidad.con_coste} total={unidad.skus} tono="azul" />
            <FilaBarra
              nombre="…y con todas las patas"
              valor={unidad.completosMin}
              total={unidad.skus}
              tono={unidad.completosMin === 0 ? 'ambar' : 'verde'}
            />
            <FilaBarra
              nombre="Envío propio sin porte"
              valor={unidad.propio_sin_envio}
              total={unidad.skus}
              tono="ambar"
            />
            <FilaBarra
              nombre="FBA sin almacenamiento"
              valor={unidad.fba_sin_almacen}
              total={unidad.skus}
              tono="ambar"
            />
            <FilaBarra
              nombre="FBA sin flete"
              valor={unidad.fba_sin_flete}
              total={unidad.skus}
              tono="ambar"
            />
            <FilaBarra
              nombre="Con IVA y sin tipo"
              valor={unidad.con_iva_sin_tipo}
              total={unidad.skus}
              tono="ambar"
            />
          </tbody>
        </table>
      )}

      <p className={`${TIPO.s} ${TEXTO.t4} mt-[5px] tabular-nums`}>
        Coste más antiguo {unidad.coste_mas_antiguo ?? '—'} · más nuevo{' '}
        {unidad.coste_mas_nuevo ?? '—'} · antigüedad mediana{' '}
        {unidad.dias_mediana !== null ? `${unidad.dias_mediana} días` : '—'}
      </p>
    </div>
  )
}

function FilaBarra({
  nombre,
  valor,
  total,
  tono,
}: {
  nombre: string
  valor: number
  total: number
  tono: TonoEstado
}) {
  return (
    <tr>
      <td className={`${TIPO.m} ${TEXTO.t2} h-7 whitespace-nowrap pr-3`}>{nombre}</td>
      <td className="h-7 w-[220px]">
        <Barra valor={valor} total={total} tono={tono} />
      </td>
    </tr>
  )
}

/* ================================================================== */
/* Piezas menudas                                                      */
/* ================================================================== */

function Campo({
  etiqueta,
  obligatorio,
  nota,
  children,
}: {
  etiqueta: string
  obligatorio?: boolean
  /** UNA línea, y solo cuando sin ella el control es ambiguo */
  nota?: string
  children: React.ReactNode
}) {
  return (
    <div className={CAMPO.contenedor}>
      <label className={CAMPO.etiqueta}>
        {etiqueta}
        {obligatorio && <span className={CAMPO.obligatorio}> *</span>}
      </label>
      {children}
      {nota && <p className={CAMPO.nota}>{nota}</p>}
    </div>
  )
}

/** Un número escrito en la pantalla, o null. NUNCA 0 por descuido */
function numero(valor: string): number | null {
  const t = valor.trim()
  if (t === '') return null
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Un número de la base a la caja de texto. null se queda VACÍO, no en cero */
function textoNumero(valor: number | null | undefined): string {
  return valor === null || valor === undefined ? '' : String(valor)
}

function porcentaje(parte: number, total: number): string {
  if (total <= 0) return '—'
  return `${Math.round((parte / total) * 100)}%`
}

/* ================================================================== */
/* La explicación entera, detrás del botón de información              */
/* ================================================================== */

export function InfoCostes() {
  return (
    <>
      <SeccionInfo titulo="Por qué esto lo tenemos que meter nosotros">
        <p>
          Amazon <strong>no da el coste de nada</strong>. Sabe a cuánto se vende y cuánto se lleva
          de comisión, pero no lo que le costó al cliente comprar el producto. Sin ese dato no hay
          margen, y sin margen no hay ni recomendación de FBM→FBA ni suelo de precio por debajo del
          cual no bajar.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="El coste tiene fecha">
        <p>
          Un mismo producto cuesta una cosa en enero y otra en junio. Calcular el margen de una
          venta de enero con el coste de junio da un número que parece bueno y no lo es. Por eso
          cada coste es un <strong>tramo con vigencia</strong> y no una casilla que se sobrescribe:
          cambiar el coste de hoy no reescribe la historia.
        </p>
        <p>
          El control <strong>«A fecha»</strong> de arriba es el que hace útil ese histórico: pon
          marzo y la tabla enseña lo que regía en marzo. El coste que se aplica un día es el del
          tramo con la fecha de entrada en vigor más alta que no lo supere.
        </p>
        <p>
          Por eso, al meter un coste a mano, la casilla <strong>«Rige desde» nace vacía</strong>. Si
          se rellenara con hoy, un coste que en realidad rige desde marzo dejaría los márgenes de
          marzo, abril y mayo calculados con el coste viejo, y nadie se enteraría.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Un coste incompleto no es un coste">
        <ListaInfo>
          <li>
            <strong>Compra</strong> — lo que le costó el producto. Sin esto no hay nada.
          </li>
          <li>
            <strong>Envío al cliente final</strong> cuando el paquete sale de nuestro almacén (FBM y
            también Seller Fulfilled Prime). El precio destacado que calcula Amazon <em>no</em>{' '}
            incluye el envío, así que con un cero aquí el margen de un catálogo FBM sale inflado
            justo donde más duele.
          </li>
          <li>
            <strong>Almacenamiento y flete de entrada en FBA</strong>. Las tarifas que devuelve
            Amazon no incluyen ninguno de los dos. Con ceros, al canal propio se le descuenta un
            coste real y al de Amazon no: la comparación entre los dos sale amañada a favor de FBA
            antes de empezar, y de ahí sale una recomendación de mandar inventario.
          </li>
          <li>
            <strong>IVA</strong>, y si el importe de compra va con impuesto incluido o no. Si lleva
            IVA y no consta el tipo, no se puede llevar a base imponible y el coste queda
            incompleto: ningún endpoint de Amazon da el tipo con los permisos que tenemos, y
            suponer un 21 % es inventarse un dato que cambia por país y por categoría.
          </li>
        </ListaInfo>
        <p>
          La columna <strong>«Falta»</strong> de la tabla dice exactamente qué pata falta en cada
          referencia, y mientras falte alguna la columna <strong>«Total unitario» no da número</strong>.
          Es la diferencia entre un hueco, que se ve, y un margen inflado, que no.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="«Sin coste» no es «coste cero»">
        <p>
          Nunca. Una referencia sin coste conocido queda fuera de cualquier cálculo de margen y lo
          dice. Rellenarla con un cero produciría el margen más alto de la tabla justo en los
          productos de los que no sabemos nada, que es exactamente al revés de lo que hace falta.
        </p>
        <p>
          Lo mismo con la pantalla vacía: un cliente cuyo catálogo todavía no se ha censado no tiene
          un <strong>0 % de cobertura</strong>, tiene una cobertura que no se puede medir. Son cosas
          distintas y se dicen distintas.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Qué exige este cliente, y qué caduca">
        <p>
          Las dos exigencias —el porte del envío propio y los costes de FBA— se pueden apagar por
          cliente en <strong>Política</strong>, porque hay casos legítimos: el cliente cuyo porte
          paga íntegro el comprador, o el que negocia el flete dentro del precio de compra.
          Apagarlas es una decisión que queda escrita, no un descuido que se hereda.
        </p>
        <p>
          <strong>Los días de caducidad nacen sin decidir</strong>, y se pueden volver a vaciar.
          Cuántos días vale un coste depende del proveedor y del sector; un umbral inventado pinta
          de rojo costes perfectamente vigentes, o de verde los que llevan dos años sin tocarse.
          Mientras no haya política, la tabla enseña la <strong>antigüedad en días</strong> —que es
          un hecho— y la cifra de caducados es «—», porque con la política vacía no puede haber
          ninguno: un cero ahí diría «está todo al día» cuando lo que pasa es que nadie lo ha
          mirado.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Importar el fichero del cliente">
        <ListaInfo>
          <li>
            <strong>Siempre empieza en simulacro.</strong> El simulacro hace exactamente el mismo
            trabajo —leer, cruzar, planificar— y no escribe ni una fila. Como el plan sale del mismo
            camino que la escritura, lo que se ve es lo que va a pasar.
          </li>
          <li>
            <strong>Repetir una importación es inofensivo.</strong> Un SKU tiene un coste por fecha
            de entrada en vigor: volver a subir el mismo fichero o no cambia nada, o corrige lo que
            difiera. Es también la forma de reanudar una importación que se cortó a medias: se
            vuelve a lanzar.
          </li>
          <li>
            <strong>El cruce referencia → SKU no es nuevo.</strong> Lo hace el mismo motor que
            decide cada noche qué unidades se publican en cada listing, probado contra los ficheros
            reales de un cliente. Sabe distinguir el código exacto de la forma sin ceros a la
            izquierda, sabe usar el EAN como desempate y —lo que más importa— <strong>se niega a
            elegir</strong> cuando una referencia lleva a dos artículos con costes distintos, en vez
            de meterle a un SKU el coste de otro producto.
          </li>
          <li>
            De ahí que el perfil pregunte <strong>de qué cliente de la sincronización de stock</strong>{' '}
            se toma el mapeo. Sin mapeo enlazado, el cruce solo puede usar el catálogo de Amazon: si
            muchas líneas se quedan sin SKU, suele ser por ahí.
          </li>
          <li>
            <strong>La divisa no tiene valor por defecto</strong> y es lo único que puede parar la
            importación entera. Un cliente que compra en dólares y vende en euros, con la divisa
            dada por supuesta, produce márgenes inventados; y ningún fichero de proveedor lleva
            escrito «esto son euros».
          </li>
          <li>
            El fichero <strong>no se guarda</strong>: se lee en memoria y se tira. Lo que queda es
            la anotación con su nombre, su tamaño y sus recuentos, que es lo que hace falta para
            investigar una cifra rara.
          </li>
        </ListaInfo>
      </SeccionInfo>

      <SeccionInfo titulo="La cobertura, y por qué los incompletos son una cota superior">
        <p>
          La cobertura contesta a una sola pregunta: <strong>¿el margen que estoy mirando vale
          algo?</strong> Sin ella, el diagnóstico de Buy Box y el análisis FBM→FBA dan un veredicto
          por referencia sin que nadie sepa que la mitad del catálogo no tiene coste, y un veredicto
          sobre datos que no están es peor que no tener veredicto.
        </p>
        <p>
          La cifra de incompletos es una <strong>cota superior, no un recuento exacto</strong>: un
          mismo SKU de FBA al que le faltan el almacenamiento y el flete cuenta en los dos
          predicados. Contar los distintos de verdad obligaría a traerse el catálogo entero, que es
          justo lo que la cuenta hecha en la base de datos evita. Para saber si fiarse o no, la cota
          prudente sobra.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Todo queda anotado">
        <p>
          Cada alta y cada corrección deja una fila con el antes, el después, quién y por qué — y
          por eso el motivo es obligatorio al meter un coste a mano. Es lo único que permite
          contestar tres meses después por qué el margen de una referencia no cuadra.
        </p>
        <p>
          Borrar un tramo también pide motivo y guarda la fila entera que se borró. Existe porque un
          tramo metido con la fecha equivocada no se arregla metiendo otro: se queda ahí rigiendo un
          trozo del histórico.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Un cliente, una consulta">
        <p>
          Los costes de compra de un vendedor son de lo más sensible que hay en esta base. Ninguna
          consulta de esta pantalla devuelve, agrega o compara los costes de dos clientes, ni
          siquiera anonimizados. La única lista que cruza cuentas es la de nombres para elegir de
          qué mapeo de stock se toma la equivalencia, y ahí no viaja ni un SKU ni un precio.
        </p>
      </SeccionInfo>
    </>
  )
}

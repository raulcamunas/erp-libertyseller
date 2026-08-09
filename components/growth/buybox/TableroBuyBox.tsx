'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Crown,
  Download,
  History,
  RefreshCw,
  Search,
  Timer,
  X,
} from 'lucide-react'
import { getAmazon, postAmazon } from '@/lib/amazon/client'
import type {
  BuyBoxRespuesta,
  ColaRespuesta,
  FilaBuyBox,
  HistoricoDisponible,
  ResumenBuyBox,
} from '@/lib/plataforma/buybox/cliente'
import {
  BOTON,
  CAMPO,
  CIFRAS,
  LINEA,
  PANTALLA,
  RADIO,
  SUPERFICIE,
  TABLA,
  TEXTO,
  TIPO,
} from '@/lib/estilo/denso'
import { VEREDICTOS, type Veredicto } from '@/lib/plataforma/buybox/tipos'
import {
  Aviso,
  Cargando,
  Dialogo,
  Vacio,
  cifra,
  dinero,
  hace,
  nombreMarketplace,
} from '@/components/plataforma/comun'
import { FichaBuyBox } from './FichaBuyBox'
import {
  AmazonEnAsin,
  Canal,
  EtiquetaVeredicto,
  GRUPO_PISTA,
  TechoDefensivo,
  TechoOfensivo,
  avisoPrime,
  datosDe,
  margenSinUsar,
  queHariaFalta,
  veredictosDe,
  type Grupo,
} from './piezas'

/**
 * =====================================================================
 *  ██  DÓNDE GANAMOS LA OFERTA DESTACADA Y DÓNDE NO  ██
 * =====================================================================
 *
 * LA DECISIÓN QUE EXPLICA TODA LA FORMA DE ESTA PANTALLA: las referencias que
 * TENEMOS y las que NO están en DOS TABLAS DISTINTAS, con DOS JUEGOS DE
 * CABECERAS DISTINTOS, y no se pueden ver a la vez.
 *
 * El motivo es el techo que da Amazon (FOEP). Es UN TECHO Y SIGNIFICA DOS COSAS
 * OPUESTAS según quién tenga hoy la oferta destacada:
 *
 *   · NO la tenemos → OFENSIVO: el precio AL QUE HAY QUE BAJAR para
 *     conquistarla. Eso sí es «qué nos haría falta».
 *   · SÍ la tenemos → DEFENSIVO: hasta dónde se puede SUBIR sin perderla, y
 *     normalmente está POR ENCIMA del precio actual. Eso no es un problema: es
 *     margen que estamos dejando sobre la mesa.
 *
 * No hay ningún campo de Amazon que distinga los dos casos. Una sola tabla con
 * una columna «FOEP» se lee de una única manera, y la mitad de las filas
 * significan la contraria: la regla ingenua «precio > techo, luego bajar»
 * RECORTA PRECIO EN LAS REFERENCIAS QUE YA VAN BIEN, sin dar ningún error y con
 * la pantalla en verde. Por eso aquí no existe esa tabla.
 *
 *
 * ============ LO QUE NO SE PUEDE SABER, SE DICE ============
 *
 *   · Si quien nos gana es Amazon vendiendo directamente: ternario —sí, no e
 *     indeterminado—, nunca un booleano. El indeterminado es el caso NORMAL.
 *   · El techo es precio de listing SIN envío, y no se puede pedir separado para
 *     Prime y no Prime. En un cliente con Prime propio (SFP) ese único número
 *     mezcla dos competiciones distintas, y se avisa en las filas donde pasa.
 *   · «Sin techo» es la AUSENCIA del dato, y además tiene dos sabores: que
 *     Amazon no lo dé, o que no se le haya preguntado en esta ronda. Con la
 *     rotación, lo segundo es lo habitual. Ninguno de los dos es un cero.
 *
 *
 * ============ Y EL HISTÓRICO NO EXISTE HASTA QUE LO GUARDAMOS ============
 *
 * Este módulo es el que lo genera. Así que la pantalla dice SIEMPRE cuántas
 * noches de datos hay, y con cero no pinta un cero: un «0 % de referencias
 * perdidas» sobre cero lecturas se lee como «vamos perfectos» y es justo lo
 * contrario de la verdad.
 *
 *
 * NADA SALE HACIA AMAZON DESDE AQUÍ. Este módulo observa, diagnostica y PROPONE
 * un precio en simulacro con su explicación. Los cambios de precio se hacen a
 * mano en Amazon API · Catálogo. Lo único que escribe esta pantalla es la cola
 * interna de peticiones de techo, que no llama a Amazon: deja el encargo para el
 * barrido siguiente.
 */

/** Cuántas filas se piden de una vez. Se sube de 200 en 200 */
const PASO = 200

/** Tope de referencias por petición de techo. Es el de la ruta de la cola */
const MAX_COLA = 500

type ClaveUnidad = string

function claveDe(u: { connection_id: string; marketplace_id: string }): ClaveUnidad {
  return `${u.connection_id}|${u.marketplace_id}`
}

export function TableroBuyBox({
  clientId,
  nombreCliente,
}: {
  clientId: string
  nombreCliente: string
}) {
  const [datos, setDatos] = useState<BuyBoxRespuesta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [mensaje, setMensaje] = useState<string | null>(null)

  const [unidad, setUnidad] = useState<ClaveUnidad | null>(null)
  const [vista, setVista] = useState<Grupo>('perdida')
  const [elegidos, setElegidos] = useState<Veredicto[]>([])
  const [escrito, setEscrito] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [limite, setLimite] = useState(PASO)
  const [porque, setPorque] = useState(false)
  const [abierto, setAbierto] = useState<FilaBuyBox | null>(null)
  const [verPendientes, setVerPendientes] = useState(false)

  // Sin debounce, cada tecla lanza una consulta que agrega sobre el histórico
  // entero de un catálogo de trece mil referencias.
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(escrito.trim()), 350)
    return () => clearTimeout(t)
  }, [escrito])

  const veredictos = useMemo(
    () => (elegidos.length > 0 ? elegidos : veredictosDe(vista, VEREDICTOS)),
    [elegidos, vista]
  )

  // La respuesta de una petición vieja no puede pisar a la de una nueva: al
  // cambiar de vista deprisa, la lenta llegaría después y pintaría la lista
  // equivocada bajo la cabecera correcta.
  const turno = useRef(0)

  const cargar = useCallback(async () => {
    const mio = ++turno.current
    setCargando(true)
    const query = new URLSearchParams({ clientId, limite: String(limite), desde: '0' })
    if (unidad) {
      const [connectionId, marketplaceId] = unidad.split('|')
      query.set('connectionId', connectionId)
      query.set('marketplaceId', marketplaceId)
    }
    if (veredictos.length > 0) query.set('veredictos', veredictos.join(','))
    if (busqueda) query.set('busqueda', busqueda)

    const res = await getAmazon<BuyBoxRespuesta>(`/api/plataforma/buybox?${query.toString()}`)
    if (turno.current !== mio) return
    setCargando(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(null)
    setDatos(res.data)
  }, [clientId, unidad, veredictos, busqueda, limite])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // La unidad se siembra con la primera que tenga catálogo en seguimiento, y no
  // con la primera a secas: una cuenta con cero referencias enseñaría una
  // pantalla vacía que parece una avería.
  useEffect(() => {
    if (unidad !== null || !datos || datos.resumen.length === 0) return
    const conCatalogo =
      datos.resumen.find((r) => r.diagnosticados > 0) ??
      datos.resumen.find((r) => r.skus_en_seguimiento > 0) ??
      datos.resumen[0]
    setUnidad(claveDe(conCatalogo))
  }, [datos, unidad])

  if (cargando && !datos) return <Cargando texto="Leyendo el monitor de Buy Box…" />
  if (error && !datos) {
    return (
      <Aviso tono="rojo" icono={AlertTriangle}>
        {error}
      </Aviso>
    )
  }
  if (!datos) return null

  if (datos.resumen.length === 0) {
    return (
      <Vacio icono={<Crown />} titulo={`${nombreCliente} no tiene ninguna cuenta activa que mirar`}>
        La oferta destacada se lee cuenta a cuenta y país a país. En cuanto la cuenta de Amazon esté
        conectada y activa desde <strong>Amazon API · Cuentas</strong>, aparece aquí.
      </Vacio>
    )
  }

  const actual = datos.resumen.find((r) => claveDe(r) === unidad) ?? datos.resumen[0]
  const historico = datos.historico.find(
    (h) => `${h.connection_id}|${h.marketplace_id}` === claveDe(actual)
  )
  const filas = datos.filas
  const pendientes = datos.config.pendientes

  // Las referencias de la lista abierta a las que todavía no se les ha
  // preguntado el techo. Es lo que hace falta para poder decir «qué nos haría
  // falta» en ellas, y hasta que no se pide no se puede.
  const sinTecho = filas.filter((f) => f.foep_estado === 'no_consultado').map((f) => f.sku)

  async function pedirTecho(skus: string[]) {
    if (skus.length === 0) return
    const res = await postAmazon<ColaRespuesta>('/api/plataforma/buybox/cola', {
      clientId,
      connectionId: actual.connection_id,
      marketplaceId: actual.marketplace_id,
      skus: skus.slice(0, MAX_COLA),
    })
    setMensaje(res.ok ? res.data.mensaje : res.error)
  }

  const exportar = () => {
    const query = new URLSearchParams({ clientId })
    query.set('connectionId', actual.connection_id)
    query.set('marketplaceId', actual.marketplace_id)
    if (veredictos.length > 0) query.set('veredictos', veredictos.join(','))
    if (busqueda) query.set('busqueda', busqueda)
    window.location.href = `/api/plataforma/buybox/exportar?${query.toString()}`
  }

  return (
    <div className={`${PANTALLA.cuerpo} h-full`}>
      <TiraDeCifras resumen={actual} historico={historico} lecturasParaSerie={datos.lecturasParaSerie} />

      {/* -------- Filtros: una fila -------- */}
      <div className={PANTALLA.filtros}>
        {datos.resumen.length > 1 && (
          <select
            value={claveDe(actual)}
            onChange={(e) => {
              setUnidad(e.target.value)
              setLimite(PASO)
            }}
            className={`${CAMPO.input} !h-6 !w-auto max-w-[280px]`}
            aria-label="Cuenta y país"
          >
            {datos.resumen.map((r) => (
              <option key={claveDe(r)} value={claveDe(r)}>
                {r.connection_name} · {nombreMarketplace(r.marketplace_id)}
              </option>
            ))}
          </select>
        )}

        <div className={PANTALLA.separador} />

        {(['perdida', 'nuestra', 'sin_juicio'] as Grupo[]).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => {
              setVista(g)
              setElegidos([])
              setLimite(PASO)
            }}
            title={GRUPO_PISTA[g]}
            className={`${BOTON.chip} ${vista === g ? BOTON.chipEncendido : ''}`}
          >
            {g === 'perdida' ? 'No la tenemos' : g === 'nuestra' ? 'La tenemos' : 'Sin juicio'}
            <span className={TEXTO.t4}>
              {cifra(
                g === 'perdida'
                  ? actual.sin_buybox
                  : g === 'nuestra'
                    ? actual.con_buybox
                    : actual.sin_juicio
              )}
            </span>
          </button>
        ))}

        <div className={PANTALLA.separador} />

        <label className="relative flex min-w-0 items-center">
          <Search className={`pointer-events-none absolute left-[7px] h-3 w-3 ${TEXTO.t4}`} />
          <input
            value={escrito}
            onChange={(e) => setEscrito(e.target.value)}
            placeholder="SKU, ASIN o título"
            aria-label="Buscar una referencia"
            className={`${CAMPO.input} !h-6 !w-[210px] pl-[24px]`}
          />
        </label>

        <button
          type="button"
          onClick={() => setPorque((v) => !v)}
          className={`${BOTON.chip} ${porque ? BOTON.chipEncendido : ''} ml-auto`}
          title="Añade bajo cada fila la razón entera del veredicto, con los números con los que se decidió. Apagado por defecto para que la tabla siga siendo una tabla."
        >
          Ver el porqué
        </button>

        {sinTecho.length > 0 && (
          <button
            type="button"
            onClick={() => void pedirTecho(sinTecho)}
            className={`${BOTON.base} ${BOTON.secundario}`}
            title="Mete estas referencias en la cola para pedirle el techo a Amazon en el próximo barrido. NO se llama a Amazon ahora: esa operación admite una petición cada treinta segundos y la pantalla se quedaría esperando."
          >
            <Timer className="h-[13px] w-[13px]" />
            Pedir el techo de {cifra(Math.min(sinTecho.length, MAX_COLA))}
          </button>
        )}

        <button type="button" onClick={exportar} className={`${BOTON.base} ${BOTON.secundario}`}>
          <Download className="h-[13px] w-[13px]" />
          Exportar
        </button>

        <button
          type="button"
          onClick={() => void cargar()}
          disabled={cargando}
          className={`${BOTON.base} ${BOTON.secundario}`}
        >
          <RefreshCw className={`h-[13px] w-[13px] ${cargando ? 'animate-spin' : ''}`} />
          Refrescar
        </button>
      </div>

      {/* -------- Los veredictos de la vista, con su recuento -------- */}
      <ChipsVeredicto
        vista={vista}
        causas={actual.causas}
        elegidos={elegidos}
        onCambiar={(v) => {
          setElegidos(v)
          setLimite(PASO)
        }}
      />

      {/* Accionable HOY y por eso se queda fuera del botón de información: hay
          algo concreto que decidir y sin ello el motor informa pero no
          recomienda. La consecuencia larga de cada una está a un clic. */}
      {pendientes.length > 0 && (
        <button
          type="button"
          onClick={() => setVerPendientes(true)}
          className={`${BOTON.base} ${BOTON.secundario} self-start`}
        >
          <AlertTriangle className="h-[13px] w-[13px]" />
          {pendientes.length} {pendientes.length === 1 ? 'decisión' : 'decisiones'} sin tomar
        </button>
      )}

      {mensaje && (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Aviso tono="azul" icono={Timer}>
              {mensaje}
            </Aviso>
          </div>
          <button
            type="button"
            onClick={() => setMensaje(null)}
            className={BOTON.icono}
            aria-label="Cerrar el aviso"
          >
            <X className="h-[13px] w-[13px]" />
          </button>
        </div>
      )}

      {/* -------- La lista -------- */}
      {actual.diagnosticados === 0 ? (
        <SinDiagnostico resumen={actual} />
      ) : filas.length === 0 ? (
        <ListaVacia vista={vista} resumen={actual} hayBusqueda={busqueda !== ''} />
      ) : (
        <Tabla
          vista={vista}
          filas={filas}
          porque={porque}
          onAbrir={setAbierto}
        />
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <p className={`${TIPO.s} ${TEXTO.t4}`}>
          {cifra(filas.length)} de {cifra(datos.total)} · vigencia {datos.diasVigencia} días · leído{' '}
          {hace(datos.leidoAt)}
        </p>
        {filas.length < datos.total && (
          <button
            type="button"
            onClick={() => setLimite((l) => l + PASO)}
            className={`${BOTON.base} ${BOTON.secundario}`}
          >
            Cargar {PASO} más
          </button>
        )}
      </div>

      {abierto && (
        <FichaBuyBox
          clientId={clientId}
          fila={abierto}
          lecturasParaSerie={datos.lecturasParaSerie}
          onCerrar={() => setAbierto(null)}
          onPedirTecho={(f) => void pedirTecho([f.sku])}
        />
      )}

      {verPendientes && (
        <Dialogo
          titulo="Lo que falta por decidir en este cliente"
          entradilla="Ninguno de estos números viene puesto por el código: los umbrales, los costes y las excepciones los pone una persona. Mientras falten, el motor informa y no recomienda."
          onCerrar={() => setVerPendientes(false)}
        >
          <ul className="space-y-[7px]">
            {pendientes.map((p) => (
              <li key={p.clave}>
                <p className={`${TIPO.m} ${TEXTO.t1} font-medium`}>{p.titulo}</p>
                <p className={`${TIPO.s} ${TEXTO.t3} leading-[1.5]`}>{p.consecuencia}</p>
              </li>
            ))}
          </ul>
        </Dialogo>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La tira de cifras, y el histórico que las sostiene                  */
/* ------------------------------------------------------------------ */

/**
 * ============ POR QUÉ EL PORCENTAJE PUEDE SER UN GUION ============
 *
 * Porque «cero referencias perdidas» y «no se ha mirado ninguna» se pintan igual
 * si uno se descuida, y el primero leído como el segundo dice que vamos
 * perfectos. Con cero diagnósticos aquí no sale un 0 % ni un 100 %: sale un
 * guion y al lado cuántas noches de datos hay.
 */
function TiraDeCifras({
  resumen,
  historico,
  lecturasParaSerie,
}: {
  resumen: ResumenBuyBox
  historico: HistoricoDisponible | undefined
  lecturasParaSerie: number
}) {
  const pct =
    resumen.diagnosticados > 0 ? (resumen.con_buybox / resumen.diagnosticados) * 100 : null

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <div className={CIFRAS.tira}>
        <Celda rotulo="en seguimiento" valor={cifra(resumen.skus_en_seguimiento)} />
        <Celda
          rotulo="diagnosticadas"
          valor={cifra(resumen.diagnosticados)}
          pista="Las que tienen un diagnóstico vigente. Uno de hace tres semanas no es un diagnóstico, es un recuerdo, y contarlo dejaría el porcentaje clavado aunque los barridos hayan dejado de correr."
        />
        <Celda
          rotulo={pct === null ? 'con la destacada · sin medir' : 'con la oferta destacada'}
          valor={
            pct === null
              ? '—'
              : `${cifra(resumen.con_buybox)} · ${pct.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`
          }
          pista={
            pct === null
              ? 'Todavía no hay ni un diagnóstico vigente, así que no hay porcentaje. Cero por ciento y «no se sabe» no son lo mismo.'
              : 'Sobre las diagnosticadas, no sobre el catálogo entero.'
          }
        />
        <Celda rotulo="sin la destacada" valor={cifra(resumen.sin_buybox)} urgente={resumen.sin_buybox > 0} />
        <Celda
          rotulo="sin poder juzgar"
          valor={cifra(resumen.sin_juicio)}
          pista="No se pudieron leer. NO cuentan como perdidas: un fallo de lectura contado como pérdida mueve el porcentaje que se le enseña al cliente."
        />
        <Celda
          rotulo="con techo"
          valor={cifra(resumen.con_foep)}
          pista="De cuántas tenemos el precio al que Amazon prevé la oferta destacada. Va por rotación: es la llamada más cara que hay, una cada treinta segundos."
        />
        <Celda
          rotulo="propuestas en simulacro"
          valor={cifra(resumen.con_propuesta)}
          pista="Precios propuestos con su explicación. No sale nada hacia Amazon desde aquí."
        />
        {resumen.cola_foep > 0 && (
          <Celda
            rotulo="en cola de techo"
            valor={cifra(resumen.cola_foep)}
            pista="Referencias esperando a que se les pida el techo por delante de la rotación."
          />
        )}
      </div>

      <ElHistoricoQueHay historico={historico} lecturasParaSerie={lecturasParaSerie} />
    </div>
  )
}

/**
 * CUÁNTAS NOCHES DE DATOS HAY. Se enseña SIEMPRE, y con cero se dice.
 *
 * Este módulo es el que genera el histórico que sustituye a Keepa, así que lo
 * normal durante sus primeras semanas es que no haya ninguno. Un porcentaje sin
 * decir sobre cuántas lecturas se calculó no es un dato: es una cifra.
 */
function ElHistoricoQueHay({
  historico,
  lecturasParaSerie,
}: {
  historico: HistoricoDisponible | undefined
  lecturasParaSerie: number
}) {
  const barridos = historico?.barridos ?? 0
  const suficiente = barridos >= lecturasParaSerie

  return (
    <span
      className={`inline-flex h-7 items-center gap-[6px] whitespace-nowrap ${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup} px-[11px]`}
      title={
        barridos === 0
          ? 'Amazon no da histórico de Buy Box: el que hay es el que guardamos nosotros cada noche. Todavía no hay ninguno, así que las series y el porcentaje del tiempo no se pueden calcular.'
          : `Cada barrido nocturno deja un punto por referencia. A partir de ${lecturasParaSerie} lecturas el porcentaje del tiempo con la oferta destacada se puede leer sin coletilla.`
      }
    >
      <History className={`h-[13px] w-[13px] shrink-0 ${TEXTO.t4}`} aria-hidden />
      {barridos === 0 ? (
        <span className={`${TIPO.s} ${TEXTO.t3}`}>
          Sin histórico todavía: el primer barrido aún no ha terminado
        </span>
      ) : (
        <span className={`${TIPO.s} ${TEXTO.t3}`}>
          {cifra(barridos)} {barridos === 1 ? 'barrido' : 'barridos'}
          {historico?.dias !== null && historico?.dias !== undefined
            ? ` · ${cifra(historico.dias)} días de histórico`
            : ''}
          {suficiente ? '' : ` · aún por debajo de ${lecturasParaSerie} para leer bien las series`}
        </span>
      )}
    </span>
  )
}

function Celda({
  rotulo,
  valor,
  pista,
  urgente,
}: {
  rotulo: string
  valor: string
  pista?: string
  urgente?: boolean
}) {
  return (
    <span className={CIFRAS.celda} title={pista}>
      <span className={`${CIFRAS.valor} ${urgente ? CIFRAS.urgente : ''}`}>{valor}</span>
      <span className={CIFRAS.rotulo}>{rotulo}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Los chips de veredicto                                              */
/* ------------------------------------------------------------------ */

function ChipsVeredicto({
  vista,
  causas,
  elegidos,
  onCambiar,
}: {
  vista: Grupo
  causas: Record<string, number>
  elegidos: Veredicto[]
  onCambiar: (v: Veredicto[]) => void
}) {
  // Solo los veredictos de la vista abierta y solo los que existen de verdad en
  // este cliente: una fila de quince chips a cero no es un filtro, es ruido.
  const disponibles = veredictosDe(vista, VEREDICTOS).filter((v) => (causas[v] ?? 0) > 0)
  if (disponibles.length <= 1) return null

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-[4px]">
      {disponibles.map((v) => {
        const activo = elegidos.includes(v)
        return (
          <button
            key={v}
            type="button"
            onClick={() =>
              onCambiar(activo ? elegidos.filter((x) => x !== v) : [...elegidos, v])
            }
            className={`${BOTON.chip} ${activo ? BOTON.chipEncendido : ''}`}
          >
            <EtiquetaVeredicto veredicto={v} />
            <span className={TEXTO.t4}>{cifra(causas[v] ?? 0)}</span>
          </button>
        )
      })}
      {elegidos.length > 0 && (
        <button type="button" onClick={() => onCambiar([])} className={BOTON.chip}>
          <X className="h-[11px] w-[11px]" />
          Quitar filtro
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Las tablas: una por grupo, con sus propias cabeceras                */
/* ------------------------------------------------------------------ */

interface Columna {
  clave: string
  cabecera: string
  pista?: string
  clase?: string
  render: (fila: FilaBuyBox) => React.ReactNode
}

/** La primera columna, igual en las tres tablas */
const REFERENCIA: Columna = {
  clave: 'sku',
  cabecera: 'Referencia',
  render: (f) => (
    <span className="flex flex-col justify-center">
      <span className={`${TIPO.m} ${TEXTO.t1} truncate`}>{f.sku}</span>
      {f.titulo && (
        <span className={`${TIPO.s} ${TEXTO.t4} truncate max-w-[280px]`}>{f.titulo}</span>
      )}
    </span>
  ),
}

/**
 * ============ LAS DOS TABLAS QUE NO SE PUEDEN MEZCLAR ============
 *
 * Fíjate en las cabeceras. En la de arriba el techo se llama «Bajar hasta» y en
 * la de abajo «Se puede subir hasta». ES EL MISMO CAMPO DE LA BASE DE DATOS. Lo
 * que cambia es quién tiene hoy la oferta destacada, y eso invierte lo que hay
 * que hacer con el número.
 *
 * Una única tabla con una columna «FOEP» y un filtro por veredicto haría que el
 * mismo encabezado sirviera para las dos, y el encabezado es lo que la gente lee
 * para saber qué hacer.
 */
const COLUMNAS: Record<Grupo, Columna[]> = {
  perdida: [
    REFERENCIA,
    {
      clave: 'veredicto',
      cabecera: 'Por qué no la tenemos',
      render: (f) => <EtiquetaVeredicto veredicto={f.veredicto} />,
    },
    {
      clave: 'precio',
      cabecera: 'Nuestro precio',
      clase: TABLA.numero,
      render: (f) => dinero(f.precio_propio, f.moneda),
    },
    {
      clave: 'destacada',
      cabecera: 'La destacada',
      clase: TABLA.numero,
      pista: 'El precio de listing de quien tiene hoy la oferta destacada. Sin envío, igual que el nuestro.',
      render: (f) => dinero(datosDe(f).precioBuybox ?? null, f.moneda),
    },
    {
      clave: 'canal',
      cabecera: 'Cómo entrega',
      pista: 'FBA lo envía Amazon; SFP es Prime del propio vendedor; FBM lo envía el vendedor sin Prime. SFP NO es FBM: confundirlos hace recomendar pasar a FBA algo que ya entrega con Prime.',
      render: (f) => <Canal canal={datosDe(f).canalGanador ?? null} />,
    },
    {
      clave: 'competidores',
      cabecera: 'Ofertas ajenas',
      clase: TABLA.numero,
      render: (f) => {
        const d = datosDe(f)
        return (
          <span title={d.competidoresPrime !== null && d.competidoresPrime !== undefined ? `${d.competidoresPrime} con Prime` : undefined}>
            {cifra(d.competidores ?? null)}
          </span>
        )
      },
    },
    {
      clave: 'amazon',
      cabecera: 'Amazon',
      pista: 'Si Amazon vende en este ASIN. Ternario a propósito: no hay ningún campo que identifique su oferta, y la marca de FBA no sirve porque un tercero con FBA devuelve lo mismo.',
      render: (f) => <AmazonEnAsin estado={f.amazon_estado} />,
    },
    {
      clave: 'techo',
      cabecera: 'Bajar hasta',
      clase: TABLA.derecha,
      pista: 'El techo que calcula Amazon: el precio de listing AL QUE HABRÍA QUE BAJAR para que nuestra oferta pase a ser la destacada. Es un techo, no un objetivo, y aquí no está garantizado: Amazon avisa de que el valor es calculado.',
      render: (f) => <TechoOfensivo fila={f} />,
    },
    {
      clave: 'falta',
      cabecera: 'Qué haría falta',
      render: (f) => {
        const { texto, tono } = queHariaFalta(f)
        return <span className={tono === 'accion' ? TEXTO.t1 : TEXTO.t4}>{texto}</span>
      },
    },
  ],

  nuestra: [
    REFERENCIA,
    {
      clave: 'veredicto',
      cabecera: 'Cómo la tenemos',
      render: (f) => <EtiquetaVeredicto veredicto={f.veredicto} />,
    },
    {
      clave: 'precio',
      cabecera: 'Nuestro precio',
      clase: TABLA.numero,
      render: (f) => dinero(f.precio_propio, f.moneda),
    },
    {
      clave: 'techo',
      cabecera: 'Se puede subir hasta',
      clase: TABLA.derecha,
      pista: 'AQUÍ EL TECHO ES DEFENSIVO: es hasta dónde Amazon calcula que mantendríamos la oferta destacada, y normalmente está POR ENCIMA del precio actual. No es un precio al que bajar.',
      render: (f) => <TechoDefensivo fila={f} />,
    },
    {
      clave: 'holgura',
      cabecera: 'Margen sin usar',
      clase: TABLA.derecha,
      pista: 'Lo que sobra hacia arriba. Es la oportunidad que el repricer nativo de Amazon nunca ve, porque no sube precios.',
      render: (f) => {
        const { texto, hay } = margenSinUsar(f)
        return <span className={hay ? TEXTO.t1 : TEXTO.t4}>{texto}</span>
      },
    },
    {
      clave: 'canal',
      cabecera: 'Cómo entregamos',
      render: (f) => <Canal canal={datosDe(f).canalPropio ?? null} />,
    },
    {
      clave: 'competidores',
      cabecera: 'Ofertas ajenas',
      clase: TABLA.numero,
      render: (f) => cifra(datosDe(f).competidores ?? null),
    },
    {
      clave: 'amazon',
      cabecera: 'Amazon',
      render: (f) => <AmazonEnAsin estado={f.amazon_estado} />,
    },
    {
      clave: 'leido',
      cabecera: 'Leído',
      render: (f) => <span className={TEXTO.t4}>{hace(f.fecha)}</span>,
    },
  ],

  sin_juicio: [
    REFERENCIA,
    {
      clave: 'veredicto',
      cabecera: 'Estado',
      render: (f) => <EtiquetaVeredicto veredicto={f.veredicto} />,
    },
    {
      clave: 'accion',
      cabecera: 'Qué hacer',
      render: (f) => f.accion || '—',
    },
    {
      clave: 'leido',
      cabecera: 'Último intento',
      render: (f) => <span className={TEXTO.t4}>{hace(f.fecha)}</span>,
    },
  ],
}

function Tabla({
  vista,
  filas,
  porque,
  onAbrir,
}: {
  vista: Grupo
  filas: FilaBuyBox[]
  porque: boolean
  onAbrir: (fila: FilaBuyBox) => void
}) {
  const columnas = COLUMNAS[vista]

  return (
    <div className={TABLA.caja}>
      <table className={TABLA.tabla}>
        <caption className="sr-only">
          {vista === 'perdida'
            ? 'Referencias sin la oferta destacada. El techo de Amazon es el precio al que habría que bajar para conquistarla.'
            : vista === 'nuestra'
              ? 'Referencias con la oferta destacada. El techo de Amazon es hasta dónde se puede subir sin perderla.'
              : 'Referencias que no se han podido juzgar. No cuentan como perdidas.'}
        </caption>
        <thead>
          <tr>
            {columnas.map((c, i) => (
              <th
                key={c.clave}
                title={c.pista}
                className={`${TABLA.cabecera} ${i === 0 ? TABLA.cabeceraFija : ''} ${c.clase ?? ''}`}
              >
                {c.cabecera}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const prime = avisoPrime(f)
            return (
              <Fragment key={`${f.connection_id}|${f.marketplace_id}|${f.sku}`}>
                <tr
                  className={`${TABLA.fila} cursor-pointer`}
                  onClick={() => onAbrir(f)}
                  title={prime}
                >
                  {columnas.map((c, i) => (
                    <td
                      key={c.clave}
                      className={`${TABLA.celda} ${i === 0 ? TABLA.celdaFija : ''} ${c.clase ?? ''}`}
                    >
                      {i === 0 ? (
                        // El teclado necesita algo que enfocar. La fila entera es
                        // pinchable con el ratón, pero un <tr> con onClick no
                        // aparece en el recorrido de tabulación.
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            onAbrir(f)
                          }}
                          className="block max-w-full text-left"
                        >
                          {c.render(f)}
                        </button>
                      ) : (
                        c.render(f)
                      )}
                    </td>
                  ))}
                </tr>

                {porque && (
                  <tr className={SUPERFICIE.sup2}>
                    <td
                      colSpan={columnas.length}
                      className={`border-b px-2 py-[5px] ${LINEA.normal} ${TIPO.s} ${TEXTO.t3} leading-[1.5]`}
                    >
                      {/* El porqué es el texto que GUARDÓ el motor, con sus
                          números dentro, y es el mismo que sale en la
                          exportación que se le enseña al cliente. No se compone
                          aquí: si se compusiera al pintarlo, lo guardado y lo
                          visto podrían divergir y una auditoría no cuadraría. */}
                      {f.motivo}
                      {f.precio_propuesto_motivo && (
                        <span className={TEXTO.t4}> · {f.precio_propuesto_motivo}</span>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Los vacíos, que son los que más se van a ver la primera semana      */
/* ------------------------------------------------------------------ */

function SinDiagnostico({ resumen }: { resumen: ResumenBuyBox }) {
  return (
    <Vacio icono={<Crown />} titulo="Todavía no se ha diagnosticado ninguna referencia de esta cuenta">
      {resumen.skus_en_seguimiento > 0 ? (
        <>
          Hay <strong>{cifra(resumen.skus_en_seguimiento)}</strong> referencias en seguimiento
          esperando. Lo que las mira es el trabajo <strong>Precios y Buy Box</strong>, que se lanza
          desde <strong>Amazon API · Ingesta</strong>. Hasta que corra, aquí no hay ni un cero que
          enseñar: no sabemos cuáles tienen la oferta destacada y cuáles no.
        </>
      ) : (
        <>
          Esta cuenta no tiene ninguna referencia en seguimiento, así que no hay nada que mirar. Qué
          entra en el refresco diario se decide en <strong>Amazon API · Seguimiento</strong>.
        </>
      )}
    </Vacio>
  )
}

function ListaVacia({
  vista,
  resumen,
  hayBusqueda,
}: {
  vista: Grupo
  resumen: ResumenBuyBox
  hayBusqueda: boolean
}) {
  if (hayBusqueda) {
    return (
      <Vacio icono={<Search />} titulo="Ninguna referencia de esta lista coincide con la búsqueda">
        Se busca por SKU, ASIN y título. Puede estar en otra de las tres listas: prueba a cambiar de
        pestaña sin borrar lo escrito.
      </Vacio>
    )
  }

  if (vista === 'perdida') {
    return (
      <Vacio icono={<Crown />} titulo="Ninguna referencia diagnosticada ha perdido la oferta destacada">
        Son <strong>{cifra(resumen.diagnosticados)}</strong> referencias diagnosticadas, de{' '}
        {cifra(resumen.skus_en_seguimiento)} en seguimiento. El dato es tan bueno como esa fracción:
        si son pocas, esto no dice que vaya todo bien, dice que se ha mirado poco.
      </Vacio>
    )
  }

  if (vista === 'nuestra') {
    return (
      <Vacio icono={<Crown />} titulo="Ninguna de las diagnosticadas tiene la oferta destacada">
        De <strong>{cifra(resumen.diagnosticados)}</strong> diagnosticadas, ninguna la tiene hoy. La
        lista de al lado —<strong>No la tenemos</strong>— dice de cada una por qué y qué haría falta.
      </Vacio>
    )
  }

  return (
    <Vacio icono={<Crown />} titulo="Todas las referencias diagnosticadas se han podido juzgar">
      Aquí solo caen las que no se pudieron leer. Que esté vacía es la buena noticia: significa que
      ninguna lectura falló y que el porcentaje de al lado no está calculado sobre huecos.
    </Vacio>
  )
}

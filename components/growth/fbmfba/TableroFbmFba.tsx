'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRightLeft,
  Download,
  Percent,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { getAmazon } from '@/lib/amazon/client'
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
import { Aviso, Cargando, Vacio, cifra, dinero, hace, nombreMarketplace } from '@/components/plataforma/comun'
import type { VeredictoA4 } from '@/lib/plataforma/fbmfba/tipos'
import type { AnalisisSku, FbmFbaRespuesta } from '@/lib/plataforma/fbmfba/cliente'
import { DialogoImpuesto, DialogoUmbrales } from './Ajustes'
import { FichaFbmFba } from './FichaFbmFba'
import { AmazonEnAsin, Canal, CeldaMargen, CeldaRotacion, Diferencia, EtiquetaVeredicto, Medidas, Techo } from './piezas'

/**
 * =====================================================================
 *  ██  QUÉ REFERENCIAS MERECEN PASAR A LOGÍSTICA DE AMAZON  ██
 * =====================================================================
 *
 * De las que hoy envía el cliente, cuáles ganarían dinero si las guardara
 * Amazon. Los dos márgenes lado a lado, la diferencia, y EL PORQUÉ EN TEXTO.
 *
 *
 * ============ LAS TRES DECISIONES QUE EXPLICAN ESTA PANTALLA ============
 *
 * 1. LOS HUECOS SE VEN. Donde falta un dato no hay un cero: hay una raya y, al
 *    pasar el ratón, qué falta y dónde se rellena. Todos los datos que faltan en
 *    este cálculo son COSTES, así que un margen a medias sale MEJOR que el de
 *    verdad, es perfectamente creíble y nadie lo revisa. Un hueco se ve; un
 *    número inflado, no.
 *
 * 2. SIN UMBRALES NO HAY RECOMENDACIÓN, Y SE DICE ARRIBA. Mientras el cliente no
 *    tenga colchón de margen y mejora mínima, todas las referencias evaluables
 *    salen como «falta criterio» con sus dos márgenes calculados. Informa y no
 *    recomienda. El botón de umbrales está en la barra y el aviso también,
 *    porque es accionable HOY: esconderlo detrás del botón de información sería
 *    no darlo.
 *
 * 3. NO HAY NINGÚN BOTÓN QUE MANDE NADA A AMAZON, y no es un olvido. Crear un
 *    envío de entrada necesita el rol de Logística de Amazon, que la aplicación
 *    no tiene. Lo único que sale de aquí es un fichero para decidirlo con el
 *    cliente.
 */

/** Cuántas filas se pintan de una vez. Se sube de 200 en 200 */
const PASO = 200

type Vista = 'accionable' | 'faltan' | 'descartadas' | 'todas'

const VISTAS: Record<Vista, { nombre: string; pista: string; veredictos: VeredictoA4[] }> = {
  accionable: {
    nombre: 'Merece la pena',
    pista: 'Las que salen a favor de migrar, y las que saldrían si se resolviera una duda.',
    veredictos: ['candidato', 'revisar', 'informa_sin_umbral'],
  },
  faltan: {
    nombre: 'Falta un dato',
    pista: 'No se pueden juzgar porque falta el coste, el impuesto o las tarifas. No es que no compensen.',
    veredictos: ['no_evaluable', 'canal_desconocido', 'sin_datos'],
  },
  descartadas: {
    nombre: 'No compensan',
    pista: 'Con los umbrales de este cliente, quedarse como están es lo correcto.',
    veredictos: ['no_compensa', 'sin_rotacion', 'descartado_amazon'],
  },
  todas: {
    nombre: 'Todas',
    pista: 'Incluidas las que ya están en FBA, donde no hay migración que evaluar.',
    veredictos: [],
  },
}

export function TableroFbmFba({
  clientId,
  nombreCliente,
}: {
  clientId: string
  nombreCliente: string
}) {
  const [datos, setDatos] = useState<FbmFbaRespuesta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [mensaje, setMensaje] = useState<string | null>(null)

  const [unidad, setUnidad] = useState<string | null>(null)
  const [vista, setVista] = useState<Vista>('accionable')
  const [escrito, setEscrito] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [limite, setLimite] = useState(PASO)
  const [porque, setPorque] = useState(false)
  const [abierta, setAbierta] = useState<AnalisisSku | null>(null)
  const [ajuste, setAjuste] = useState<'umbrales' | 'impuesto' | null>(null)

  // Sin espera, cada tecla lanzaría un análisis completo del catálogo.
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(escrito.trim()), 350)
    return () => clearTimeout(t)
  }, [escrito])

  const veredictos = useMemo(() => VISTAS[vista].veredictos, [vista])

  // La respuesta de una petición vieja no puede pisar a la de una nueva: al
  // cambiar de vista deprisa, la lenta llegaría después y pintaría la lista
  // equivocada bajo la cabecera correcta.
  const turno = useRef(0)

  const cargar = useCallback(async () => {
    const mio = ++turno.current
    setCargando(true)
    const query = new URLSearchParams({ clientId })
    if (unidad) {
      const [connectionId, marketplaceId] = unidad.split('|')
      query.set('connectionId', connectionId)
      query.set('marketplaceId', marketplaceId)
    }
    if (veredictos.length > 0) query.set('veredictos', veredictos.join(','))
    if (busqueda) query.set('busqueda', busqueda)

    const res = await getAmazon<FbmFbaRespuesta>(`/api/plataforma/fbmfba?${query.toString()}`)
    if (turno.current !== mio) return
    setCargando(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(null)
    setDatos(res.data)
  }, [clientId, unidad, veredictos, busqueda])

  useEffect(() => {
    void cargar()
  }, [cargar])

  useEffect(() => {
    if (unidad !== null || !datos || !datos.unidad) return
    setUnidad(`${datos.unidad.connectionId}|${datos.unidad.marketplaceId}`)
  }, [datos, unidad])

  if (cargando && !datos) return <Cargando texto="Comparando los dos escenarios…" />
  if (error && !datos) {
    return (
      <Aviso tono="rojo" icono={AlertTriangle}>
        {error}
      </Aviso>
    )
  }
  if (!datos) return null

  if (datos.unidades.length === 0 || !datos.unidad || !datos.resumen || !datos.config) {
    return (
      <Vacio icono={<ArrowRightLeft />} titulo={`${nombreCliente} no tiene ninguna cuenta activa que mirar`}>
        La comparación se hace cuenta a cuenta y país a país, con las referencias, las tarifas y el
        ranking de esa cuenta. En cuanto esté conectada y activa desde{' '}
        <strong>Amazon API · Cuentas</strong>, aparece aquí.
      </Vacio>
    )
  }

  // Se saca a una constante y no se usa `datos.unidad` suelto: TypeScript pierde
  // el estrechamiento de una propiedad dentro de los manejadores de abajo, y la
  // alternativa serían cuatro `!` que apagan justo la comprobación que acaba de
  // hacerse tres líneas más arriba.
  const unidadActual = datos.unidad
  const { resumen, config, fiscal } = datos
  const filas = datos.filas.slice(0, limite)
  const hayMas = datos.filas.length > limite
  const sinCriterio = config.colchonMargenPct === null || config.mejoraMinimaPuntos === null
  const sinImpuesto = !fiscal || fiscal.precioIncluyeImpuesto === null

  const exportar = () => {
    const query = new URLSearchParams({ clientId, formato: 'csv' })
    query.set('connectionId', unidadActual.connectionId)
    query.set('marketplaceId', unidadActual.marketplaceId)
    if (veredictos.length > 0) query.set('veredictos', veredictos.join(','))
    if (busqueda) query.set('busqueda', busqueda)
    window.location.href = `/api/plataforma/fbmfba?${query.toString()}`
  }

  return (
    <div className={`${PANTALLA.cuerpo} h-full`}>
      {/* -------- La tira de cifras -------- */}
      <div className={CIFRAS.tira}>
        <Cifra
          rotulo="candidatas"
          valor={cifra(resumen.porVeredicto.candidato)}
          urgente={resumen.porVeredicto.candidato > 0}
          pista="Referencias que mejoran por encima de la mejora mínima del cliente y con colchón de sobra."
        />
        <Cifra
          rotulo="por revisar"
          valor={cifra(resumen.porVeredicto.revisar)}
          pista="Los números salen, pero hay una duda que mirar antes de proponérselo al cliente."
        />
        <Cifra
          rotulo="las envía el cliente"
          valor={`${cifra(resumen.canalPropio)}/${cifra(resumen.analizadas)}`}
          pista="El universo de este análisis: las que hoy salen del almacén del cliente. Las de FBA salen en la tabla pero no hay migración que evaluar."
        />
        <Cifra
          rotulo="con coste"
          valor={`${cifra(resumen.conCoste)}/${cifra(resumen.analizadas)}`}
          pista="Sin coste no hay margen. Se rellenan en Amazon API · Costes. Un análisis sobre el 30 % del catálogo no es un análisis: es una muestra sesgada hacia lo que alguien se molestó en rellenar."
        />
        <Cifra
          rotulo="con tarifa de FBA"
          valor={`${cifra(resumen.conTarifasFba)}/${cifra(resumen.analizadas)}`}
          pista="La tarifa de logística es EL número que decide esta migración, y hay que pedírsela a Amazon marcando el escenario de FBA: para una referencia que hoy envía el cliente, la estimación normal no la trae."
        />
        <Cifra
          rotulo="con ventas"
          valor={`${cifra(resumen.conRotacionMedida)}/${cifra(resumen.analizadas)}`}
          pista="Las unidades entran por CSV: los roles concedidos no incluyen el informe de ventas de Amazon. Sin ellas, la rotación es «no evaluable», que NO es «no rota»."
        />
      </div>

      {/* -------- Avisos ACCIONABLES. Lo demás vive en el botón de información -------- */}
      {sinImpuesto && (
        <Aviso tono="ambar" icono={Percent}>
          <strong>No hay margen para {nombreMarketplace(unidadActual.marketplaceId)}</strong> porque
          nadie ha dicho si el precio de ese país lleva el impuesto dentro. Amazon no da ese dato con
          los permisos que tenemos.{' '}
          <button
            type="button"
            onClick={() => setAjuste('impuesto')}
            className={`${TEXTO.acento} underline underline-offset-2`}
          >
            Configurarlo
          </button>
        </Aviso>
      )}

      {!sinImpuesto && sinCriterio && (
        <Aviso tono="azul" icono={SlidersHorizontal}>
          Este cliente <strong>no tiene umbrales puestos</strong>, así que el análisis calcula los dos
          márgenes pero no dice si compensa. Los pone una persona: con un número inventado se
          recomiendan migraciones sin base y las paga el cliente.{' '}
          <button
            type="button"
            onClick={() => setAjuste('umbrales')}
            className={`${TEXTO.acento} underline underline-offset-2`}
          >
            Ponerlos
          </button>
        </Aviso>
      )}

      {resumen.feesSinCanal > 0 && (
        <Aviso tono="ambar" icono={AlertTriangle}>
          Hay <strong>{cifra(resumen.feesSinCanal)} estimaciones de tarifas guardadas sin escenario</strong>
          . Se pidieron antes de que se distinguiera «lo envía el cliente» de «lo envía Amazon», y sin
          eso no se sabe cuál de las dos son: no se usan. Hay que volver a pedirlas desde{' '}
          <strong>Amazon API · Ingesta</strong>.
        </Aviso>
      )}

      {resumen.truncado && (
        <Aviso tono="ambar" icono={AlertTriangle}>
          Se han analizado <strong>{cifra(resumen.analizadas)}</strong> de{' '}
          {cifra(resumen.total)} referencias de esta cuenta. El resto no está en esta lista.
        </Aviso>
      )}

      {mensaje && (
        <Aviso tono="verde" icono={RefreshCw}>
          {mensaje}
        </Aviso>
      )}

      {/* -------- Filtros: una fila -------- */}
      <div className={PANTALLA.filtros}>
        {datos.unidades.length > 1 && (
          <select
            value={`${unidadActual.connectionId}|${unidadActual.marketplaceId}`}
            onChange={(e) => {
              setUnidad(e.target.value)
              setLimite(PASO)
            }}
            className={`${CAMPO.input} !h-6 !w-auto max-w-[280px]`}
            aria-label="Cuenta y país"
          >
            {datos.unidades.map((u) => (
              <option key={`${u.connectionId}|${u.marketplaceId}`} value={`${u.connectionId}|${u.marketplaceId}`}>
                {u.connectionName} · {nombreMarketplace(u.marketplaceId)}
              </option>
            ))}
          </select>
        )}

        <div className={PANTALLA.separador} />

        {(Object.keys(VISTAS) as Vista[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => {
              setVista(v)
              setLimite(PASO)
            }}
            title={VISTAS[v].pista}
            className={`${BOTON.chip} ${vista === v ? BOTON.chipEncendido : ''}`}
          >
            {VISTAS[v].nombre}
            <span className={TEXTO.t4}>
              {cifra(
                v === 'todas'
                  ? resumen.analizadas
                  : VISTAS[v].veredictos.reduce((n, ver) => n + resumen.porVeredicto[ver], 0)
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
            className={`${CAMPO.input} !h-6 !w-[200px] pl-[24px]`}
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

        <button
          type="button"
          onClick={() => setAjuste('umbrales')}
          className={BOTON.chip}
          title="El colchón de margen, la mejora mínima y la rotación. Sin ellos el análisis informa pero no recomienda."
        >
          <SlidersHorizontal className="h-[13px] w-[13px]" />
          Umbrales
        </button>

        <button
          type="button"
          onClick={exportar}
          className={`${BOTON.base} ${BOTON.secundario}`}
          title="Saca las filas que estás viendo, con el motivo entero y las salvedades. Es lo que se le enseña al cliente."
        >
          <Download className="h-[13px] w-[13px]" />
          Exportar
        </button>
      </div>

      {/* -------- La tabla -------- */}
      {datos.filas.length === 0 ? (
        <Vacio icono={<ArrowRightLeft />} titulo="Aquí no hay ninguna referencia">
          {VISTAS[vista].pista} Prueba con <strong>Todas</strong> o quita la búsqueda.
        </Vacio>
      ) : (
        <div className={TABLA.caja}>
          <table className={TABLA.tabla}>
            <thead>
              <tr>
                <th className={`${TABLA.cabecera} ${TABLA.cabeceraFija}`}>Referencia</th>
                <th className={TABLA.cabecera}>Canal</th>
                <th className={`${TABLA.cabecera} text-right`}>Precio</th>
                <th className={`${TABLA.cabecera} text-right`} title="El precio de referencia de Amazon. La flecha dice si es un techo al que bajar (↓) o hasta el que se puede subir (↑).">
                  Techo
                </th>
                <th className={`${TABLA.cabecera} text-right`}>Lo envía el cliente</th>
                <th className={`${TABLA.cabecera} text-right`}>Lo envía Amazon</th>
                <th className={`${TABLA.cabecera} text-right`} title="Puntos porcentuales de diferencia entre los dos escenarios.">
                  Dif.
                </th>
                <th className={TABLA.cabecera}>Rotación</th>
                <th className={TABLA.cabecera}>Medidas</th>
                <th className={TABLA.cabecera}>Amazon</th>
                <th className={TABLA.cabecera}>Veredicto</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <Fragment key={f.sku}>
                  <tr
                    className={`${TABLA.fila} cursor-pointer`}
                    onClick={() => setAbierta(f)}
                    title="Ver de dónde sale cada euro"
                  >
                    <td className={`${TABLA.celda} ${TABLA.celdaFija}`}>
                      <span className={`${TABLA.corta} max-w-[240px]`}>
                        <span className={TEXTO.t1}>{f.sku}</span>
                        {f.titulo && <span className={`${TEXTO.t4} ml-[6px]`}>{f.titulo}</span>}
                      </span>
                    </td>
                    <td className={TABLA.celda}>
                      <Canal canal={f.canal} />
                    </td>
                    <td className={`${TABLA.celda} ${TABLA.numero}`}>
                      {dinero(f.precioActual, f.moneda)}
                    </td>
                    <td className={`${TABLA.celda} ${TABLA.numero}`}>
                      <Techo fila={f} />
                    </td>
                    <td className={`${TABLA.celda} ${TABLA.derecha}`}>
                      <CeldaMargen margen={f.margenPropio} moneda={f.moneda} />
                    </td>
                    <td className={`${TABLA.celda} ${TABLA.derecha}`}>
                      <CeldaMargen margen={f.margenFba} moneda={f.moneda} />
                    </td>
                    <td className={`${TABLA.celda} ${TABLA.numero}`}>
                      <Diferencia puntos={f.comparacion.puntos} />
                    </td>
                    <td className={TABLA.celda}>
                      <CeldaRotacion rotacion={f.rotacion} />
                    </td>
                    <td className={TABLA.celda}>
                      <Medidas procedencia={f.procedenciaDims} confianza={f.confianzaDims} />
                    </td>
                    <td className={TABLA.celda}>
                      <AmazonEnAsin estado={f.amazon} />
                    </td>
                    <td className={TABLA.celda}>
                      <EtiquetaVeredicto veredicto={f.veredicto} etiqueta={datos.etiquetas[f.veredicto]} />
                    </td>
                  </tr>

                  {/* EL PORQUÉ, entero y con sus números. Es la mitad del valor
                      de este módulo: una etiqueta se obedece, una frase con
                      números se discute, y discutirla es lo que hace que se
                      detecte cuando el motor se equivoca. */}
                  {porque && (
                    <tr>
                      <td
                        colSpan={11}
                        className={`px-2 pb-[7px] pt-0 border-b ${LINEA.normal} ${TIPO.s} ${TEXTO.t3} leading-[1.5]`}
                      >
                        {f.motivo}
                        {f.salvedades.length > 0 && (
                          <span className={TEXTO.t4}>
                            {' '}
                            {f.salvedades.map((s) => s.texto).join(' ')}
                          </span>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* -------- Pie: cuántas hay y de cuándo son los datos -------- */}
      <div className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 ${TIPO.s} ${TEXTO.t4}`}>
        <span>
          {cifra(filas.length)} de {cifra(datos.filas.length)} referencias
        </span>
        {hayMas && (
          <button
            type="button"
            onClick={() => setLimite((n) => n + PASO)}
            className={`${BOTON.chip} h-5`}
          >
            Ver {PASO} más
          </button>
        )}
        <span className={PANTALLA.separador} />
        <span title="Cuándo se leyó por última vez quién tiene la oferta destacada en esta cuenta.">
          Diagnóstico de Buy Box: {hace(resumen.ultimoDiagnostico)}
        </span>
        <span title="Cuándo se pidió por última vez una estimación de tarifas a Amazon.">
          Tarifas: {hace(resumen.ultimaTarifa)}
        </span>
        {fiscal && fiscal.precioIncluyeImpuesto !== null && (
          <button
            type="button"
            onClick={() => setAjuste('impuesto')}
            className="underline underline-offset-2"
            title="El impuesto con el que se está calculando. Se puede corregir y queda con fecha y dueño."
          >
            {nombreMarketplace(unidadActual.marketplaceId)}:{' '}
            {fiscal.precioIncluyeImpuesto
              ? `IVA ${fiscal.ivaPorcentaje} % incluido en el precio`
              : 'el impuesto va fuera del precio'}
          </button>
        )}
        <span className="ml-auto">A4 recomienda; el envío se crea a mano en Seller Central.</span>
      </div>

      {/* -------- Lo que nadie ha decidido -------- */}
      {datos.faltaPorDecidir.length > 0 && (
        <details className={`shrink-0 ${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup} px-[10px] py-[7px]`}>
          <summary className={`${TIPO.s} ${TEXTO.t3} cursor-pointer`}>
            {datos.faltaPorDecidir.length} decisión
            {datos.faltaPorDecidir.length === 1 ? '' : 'es'} sin tomar
          </summary>
          <ul className={`mt-[6px] space-y-[4px] ${TIPO.s} ${TEXTO.t3} leading-[1.5]`}>
            {datos.faltaPorDecidir.map((f) => (
              <li key={f}>· {f}</li>
            ))}
          </ul>
        </details>
      )}

      {abierta && (
        <FichaFbmFba
          fila={abierta}
          moneda={abierta.moneda ?? datos.moneda}
          etiqueta={datos.etiquetas[abierta.veredicto]}
          onCerrar={() => setAbierta(null)}
        />
      )}

      {ajuste === 'umbrales' && (
        <DialogoUmbrales
          clientId={clientId}
          config={config}
          onCerrar={() => setAjuste(null)}
          onGuardado={(m) => {
            setMensaje(m)
            void cargar()
          }}
        />
      )}

      {ajuste === 'impuesto' && (
        <DialogoImpuesto
          clientId={clientId}
          marketplaceId={unidadActual.marketplaceId}
          fiscal={fiscal ?? { marketplaceId: unidadActual.marketplaceId, ivaPorcentaje: null, precioIncluyeImpuesto: null, validoDesde: null, actualizadoPor: null, ambito: 'sin_configurar', notas: null }}
          sugerencia={datos.sugerenciaFiscal}
          onCerrar={() => setAjuste(null)}
          onGuardado={(m) => {
            setMensaje(m)
            void cargar()
          }}
        />
      )}
    </div>
  )
}

function Cifra({
  rotulo,
  valor,
  pista,
  urgente,
}: {
  rotulo: string
  valor: string
  pista: string
  urgente?: boolean
}) {
  return (
    <div className={`${CIFRAS.celda} cursor-help`} title={pista}>
      <span className={`${CIFRAS.valor} ${urgente ? CIFRAS.urgente : ''}`}>{valor}</span>
      <span className={CIFRAS.rotulo}>{rotulo}</span>
    </div>
  )
}

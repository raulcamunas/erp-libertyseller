'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Download,
  FileSpreadsheet,
  Loader2,
  Minus,
  NotebookPen,
  Pencil,
  Plus,
  Trash2,
  Upload,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { deleteAmazon, getAmazon, patchAmazon, subirAmazon } from '@/lib/amazon/client'
import {
  AVISO,
  BOTON,
  CAMPO,
  CIFRAS,
  COLOR_ESTADO,
  LINEA,
  PANTALLA,
  RADIO,
  SUPERFICIE,
  TARJETA,
  TEXTO,
  TIPO,
  TITULO,
} from '@/lib/estilo/denso'
import { useIsMobile } from '@/lib/use-is-mobile'
import { Aviso, Cargando, Dialogo, Vacio, fechaHora } from '@/components/plataforma/comun'
import type { ClienteTax, FicheroTax, VistaTaxReports } from '@/lib/tax-reports/tipos'
import { ClienteDialogo } from './ClienteDialogo'

/**
 * LOS CLIENTES A LA IZQUIERDA, EL AÑO DE UNO A LA DERECHA.
 *
 * ============ POR QUÉ YA NO ES UNA REJILLA ============
 *
 * Era clientes × meses, y una rejilla se lee para COMPARAR. Aquí nadie compara
 * nada: el día 3 se va cuenta POR cuenta —se entra en Seller Central de una, se
 * baja su fichero, se cuelga— y esa forma de trabajar es una lista, no una
 * tabla. En la rejilla eso obligaba a mantener el dedo en una fila recorriendo
 * doce columnas; con un cliente elegido y sus doce meses delante, cada paso del
 * día 3 pasa dentro de un solo panel.
 *
 * Y la rejilla no tenía dónde poner lo que faltaba: el nombre libre del fichero
 * de cada cliente, las notas del cliente y las notas de UN MES concreto no caben
 * en una celda de 66 px que solo admite un glifo.
 *
 * ES EL MISMO PATRÓN DE AMAZON API > ORIGEN (components/amazon/PerfilesPanel.tsx)
 * a propósito, hasta los ladrillos de estilo: quien usa las dos pantallas no
 * tiene que aprender dos formas de moverse.
 *
 *
 * ============ EL RECUENTO VA ARRIBA DEL TODO ============
 *
 * «Faltan 4 de 11 de septiembre» es LA razón por la que se abre esta pantalla,
 * así que se ve antes que nada y sin pulsar. Debajo, cada cliente lleva cuántos
 * meses le faltan del año elegido: es lo que decide a quién se entra primero.
 *
 * UN MES QUE NO HA TERMINADO NO FALTA. El informe fiscal de septiembre no existe
 * el 12 de septiembre. Si contaran, el recuento diría «faltan 15» todos los días
 * del mes y a los tres días nadie lo miraría — que es la forma exacta de que un
 * aviso deje de servir.
 *
 *
 * ============ EL NOMBRE DEL FICHERO ES TEXTO LIBRE ============
 *
 * No son dos opciones: es lo que Raúl escriba —«Tax report», «Sellerboard»,
 * «Informe del proveedor»—. Por eso aquí no hay ningún mapa de tipos con icono y
 * color por valor: se pinta LO QUE PONE. Un mapa cerrado obliga a desplegar para
 * dar de alta un cliente con un fichero nuevo, y deja sin etiqueta —o con la
 * etiqueta de otro— a cualquier valor que no esté previsto.
 *
 *
 * ============ EL FICHERO NO PASA POR AQUÍ, NI SU URL ============
 *
 * Ni se sube ni se baja contra Supabase Storage desde el navegador, que es como
 * lo hacen hoy CRM, Finanzas, Agenda y Clientes. El fichero se manda a una ruta
 * del ERP y la descarga se pide como ENLACE FIRMADO que caduca en 60 segundos.
 * Esta pantalla no construye ninguna URL de Storage, no guarda ninguna y no sabe
 * cómo se llama el bucket. El porqué: dentro de un tax report hay ciudad, código
 * postal y Order ID de los compradores de ese cliente, y una URL pública no
 * caduca, no comprueba sesión y quien la tenga la reparte.
 */

/** La ruta del módulo. En un solo sitio: todas las llamadas cuelgan de ella. */
const RUTA = '/api/tax-reports'

/**
 * Los meses escritos a mano y no con `toLocaleDateString`.
 *
 * Este componente se pinta también en el servidor, y el contenedor y el
 * navegador no tienen por qué traer los mismos datos de idioma: un «sept.» en
 * uno y un «sep» en el otro es un error de hidratación que tira la pantalla
 * entera al cliente sin decir por qué.
 */
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

/**
 * El tope que aplica el bucket de la migración 200.
 *
 * Se comprueba también aquí, antes de mandar nada, porque un 413 del proxy de
 * Easypanel no menciona ni al ERP ni a Supabase: llega como un error de red sin
 * explicación. La comprobación de verdad es la del servidor; esta solo sirve
 * para poder decir en español qué ha pasado.
 */
const MAX_BYTES = 10 * 1024 * 1024

/**
 * Las extensiones que valen, y no los tipos MIME.
 *
 * El `type` que da el navegador para un .csv es un cara o cruz —text/csv,
 * application/vnd.ms-excel, text/plain o cadena vacía, según si hay Excel
 * instalado—, así que filtrar por él rechaza ficheros buenos. La ruta de
 * servidor decide el Content-Type por la extensión, y aquí se comprueba lo mismo
 * para avisar antes de subir 3 MB para nada.
 */
const EXTENSIONES = ['.csv', '.txt', '.xlsx', '.xls']

/** Lo que se enseña cuando un cliente se quedó sin nombre de fichero escrito. */
const SIN_NOMBRE = 'Sin especificar'

function peso(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Cómo se llama el fichero de este cliente, tal y como se escribió en su ficha. */
function comoSeLlama(cliente: ClienteTax): string {
  const texto = (cliente.tipoFichero ?? '').trim()
  return texto === '' ? SIN_NOMBRE : texto
}

export function PantallaTaxReports() {
  const [vista, setVista] = useState<VistaTaxReports | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * El año y el mes de hoy se fijan DESPUÉS de montar, y por eso empiezan en
   * null: los calcula el reloj del navegador, no el del contenedor. Si se
   * calcularan al pintar, el 31 de diciembre a las 23:30 en España el servidor
   * diría un año y el navegador otro, y eso es un error de hidratación.
   */
  const [hoy, setHoy] = useState<{ anio: number; mes: number } | null>(null)
  const [anio, setAnio] = useState<number | null>(null)

  /** El cliente abierto en el panel de la derecha. Null = todavía ninguno. */
  const [clienteId, setClienteId] = useState<string | null>(null)
  const [pestana, setPestana] = useState<'meses' | 'notas'>('meses')

  /**
   * Lo que está subiendo ahora mismo, como «cliente:mes» y no solo el mes.
   *
   * Una subida sigue viva aunque se cambie de cliente mientras tanto, y con la
   * clave siendo solo el número de mes el otro cliente enseñaría el giratorio en
   * su mismo mes — o sea, en un mes en el que no está pasando nada.
   */
  const [subiendo, setSubiendo] = useState<ReadonlySet<string>>(new Set())
  const [bajando, setBajando] = useState<string | null>(null)
  const [quitando, setQuitando] = useState<string | null>(null)

  /** null = cerrado; { cliente: null } = alta; { cliente } = edición */
  const [editando, setEditando] = useState<{ cliente: ClienteTax | null } | null>(null)
  /** El mes cuya nota se está escribiendo */
  const [notaMes, setNotaMes] = useState<{ mes: number } | null>(null)
  const [verBajas, setVerBajas] = useState(false)

  // 768 y no el 1023 por defecto: por debajo de ahí es donde la lista y el panel
  // de doce meses dejan de caber de verdad uno al lado del otro.
  const isMobile = useIsMobile('(max-width: 767px)')

  /**
   * UN SOLO selector de fichero para los doce meses, con el mes al que va
   * guardado aparte. Uno por mes serían doce nodos `<input>` en el DOM para que
   * se use uno.
   */
  const inputRef = useRef<HTMLInputElement>(null)
  const destinoRef = useRef<{ clienteId: string; mes: number } | null>(null)

  useEffect(() => {
    const d = new Date()
    setHoy({ anio: d.getFullYear(), mes: d.getMonth() + 1 })
    setAnio(d.getFullYear())
  }, [])

  const cargar = useCallback(async (delAnio: number) => {
    setCargando(true)
    const res = await getAmazon<VistaTaxReports>(`${RUTA}?anio=${delAnio}`)
    setCargando(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(null)
    setVista(res.data)
  }, [])

  useEffect(() => {
    if (anio === null) return
    void cargar(anio)
  }, [anio, cargar])

  /* ---------------------------------------------------------------- */
  /* Lo que se pinta, ya masticado                                     */
  /* ---------------------------------------------------------------- */

  /** El fichero de cada cliente y mes del año que se está viendo. */
  const porCelda = useMemo(() => {
    const mapa = new Map<string, FicheroTax>()
    if (!vista || anio === null) return mapa
    for (const f of vista.ficheros) {
      // Se filtra por año aunque la ruta ya devuelva el año pedido: si algún día
      // devuelve más, el panel pintaría el fichero de otro año en ese mes y eso
      // se lee como «ya está subido».
      if (f.anio !== anio) continue
      mapa.set(`${f.clienteId}:${f.mes}`, f)
    }
    return mapa
  }, [vista, anio])

  /**
   * La nota de cada cliente y mes, en un mapa APARTE del de ficheros.
   *
   * Separado y no dentro de `FicheroTax` porque hay notas en meses que no
   * tienen fichero —que son la mayoría de las que se escriben: «falta la
   * factura de enero» habla de un mes que falta—, y ahí no habría dónde
   * colgarlas. La clave es la misma, así que la celda se busca igual en los dos.
   */
  const notaPorCelda = useMemo(() => {
    const mapa = new Map<string, string>()
    if (!vista || anio === null) return mapa
    for (const n of vista.notasMes) {
      if (n.anio !== anio) continue
      mapa.set(`${n.clienteId}:${n.mes}`, n.texto)
    }
    return mapa
  }, [vista, anio])

  /** Un mes de este año ya cerrado: el informe existe y por tanto puede faltar. */
  const estaCerrado = useCallback(
    (mes: number) => {
      if (!hoy || anio === null) return false
      return anio < hoy.anio || (anio === hoy.anio && mes < hoy.mes)
    },
    [hoy, anio]
  )

  /** El mes que toca subir: el anterior al de hoy, no el de hoy. */
  const queToca = useMemo(() => {
    if (!hoy) return null
    return hoy.mes === 1 ? { anio: hoy.anio - 1, mes: 12 } : { anio: hoy.anio, mes: hoy.mes - 1 }
  }, [hoy])

  const lista = useMemo(() => {
    if (!vista) return []
    return [...vista.clientes]
      .filter((c) => {
        if (c.activo || verBajas) return true
        // Un cliente dado de baja sigue saliendo si tiene meses subidos de este
        // año: es su histórico, y esconderlo haría que el año pareciera otro.
        return vista.ficheros.some((f) => f.clienteId === c.id && f.anio === anio)
      })
      .sort((a, b) => {
        const oa = a.orden ?? 0
        const ob = b.orden ?? 0
        if (oa !== ob) return oa - ob
        return a.nombre.localeCompare(b.nombre, 'es')
      })
  }, [vista, verBajas, anio])

  /** Cuántos meses cerrados del año elegido le faltan a cada cliente. */
  const faltanPorCliente = useMemo(() => {
    const mapa = new Map<string, number>()
    for (const c of lista) {
      let n = 0
      for (let mes = 1; mes <= 12; mes += 1) {
        if (!estaCerrado(mes)) continue
        if (!porCelda.has(`${c.id}:${mes}`)) n += 1
      }
      mapa.set(c.id, n)
    }
    return mapa
  }, [lista, estaCerrado, porCelda])

  /** El recuento del mes que toca, que es el dato por el que se abre esto. */
  const marcador = useMemo(() => {
    if (!vista || !queToca || anio === null) return null
    if (queToca.anio !== anio) return null
    const activos = lista.filter((c) => c.activo)
    const puestos = activos.filter((c) => porCelda.has(`${c.id}:${queToca.mes}`)).length
    return { mes: queToca.mes, puestos, total: activos.length }
  }, [vista, queToca, anio, lista, porCelda])

  /** Todo lo que falta del año entero, contando solo meses ya cerrados. */
  const pendientesAnio = useMemo(() => {
    let n = 0
    for (const c of lista) {
      if (!c.activo) continue
      n += faltanPorCliente.get(c.id) ?? 0
    }
    return n
  }, [lista, faltanPorCliente])

  const anios = useMemo(() => {
    const todos = new Set<number>(vista?.anios ?? [])
    if (hoy) todos.add(hoy.anio)
    if (anio !== null) todos.add(anio)
    return [...todos].sort((a, b) => a - b)
  }, [vista, hoy, anio])

  const minAnio = anios.length > 0 ? anios[0] : anio
  const maxAnio = hoy ? hoy.anio : anio

  /**
   * El cliente abierto, buscado en la vista recién llegada y no guardado entero.
   *
   * Guardar el objeto en el estado lo dejaría congelado: después de cambiarle el
   * nombre o el fichero desde el diálogo, la lista de la izquierda diría lo
   * nuevo y la cabecera del panel lo viejo, sin que nada avise.
   */
  const cliente = clienteId ? (lista.find((c) => c.id === clienteId) ?? null) : null

  /**
   * Se abre solo el primero al llegar, como la pestaña Origen: la pantalla nace
   * con trabajo delante en lugar de con un panel vacío y un «elige un cliente».
   *
   * Y si el cliente abierto desaparece de la lista —se borra, o se da de baja
   * con «Ver los dados de baja» apagado— se cierra el panel: dejarlo sería
   * enseñar los meses de alguien que ya no está en la lista de al lado.
   */
  useEffect(() => {
    if (lista.length === 0) {
      if (clienteId !== null) setClienteId(null)
      return
    }
    // El que estaba abierto ya no está en la lista.
    if (clienteId !== null && !lista.some((c) => c.id === clienteId)) {
      // En móvil se vuelve a la lista y no al primero: en una pantalla donde
      // solo se ve UNA de las dos columnas, aterrizar en la ficha de otro
      // cliente sin haberla pedido se lee como que se ha tocado a quien no era.
      setClienteId(isMobile ? null : lista[0].id)
      return
    }
    // En escritorio las dos columnas se ven a la vez, así que el panel nunca
    // está de más: se abre el primero y la pantalla nace con trabajo delante.
    if (clienteId === null && !isMobile) setClienteId(lista[0].id)
  }, [lista, clienteId, isMobile])

  /* ---------------------------------------------------------------- */
  /* Subir, bajar, quitar y anotar                                     */
  /* ---------------------------------------------------------------- */

  function pedirFichero(delCliente: string, mes: number) {
    destinoRef.current = { clienteId: delCliente, mes }
    inputRef.current?.click()
  }

  async function subir(delCliente: string, mes: number, fichero: File) {
    if (anio === null) return

    const ext = fichero.name.slice(fichero.name.lastIndexOf('.')).toLowerCase()
    if (!EXTENSIONES.includes(ext)) {
      toast.error(
        `«${fichero.name}» no vale: aquí van ${EXTENSIONES.join(', ')}. El tax report se baja en CSV y el de Sellerboard en Excel.`
      )
      return
    }
    if (fichero.size > MAX_BYTES) {
      toast.error(
        `«${fichero.name}» ocupa ${peso(fichero.size)} y el tope son ${peso(MAX_BYTES)}. Comprueba que es el informe y no un export entero.`
      )
      return
    }

    const clave = `${delCliente}:${mes}`
    setSubiendo((antes) => new Set(antes).add(clave))

    const form = new FormData()
    // No se pone Content-Type a mano: lo pone el navegador con su `boundary`.
    form.set('fichero', fichero)
    form.set('clienteId', delCliente)
    form.set('anio', String(anio))
    form.set('mes', String(mes))

    const res = await subirAmazon<VistaTaxReports>(`${RUTA}/ficheros`, form)

    setSubiendo((antes) => {
      const ahora = new Set(antes)
      ahora.delete(clave)
      return ahora
    })

    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setVista(res.data)
    const nombre = vista?.clientes.find((c) => c.id === delCliente)?.nombre ?? 'el cliente'
    toast.success(`${MESES[mes - 1]} de «${nombre}» subido.`)
  }

  /**
   * La descarga.
   *
   * Se pide el enlace a la ruta y se NAVEGA a él, no se abre en otra pestaña: el
   * enlace firmado contesta con «adjunto», así que el navegador se lo baja y se
   * queda donde estaba. `window.open` dejaría una pestaña en blanco detrás y,
   * además, se lo come el bloqueador de ventanas cuando la llamada tarda —que
   * tarda, porque el enlace se pide al pulsar.
   *
   * SE PIDE DE UNO EN UNO, AL PULSAR. Se podría firmar el año entero al cargarlo
   * y ahorrarse este viaje; eso repartiría doce enlaces válidos dentro del HTML
   * cada vez que alguien abre un cliente, para que se use uno.
   */
  async function descargar(fichero: FicheroTax) {
    setBajando(fichero.id)
    const res = await getAmazon<{ url: string }>(`${RUTA}/ficheros/${fichero.id}`)
    setBajando(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    window.location.assign(res.data.url)
  }

  /**
   * EL `?anio=` NO ES ADORNO EN NINGUNA DE LAS ESCRITURAS.
   *
   * Las rutas contestan la vista YA RECARGADA, y el año que recargan lo leen de
   * la dirección: sin él cogen el año de HOY según el reloj del contenedor. O
   * sea que quitar un fichero de 2025 mientras se está mirando 2025 devolvería
   * el año 2026 y el panel pintaría los doce meses vacíos, como si el borrado se
   * hubiera llevado el año entero por delante.
   */
  async function quitar(fichero: FicheroTax) {
    setQuitando(fichero.id)
    const res = await deleteAmazon<VistaTaxReports>(
      `${RUTA}/ficheros/${fichero.id}?anio=${anio ?? fichero.anio}`
    )
    setQuitando(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setVista(res.data)
    toast.success('Fichero quitado. Ese mes vuelve a contar como que falta.')
  }

  /**
   * La nota de UN MES, que no es la del cliente.
   *
   * «Este mes lo mando tarde» o «va sin la factura de enero» caducan con el mes;
   * meterlas en la nota del cliente las deja ahí para siempre y al año siguiente
   * se leen como si pasaran ahora.
   *
   * SE PUEDE ANOTAR UN MES VACÍO, y es el caso que más importa: «falta la
   * factura de enero» habla de un mes QUE FALTA. La nota vive en su propia
   * tabla (`tax_report_notas_mes`, bloque 2 bis de la migración 200) y no en la
   * fila del fichero, que solo existe cuando hay algo colgado.
   *
   * Y ANOTAR UN MES NO LO PONE: no se crea ninguna fila en tax_report_ficheros,
   * así que el tic verde, la cifra de meses que faltan y el recuento de arriba
   * siguen diciendo lo mismo que antes de escribir la nota.
   */
  async function guardarNotaMes(mes: number, texto: string) {
    if (anio === null || !cliente) return false
    const notas = texto.trim() === '' ? null : texto.trim()

    // SE DIRECCIONA LA CELDA COMO SE VE —cliente, año y mes— y no por el id del
    // fichero: el mes que más se anota es justo el que todavía no tiene fichero,
    // y por el id no habría forma de nombrarlo.
    const res = await patchAmazon<VistaTaxReports>(`${RUTA}/ficheros?anio=${anio}`, {
      clienteId: cliente.id,
      anio,
      mes,
      notas,
    })

    if (!res.ok) {
      toast.error(res.error)
      return false
    }
    setVista(res.data)
    toast.success(notas ? `Nota de ${MESES[mes - 1]} guardada.` : `Nota de ${MESES[mes - 1]} quitada.`)
    return true
  }

  /** La nota del cliente, que sí es permanente. Va por su propia ruta. */
  async function guardarNotaCliente(texto: string) {
    if (!cliente) return false
    const res = await patchAmazon<VistaTaxReports>(
      `${RUTA}/clientes/${cliente.id}${anio === null ? '' : `?anio=${anio}`}`,
      { notas: texto.trim() === '' ? null : texto.trim() }
    )
    if (!res.ok) {
      toast.error(res.error)
      return false
    }
    setVista(res.data)
    toast.success(`Nota de «${cliente.nombre}» guardada.`)
    return true
  }

  /* ---------------------------------------------------------------- */
  /* Pintura                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Falta la migración, y se dice con el nombre del fichero entero.
   *
   * Es lo más accionable que hay en todo el módulo —un .sql que pegar en un
   * editor— y sin él esta pantalla no puede guardar absolutamente nada.
   */
  if (vista?.faltaMigracion) {
    return (
      <Aviso tono="rojo" icono={AlertTriangle}>
        <span className={AVISO.fuerte}>Las tablas de Tax Reports todavía no existen.</span> Abre el
        editor SQL de Supabase y pega{' '}
        <code className={TEXTO.t1}>supabase/migrations/200_tax_reports.sql</code> entero. Crea las
        dos tablas, el bucket privado y siembra los clientes que ya están en comisiones. Hasta
        entonces esta pantalla no puede guardar nada.
      </Aviso>
    )
  }

  /* ---------------- Columna izquierda: los clientes ---------------- */

  const columnaClientes = (
    <div className="flex min-h-0 min-w-0 flex-col gap-2">
      {/* LO QUE SE VIENE A MIRAR EL DÍA 3, y por eso va lo primero y en grande */}
      {vista !== null && (
        <div className={CIFRAS.tira}>
          {marcador && (
            <span className={CIFRAS.celda}>
              <span
                className={`${CIFRAS.valor} ${
                  marcador.puestos < marcador.total ? CIFRAS.urgente : ''
                }`}
              >
                {marcador.total - marcador.puestos === 0
                  ? 'todos'
                  : `faltan ${marcador.total - marcador.puestos} de ${marcador.total}`}
              </span>
              <span className={CIFRAS.rotulo}>de {MESES[marcador.mes - 1]}</span>
            </span>
          )}
          <span className={CIFRAS.celda}>
            <span className={`${CIFRAS.valor} ${pendientesAnio > 0 ? CIFRAS.urgente : ''}`}>
              {pendientesAnio}
            </span>
            <span className={CIFRAS.rotulo}>sin subir en {anio ?? '—'}</span>
          </span>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-[6px]">
        <button
          type="button"
          onClick={() => setEditando({ cliente: null })}
          className={`${BOTON.base} ${BOTON.primario}`}
        >
          <Plus className="h-[13px] w-[13px]" />
          Añadir cliente
        </button>
        <button
          type="button"
          aria-pressed={verBajas}
          onClick={() => setVerBajas((v) => !v)}
          className={`${BOTON.chip} ml-auto`}
          title="Los clientes dados de baja siguen enseñando sus meses viejos aunque no estén marcados aquí"
        >
          {verBajas ? 'Ocultar bajas' : 'Ver bajas'}
        </button>
        {cargando && vista !== null && <Loader2 className={`h-3 w-3 animate-spin ${TEXTO.t4}`} />}
      </div>

      {vista === null ? (
        cargando ? (
          <Cargando texto="Leyendo los clientes y sus meses…" />
        ) : null
      ) : lista.length === 0 ? (
        <Vacio
          icono={<Users />}
          titulo="Todavía no hay ningún cliente"
          accion={
            <button
              type="button"
              onClick={() => setEditando({ cliente: null })}
              className={`${BOTON.base} ${BOTON.primario}`}
            >
              <Plus className="h-[13px] w-[13px]" />
              Añadir el primero
            </button>
          }
        >
          La migración 200 siembra aquí los clientes que ya están en comisiones. Si no ha salido
          ninguno es que no se ha pegado todavía, o que se han dado todos de baja: pruébalo con «Ver
          bajas».
        </Vacio>
      ) : (
        <div className="min-h-0 flex-1 space-y-[6px] overflow-auto pr-px">
          {lista.map((c) => (
            <FilaCliente
              key={c.id}
              cliente={c}
              faltan={faltanPorCliente.get(c.id) ?? 0}
              activo={c.id === clienteId}
              onElegir={() => {
                setClienteId(c.id)
                setPestana('meses')
              }}
            />
          ))}
        </div>
      )}
    </div>
  )

  /* ---------------- Columna derecha: el año de ese cliente ---------------- */

  const panel = cliente ? (
    <PanelCliente
      // Cambiar de cliente remonta el panel entero: el borrador de la nota del
      // cliente es un input con su propio estado y, sin esto, se quedaría dentro
      // la nota a medio escribir del anterior y se guardaría sobre este.
      key={cliente.id}
      cliente={cliente}
      anio={anio}
      minAnio={minAnio}
      maxAnio={maxAnio}
      porCelda={porCelda}
      notaPorCelda={notaPorCelda}
      estaCerrado={estaCerrado}
      queToca={queToca}
      subiendo={subiendo}
      bajando={bajando}
      quitando={quitando}
      pestana={pestana}
      onPestana={setPestana}
      onAnio={(a) => setAnio(a)}
      onVolver={isMobile ? () => setClienteId(null) : null}
      onEditar={() => setEditando({ cliente })}
      onAdjuntar={(mes) => pedirFichero(cliente.id, mes)}
      onDescargar={(f) => void descargar(f)}
      onQuitar={(f) => void quitar(f)}
      onNotaMes={(mes) => setNotaMes({ mes })}
      onGuardarNotaCliente={guardarNotaCliente}
    />
  ) : (
    <div
      className={`flex h-full min-h-[180px] items-center justify-center px-6 py-10 text-center border ${LINEA.normal} ${RADIO.r2} ${SUPERFICIE.sup}`}
    >
      <p className={`${TIPO.s} ${TEXTO.t3}`}>Elige un cliente de la lista.</p>
    </div>
  )

  return (
    <div className={`${PANTALLA.cuerpo} h-full`}>
      {/* Un solo selector de fichero para los doce meses */}
      <input
        ref={inputRef}
        type="file"
        accept={EXTENSIONES.join(',')}
        className="hidden"
        onChange={(e) => {
          const fichero = e.target.files?.[0]
          const destino = destinoRef.current
          // Se vacía SIEMPRE: sin esto, elegir dos veces seguidas el mismo
          // fichero —que es lo que pasa al reintentar una subida que ha
          // fallado— no dispara `change` y el botón parece muerto.
          e.target.value = ''
          destinoRef.current = null
          if (!fichero || !destino) return
          void subir(destino.clienteId, destino.mes, fichero)
        }}
      />

      {error && (
        <div className="shrink-0">
          <Aviso tono="rojo" icono={AlertTriangle}>
            <span className={AVISO.fuerte}>No se han podido leer los clientes.</span> {error}
          </Aviso>
        </div>
      )}

      {isMobile ? (
        <div className="min-h-0 flex-1 overflow-auto">{clienteId ? panel : columnaClientes}</div>
      ) : (
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[268px_1fr] items-start gap-2">
          <div className="flex h-full min-h-0 flex-col">{columnaClientes}</div>
          <div className="h-full min-h-0 min-w-0 overflow-auto pr-px">{panel}</div>
        </div>
      )}

      {editando && (
        <ClienteDialogo
          cliente={editando.cliente}
          anio={anio}
          sugerencias={vista?.clientes ?? []}
          onCerrar={() => setEditando(null)}
          onGuardado={(nueva) => {
            setVista(nueva)
            setEditando(null)
          }}
        />
      )}

      {notaMes && cliente && (
        <NotaMesDialogo
          // El diálogo nace con la nota que hay: sin la clave, abrir enero y
          // después febrero reutilizaría el mismo componente y dentro seguiría
          // el texto de enero.
          key={`${cliente.id}:${notaMes.mes}`}
          cliente={cliente}
          mes={notaMes.mes}
          anio={anio}
          nota={notaPorCelda.get(`${cliente.id}:${notaMes.mes}`) ?? null}
          onCerrar={() => setNotaMes(null)}
          onGuardar={async (texto) => {
            const ok = await guardarNotaMes(notaMes.mes, texto)
            if (ok) setNotaMes(null)
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La lista: un cliente por línea                                      */
/* ------------------------------------------------------------------ */

/**
 * TRES DATOS Y NO MÁS: quién, con qué fichero y cuántos meses le faltan.
 *
 * Los que faltan van en ámbar y en cifra, no en palabra: es el número por el que
 * se decide a quién se entra primero, y la lista se recorre de arriba abajo
 * buscándolo.
 */
function FilaCliente({
  cliente,
  faltan,
  activo,
  onElegir,
}: {
  cliente: ClienteTax
  /** Meses cerrados del año elegido sin fichero */
  faltan: number
  activo: boolean
  onElegir: () => void
}) {
  const alDia = faltan === 0

  return (
    <button
      type="button"
      onClick={onElegir}
      aria-pressed={activo}
      className={`flex w-full min-w-0 items-center gap-[6px] px-2 py-[6px] text-left border ${RADIO.r2} ${
        activo
          ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-sel)]'
          : `${LINEA.normal} ${SUPERFICIE.sup} hover:bg-[var(--ls-sup2)]`
      } ${cliente.activo ? '' : 'opacity-55'}`}
    >
      {alDia ? (
        <Check className="h-[13px] w-[13px] shrink-0" style={{ color: COLOR_ESTADO.verde }} />
      ) : (
        <CircleDashed className="h-[13px] w-[13px] shrink-0" style={{ color: COLOR_ESTADO.ambar }} />
      )}

      <span className="min-w-0 flex-1">
        <span className={`${TIPO.m} ${TEXTO.t1} block truncate font-medium`}>
          {cliente.nombre}
          {!cliente.activo && <span className={`${TIPO.xs} ${TEXTO.t4}`}> · de baja</span>}
        </span>
        <span className={`${TIPO.xs} ${TEXTO.t4} block truncate font-normal`}>
          {comoSeLlama(cliente)}
        </span>
      </span>

      <span
        className={`${TIPO.xs} shrink-0 tabular-nums`}
        style={{ color: alDia ? COLOR_ESTADO.verde : COLOR_ESTADO.ambar }}
        title={
          alDia
            ? 'No le falta ningún mes cerrado de este año'
            : `${faltan} ${faltan === 1 ? 'mes cerrado' : 'meses cerrados'} sin fichero`
        }
      >
        {alDia ? '·' : faltan}
      </span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* El panel de un cliente: sus doce meses                              */
/* ------------------------------------------------------------------ */

/**
 * TODOS LOS MESES DEL AÑO, PUESTOS Y POR PONER, EN LA MISMA LISTA.
 *
 * No se filtra a «solo los que faltan», que es la tentación: el mes que se está
 * buscando se localiza por su SITIO en el año, y una lista que cambia de largo
 * según lo que haya subido obliga a leer las etiquetas una por una. Los doce
 * siempre, en orden, y lo que cambia es la línea de cada uno.
 */
function PanelCliente({
  cliente,
  anio,
  minAnio,
  maxAnio,
  porCelda,
  notaPorCelda,
  estaCerrado,
  queToca,
  subiendo,
  bajando,
  quitando,
  pestana,
  onPestana,
  onAnio,
  onVolver,
  onEditar,
  onAdjuntar,
  onDescargar,
  onQuitar,
  onNotaMes,
  onGuardarNotaCliente,
}: {
  cliente: ClienteTax
  anio: number | null
  minAnio: number | null
  maxAnio: number | null
  porCelda: Map<string, FicheroTax>
  notaPorCelda: Map<string, string>
  estaCerrado: (mes: number) => boolean
  queToca: { anio: number; mes: number } | null
  subiendo: ReadonlySet<string>
  bajando: string | null
  quitando: string | null
  pestana: 'meses' | 'notas'
  onPestana: (p: 'meses' | 'notas') => void
  onAnio: (anio: number) => void
  /** En móvil se vuelve a la lista; en escritorio no hay a dónde volver */
  onVolver: (() => void) | null
  onEditar: () => void
  onAdjuntar: (mes: number) => void
  onDescargar: (fichero: FicheroTax) => void
  onQuitar: (fichero: FicheroTax) => void
  onNotaMes: (mes: number) => void
  onGuardarNotaCliente: (texto: string) => Promise<boolean>
}) {
  const faltan = useMemo(() => {
    let n = 0
    for (let mes = 1; mes <= 12; mes += 1) {
      if (!estaCerrado(mes)) continue
      if (!porCelda.has(`${cliente.id}:${mes}`)) n += 1
    }
    return n
  }, [cliente.id, estaCerrado, porCelda])

  return (
    <div className="min-w-0 space-y-2">
      <div className={`${TARJETA.base} flex flex-wrap items-center gap-2 px-[10px] py-[7px]`}>
        <div className="min-w-0">
          <p className={`${TITULO.seccion} truncate`}>{cliente.nombre}</p>
          <p className={`${TIPO.s} ${TEXTO.t4} truncate`}>
            <FileSpreadsheet className="mr-[4px] inline h-[12px] w-[12px] align-[-2px]" />
            {comoSeLlama(cliente)}
            {cliente.activo ? '' : ' · dado de baja'}
            {faltan > 0 ? ` · le faltan ${faltan} de ${anio ?? '—'}` : ''}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-[4px]">
          {onVolver && (
            <button
              type="button"
              onClick={onVolver}
              className={`${BOTON.base} ${BOTON.secundario}`}
            >
              Volver
            </button>
          )}

          {/* Las notas del cliente son una PESTAÑA y no un campo más abajo del
              todo: Raúl las pidió arriba porque lo que se anota de una cuenta
              —a quién se le manda, qué tiene de raro— se consulta ANTES de
              colgar nada, no después de bajar doce meses. */}
          {(['meses', 'notas'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPestana(p)}
              aria-pressed={pestana === p}
              className={`${BOTON.chip} ${pestana === p ? BOTON.chipEncendido : ''}`}
            >
              {p === 'meses' ? 'Meses' : 'Notas del cliente'}
              {p === 'notas' && cliente.notas ? ' ·' : ''}
            </button>
          ))}

          <button
            type="button"
            onClick={onEditar}
            className={BOTON.icono}
            aria-label={`Editar «${cliente.nombre}»`}
            title="Cambiar el nombre, cómo se llama su fichero o darlo de baja"
          >
            <Pencil className="h-[13px] w-[13px]" />
          </button>
        </div>
      </div>

      {pestana === 'notas' ? (
        <NotasCliente cliente={cliente} onGuardar={onGuardarNotaCliente} />
      ) : (
        <section className={TARJETA.base}>
          <header className={TARJETA.cabecera}>
            <h2 className={TITULO.seccion}>Los meses de {anio ?? '—'}</h2>

            {/* EL SELECTOR DE AÑO VA AQUÍ, en la cabecera de los meses, porque
                el año solo significa algo cuando hay meses delante. Mueve la
                carga entera —la lista de la izquierda también cuenta con él—,
                así que no es un filtro del panel: es qué año se está mirando. */}
            <div
              className={`ml-auto flex items-center gap-[2px] ${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup} px-[3px] py-[2px]`}
            >
              <button
                type="button"
                className={BOTON.icono}
                aria-label="Año anterior"
                disabled={anio === null || minAnio === null || anio <= minAnio}
                onClick={() => anio !== null && onAnio(anio - 1)}
              >
                <ChevronLeft className="h-[13px] w-[13px]" />
              </button>
              <span className={`${TIPO.l} ${TEXTO.t1} px-1 tabular-nums`}>{anio ?? '—'}</span>
              <button
                type="button"
                className={BOTON.icono}
                aria-label="Año siguiente"
                disabled={anio === null || maxAnio === null || anio >= maxAnio}
                onClick={() => anio !== null && onAnio(anio + 1)}
              >
                <ChevronRight className="h-[13px] w-[13px]" />
              </button>
            </div>
          </header>

          <div className={`${TARJETA.cuerpo} space-y-px`}>
            {MESES.map((_, i) => {
              const mes = i + 1
              return (
                <FilaMes
                  key={mes}
                  cliente={cliente}
                  mes={mes}
                  anio={anio}
                  fichero={porCelda.get(`${cliente.id}:${mes}`) ?? null}
                  nota={notaPorCelda.get(`${cliente.id}:${mes}`) ?? null}
                  cerrado={estaCerrado(mes)}
                  esElQueToca={queToca?.anio === anio && queToca?.mes === mes}
                  subiendo={subiendo.has(`${cliente.id}:${mes}`)}
                  bajando={bajando}
                  quitando={quitando}
                  onAdjuntar={() => onAdjuntar(mes)}
                  onDescargar={onDescargar}
                  onQuitar={onQuitar}
                  onNota={() => onNotaMes(mes)}
                />
              )
            })}
          </div>

          {/* Se dice aquí porque es donde se decide descargar, y porque explica
              por qué un enlace guardado deja de valer al minuto. */}
          <div className={`border-t ${LINEA.normal} px-[10px] py-[7px]`}>
            <p className={`${TIPO.s} ${TEXTO.t4}`}>
              El enlace de descarga se genera al pulsar y caduca a los 60 segundos: no sirve para
              reenviarlo ni pegado en un correo. Los ficheros se retiran solos a los seis meses —
              existen para mandarlos ese mes, no para guardarlos.
            </p>
          </div>
        </section>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Un mes                                                              */
/* ------------------------------------------------------------------ */

/**
 * LOS CUATRO ESTADOS DE UN MES, DISTINGUIDOS POR FORMA ANTES QUE POR COLOR.
 *
 *   · Puesto          — el tic. Se puede descargar, sustituir o quitar.
 *   · Falta           — el círculo de trazos, y el mes ya cerró.
 *   · Aún no toca     — la raya. El mes no ha terminado: el informe no existe.
 *   · Retirado        — el archivador. SE MANDÓ y se retiró a los seis meses.
 *
 * El último no se pinta como «falta» y no es un detalle: si los dos se vieran
 * igual, el día 3 alguien volvería a colgar justo lo que decidimos no guardar.
 */
function FilaMes({
  cliente,
  mes,
  anio,
  fichero,
  nota,
  cerrado,
  esElQueToca,
  subiendo,
  bajando,
  quitando,
  onAdjuntar,
  onDescargar,
  onQuitar,
  onNota,
}: {
  cliente: ClienteTax
  mes: number
  anio: number | null
  fichero: FicheroTax | null
  /** Lo anotado de este mes, tenga fichero o no */
  nota: string | null
  cerrado: boolean
  /** Es el mes que se sube este día 3 */
  esElQueToca: boolean
  subiendo: boolean
  bajando: string | null
  quitando: string | null
  onAdjuntar: () => void
  onDescargar: (fichero: FicheroTax) => void
  onQuitar: (fichero: FicheroTax) => void
  onNota: () => void
}) {
  const comoSeLlamaSuFichero = comoSeLlama(cliente)

  let icono: React.ReactNode
  let linea: React.ReactNode

  if (subiendo) {
    icono = <Loader2 className="h-[13px] w-[13px] animate-spin" />
    linea = <span className={TEXTO.t3}>Subiendo…</span>
  } else if (fichero?.purgadoAt) {
    icono = <Archive className="h-[13px] w-[13px]" />
    linea = (
      <span className={TEXTO.t4}>
        Se mandó y se retiró el {fechaHora(fichero.purgadoAt)}. Ya no se puede descargar.
      </span>
    )
  } else if (fichero) {
    icono = <Check className="h-[13px] w-[13px]" style={{ color: COLOR_ESTADO.verde }} />
    linea = (
      <span className={TEXTO.t3}>
        {fichero.nombreOriginal} · {peso(fichero.tamano)} · {fechaHora(fichero.subidoAt)}
      </span>
    )
  } else if (cerrado) {
    icono = <CircleDashed className="h-[13px] w-[13px]" style={{ color: COLOR_ESTADO.ambar }} />
    linea = <span style={{ color: COLOR_ESTADO.ambar }}>Falta el {comoSeLlamaSuFichero}</span>
  } else {
    icono = <Minus className="h-[13px] w-[13px]" />
    linea = <span className={TEXTO.t4}>El mes no ha terminado: todavía no hay informe</span>
  }

  return (
    <div
      className={`min-w-0 ${RADIO.r1} px-[5px] py-[4px] ${
        esElQueToca ? SUPERFICIE.sel : 'hover:bg-[var(--ls-sup2)]'
      }`}
    >
      <div className="flex min-w-0 items-center gap-[6px]">
        <span className={`${TEXTO.t4} shrink-0`}>{icono}</span>

        <span
          className={`${TIPO.m} ${esElQueToca ? TEXTO.t1 : TEXTO.t2} w-[92px] shrink-0 truncate`}
          title={esElQueToca ? `${MESES[mes - 1]}: es el mes que toca subir` : MESES[mes - 1]}
        >
          {MESES[mes - 1]}
        </span>

        <span className={`${TIPO.s} min-w-0 flex-1 truncate`}>{linea}</span>

        <span className="flex shrink-0 items-center gap-[2px]">
          {/* SE PUEDE ANOTAR UN MES VACÍO, y es el que más se anota: lo que hay
              que explicar el día 3 es por qué ESE mes todavía no está. La nota
              vive en su propia tabla y no en la fila del fichero, así que no
              hace falta que el mes esté puesto — y anotarlo tampoco lo pone. */}
          <button
            type="button"
            onClick={onNota}
            className={BOTON.icono}
            aria-label={`Nota de ${MESES[mes - 1]}${anio === null ? '' : ` de ${anio}`}`}
            title={nota ? `Nota: ${nota}` : 'Escribir una nota de este mes'}
            style={nota ? { color: COLOR_ESTADO.ambar } : undefined}
          >
            <NotebookPen className="h-[13px] w-[13px]" />
          </button>

          {fichero && !fichero.purgadoAt && (
            <button
              type="button"
              onClick={() => onDescargar(fichero)}
              disabled={bajando === fichero.id}
              className={BOTON.icono}
              aria-label={`Descargar ${MESES[mes - 1]}`}
              title="Descargar este fichero"
            >
              {bajando === fichero.id ? (
                <Loader2 className="h-[13px] w-[13px] animate-spin" />
              ) : (
                <Download className="h-[13px] w-[13px]" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onAdjuntar}
            disabled={subiendo}
            className={BOTON.icono}
            aria-label={`${fichero ? 'Sustituir' : 'Adjuntar'} ${MESES[mes - 1]}`}
            title={fichero ? 'Sustituir por otro fichero' : 'Adjuntar el fichero de este mes'}
          >
            <Upload className="h-[13px] w-[13px]" />
          </button>

          {/* Quitar la fila de un fichero YA RETIRADO dejaría el mes vacío, o
              sea leyéndose como «falta por subir», que es justo lo contrario de
              lo que pasó: se mandó y se retiró. La fila es lo único que queda
              para contarlo. */}
          {fichero && !fichero.purgadoAt && (
            <button
              type="button"
              onClick={() => onQuitar(fichero)}
              disabled={quitando === fichero.id}
              className={BOTON.icono}
              aria-label={`Quitar ${MESES[mes - 1]}`}
              title="Quitar el fichero: este mes vuelve a contar como que falta"
            >
              {quitando === fichero.id ? (
                <Loader2 className="h-[13px] w-[13px] animate-spin" />
              ) : (
                <Trash2 className="h-[13px] w-[13px]" />
              )}
            </button>
          )}
        </span>
      </div>

      {/* La nota se LEE en la línea del mes, no solo en el `title`: una nota que
          hay que descubrir pasando el ratón por encima de doce filas es una nota
          que nadie va a leer el día que importa. */}
      {nota && (
        <p
          className={`${TIPO.xs} mt-[2px] pl-[117px] font-normal leading-[1.5]`}
          style={{ color: COLOR_ESTADO.ambar }}
        >
          {nota}
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Las notas del cliente                                               */
/* ------------------------------------------------------------------ */

/**
 * LA NOTA PERMANENTE DE LA CUENTA, y no la de un mes.
 *
 * Se guarda con un botón y no al teclear: esto es un textarea largo y un
 * guardado automático mandaría una escritura por pulsación, cada una
 * devolviendo la vista entera y repintando la lista de al lado.
 *
 * AQUÍ NO VAN DATOS DE COMPRADORES. Es un campo libre que lee todo el que entra
 * en el módulo, y lo que tiene que decir es a quién se le manda el informe y qué
 * tiene de particular esta cuenta.
 */
function NotasCliente({
  cliente,
  onGuardar,
}: {
  cliente: ClienteTax
  onGuardar: (texto: string) => Promise<boolean>
}) {
  const [texto, setTexto] = useState(cliente.notas ?? '')
  const [guardando, setGuardando] = useState(false)

  const sucio = (cliente.notas ?? '') !== texto

  return (
    <section className={TARJETA.base}>
      <header className={TARJETA.cabecera}>
        <h2 className={TITULO.seccion}>Notas de «{cliente.nombre}»</h2>
        <button
          type="button"
          onClick={async () => {
            setGuardando(true)
            await onGuardar(texto)
            setGuardando(false)
          }}
          disabled={guardando || !sucio}
          className={`${BOTON.base} ${BOTON.primario} ml-auto`}
        >
          {guardando && <Loader2 className="h-[13px] w-[13px] animate-spin" />}
          Guardar
        </button>
      </header>

      <div className={`${TARJETA.cuerpo} ${CAMPO.contenedor}`}>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={8}
          placeholder="A quién se le manda, de dónde se saca su informe, qué tiene de particular esta cuenta…"
          className={`${CAMPO.input} h-auto py-[5px] leading-[1.5]`}
        />
        <p className={CAMPO.nota}>
          Es la nota de la CUENTA y se queda para siempre. Lo que caduca con el mes —«este mes lo
          mando tarde», «va sin la factura de enero»— va en la nota de ese mes, en la pestaña
          «Meses»: el lápiz de su línea, que se enciende en cuanto el mes tiene fichero. Aquí NO van
          datos de compradores.
        </p>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* La nota de un mes                                                   */
/* ------------------------------------------------------------------ */

function NotaMesDialogo({
  cliente,
  mes,
  anio,
  nota,
  onCerrar,
  onGuardar,
}: {
  cliente: ClienteTax
  mes: number
  anio: number | null
  /** Lo que ya hubiera escrito de este mes, o null */
  nota: string | null
  onCerrar: () => void
  onGuardar: (texto: string) => Promise<void>
}) {
  const [texto, setTexto] = useState(nota ?? '')
  const [guardando, setGuardando] = useState(false)

  return (
    <Dialogo
      titulo={`${cliente.nombre} · ${MESES[mes - 1]}${anio === null ? '' : ` de ${anio}`}`}
      entradilla="Lo que haya pasado con ESTE mes. Se lee en su línea, debajo del nombre del mes."
      onCerrar={onCerrar}
      pie={
        <>
          <button
            type="button"
            onClick={async () => {
              setGuardando(true)
              await onGuardar(texto)
              setGuardando(false)
            }}
            disabled={guardando}
            className={`${BOTON.base} ${BOTON.primario}`}
          >
            {guardando && <Loader2 className="h-[13px] w-[13px] animate-spin" />}
            Guardar
          </button>
          <button type="button" onClick={onCerrar} className={`${BOTON.base} ${BOTON.secundario}`}>
            Cancelar
          </button>
        </>
      }
    >
      <div className={CAMPO.contenedor}>
        <label className={CAMPO.etiqueta} htmlFor="nota-mes">
          Nota de {MESES[mes - 1]}
        </label>
        <textarea
          id="nota-mes"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={3}
          autoFocus
          placeholder="Este mes se manda tarde · falta la factura de enero · lo pidió en Excel"
          className={`${CAMPO.input} h-auto py-[5px] leading-[1.5]`}
        />
        <p className={CAMPO.nota}>
          Vaciarla la quita. Es de este mes y no de la cuenta: lo que vale todos los meses va en las
          notas del cliente. Se puede escribir aunque el mes aún no tenga nada colgado, y escribirla
          no lo da por puesto.
        </p>
      </div>
    </Dialogo>
  )
}

'use client'

import { useMemo, useState } from 'react'
import {
  Ban,
  CheckCircle2,
  CircleDashed,
  FileCog,
  Loader2,
  Plus,
  Trash2,
  AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  deleteAmazon,
  patchAmazon,
  postAmazon,
  type PerfilesVista,
} from '@/lib/amazon/client'
import { useIsMobile } from '@/lib/use-is-mobile'
import type { ClienteSinAlta } from '@/lib/stock-sync/perfiles'
import { PARAM_MODULO } from '@/components/growth/modulos'
import {
  ESTADO_SINCRONIZACION_LABELS,
  STOCK_BRAKE_LABELS,
  STOCK_PROFILE_ORIGIN_LABELS,
  estadoSincronizacion,
  type EstadoSincronizacion,
  type StockClient,
  type StockProfileRun,
  type StockReadProfile,
} from '@/lib/types/stock-sync'
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
  TARJETA,
  TEXTO,
  TIPO,
  TITULO,
  type TonoEstado,
} from '@/lib/estilo/denso'
import { Aviso, Dialogo, fechaHora } from '@/components/plataforma/comun'
import { EjecucionesPanel } from './EjecucionesPanel'
import { PerfilConfig } from './PerfilConfig'
import { SimulacroPanel } from './SimulacroPanel'
import { formatWhen } from './shared'

/**
 * LA PESTAÑA «ORIGEN»: DE DÓNDE SALE EL FICHERO DE CADA CLIENTE.
 *
 * Un perfil = un fichero de un cliente y cómo se interpreta. Es la única pieza
 * del proceso que cambia de un cliente a otro; el cruce, los frenos y el envío
 * son comunes y no saben de clientes.
 *
 *
 * ============ LA LISTA VA POR CLIENTE Y NO POR PERFIL ============
 *
 * Antes enumeraba PERFILES, que es lo que HAY, y la pregunta de todos los días
 * es la contraria: ¿a quién le falta? Eso obligaba a una segunda lista debajo
 * —«clientes sin perfil»— y a compararlas con la vista.
 *
 * Ahora la lista son LOS CLIENTES, todos, cada uno con su estado y sus perfiles
 * colgando. Se lee de arriba abajo y contesta la pregunta sin sumar nada.
 *
 *
 * ============ «NO SINCRONIZA» ES UN ESTADO, NO UN HUECO ============
 *
 * Son tres situaciones y hasta hoy solo se distinguían dos:
 *
 *   · SINCRONIZA    — tiene perfil de stock activo. Entra en el ciclo.
 *   · NO SINCRONIZA — alguien decidió que no, y consta cuándo, quién y por qué.
 *   · SIN CONFIGURAR— nadie lo ha hecho y nadie ha dicho que no haga falta.
 *
 * Las dos últimas se veían EXACTAMENTE IGUAL —cero perfiles— y por eso la lista
 * de pendientes no se podía usar para nada: nunca se sabía si lo que había ahí
 * era trabajo por hacer o clientes que no lo necesitan. La decisión se guarda en
 * stock_clients (migración 127) y la respeta el ciclo automático, no solo esta
 * pantalla.
 *
 *
 * ============ EL TEXTO EXPLICATIVO NO ESTÁ AQUÍ ============
 *
 * Ni un párrafo encima de los controles. El porqué de los frenos, qué hace un
 * simulacro, qué significa cada origen y qué pasa con la configuración de un
 * cliente al que se marca — todo eso vive detrás del botón de información de la
 * cabecera, en InfoOrigen. Lo que se queda en pantalla es lo accionable de HOY:
 * una ejecución que ha fallado y una migración sin lanzar.
 */

/** Qué se está mirando en el panel de la derecha */
type Seleccion =
  | { tipo: 'cliente'; id: string }
  | { tipo: 'perfil'; id: string }

const TONO_ESTADO: Record<EstadoSincronizacion, TonoEstado> = {
  sincroniza: 'verde',
  no_sincroniza: 'gris',
  pendiente: 'ambar',
}

const ICONO_ESTADO = {
  sincroniza: CheckCircle2,
  no_sincroniza: Ban,
  pendiente: CircleDashed,
} as const

export function PerfilesPanel({ initialData }: { initialData: PerfilesVista }) {
  const [data, setData] = useState<PerfilesVista>(initialData)
  const [seleccion, setSeleccion] = useState<Seleccion | null>(() =>
    initialData.clientes[0] ? { tipo: 'cliente', id: initialData.clientes[0].id } : null
  )
  const [vista, setVista] = useState<'config' | 'simulacro' | 'ejecuciones'>('config')
  const [creando, setCreando] = useState<{ clienteId: string | null } | null>(null)
  const [decidiendo, setDecidiendo] = useState<StockClient | null>(null)
  /** El que solo está en Amazon y sobre el que se va a decidir. Se identifica por slug */
  const [decidiendoSinAlta, setDecidiendoSinAlta] = useState<ClienteSinAlta | null>(null)
  const [guardando, setGuardando] = useState(false)

  // 768 y no el 1023 por defecto: por debajo de ahí es donde un formulario de
  // dos columnas y una tabla de nueve dejan de caber de verdad.
  const isMobile = useIsMobile('(max-width: 767px)')

  const perfil =
    seleccion?.tipo === 'perfil' ? data.perfiles.find((p) => p.id === seleccion.id) ?? null : null

  /**
   * El cliente que se está mirando, venga de donde venga la selección.
   *
   * Un perfil seleccionado también fija cliente: es lo que mantiene la columna
   * izquierda con el grupo correcto abierto al saltar de un perfil a otro.
   */
  const clienteId =
    seleccion?.tipo === 'cliente' ? seleccion.id : perfil?.client_id ?? null
  const cliente = data.clientes.find((c) => c.id === clienteId) ?? null

  /** Los perfiles de cada cliente, en el orden en que llegan de la base */
  const perfilesPorCliente = useMemo(() => {
    const mapa = new Map<string, StockReadProfile[]>()
    for (const p of data.perfiles) {
      const lista = mapa.get(p.client_id)
      if (lista) lista.push(p)
      else mapa.set(p.client_id, [p])
    }
    return mapa
  }, [data.perfiles])

  /**
   * La última ejecución de cada perfil.
   *
   * `data.runs` llega ordenada de la más reciente a la más antigua, así que la
   * PRIMERA que se ve de cada perfil es la última que hubo. Sirve para que un
   * freno se vea en la lista sin entrar perfil por perfil: un freno que solo se
   * ve entrando a mirar no cumple su función.
   */
  const ultimoRun = useMemo(() => {
    const mapa = new Map<string, StockProfileRun>()
    for (const run of data.runs) {
      if (!mapa.has(run.profile_id)) mapa.set(run.profile_id, run)
    }
    return mapa
  }, [data.runs])

  /** El estado de cada cliente, calculado una vez */
  const estados = useMemo(() => {
    const mapa = new Map<string, EstadoSincronizacion>()
    for (const c of data.clientes) {
      const activos = (perfilesPorCliente.get(c.id) ?? []).filter(
        (p) => p.tipo === 'stock' && p.is_active
      ).length
      mapa.set(c.id, estadoSincronizacion(c, activos))
    }
    return mapa
  }, [data.clientes, perfilesPorCliente])

  const recuento = useMemo(() => {
    const out = { sincroniza: 0, no_sincroniza: 0, pendiente: 0 }
    for (const estado of estados.values()) out[estado] += 1
    // Los que solo están en Amazon cuentan como SIN CONFIGURAR: nadie ha mirado
    // si les hace falta sincronizar. Dejarlos fuera del recuento era lo que hacía
    // que la tira de arriba dijera «0 sin configurar» teniendo trabajo pendiente.
    out.pendiente += data.clientesSinAlta.length
    return out
  }, [estados, data.clientesSinAlta])

  /**
   * Qué clientes con perfil de stock no tienen el de códigos de barras.
   *
   * Se distingue porque no se nota de ninguna otra forma y no es un detalle: sin
   * ese fichero el cruce pierde la vía por EAN entera, que con los datos reales
   * resuelve 245 de 395 referencias.
   */
  const clientesConEan = useMemo(
    () =>
      new Set(
        data.perfiles.filter((p) => p.tipo === 'ean' && p.is_active).map((p) => p.client_id)
      ),
    [data.perfiles]
  )

  /**
   * Guarda un cambio del perfil.
   *
   * NO es optimista, a diferencia del catálogo: aquí la base tiene siete CHECK
   * que pueden rechazar el cambio —mandar precio sin decir de dónde, margen sin
   * porcentaje, envío automático sin conexión— y esos rechazos son la mitad de
   * la ayuda que da esta pantalla. Pintar el cambio antes de saber si se ha
   * aceptado dejaría en pantalla un perfil que la base no tiene.
   */
  async function patch(id: string, cambios: Record<string, unknown>) {
    setGuardando(true)
    const res = await patchAmazon<PerfilesVista>(`/api/amazon/perfiles/${id}`, cambios)
    setGuardando(false)

    if (!res.ok) {
      toast.error(res.error)
      // La vista no se toca: los inputs no controlados siguen enseñando lo que
      // se tecleó, que es lo que hay que corregir.
      return
    }
    setData(res.data)
  }

  /** Marca o desmarca «este cliente no hace sincronización de stock» */
  async function decidir(id: string, noSincroniza: boolean, motivo: string | null) {
    setGuardando(true)
    const res = await patchAmazon<PerfilesVista>(`/api/stock-sync/clientes/${id}`, {
      noSincroniza,
      motivo,
    })
    setGuardando(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setData(res.data)
    setDecidiendo(null)
    toast.success(
      noSincroniza
        ? 'Anotado: a este cliente no se le sincroniza el stock'
        : 'Este cliente vuelve a entrar en la sincronización'
    )
  }

  /**
   * Decide sobre un cliente que TODAVÍA NO está en el sincronismo.
   *
   * Va por POST /api/stock-sync/clientes y no por el PATCH de siempre porque
   * primero hay que crearle la fila: se identifica por SLUG, que es lo único que
   * comparten `amazon_clients` y `stock_clients`. La fila no significa «le
   * mandamos stock»; significa que alguien ha mirado esto.
   */
  async function decidirSinAlta(slug: string, noSincroniza: boolean, motivo: string | null) {
    setGuardando(true)
    const res = await postAmazon<PerfilesVista>('/api/stock-sync/clientes', {
      slug,
      noSincroniza,
      motivo,
    })
    setGuardando(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setData(res.data)
    setDecidiendoSinAlta(null)
    toast.success(
      noSincroniza
        ? 'Anotado: a este cliente no se le sincroniza el stock'
        : 'Cliente dado de alta en el sincronismo'
    )
  }

  async function borrar(p: StockReadProfile) {
    if (
      !confirm(
        `¿Borrar el perfil «${p.name}»?\n\nSe borra también su historial de ejecuciones. El mapeo del cliente y su catálogo de Amazon no se tocan.`
      )
    ) {
      return
    }

    const res = await deleteAmazon<PerfilesVista>(`/api/amazon/perfiles/${p.id}`)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setData(res.data)
    setSeleccion({ tipo: 'cliente', id: p.client_id })
    toast.success(`Perfil «${p.name}» borrado`)
  }

  if (data.missingTables) return <MigracionPendiente />

  /* ---------------- Columna izquierda: los clientes ---------------- */

  const lista = (
    <div className="flex min-h-0 min-w-0 flex-col gap-2">
      <div className={CIFRAS.tira}>
        <span className={CIFRAS.celda}>
          <span className={CIFRAS.valor}>{recuento.sincroniza}</span>
          <span className={CIFRAS.rotulo}>sincronizan</span>
        </span>
        <span className={CIFRAS.celda}>
          <span className={CIFRAS.valor}>{recuento.no_sincroniza}</span>
          <span className={CIFRAS.rotulo}>no</span>
        </span>
        <span className={CIFRAS.celda}>
          <span className={`${CIFRAS.valor} ${recuento.pendiente > 0 ? CIFRAS.urgente : ''}`}>
            {recuento.pendiente}
          </span>
          <span className={CIFRAS.rotulo}>sin configurar</span>
        </span>
      </div>

      {data.clientes.length === 0 && data.clientesSinAlta.length === 0 ? (
        <div
          className={`flex flex-col items-center gap-1 px-4 py-6 text-center border ${LINEA.normal} ${RADIO.r2} ${SUPERFICIE.sup}`}
        >
          <FileCog className={`h-5 w-5 ${TEXTO.t4}`} />
          <p className={TITULO.seccion}>Todavía no hay ningún cliente</p>
          {/* «Sincronismo de stock» dejó de ser una entrada del menú: vive
              dentro de Growth Partner. Quien leyera lo de antes se ponía a
              buscar en la barra lateral un módulo que ya no está. */}
          <p className={`${TIPO.s} ${TEXTO.t3}`}>
            Se dan de alta en{' '}
            <a
              href={`/dashboard/growth?${PARAM_MODULO}=stock-sync`}
              className="underline underline-offset-2 hover:text-[var(--ls-t1)]"
            >
              Growth Partner · Sincronismo de stock
            </a>
            .
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-[6px] overflow-auto pr-px">
          {data.clientes.map((c) => (
            <GrupoCliente
              key={c.id}
              cliente={c}
              estado={estados.get(c.id) ?? 'pendiente'}
              perfiles={perfilesPorCliente.get(c.id) ?? []}
              ultimoRun={ultimoRun}
              sinEan={!clientesConEan.has(c.id)}
              clienteActivo={c.id === clienteId}
              perfilActivo={perfil?.id ?? null}
              onElegirCliente={() => setSeleccion({ tipo: 'cliente', id: c.id })}
              onElegirPerfil={(id) => {
                setSeleccion({ tipo: 'perfil', id })
                setVista('config')
              }}
            />
          ))}

          {/* -------- Los que solo están en Amazon --------

              Aparecen aquí porque decidir que a un cliente NO le hace falta
              sincronizar es media pestaña Origen, y antes no se podía: la lista
              salía solo de `stock_clients` y estos no están. Growth Partner
              enlazaba aquí y el cliente no aparecía. */}
          {data.clientesSinAlta.map((c) => (
            <div
              key={c.slug}
              className={`flex items-center gap-2 px-2 py-[6px] border ${LINEA.normal} ${RADIO.r2} ${SUPERFICIE.sup}`}
            >
              <CircleDashed
                className="h-[13px] w-[13px] shrink-0"
                style={{ color: COLOR_ESTADO.ambar }}
              />
              <span className="min-w-0 flex-1 truncate">
                <span className={`${TIPO.m} ${TEXTO.t1}`}>{c.name}</span>{' '}
                <span className={`${TIPO.xs} ${TEXTO.t4}`}>· sin configurar</span>
              </span>
              <button
                type="button"
                onClick={() => setDecidiendoSinAlta(c)}
                disabled={guardando}
                className={`${BOTON.base} ${BOTON.secundario} shrink-0`}
                title="Decidir si a este cliente hay que sincronizarle el stock"
              >
                Decidir
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  /* ---------------- Columna derecha: el detalle ---------------- */

  let detalle: React.ReactNode

  if (perfil) {
    const suCliente = data.clientes.find((c) => c.id === perfil.client_id)
    const marcado = Boolean(suCliente?.no_sincroniza_desde)

    detalle = (
      <div className="min-w-0 space-y-2">
        <div className={`${TARJETA.base} flex flex-wrap items-center gap-2 px-[10px] py-[7px]`}>
          <div className="min-w-0">
            <p className={`${TITULO.seccion} truncate`}>{perfil.name}</p>
            <p className={`${TIPO.s} ${TEXTO.t4} truncate`}>
              {suCliente?.name ?? '—'} · {STOCK_PROFILE_ORIGIN_LABELS[perfil.origen]} ·{' '}
              {perfil.tipo === 'ean' ? 'Códigos de barras' : 'Stock'}
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-[4px]">
            {isMobile && (
              <button
                type="button"
                onClick={() => setSeleccion({ tipo: 'cliente', id: perfil.client_id })}
                className={`${BOTON.base} ${BOTON.secundario}`}
              >
                Volver
              </button>
            )}
            {(['config', 'simulacro', 'ejecuciones'] as const)
              .filter((v) => v === 'config' || perfil.tipo === 'stock')
              .map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVista(v)}
                  aria-pressed={vista === v}
                  className={`${BOTON.chip} ${vista === v ? BOTON.chipEncendido : ''}`}
                >
                  {v === 'config' ? 'Configuración' : v === 'simulacro' ? 'Simulacro' : 'Ejecuciones'}
                </button>
              ))}
            <button
              type="button"
              onClick={() => borrar(perfil)}
              aria-label={`Borrar el perfil ${perfil.name}`}
              title="Borrar este perfil"
              className={BOTON.icono}
            >
              <Trash2 className="h-[13px] w-[13px]" />
            </button>
          </div>
        </div>

        {/* Accionable HOY: se queda en pantalla, no detrás del botón de info */}
        {perfil.last_error && (
          <Aviso tono="rojo" icono={AlertTriangle}>
            <span className="font-semibold text-[var(--ls-t1)]">La última ejecución falló:</span>{' '}
            <span className="whitespace-pre-line">{perfil.last_error}</span>
          </Aviso>
        )}

        {/* También accionable: este perfil está configurado y no se va a leer */}
        {marcado && (
          <Aviso tono="ambar" icono={Ban}>
            <span className="font-semibold text-[var(--ls-t1)]">
              A {suCliente?.name ?? 'este cliente'} no se le sincroniza el stock.
            </span>{' '}
            Este perfil se guarda pero no se procesa.
          </Aviso>
        )}

        {vista === 'config' || perfil.tipo === 'ean' ? (
          <PerfilConfig
            // Cambiar de perfil remonta el formulario entero: los inputs no
            // controlados conservarían los valores del anterior.
            key={perfil.id}
            perfil={perfil}
            data={data}
            onPatch={(cambios) => patch(perfil.id, cambios)}
            guardando={guardando}
          />
        ) : vista === 'ejecuciones' ? (
          <EjecucionesPanel key={perfil.id} perfil={perfil} />
        ) : (
          <SimulacroPanel key={perfil.id} perfil={perfil} />
        )}
      </div>
    )
  } else if (cliente) {
    detalle = (
      <FichaCliente
        cliente={cliente}
        estado={estados.get(cliente.id) ?? 'pendiente'}
        perfiles={perfilesPorCliente.get(cliente.id) ?? []}
        quienDecidio={
          cliente.no_sincroniza_por ? data.decididoPor[cliente.no_sincroniza_por] ?? null : null
        }
        faltaMigracion={data.faltaMigracionNoSincroniza}
        guardando={guardando}
        onVolver={isMobile ? () => setSeleccion(null) : null}
        onNuevoPerfil={() => setCreando({ clienteId: cliente.id })}
        onAbrirPerfil={(id) => {
          setSeleccion({ tipo: 'perfil', id })
          setVista('config')
        }}
        onMarcar={() => setDecidiendo(cliente)}
        onDesmarcar={() => decidir(cliente.id, false, null)}
      />
    )
  } else {
    detalle = (
      <div
        className={`flex h-full min-h-[180px] items-center justify-center px-6 py-10 text-center border ${LINEA.normal} ${RADIO.r2} ${SUPERFICIE.sup}`}
      >
        <p className={`${TIPO.s} ${TEXTO.t3}`}>Elige un cliente.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {isMobile ? (
        <div className="min-h-0 flex-1 overflow-auto">{seleccion ? detalle : lista}</div>
      ) : (
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[268px_1fr] items-start gap-2">
          <div className="flex h-full min-h-0 flex-col">{lista}</div>
          <div className="h-full min-h-0 min-w-0 overflow-auto pr-px">{detalle}</div>
        </div>
      )}

      {creando && (
        <NuevoPerfil
          data={data}
          clienteInicial={creando.clienteId}
          onClose={() => setCreando(null)}
          onDone={(nueva, id) => {
            setData(nueva)
            setSeleccion({ tipo: 'perfil', id })
            setVista('config')
            setCreando(null)
          }}
        />
      )}

      {decidiendo && (
        <DialogoNoSincroniza
          cliente={decidiendo}
          perfiles={perfilesPorCliente.get(decidiendo.id) ?? []}
          guardando={guardando}
          onCerrar={() => setDecidiendo(null)}
          onConfirmar={(motivo) => decidir(decidiendo.id, true, motivo)}
        />
      )}

      {/* El mismo diálogo para un cliente que todavía no está en el sincronismo.
          Su fila se crea al confirmar: obligar a darlo de alta antes para poder
          decir que NO sincroniza sería pedir justo lo contrario de lo decidido. */}
      {decidiendoSinAlta && (
        <DialogoNoSincroniza
          cliente={decidiendoSinAlta}
          perfiles={[]}
          guardando={guardando}
          onCerrar={() => setDecidiendoSinAlta(null)}
          onConfirmar={(motivo) => decidirSinAlta(decidiendoSinAlta.slug, true, motivo)}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La lista: un cliente y sus perfiles                                 */
/* ------------------------------------------------------------------ */

function GrupoCliente({
  cliente,
  estado,
  perfiles,
  ultimoRun,
  sinEan,
  clienteActivo,
  perfilActivo,
  onElegirCliente,
  onElegirPerfil,
}: {
  cliente: StockClient
  estado: EstadoSincronizacion
  perfiles: StockReadProfile[]
  ultimoRun: Map<string, StockProfileRun>
  /** Este cliente no tiene perfil de códigos de barras activo */
  sinEan: boolean
  clienteActivo: boolean
  perfilActivo: string | null
  onElegirCliente: () => void
  onElegirPerfil: (id: string) => void
}) {
  const Icono = ICONO_ESTADO[estado]

  return (
    <div
      className={`min-w-0 border ${RADIO.r2} ${
        clienteActivo
          ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-sel)]'
          : `${LINEA.normal} ${SUPERFICIE.sup}`
      }`}
    >
      <button
        type="button"
        onClick={onElegirCliente}
        aria-pressed={clienteActivo}
        className="flex w-full min-w-0 items-center gap-[6px] px-2 py-[6px] text-left"
      >
        <Icono className={ESTADO.icono} style={{ color: COLOR_ESTADO[TONO_ESTADO[estado]] }} />
        <span className={`${TIPO.m} ${TEXTO.t1} min-w-0 flex-1 truncate font-medium`}>
          {cliente.name}
        </span>
        <span className={`${TIPO.xs} ${TEXTO.t4} shrink-0`}>
          {ESTADO_SINCRONIZACION_LABELS[estado]}
        </span>
      </button>

      {perfiles.length > 0 && (
        <div className={`border-t ${LINEA.normal} px-1 py-1 space-y-px`}>
          {perfiles.map((p) => {
            const ultimo = ultimoRun.get(p.id)
            const activo = p.id === perfilActivo
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onElegirPerfil(p.id)}
                aria-pressed={activo}
                className={`block w-full min-w-0 ${RADIO.r1} px-[6px] py-[3px] text-left ${
                  activo ? SUPERFICIE.sup3 : 'hover:bg-[var(--ls-sup2)]'
                } ${p.is_active ? '' : 'opacity-55'}`}
              >
                <span className="flex min-w-0 items-center gap-[5px]">
                  <span
                    className={`${TIPO.s} min-w-0 flex-1 truncate ${activo ? TEXTO.t1 : TEXTO.t2}`}
                  >
                    {p.name}
                  </span>
                  {p.envio_automatico && (
                    <span
                      className={`${TIPO.xs} shrink-0`}
                      style={{ color: COLOR_ESTADO.ambar }}
                      title="Envío automático encendido"
                    >
                      auto
                    </span>
                  )}
                </span>

                {/* El orden de las tres condiciones es su prioridad y no es
                    indiferente: un freno tapa al «todo bien», porque un freno
                    significa que el stock de ese cliente lleva sin actualizarse
                    desde entonces. */}
                <span className={`${TIPO.xs} block truncate font-normal ${TEXTO.t4}`}>
                  {p.last_error ? (
                    <span style={{ color: COLOR_ESTADO.rojo }}>Última ejecución con error</span>
                  ) : ultimo?.estado === 'frenado' ? (
                    <span style={{ color: COLOR_ESTADO.ambar }}>
                      Frenado:{' '}
                      {ultimo.freno ? STOCK_BRAKE_LABELS[ultimo.freno].toLowerCase() : 'sin detalle'}
                    </span>
                  ) : p.tipo === 'ean' ? (
                    'Códigos de barras'
                  ) : (
                    formatWhen(p.last_run_at)
                  )}
                </span>
              </button>
            )
          })}

          {sinEan && perfiles.some((p) => p.tipo === 'stock') && (
            <p className={`${TIPO.xs} truncate px-[6px] pt-px font-normal ${TEXTO.t4}`}>
              sin fichero de códigos de barras
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La ficha de un cliente                                              */
/* ------------------------------------------------------------------ */

/**
 * DONDE SE DICE SI ESTE CLIENTE SINCRONIZA O NO.
 *
 * Los dos botones son un interruptor de dos posiciones y las dos están siempre
 * a la vista, encendida la que rige. Un único botón de «marcar» dejaría la
 * situación normal sin nombre en pantalla, y sin nombre no se distingue de «no
 * lo he mirado» — que es exactamente el problema del que viene todo esto.
 */
function FichaCliente({
  cliente,
  estado,
  perfiles,
  quienDecidio,
  faltaMigracion,
  guardando,
  onVolver,
  onNuevoPerfil,
  onAbrirPerfil,
  onMarcar,
  onDesmarcar,
}: {
  cliente: StockClient
  estado: EstadoSincronizacion
  perfiles: StockReadProfile[]
  /** El nombre de quien lo decidió; null si ya no está en el ERP */
  quienDecidio: string | null
  /** Falta lanzar la 127: se puede ver el estado pero no cambiarlo */
  faltaMigracion: boolean
  guardando: boolean
  onVolver: (() => void) | null
  onNuevoPerfil: () => void
  onAbrirPerfil: (id: string) => void
  onMarcar: () => void
  onDesmarcar: () => void
}) {
  const marcado = Boolean(cliente.no_sincroniza_desde)
  const Icono = ICONO_ESTADO[estado]

  return (
    <div className="min-w-0 space-y-2">
      <section className={TARJETA.base}>
        <header className={TARJETA.cabecera}>
          <Icono className={ESTADO.icono} style={{ color: COLOR_ESTADO[TONO_ESTADO[estado]] }} />
          <h2 className={`${TITULO.seccion} truncate`}>{cliente.name}</h2>
          {onVolver && (
            <button
              type="button"
              onClick={onVolver}
              className={`${BOTON.base} ${BOTON.secundario} ml-auto`}
            >
              Volver
            </button>
          )}
        </header>

        <div className={`${TARJETA.cuerpo} space-y-[9px]`}>
          <div className={CAMPO.contenedor}>
            <span className={CAMPO.etiqueta}>Sincronización de stock</span>
            <div className={PANTALLA.fila}>
              <button
                type="button"
                onClick={onDesmarcar}
                disabled={guardando || !marcado}
                aria-pressed={!marcado}
                className={`${BOTON.chip} ${!marcado ? BOTON.chipEncendido : ''}`}
              >
                <CheckCircle2 className="h-[13px] w-[13px]" />
                Sí, se le sincroniza
              </button>
              <button
                type="button"
                onClick={onMarcar}
                disabled={guardando || marcado || faltaMigracion}
                aria-pressed={marcado}
                className={`${BOTON.chip} ${marcado ? BOTON.chipEncendido : ''}`}
              >
                <Ban className="h-[13px] w-[13px]" />
                No hace falta
              </button>
              {guardando && <Loader2 className={`h-3 w-3 animate-spin ${TEXTO.t4}`} />}
            </div>

            {marcado && (
              <p className={CAMPO.nota}>
                Decidido el {fechaHora(cliente.no_sincroniza_desde)}
                {quienDecidio
                  ? ` por ${quienDecidio}`
                  : cliente.no_sincroniza_por
                    ? ' por alguien que ya no está en el ERP'
                    : ''}
                {cliente.no_sincroniza_motivo ? ` · ${cliente.no_sincroniza_motivo}` : ''}
              </p>
            )}

            {estado === 'pendiente' && (
              <p className={CAMPO.nota}>
                Sin perfil y sin decisión: no se sabe si falta configurarlo o no hace falta.
              </p>
            )}
          </div>

          {/* Accionable HOY, y por eso está en pantalla y no detrás del botón de
              información: sin la migración el estado se ve pero no se cambia. */}
          {faltaMigracion && (
            <Aviso tono="ambar" icono={AlertTriangle}>
              <span className="font-semibold text-[var(--ls-t1)]">
                Falta lanzar 127_origenes_no_sincroniza.sql
              </span>{' '}
              en el editor SQL de Supabase. Hasta entonces no hay dónde apuntar la decisión.
            </Aviso>
          )}
        </div>
      </section>

      <section className={TARJETA.base}>
        <header className={TARJETA.cabecera}>
          <h2 className={TITULO.seccion}>
            Perfiles de lectura{perfiles.length > 0 ? ` (${perfiles.length})` : ''}
          </h2>
          <button
            type="button"
            onClick={onNuevoPerfil}
            className={`${BOTON.base} ${BOTON.primario} ml-auto`}
          >
            <Plus className="h-[13px] w-[13px]" />
            Nuevo perfil
          </button>
        </header>

        <div className={TARJETA.cuerpo}>
          {perfiles.length === 0 ? (
            <p className={`${TIPO.s} ${TEXTO.t3}`}>
              Ninguno todavía. Un perfil dice de dónde sale su fichero y cómo se lee.
            </p>
          ) : (
            <ul className="space-y-px">
              {perfiles.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onAbrirPerfil(p.id)}
                    className={`flex w-full min-w-0 items-center gap-2 ${RADIO.r1} px-[5px] py-[3px] text-left hover:bg-[var(--ls-sup2)] ${
                      p.is_active ? '' : 'opacity-55'
                    }`}
                  >
                    <span className={`${TIPO.m} ${TEXTO.t2} min-w-0 flex-1 truncate`}>{p.name}</span>
                    <span className={`${TIPO.xs} ${TEXTO.t4} shrink-0 font-normal`}>
                      {STOCK_PROFILE_ORIGIN_LABELS[p.origen]}
                      {p.tipo === 'ean' ? ' · EAN' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Marcar «no sincroniza»                                              */
/* ------------------------------------------------------------------ */

/**
 * Se pregunta el motivo, y se pregunta ANTES de guardar.
 *
 * No es una confirmación de cortesía: sin el porqué escrito, dentro de seis
 * meses la decisión es indistinguible de un olvido y alguien la deshace «por si
 * acaso». Es opcional de todas formas —obligarlo lleva a que se rellene con un
 * punto— pero se pide con el campo delante y no escondido en una ficha.
 */
function DialogoNoSincroniza({
  cliente,
  perfiles,
  guardando,
  onCerrar,
  onConfirmar,
}: {
  // Solo el nombre: este diálogo vale igual para un cliente ya dado de alta en
  // el sincronismo y para uno que solo está en Amazon —que no tiene id de
  // sincronismo todavía—. Lo que cambia es a qué ruta va el «Anotarlo», y eso
  // lo decide quien lo abre, no el diálogo.
  cliente: { name: string }
  perfiles: StockReadProfile[]
  guardando: boolean
  onCerrar: () => void
  onConfirmar: (motivo: string | null) => void
}) {
  const [motivo, setMotivo] = useState('')
  const configurados = perfiles.filter((p) => p.is_active).length

  return (
    <Dialogo
      titulo={`${cliente.name} no sincroniza stock`}
      onCerrar={onCerrar}
      pie={
        <>
          <button type="button" onClick={onCerrar} className={`${BOTON.base} ${BOTON.secundario}`}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirmar(motivo.trim() || null)}
            disabled={guardando}
            className={`${BOTON.base} ${BOTON.primario}`}
          >
            {guardando && <Loader2 className="h-3 w-3 animate-spin" />}
            Anotarlo
          </button>
        </>
      }
    >
      <div className={CAMPO.contenedor}>
        <label className={CAMPO.etiqueta} htmlFor="motivo-no-sincroniza">
          Por qué
        </label>
        <input
          id="motivo-no-sincroniza"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Lleva el stock a mano desde Seller Central"
          autoFocus
          maxLength={300}
          className={CAMPO.input}
        />
      </div>

      {/* La consecuencia concreta de pulsar, no una explicación general */}
      {configurados > 0 && (
        <Aviso tono="ambar" icono={AlertTriangle}>
          {configurados === 1
            ? 'Su perfil se conserva y deja de procesarse.'
            : `Sus ${configurados} perfiles se conservan y dejan de procesarse.`}
        </Aviso>
      )}
    </Dialogo>
  )
}

/* ------------------------------------------------------------------ */
/* Nuevo perfil                                                        */
/* ------------------------------------------------------------------ */

function NuevoPerfil({
  data,
  clienteInicial,
  onClose,
  onDone,
}: {
  data: PerfilesVista
  /** El cliente desde cuya ficha se ha abierto */
  clienteInicial?: string | null
  onClose: () => void
  onDone: (nueva: PerfilesVista, id: string) => void
}) {
  const [clientId, setClientId] = useState(clienteInicial ?? data.clientes[0]?.id ?? '')
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState<'stock' | 'ean'>('stock')
  const [enviando, setEnviando] = useState(false)

  async function crear() {
    if (!clientId) {
      toast.error('Elige el cliente')
      return
    }
    if (!nombre.trim()) {
      toast.error('Ponle un nombre al perfil')
      return
    }

    setEnviando(true)
    const res = await postAmazon<PerfilesVista & { creado: string }>('/api/amazon/perfiles', {
      clientId,
      nombre: nombre.trim(),
      tipo,
    })
    setEnviando(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(`Perfil «${nombre.trim()}» creado`)
    onDone(res.data, res.data.creado)
  }

  return (
    <Dialogo
      titulo="Nuevo perfil de lectura"
      onCerrar={onClose}
      pie={
        data.clientes.length > 0 ? (
          <>
            <button type="button" onClick={onClose} className={`${BOTON.base} ${BOTON.secundario}`}>
              Cancelar
            </button>
            <button
              type="button"
              onClick={crear}
              disabled={enviando}
              className={`${BOTON.base} ${BOTON.primario}`}
            >
              {enviando && <Loader2 className="h-3 w-3 animate-spin" />}
              Crear
            </button>
          </>
        ) : undefined
      }
    >
      {data.clientes.length === 0 ? (
        <Aviso tono="ambar" icono={AlertTriangle}>
          No hay ningún cliente en la sincronización de stock. Créalo antes allí: el perfil de
          lectura cuelga del cliente.
        </Aviso>
      ) : (
        <div className={CAMPO.rejilla}>
          <div className={CAMPO.contenedor}>
            <label className={CAMPO.etiqueta} htmlFor="perfil-cliente">
              Cliente
            </label>
            <select
              id="perfil-cliente"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className={CAMPO.input}
            >
              {data.clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className={CAMPO.contenedor}>
            <label className={CAMPO.etiqueta} htmlFor="perfil-nombre">
              Nombre
            </label>
            <input
              id="perfil-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Volcado diario de stock"
              autoFocus
              className={CAMPO.input}
            />
          </div>

          <div className={CAMPO.contenedor}>
            <span className={CAMPO.etiqueta}>Qué trae el fichero</span>
            <div className="flex gap-[4px]">
              {(['stock', 'ean'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipo(t)}
                  aria-pressed={tipo === t}
                  className={`${BOTON.chip} flex-1 justify-center ${tipo === t ? BOTON.chipEncendido : ''}`}
                >
                  {t === 'stock' ? 'Stock (y precio)' : 'Códigos de barras'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Dialogo>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Falta la migración de los perfiles.
 *
 * Se queda en pantalla y con los nombres de fichero completos: es lo más
 * accionable que hay en todo el módulo —dos ficheros que pegar en un editor— y
 * esconderlo detrás del botón de información sería no darlo.
 */
function MigracionPendiente() {
  return (
    <div className={`${TARJETA.base} max-w-[560px]`}>
      <header className={TARJETA.cabecera}>
        <h2 className={TITULO.seccion}>Falta lanzar la migración de los perfiles</h2>
      </header>
      <div className={`${TARJETA.cuerpo} space-y-[7px]`}>
        <p className={`${TIPO.s} ${TEXTO.t3}`}>
          Pega estos dos ficheros de <code>supabase/migrations/</code> en el editor SQL de Supabase,
          en orden:
        </p>
        <ul className={`${TIPO.m} ${TEXTO.t1} space-y-px`}>
          <li>120_stock_profiles.sql</li>
          <li>121_stock_ciclo.sql</li>
        </ul>
        <p className={`${TIPO.s} ${TEXTO.t4}`}>
          Los dos son idempotentes. El resto del módulo funciona con normalidad mientras tanto.
        </p>
      </div>
    </div>
  )
}

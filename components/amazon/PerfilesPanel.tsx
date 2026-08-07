'use client'

import { useState } from 'react'
import { FileCog, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  deleteAmazon,
  patchAmazon,
  postAmazon,
  type PerfilesVista,
} from '@/lib/amazon/client'
import { useIsMobile } from '@/lib/use-is-mobile'
import {
  STOCK_BRAKE_LABELS,
  STOCK_PROFILE_ORIGIN_LABELS,
  type StockProfileRun,
  type StockReadProfile,
} from '@/lib/types/stock-sync'
import { Dialogo } from './Dialogo'
import { EjecucionesPanel } from './EjecucionesPanel'
import { PerfilConfig } from './PerfilConfig'
import { SimulacroPanel } from './SimulacroPanel'
import {
  cardShell,
  dangerButton,
  fieldInput,
  formatWhen,
  ghostButton,
  infoBox,
  primaryButton,
  warnBox,
} from './shared'

/**
 * LA AUTOMATIZACIÓN: la lista de perfiles y lo que se hace con uno.
 *
 * Un perfil = un fichero de un cliente y cómo se interpreta. Es la única pieza
 * del proceso que cambia de un cliente a otro; el cruce, los frenos y el envío
 * son comunes y no saben de clientes.
 *
 * Dos pestañas por perfil, y el orden no es casual: primero se configura y
 * luego se simula. La de simulacro es la que se acaba usando todos los días.
 */
export function PerfilesPanel({ initialData }: { initialData: PerfilesVista }) {
  const [data, setData] = useState<PerfilesVista>(initialData)
  const [perfilId, setPerfilId] = useState<string | null>(null)
  const [vista, setVista] = useState<'config' | 'simulacro' | 'ejecuciones'>('config')
  const [creando, setCreando] = useState(false)
  /** Cliente preelegido al abrir el diálogo desde «Clientes sin perfil» */
  const [clienteNuevo, setClienteNuevo] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  // 768 y no el 1023 por defecto: por debajo de ahí es donde un formulario de
  // dos columnas y una tabla de nueve dejan de caber de verdad.
  const isMobile = useIsMobile('(max-width: 767px)')

  const perfil = data.perfiles.find((p) => p.id === perfilId) ?? null
  const clientesPorId = new Map(data.clientes.map((c) => [c.id, c]))

  /**
   * A QUIÉN LE FALTA PERFIL, Y A QUIÉN LE FALTA EL DE CÓDIGOS DE BARRAS.
   *
   * Los dos huecos se ven igual de mal desde la lista de perfiles —que enumera
   * lo que HAY— y los dos duelen: sin perfil de stock ese cliente no entra en
   * la automatización, y sin perfil de EAN el cruce pierde la vía por código de
   * barras entera, que con los datos reales resuelve 245 de 395 referencias.
   */
  const clientesConPerfil = new Set(data.perfiles.map((p) => p.client_id))
  const clientesConEan = new Set(
    data.perfiles.filter((p) => p.tipo === 'ean' && p.is_active).map((p) => p.client_id)
  )
  const clientesSinPerfil = data.clientes.filter((c) => !clientesConPerfil.has(c.id))

  /**
   * La última ejecución de cada perfil.
   *
   * `data.runs` llega ordenada de la más reciente a la más antigua, así que la
   * PRIMERA que se ve de cada perfil es la última que hubo. Sirve para que un
   * freno se vea en la lista sin tener que entrar perfil por perfil: un freno
   * que solo se ve entrando a mirar no cumple su función.
   */
  const ultimoRun = new Map<string, (typeof data.runs)[number]>()
  for (const run of data.runs) {
    if (!ultimoRun.has(run.profile_id)) ultimoRun.set(run.profile_id, run)
  }

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
    setPerfilId(null)
    toast.success(`Perfil «${p.name}» borrado`)
  }

  if (data.missingTables) return <MigracionPendiente />

  const lista = (
    <div className="space-y-2 min-w-0">
      <button type="button" onClick={() => setCreando(true)} className={`${primaryButton} w-full`}>
        <Plus className="h-3.5 w-3.5" />
        Nuevo perfil
      </button>

      {data.perfiles.length === 0 ? (
        <div className={`${cardShell} p-5 text-center`}>
          <FileCog className="h-5 w-5 text-white/20 mx-auto mb-2" />
          <p className="text-[12px] text-white/45">Todavía no hay ningún perfil de lectura.</p>
          <p className="text-[11px] text-white/30 mt-1 leading-relaxed">
            Un perfil dice de dónde sale el fichero de un cliente y cómo se interpreta. El resto
            del proceso —cruce, frenos y envío— es común.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {data.perfiles.map((p) => (
            <BotonPerfil
              key={p.id}
              perfil={p}
              cliente={clientesPorId.get(p.client_id)?.name ?? 'Cliente desconocido'}
              ultimo={ultimoRun.get(p.id) ?? null}
              sinPerfilEan={p.tipo === 'stock' && !clientesConEan.has(p.client_id)}
              selected={p.id === perfilId}
              onSelect={() => {
                setPerfilId(p.id)
                setVista('config')
              }}
            />
          ))}
        </div>
      )}

      {/*
        A QUIÉN LE FALTA. La lista de arriba enumera PERFILES, y la pregunta de
        todos los días mientras se dan de alta clientes es la contraria: ¿a cuál
        no se lo he hecho todavía? Sin esto solo se contesta comparando de
        memoria esta lista con la del módulo de Sincronismo de stock.
      */}
      {clientesSinPerfil.length > 0 && (
        <div className={`${cardShell} p-2.5`}>
          <p className="text-[11px] font-semibold text-white/70 mb-1.5">
            Clientes sin perfil ({clientesSinPerfil.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {clientesSinPerfil.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setClienteNuevo(c.id)
                  setCreando(true)
                }}
                className="px-2 py-1 rounded-lg text-[11px] border border-white/10 bg-white/[0.02] text-white/55 hover:text-white hover:border-[#FF6600]/40 transition-colors"
              >
                <Plus className="h-3 w-3 inline-block mr-1 -mt-px" />
                {c.name}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-white/30 mt-1.5 leading-relaxed">
            Estos clientes tienen mapeo en Sincronismo de stock pero nadie ha dicho todavía de dónde
            sale su fichero ni cómo se lee.
          </p>
        </div>
      )}
    </div>
  )

  const detalle = perfil ? (
    <div className="space-y-3 min-w-0">
      <div className={`${cardShell} p-2.5 flex flex-wrap items-center justify-between gap-2`}>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-white truncate">{perfil.name}</p>
          <p className="text-[10px] text-white/35 truncate">
            {clientesPorId.get(perfil.client_id)?.name ?? '—'} ·{' '}
            {STOCK_PROFILE_ORIGIN_LABELS[perfil.origen]} ·{' '}
            {perfil.tipo === 'ean' ? 'Códigos de barras' : 'Stock'}
          </p>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {isMobile && (
            <button type="button" onClick={() => setPerfilId(null)} className={ghostButton}>
              Volver
            </button>
          )}
          <button
            type="button"
            onClick={() => setVista('config')}
            aria-pressed={vista === 'config'}
            className={vista === 'config' ? primaryButton : ghostButton}
          >
            Configuración
          </button>
          {perfil.tipo === 'stock' && (
            <>
              <button
                type="button"
                onClick={() => setVista('simulacro')}
                aria-pressed={vista === 'simulacro'}
                className={vista === 'simulacro' ? primaryButton : ghostButton}
              >
                Simulacro
              </button>
              <button
                type="button"
                onClick={() => setVista('ejecuciones')}
                aria-pressed={vista === 'ejecuciones'}
                className={vista === 'ejecuciones' ? primaryButton : ghostButton}
              >
                Ejecuciones
              </button>
            </>
          )}
          <button type="button" onClick={() => borrar(perfil)} className={dangerButton}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {perfil.last_error && (
        <div className={warnBox}>
          <strong>La última ejecución falló:</strong> {perfil.last_error}
        </div>
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
  ) : (
    <div className={`${cardShell} flex-1 min-h-0 flex items-center justify-center px-6 py-10 text-center`}>
      <p className="text-[13px] text-white/35 max-w-[380px] leading-relaxed">
        Elige un perfil para configurarlo o para lanzar un simulacro. Un simulacro lee el fichero
        del cliente y enseña exactamente lo que se mandaría a Amazon,{' '}
        <strong className="text-white/55">sin mandarlo</strong>.
      </p>
    </div>
  )

  return (
    <div className="min-w-0">
      {isMobile ? (
        perfilId ? (
          detalle
        ) : (
          lista
        )
      ) : (
        <div className="grid grid-cols-[280px_1fr] gap-3 min-w-0 items-start">
          {lista}
          <div className="min-w-0">{detalle}</div>
        </div>
      )}

      {creando && (
        <NuevoPerfil
          data={data}
          clienteInicial={clienteNuevo}
          onClose={() => {
            setCreando(false)
            setClienteNuevo(null)
          }}
          onDone={(nueva, id) => {
            setData(nueva)
            setPerfilId(id)
            setVista('config')
            setCreando(false)
            setClienteNuevo(null)
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function BotonPerfil({
  perfil,
  cliente,
  ultimo,
  sinPerfilEan,
  selected,
  onSelect,
}: {
  perfil: StockReadProfile
  cliente: string
  /** La última ejecución de este perfil, si hay alguna en la vista */
  ultimo: StockProfileRun | null
  /**
   * Este cliente no tiene perfil de códigos de barras activo.
   *
   * Se distingue en la lista porque no se nota de ninguna otra forma y no es un
   * detalle: sin ese fichero el cruce pierde la vía por EAN del ERP entera, que
   * con los datos reales resuelve 245 de 395 referencias. Las que resolvía por
   * ahí pasan a resolverse quitando ceros a la izquierda, que es la heurística.
   */
  sinPerfilEan: boolean
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full text-left rounded-xl border px-2.5 py-2 transition-colors min-w-0 ${
        selected
          ? 'border-[#FF6600]/50 bg-[#FF6600]/[0.08]'
          : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/20'
      } ${perfil.is_active ? '' : 'opacity-50'}`}
    >
      <span className="flex items-center justify-between gap-2 min-w-0">
        <span
          className={`text-[12px] font-semibold truncate ${selected ? 'text-white' : 'text-white/80'}`}
        >
          {perfil.name}
        </span>
        {perfil.envio_automatico ? (
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border border-yellow-500/30 bg-yellow-400/[0.08] text-yellow-300 whitespace-nowrap flex-shrink-0">
            AUTO
          </span>
        ) : (
          <span className="text-[9px] text-white/30 whitespace-nowrap flex-shrink-0">
            simulacro
          </span>
        )}
      </span>

      {sinPerfilEan && (
        <span className="block text-[10px] text-yellow-300/80 truncate mt-0.5">
          sin fichero de códigos de barras
        </span>
      )}

      <span className="block text-[10px] text-white/40 truncate mt-0.5">
        {cliente} · {STOCK_PROFILE_ORIGIN_LABELS[perfil.origen]}
        {perfil.tipo === 'ean' && ' · EAN'}
      </span>

      {/* El orden de las tres condiciones es su prioridad, y no es indiferente:
          un freno tapa al «todo bien», porque un freno significa que el stock de
          ese cliente lleva sin actualizarse desde entonces. */}
      <span className="block text-[10px] truncate mt-px">
        {perfil.last_error ? (
          <span className="text-red-300">Última ejecución con error</span>
        ) : ultimo?.estado === 'frenado' ? (
          <span className="text-yellow-300">
            Frenado: {ultimo.freno ? STOCK_BRAKE_LABELS[ultimo.freno].toLowerCase() : 'sin detalle'}
          </span>
        ) : (
          <span className="text-white/30">Última lectura: {formatWhen(perfil.last_run_at)}</span>
        )}
      </span>
    </button>
  )
}

/* ------------------------------------------------------------------ */

function NuevoPerfil({
  data,
  clienteInicial,
  onClose,
  onDone,
}: {
  data: PerfilesVista
  /** Cuando se abre desde «Clientes sin perfil», ese cliente ya viene elegido */
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
      title="Nuevo perfil de lectura"
      subtitle="Un fichero de un cliente y cómo se interpreta"
      onClose={onClose}
    >
      <div className="space-y-3">
        {data.clientes.length === 0 ? (
          <div className={warnBox}>
            No hay ningún cliente en la sincronización de stock. Créalo antes en el módulo
            «Sincronismo de stock»: el perfil de lectura cuelga del cliente, no al revés.
          </div>
        ) : (
          <>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-white/35 mb-1">
                Cliente
              </label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className={`${fieldInput} [color-scheme:dark]`}
              >
                {data.clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-white/35 mb-1">
                Nombre
              </label>
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Volcado diario de stock"
                autoFocus
                className={fieldInput}
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-white/35 mb-1">
                Qué trae el fichero
              </label>
              <div className="flex gap-1.5">
                {(['stock', 'ean'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTipo(t)}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                      tipo === t
                        ? 'border-[#FF6600]/50 bg-[#FF6600]/[0.1] text-white'
                        : 'border-white/10 bg-white/[0.02] text-white/45 hover:text-white hover:border-white/20'
                    }`}
                  >
                    {t === 'stock' ? 'Stock (y precio)' : 'Códigos de barras'}
                  </button>
                ))}
              </div>
            </div>

            <div className={infoBox}>
              Se crea con unos nombres de columna de partida y con los frenos ya puestos, para que
              se pueda probar desde el primer momento. El envío automático nace apagado.
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className={ghostButton}>
                Cancelar
              </button>
              <button type="button" onClick={crear} disabled={enviando} className={primaryButton}>
                {enviando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Crear
              </button>
            </div>
          </>
        )}
      </div>
    </Dialogo>
  )
}

/* ------------------------------------------------------------------ */

function MigracionPendiente() {
  return (
    <div className={`${cardShell} p-5 max-w-2xl`}>
      <h3 className="text-[13px] font-semibold text-white mb-1">
        Falta lanzar la migración de los perfiles
      </h3>
      <p className="text-[12px] text-white/50 mb-3 leading-relaxed">
        La automatización está desplegada pero sus tablas todavía no existen en la base de datos.
      </p>
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-400/[0.09] p-4">
        <p className="text-[12px] text-white/75 mb-2">
          Abre el editor SQL de Supabase y pega estos dos ficheros de{' '}
          <code className="text-white/55">supabase/migrations/</code>, en orden:
        </p>
        <code className="block text-[12px] text-yellow-200">120_stock_profiles.sql</code>
        <code className="block text-[12px] text-yellow-200">121_stock_ciclo.sql</code>
        <p className="text-[11px] text-white/45 mt-2 leading-relaxed">
          Cada uno se ejecuta entero en una transacción: si algo falla, no se queda a medias. Los
          dos son idempotentes, así que se pueden lanzar aunque ya estuvieran aplicados. La 121 es
          la que añade el cerrojo del ciclo automático; sin ella el módulo se ve pero no procesa
          nada solo. El resto del módulo de Amazon y el sincronismo de stock funcionan con
          normalidad mientras tanto.
        </p>
      </div>
    </div>
  )
}

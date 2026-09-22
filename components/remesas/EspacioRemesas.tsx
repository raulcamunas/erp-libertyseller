'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Boxes,
  Package,
  Plus,
  Search,
  TrendingDown,
} from 'lucide-react'
import type { PanelRemesas, RemesaDePanel } from '@/lib/fba/datos'
import { NuevaRemesaDialog } from './NuevaRemesaDialog'
import { DetalleRemesa } from './DetalleRemesa'
import { VistaReferencias } from './VistaReferencias'
import { fecha } from './formato'

/**
 * EL ESPACIO DE REMESAS: DOS COLUMNAS.
 *
 * A la izquierda, la lista de envíos. A la derecha, el que esté elegido, con
 * todo lo que se sabe de él. Es la forma de trabajar a diario: recorrer la
 * lista sin perder de vista lo que se está mirando.
 *
 * La vista «por referencia» —la que dice cuándo se agota cada SKU— es otra
 * pregunta y va a pantalla completa, porque es una tabla ancha y partirla en
 * dos columnas la haría ilegible.
 *
 * No calcula nada: el reparto llega hecho del servidor.
 */

interface Cliente {
  id: string
  nombre: string
  puedeEditar: boolean
  remesas: number
}

const suave = { type: 'spring', stiffness: 380, damping: 32 } as const

export function EspacioRemesas({
  clientes,
  cliente,
  panel,
  esAdmin,
  remesaAbierta,
}: {
  clientes: Cliente[]
  cliente: Cliente
  panel: PanelRemesas
  esAdmin: boolean
  /** La remesa cuyas cajas ha traído el servidor. Viene de la URL */
  remesaAbierta: string | null
  nombreUsuario: string
}) {
  const router = useRouter()
  const [vista, setVista] = useState<'envios' | 'referencias'>('envios')
  const [seleccionada, setSeleccionada] = useState<string | null>(
    remesaAbierta ?? panel.remesas[0]?.id ?? null
  )
  const [busqueda, setBusqueda] = useState('')
  const [soloAbiertas, setSoloAbiertas] = useState(true)
  const [nueva, setNueva] = useState(false)
  const [cambiando, setCambiando] = useState<string | null>(null)

  /**
   * Cambiar de cliente recarga en el servidor —el reparto entero se calcula
   * allí—, así que hay un hueco de unas décimas. Se marca el botón pulsado para
   * que no parezca que no ha hecho nada y se pulse dos veces.
   */
  function irACliente(id: string) {
    if (id === cliente.id) return
    setCambiando(id)
    router.push(`/dashboard/remesas?cliente=${id}`)
  }

  // Al llegar los datos del cliente nuevo, se apaga la marca de carga
  useEffect(() => {
    setCambiando(null)
  }, [cliente.id])

  // Si cambia el cliente o desaparece la remesa elegida, se elige la primera.
  useEffect(() => {
    if (!panel.remesas.some((r) => r.id === seleccionada)) {
      setSeleccionada(panel.remesas[0]?.id ?? null)
    }
  }, [panel.remesas, seleccionada])

  const lista = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return panel.remesas
      .filter((r) => !soloAbiertas || r.quedan > 0)
      .filter(
        (r) =>
          !q ||
          (r.nombre ?? '').toLowerCase().includes(q) ||
          r.lineas.some((l) => l.sku.toLowerCase().includes(q) || (l.nombre ?? '').toLowerCase().includes(q))
      )
      .slice()
      .sort((a, b) => b.fechaEnvio.localeCompare(a.fechaEnvio))
  }, [panel.remesas, busqueda, soloAbiertas])

  const remesa = panel.remesas.find((r) => r.id === seleccionada) ?? null

  const totales = useMemo(() => {
    const enviadas = panel.remesas.reduce((s, r) => s + r.enviadas, 0)
    const quedan = panel.remesas.reduce((s, r) => s + r.quedan, 0)
    const urgentes = panel.skus.filter(
      (s) => s.diasDeCobertura !== null && s.diasDeCobertura <= 14 && s.quedan > 0
    ).length
    const descuadre = panel.skus.reduce((s, k) => s + (k.descuadre ?? 0), 0)
    return { enviadas, quedan, urgentes, descuadre }
  }, [panel])

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-0 flex-col">
      {/* ================= CABECERA ================= */}
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-white/[0.06] px-6 py-3">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-[#FF6600]" />
          <h1 className="text-[15px] font-semibold text-white">Remesas a FBA</h1>
        </div>

        <div className="ml-2 flex items-center gap-1 rounded-lg bg-white/[0.03] p-0.5">
          <Pestana activa={vista === 'envios'} onClick={() => setVista('envios')}>
            <Package className="h-3.5 w-3.5" />
            Envíos
          </Pestana>
          <Pestana activa={vista === 'referencias'} onClick={() => setVista('referencias')}>
            <TrendingDown className="h-3.5 w-3.5" />
            Referencias
          </Pestana>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {panel.leidoHasta && (
            <span className="hidden text-[10px] text-white/30 lg:inline">
              Movimientos hasta el {fecha(panel.leidoHasta)}
            </span>
          )}
          {cliente.puedeEditar && (
            <motion.button
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setNueva(true)}
              className="flex items-center gap-1.5 rounded-lg bg-[#FF6600] px-3 py-1.5 text-[12px] font-semibold text-white shadow-[0_0_20px_-6px_#FF6600]"
            >
              <Plus className="h-3.5 w-3.5" />
              Nueva remesa
            </motion.button>
          )}
        </div>
      </header>

      {/* ================= CLIENTES ================= */}
      {clientes.length > 1 && (
        <BarraClientes
          clientes={clientes}
          activo={cliente.id}
          cargando={cambiando}
          onElegir={irACliente}
        />
      )}

      {/* ================= CIFRAS ================= */}
      <div className="flex shrink-0 flex-wrap items-stretch gap-2 px-6 py-3">
        <Cifra etiqueta="Enviadas" valor={totales.enviadas} />
        <Cifra etiqueta="Vivas" valor={totales.quedan} tono="acento" />
        <Cifra
          etiqueta="Se agotan en 14 días"
          valor={totales.urgentes}
          tono={totales.urgentes > 0 ? 'alerta' : undefined}
        />
        {panel.conectado && (
          <Cifra
            etiqueta="Descuadre con Amazon"
            valor={totales.descuadre}
            tono={totales.descuadre !== 0 ? 'aviso' : undefined}
            signo
            pista="Lo que Amazon tiene menos lo que explican las remesas. Positivo = había stock de antes"
          />
        )}
        {!panel.conectado && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 text-[11px] text-amber-200/90">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Sin API de Amazon: las ventas no se descuentan solas
          </div>
        )}
        {panel.ultimoError && (
          <div className="flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-400/[0.06] px-3 text-[11px] text-red-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Última lectura fallida: {panel.ultimoError.slice(0, 80)}
          </div>
        )}
      </div>

      {/* ================= CUERPO ================= */}
      <AnimatePresence mode="wait">
        {vista === 'referencias' ? (
          <motion.div
            key="referencias"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="min-h-0 flex-1 overflow-auto px-6 pb-6"
          >
            <VistaReferencias skus={panel.skus} />
          </motion.div>
        ) : (
          <motion.div
            key="envios"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="grid min-h-0 flex-1 grid-cols-[360px_1fr] gap-4 px-6 pb-6"
          >
            {/* ---------- IZQUIERDA: la lista ---------- */}
            <aside className="flex min-h-0 flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
                  <input
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Buscar envío o SKU"
                    className="w-full rounded-lg border border-white/10 bg-white/[0.03] py-1.5 pl-8 pr-2 text-[12px] text-white placeholder:text-white/25 focus:border-[#FF6600]/40 focus:outline-none"
                  />
                </div>
                <label
                  className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-[10px] text-white/40"
                  title="Esconder los envíos que ya no tienen unidades"
                >
                  <input
                    type="checkbox"
                    checked={soloAbiertas}
                    onChange={(e) => setSoloAbiertas(e.target.checked)}
                    className="h-3 w-3 accent-[#FF6600]"
                  />
                  Solo vivas
                </label>
              </div>

              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
                {lista.length === 0 && (
                  <div className="glass-card p-6 text-center">
                    <p className="text-[12px] text-white/40">
                      {panel.remesas.length === 0
                        ? 'Todavía no hay ninguna remesa.'
                        : 'Nada que coincida. Prueba a quitar el filtro.'}
                    </p>
                    {panel.remesas.length === 0 && cliente.puedeEditar && (
                      <button
                        type="button"
                        onClick={() => setNueva(true)}
                        className="mt-3 text-[12px] font-semibold text-[#FF6600] hover:underline"
                      >
                        Crear la primera
                      </button>
                    )}
                  </div>
                )}
                {lista.map((r, i) => (
                  <TarjetaRemesa
                    key={r.id}
                    remesa={r}
                    activa={r.id === seleccionada}
                    indice={i}
                    onClick={() => {
                      setSeleccionada(r.id)
                      // A la URL: es lo que hace que el servidor traiga SUS
                      // cajas. Sin scroll para que la lista no salte.
                      router.replace(`/dashboard/remesas?cliente=${cliente.id}&remesa=${r.id}`, {
                        scroll: false,
                      })
                    }}
                  />
                ))}
              </div>
            </aside>

            {/* ---------- DERECHA: el detalle ---------- */}
            <section className="min-h-0 overflow-y-auto">
              <AnimatePresence mode="wait">
                {remesa ? (
                  <motion.div
                    key={remesa.id}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={suave}
                    className="h-full"
                  >
                    <DetalleRemesa
                      remesa={remesa}
                      skus={panel.skus}
                      puedeEditar={cliente.puedeEditar}
                      puedeBorrar={esAdmin}
                      conectado={panel.conectado}
                      esAdmin={esAdmin}
                      cajas={panel.cajasDe?.remesaId === remesa.id ? panel.cajasDe.datos : null}
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="vacio"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="glass-card flex h-full flex-col items-center justify-center gap-3 p-10 text-center"
                  >
                    <Boxes className="h-8 w-8 text-white/15" />
                    <p className="text-[12px] text-white/40">Elige un envío de la lista</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          </motion.div>
        )}
      </AnimatePresence>

      {nueva && (
        <NuevaRemesaDialog
          clienteId={cliente.id}
          clienteNombre={cliente.nombre}
          onClose={() => setNueva(false)}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La tarjeta de la lista                                              */
/* ------------------------------------------------------------------ */

function TarjetaRemesa({
  remesa,
  activa,
  indice,
  onClick,
}: {
  remesa: RemesaDePanel
  activa: boolean
  indice: number
  onClick: () => void
}) {
  const agotada = remesa.quedan === 0
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(indice * 0.025, 0.3), ...suave }}
      whileHover={{ x: 2 }}
      className={`group relative w-full rounded-xl border p-3 text-left transition-colors ${
        activa
          ? 'border-[#FF6600]/50 bg-[#FF6600]/[0.07]'
          : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]'
      }`}
    >
      {activa && (
        <motion.span
          layoutId="marca-activa"
          className="absolute -left-px top-3 bottom-3 w-[3px] rounded-full bg-[#FF6600]"
          transition={suave}
        />
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`truncate text-[13px] font-semibold ${agotada ? 'text-white/45' : 'text-white'}`}>
            {remesa.nombre ?? `Envío del ${fecha(remesa.fechaEnvio)}`}
          </p>
          <p className="mt-0.5 text-[10px] text-white/35">
            {fecha(remesa.fechaEnvio)} · {remesa.lineas.length} ref · {remesa.enviadas} ud
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-[15px] font-semibold leading-none ${agotada ? 'text-white/30' : 'text-white'}`}>
            {remesa.quedan}
          </p>
          <p className="mt-0.5 text-[8px] uppercase tracking-wider text-white/30">quedan</p>
        </div>
      </div>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, remesa.consumidoPct)}%` }}
          transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
          className={`h-full rounded-full ${
            remesa.consumidoPct >= 90 ? 'bg-red-400/70' : remesa.consumidoPct >= 60 ? 'bg-amber-400/70' : 'bg-[#FF6600]/70'
          }`}
        />
      </div>
      {remesa.llegadaAt && (
        <span className="mt-1.5 inline-block rounded bg-emerald-400/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-emerald-400">
          llegó el {fecha(remesa.llegadaAt)}
        </span>
      )}
    </motion.button>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

function Cifra({
  etiqueta,
  valor,
  tono,
  signo,
  pista,
}: {
  etiqueta: string
  valor: number
  tono?: 'acento' | 'alerta' | 'aviso'
  signo?: boolean
  pista?: string
}) {
  const color =
    tono === 'alerta'
      ? 'text-red-400'
      : tono === 'aviso'
        ? 'text-amber-400'
        : tono === 'acento'
          ? 'text-[#FF6600]'
          : 'text-white'
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card min-w-[110px] px-3 py-2"
      title={pista}
    >
      <p className={`text-[18px] font-semibold leading-none tabular-nums ${color}`}>
        {signo && valor > 0 ? '+' : ''}
        {valor}
      </p>
      <p className="mt-1 text-[9px] uppercase tracking-wide text-white/35">{etiqueta}</p>
    </motion.div>
  )
}

function Pestana({
  activa,
  onClick,
  children,
}: {
  activa: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-1.5 rounded-md px-3 py-1 text-[12px] font-medium transition-colors ${
        activa ? 'text-[#FF6600]' : 'text-white/45 hover:text-white/70'
      }`}
    >
      {activa && (
        <motion.span
          layoutId="pestana-activa"
          className="absolute inset-0 rounded-md bg-[#FF6600]/12"
          transition={suave}
        />
      )}
      <span className="relative flex items-center gap-1.5">{children}</span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* La barra de clientes                                                */
/* ------------------------------------------------------------------ */

/**
 * UN BOTÓN POR CLIENTE, EN HORIZONTAL.
 *
 * Con once cuentas un desplegable obliga a abrirlo para saber qué hay; en
 * horizontal se ven todas de un vistazo y se salta de una a otra con un clic,
 * que es como se trabaja cuando revisas varias seguidas.
 *
 * Cada botón lleva cuántas remesas tiene. Los que están a cero se pintan
 * apagados: siguen siendo clicables —hay que poder crearle la primera— pero se
 * distinguen sin tener que entrar a comprobarlo.
 *
 * La fila hace scroll horizontal ella sola. El activo se centra al montar, que
 * es lo que hace falta cuando entras por un enlace directo al undécimo cliente.
 */
function BarraClientes({
  clientes,
  activo,
  cargando,
  onElegir,
}: {
  clientes: Cliente[]
  activo: string
  /** El que se acaba de pulsar y todavía no ha llegado. null = ninguno */
  cargando: string | null
  onElegir: (id: string) => void
}) {
  const fila = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fila.current?.querySelector('[data-activo="true"]')?.scrollIntoView({
      block: 'nearest',
      inline: 'center',
      behavior: 'smooth',
    })
  }, [activo])

  return (
    <div
      ref={fila}
      className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-6 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {clientes.map((c) => {
        const esActivo = c.id === activo
        const esperando = c.id === cargando
        const vacio = c.remesas === 0
        return (
          <motion.button
            key={c.id}
            type="button"
            data-activo={esActivo}
            onClick={() => onElegir(c.id)}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            title={vacio ? `${c.nombre} · todavía sin remesas` : `${c.nombre} · ${c.remesas} remesas`}
            className={`relative flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
              esperando ? 'animate-pulse ' : ''
            }${
              esActivo
                ? 'border-[#FF6600]/50 text-white'
                : vacio
                  ? 'border-white/[0.06] text-white/30 hover:border-white/[0.12] hover:text-white/55'
                  : 'border-white/[0.08] text-white/65 hover:border-white/20 hover:text-white'
            }`}
          >
            {esActivo && (
              <motion.span
                layoutId="cliente-activo"
                className="absolute inset-0 rounded-full bg-[#FF6600]/12"
                transition={suave}
              />
            )}
            <span className="relative">{c.nombre}</span>
            <span
              className={`relative rounded-full px-1.5 text-[10px] tabular-nums ${
                esActivo ? 'bg-[#FF6600]/25 text-[#FF6600]' : 'bg-white/[0.06] text-white/40'
              }`}
            >
              {c.remesas}
            </span>
          </motion.button>
        )
      })}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Pin,
  AlertTriangle,
  Ban,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  Hand,
  Lock,
  MapPin,
  PackageCheck,
  Plug,
  Printer,
  RefreshCw,
  Copy,
  Rocket,
  RotateCcw,
  Route,
  Send,
  ShieldCheck,
  Tags,
  Truck,
  Unlock,
  UserCheck,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Boton, CifraAnimada, Confirmacion, EsqueletoTarjeta, EstadoVacio, FilaDeKpis, Insignia, Kpi, LineaDeTiempo, Segmentado, Tarjeta, mezcla, ACENTO, type Hito } from '@/components/ui-ls'
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import { FASES_ENVIO, cuantoQueda, esFinDeSemana, explicarErrorAmazon, faseDelPaso, siguienteLaborable, type FaseEnvio, type Problema } from '@/lib/fba/envio-amazon'
import type { EstadoDelEnvio } from '@/lib/fba/envio-amazon-motor'
import { HOJAS_CAJA, type HojaCaja } from '@/lib/fba/formatos-etiqueta'
import { invalidarRemesas } from '../comun/useAgencia'
import { useEnvioAmazon } from './useEnvioAmazon'
import { DireccionOrigen } from '../DireccionOrigen'

/**
 * «ENVIAR A AMAZON» DENTRO DEL DETALLE DE LA REMESA (solo administradores).
 *
 * Seis fases, una detrás de otra y siempre a la vista: Inventario → Embalaje → Reparto → Transporte UPS →
 * Etiquetas → Seguimiento. Arriba el modo (manual en Seller Central o desde el ERP) y el estado de la
 * operación de Amazon en curso, en vivo. Lo irreversible (confirmar el reparto, confirmar el transporte,
 * cancelar envíos reales) pide escribir una palabra. El transporte lo confirma la agencia (el cliente solo ve
 * el coste en su enlace).
 *
 * El motor está en lib/fba/envio-amazon-motor.ts; la secuencia y las validaciones, en lib/fba/envio-amazon.ts.
 */

const ICONO_FASE: Record<FaseEnvio, LucideIcon> = {
  inventario: ClipboardCheck,
  embalaje: Boxes,
  reparto: Warehouse,
  transporte: Truck,
  etiquetas: Tags,
  seguimiento: Route,
}

const ORDEN: FaseEnvio[] = FASES_ENVIO.map((f) => f.id)

/**
 * SIN «HOVER PEGADO» EN EL MÓVIL. `.ls-elevar` levanta 2 px al pasar el ratón, pero en una pantalla táctil el :hover se queda puesto en lo último
 * que se tocó: la fase o la opción tocada se quedaba subida y torcida respecto a las demás hasta tocar otra cosa. Donde no hay ratón no se levanta.
 */
const SIN_HOVER_TACTIL = '[@media(hover:none)]:!transform-none'

const dinero = (n: number | null, moneda: string | null): string => {
  if (n === null) return '—'
  return `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moneda === 'EUR' || !moneda ? '€' : moneda}`
}

const fechaDia = (dia: string | null | undefined): string => (dia ? new Date(`${dia}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) : '—')

const fechaHora = (iso: string | null): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Un reloj que avanza cada 30 s, para las cuentas atrás (caducidad y anulación) */
function useAhora(activo: boolean): Date {
  const [ahora, setAhora] = useState(() => new Date())
  useEffect(() => {
    if (!activo) return
    const t = window.setInterval(() => setAhora(new Date()), 30_000)
    return () => window.clearInterval(t)
  }, [activo])
  return ahora
}

export function EnviarAAmazon({ remesaId, soloSeguimiento = false, onModo }: { remesaId: string; soloSeguimiento?: boolean; onModo?: (modo: 'manual' | 'api', enMarcha: boolean) => void }) {
  const router = useRouter()
  const { estado: e, error, trabajando, leer, enviar } = useEnvioAmazon(remesaId)
  // La ficha de la propuesta necesita saber el modo para no repetir lo del otro camino (manifiesto y dirección en manual; el paso a paso en API)
  const modoActual = e && !e.sinMigrar ? e.modo : null
  const enMarcha = !!e && !e.sinMigrar && e.paso !== 'sin_empezar' && e.paso !== 'cancelado'
  useEffect(() => {
    if (modoActual) onModo?.(modoActual, enMarcha)
  }, [modoActual, enMarcha, onModo])
  const faseActual: FaseEnvio = e ? (e.paso === 'sin_empezar' ? 'inventario' : faseDelPaso(e.paso)) : 'inventario'
  const [vista, setVista] = useState<FaseEnvio | null>(null)
  const fase = vista ?? (soloSeguimiento && e?.paso === 'etiquetas' ? 'seguimiento' : faseActual)
  const ahora = useAhora(!!e && (!!e.anulableHasta || !!e.transporteCaduca))

  if (error && !e) {
    return <EstadoVacio icono={AlertTriangle} titulo="No se ha podido abrir el envío a Amazon" descripcion={error} accion={{ texto: 'Volver a probar', onClick: () => void leer(), icono: RefreshCw }} acento="remesas" />
  }
  if (!e) {
    return (
      <div className="space-y-3" aria-busy>
        <EsqueletoTarjeta alto={110} />
        <EsqueletoTarjeta alto={64} />
        <EsqueletoTarjeta alto={220} />
      </div>
    )
  }
  if (e.sinMigrar) {
    return <EstadoVacio icono={Plug} titulo="Falta lanzar la migración 310" descripcion="El envío a Amazon desde el ERP necesita la migración 310_fba_envio_amazon.sql. Mientras tanto, el envío se hace como siempre en Seller Central." acento="remesas" />
  }

  const refrescar = () => {
    void leer()
    router.refresh()
    // Las pantallas de agencia (plan, resumen…) olvidan lo que tenían: el envío puede haber cambiado de paso
    invalidarRemesas()
  }

  return (
    <div className="space-y-3">
      <CabeceraEnvio e={e} trabajando={trabajando} bloqueado={soloSeguimiento} onModo={(modo) => void enviar({ modo }, '', 'modo').then((ok) => ok && toast.success(modo === 'api' ? 'El envío se hará desde el ERP' : 'El envío se hará a mano en Seller Central'))} onReintentar={() => void enviar({ accion: 'reintentar' }, '', 'reintentar')} />

      {e.modo === 'manual' ? (
        <ModoManual e={e} soloSeguimiento={soloSeguimiento} onPasar={() => void enviar({ modo: 'api' }, '', 'modo')} />
      ) : (
        <>
          <BarraDeFasesEnvio actual={faseActual} vista={fase} onVer={setVista} cancelado={e.paso === 'cancelado'} />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={fase} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              {fase === 'inventario' && <FaseInventario e={e} remesaId={remesaId} trabajando={trabajando} enviar={enviar} onDireccion={refrescar} />}
              {fase === 'embalaje' && <FaseEmbalaje e={e} trabajando={trabajando} enviar={enviar} onReabierto={refrescar} />}
              {fase === 'reparto' && <FaseReparto e={e} trabajando={trabajando} enviar={enviar} ahora={ahora} />}
              {fase === 'transporte' && <FaseTransporte e={e} trabajando={trabajando} enviar={enviar} ahora={ahora} />}
              {fase === 'etiquetas' && <FaseEtiquetas e={e} remesaId={remesaId} onEnviada={refrescar} />}
              {fase === 'seguimiento' && <FaseSeguimiento e={e} trabajando={trabajando} enviar={enviar} ahora={ahora} />}
            </motion.div>
          </AnimatePresence>
        </>
      )}
    </div>
  )
}

type Enviar = (cuerpo: Record<string, unknown>, ruta?: string, etiqueta?: string) => Promise<boolean>

/* ------------------------------------------------------------------ */
/* Cabecera: modo y estado en vivo                                      */
/* ------------------------------------------------------------------ */

function CabeceraEnvio({ e, trabajando, bloqueado, onModo, onReintentar }: { e: EstadoDelEnvio; trabajando: string | null; bloqueado: boolean; onModo: (m: 'manual' | 'api') => void; onReintentar: () => void }) {
  // El modo se elige mientras se prepara; con un plan en marcha o ya enviada, no se cambia
  const fijo = bloqueado || !['sin_empezar', 'cancelado'].includes(e.paso)
  const tono: TonoEstado = e.error ? 'rojo' : e.enCurso ? 'cian' : e.paso === 'etiquetas' ? 'verde' : e.paso === 'cancelado' ? 'gris' : 'ambar'
  const selector = (ancho: boolean) => (
    <Segmentado
      etiqueta="Cómo se crea el envío"
      tamano="sm"
      anchoCompleto={ancho}
      opciones={[
        { id: 'manual', texto: 'Manual', icono: Hand, desactivada: fijo || !!trabajando },
        { id: 'api', texto: 'Desde el ERP', icono: Rocket, desactivada: fijo || !e.conConexion || !!trabajando },
      ]}
      valor={e.modo}
      onCambio={(v) => v !== e.modo && onModo(v)}
    />
  )
  return (
    <Tarjeta
      variante="destacada"
      acento="remesas"
      icono={Send}
      titulo="Enviar a Amazon"
      subtitulo={e.modo === 'api' ? 'Desde el ERP, con la API de Amazon' : 'A mano en Seller Central, con el manifiesto'}
      acciones={<div className="hidden sm:block">{selector(false)}</div>}
    >
      {/* En el móvil el selector va dentro, a lo ancho: en la cabecera no cabe con el título */}
      <div className="mb-3 sm:hidden">{selector(true)}</div>
      {e.modo === 'api' ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-[2px] flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]" style={{ background: mezcla(COLOR_ESTADO[tono], 14), color: COLOR_ESTADO[tono] }}>
              {e.enCurso ? <RefreshCw className="h-4 w-4 motion-safe:animate-spin" /> : e.error ? <AlertTriangle className="h-4 w-4" /> : <PackageCheck className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[14px] font-semibold text-[var(--ls-t1)]">{e.error ? `Se ha parado: ${e.texto.replace(/…$/, '').toLowerCase()}` : e.texto}</p>
                {e.enCurso && (
                  <Insignia tono="cian" vivo>
                    Amazon trabajando
                  </Insignia>
                )}
                {e.cajasBloqueadas && (
                  <Insignia tono="gris" icono={Lock}>
                    Cajas bloqueadas
                  </Insignia>
                )}
              </div>
              {e.error ? (
                <ErrorExplicado texto={e.error} />
              ) : (
                <p className="mt-1 text-[12px] text-[var(--ls-t3)]">
                  {e.inboundPlanId ? <>Plan <span className="font-mono">{e.inboundPlanId}</span></> : 'Todavía no hay plan en Amazon'}
                  {e.enCurso && ' · se actualiza solo cada pocos segundos'}
                </p>
              )}
            </div>
          </div>
          {e.acciones.includes('reintentar') && (
            <Boton variante="primario" icono={RotateCcw} cargando={trabajando === 'reintentar'} onClick={onReintentar}>
              Reintentar el paso
            </Boton>
          )}
        </div>
      ) : (
        <p className="text-[12.5px] leading-[1.5] text-[var(--ls-t3)]">
          {e.conConexion ? 'Puedes pasar este envío a «Desde el ERP»: el plan, las cajas, el reparto, el UPS de Amazon y las etiquetas se hacen aquí, y la agencia confirma el coste del transporte.' : 'Este cliente no tiene la cuenta de Amazon conectada: el envío se hace en Seller Central.'}
        </p>
      )}
    </Tarjeta>
  )
}

function ModoManual({ e, soloSeguimiento, onPasar }: { e: EstadoDelEnvio; soloSeguimiento: boolean; onPasar: () => void }) {
  if (soloSeguimiento) return <EstadoVacio compacto icono={Hand} titulo="Este envío se creó a mano en Seller Central" descripcion="El seguimiento está en la pestaña «Seguimiento»." acento="remesas" />
  return (
    <EstadoVacio
      icono={Hand}
      titulo="Envío manual (como hasta ahora)"
      descripcion="Aquí debajo tienes el manifiesto y el Excel de embalaje para subir a Seller Central; luego se marca como enviada con el nº FBA."
      accion={e.conConexion && e.remesaEstado === 'lista' ? { texto: 'Hacerlo desde el ERP', onClick: onPasar, icono: Rocket } : undefined}
      acento="remesas"
    />
  )
}

/* ------------------------------------------------------------------ */
/* Las seis fases                                                       */
/* ------------------------------------------------------------------ */

function BarraDeFasesEnvio({ actual, vista, onVer, cancelado }: { actual: FaseEnvio; vista: FaseEnvio; onVer: (f: FaseEnvio) => void; cancelado: boolean }) {
  const iActual = ORDEN.indexOf(actual)
  return (
    <nav aria-label="Fases del envío a Amazon" className="-mx-1 overflow-x-auto px-1 pb-1">
      <ol className="grid grid-cols-6 gap-[6px] sm:min-w-[640px]">
        {FASES_ENVIO.map((f, i) => {
          const hecha = !cancelado && i < iActual
          const esActual = i === iActual
          const Icono = hecha ? CheckCircle2 : ICONO_FASE[f.id]
          const color = hecha ? COLOR_ESTADO.verde : esActual ? ACENTO.remesas : 'var(--ls-t4)'
          return (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onVer(f.id)}
                aria-current={esActual ? 'step' : undefined}
                aria-label={`${i + 1} · ${f.texto}`}
                className={`ls-elevar ${SIN_HOVER_TACTIL} relative flex w-full items-center justify-center gap-2 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-[6px] py-2 text-left sm:justify-start sm:px-[10px] [@media(pointer:coarse)]:min-h-[44px]`}
              >
                {vista === f.id && <motion.span layoutId="fase-envio-amazon" className="absolute inset-0 rounded-[10px]" style={{ boxShadow: `inset 0 0 0 1.5px ${ACENTO.remesas}`, background: mezcla(ACENTO.remesas, 7) }} transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: mezcla(color, 14), color }}>
                  <Icono className="h-[14px] w-[14px]" />
                </span>
                <span className="relative hidden min-w-0 sm:block">
                  <span className="block truncate text-[12.5px] font-semibold text-[var(--ls-t1)]">
                    {i + 1} · {f.texto}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--ls-t4)]">{f.pista}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <p className="mt-2 text-[12.5px] text-[var(--ls-t3)] sm:hidden">
        Fase {ORDEN.indexOf(vista) + 1} de 6 · <b className="text-[var(--ls-t1)]">{FASES_ENVIO[ORDEN.indexOf(vista)].texto}</b> · {FASES_ENVIO[ORDEN.indexOf(vista)].pista}
      </p>
    </nav>
  )
}

function ListaDeProblemas({ problemas, vacio }: { problemas: Problema[]; vacio: string }) {
  if (!problemas.length)
    return (
      <p className="flex items-center gap-2 text-[12.5px]" style={{ color: COLOR_ESTADO.verde }}>
        <ShieldCheck className="h-4 w-4" /> {vacio}
      </p>
    )
  return (
    <ul className="space-y-[6px]">
      {problemas.slice(0, 30).map((p, i) => (
        <li key={i} className="flex items-start gap-2 text-[12.5px] leading-[1.45]" style={{ color: p.nivel === 'error' ? COLOR_ESTADO.rojo : COLOR_ESTADO.ambar }}>
          <AlertTriangle className="mt-[2px] h-[13px] w-[13px] shrink-0" />
          <span className="text-[var(--ls-t2)]">{p.texto}</span>
        </li>
      ))}
      {problemas.length > 30 && <li className="text-[12px] text-[var(--ls-t4)]">Y {problemas.length - 30} más</li>}
    </ul>
  )
}

/* 1 · Inventario --------------------------------------------------- */

function FaseInventario({ e, remesaId, trabajando, enviar, onDireccion }: { e: EstadoDelEnvio; remesaId: string; trabajando: string | null; enviar: Enviar; onDireccion: () => void }) {
  const [confirmar, setConfirmar] = useState(false)
  const [sonda, setSonda] = useState<{ ok: boolean; texto: string } | null>(null)
  const [sondando, setSondando] = useState(false)
  const problemas = [...e.inventario.problemas, ...e.cajas.problemas]
  const bloquean = problemas.some((p) => p.nivel === 'error')
  const puedeIniciar = e.acciones.includes('iniciar')

  async function probar() {
    setSondando(true)
    try {
      const res = await fetch(`/api/fba/remesas/${remesaId}/amazon/sonda`, { cache: 'no-store' })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      setSonda(res.ok && j?.ok ? { ok: true, texto: 'Amazon deja usar la API de envíos con esta cuenta (lectura comprobada)' } : { ok: false, texto: j?.error ?? 'Amazon no deja usar la API de envíos con esta cuenta' })
    } finally {
      setSondando(false)
    }
  }

  return (
    <div className="space-y-3">
      <FilaDeKpis minimo={150}>
        <Kpi indice={0} etiqueta="Referencias" valor={e.inventario.referencias} icono={ClipboardCheck} acento="remesas" />
        <Kpi indice={1} etiqueta="Unidades" valor={e.inventario.unidades} icono={PackageCheck} acento="remesas" />
        <Kpi indice={2} etiqueta="Cajas" valor={e.cajas.cajas} icono={Boxes} acento="remesas" />
        <Kpi indice={3} etiqueta="Peso total" valor={e.cajas.pesoKg} formato={(n) => `${n.toLocaleString('es-ES', { maximumFractionDigits: 1 })} kg`} icono={Truck} acento="remesas" />
      </FilaDeKpis>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
        <Tarjeta indice={1} icono={ShieldCheck} titulo="Comprobaciones antes de mandar" subtitulo="Límites de Amazon: 63,5 cm por lado y 23 kg por caja">
          <ListaDeProblemas problemas={problemas} vacio="Todo en orden: se puede mandar a Amazon" />
        </Tarjeta>
        {/* Mientras Amazon no tenga el plan, la dirección se puede corregir aquí mismo (si la rechaza, se arregla y se reintenta sin salir) */}
        {e.clienteId && !e.inboundPlanId ? (
          <DireccionOrigen key={e.clienteId} clienteId={e.clienteId} clienteNombre={e.direccion?.empresa ?? 'el cliente'} puedeEditar onGuardada={onDireccion} />
        ) : (
          <Tarjeta indice={2} icono={MapPin} titulo="Sale desde" subtitulo="La dirección de origen del cliente">
            {e.direccion ? (
              <address className="text-[12.5px] not-italic leading-[1.55] text-[var(--ls-t2)]">
                <span className="font-semibold text-[var(--ls-t1)]">{e.direccion.empresa}</span>
                <br />
                {e.direccion.linea1}
                {e.direccion.linea2 ? `, ${e.direccion.linea2}` : ''}
                <br />
                {e.direccion.codigoPostal} {e.direccion.ciudad} ({e.direccion.provincia}) · {e.direccion.pais}
                <br />
                {e.direccion.nombre} · {e.direccion.telefono}
              </address>
            ) : (
              <p className="text-[12.5px] text-[var(--ls-t3)]">Falta. Se rellena en «Lo que toca» → Dirección de origen.</p>
            )}
          </Tarjeta>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Boton variante="secundario" icono={Plug} cargando={sondando} onClick={() => void probar()}>
            Probar el acceso a Amazon
          </Boton>
          {sonda && (
            <span className="text-[12px]" style={{ color: sonda.ok ? COLOR_ESTADO.verde : COLOR_ESTADO.rojo }}>
              {sonda.texto}
            </span>
          )}
        </div>
        {puedeIniciar ? (
          <Boton variante="primario" icono={Rocket} disabled={bloquean} onClick={() => setConfirmar(true)}>
            Mandar a Amazon
          </Boton>
        ) : (
          e.inboundPlanId && <Insignia tono="verde" icono={CheckCircle2}>Plan creado</Insignia>
        )}
      </div>

      <Confirmacion
        abierto={confirmar}
        onCambio={setConfirmar}
        palabra={null}
        tono="normal"
        titulo="Mandar el envío a Amazon"
        textoConfirmar="Crear el plan"
        descripcion="Se crea el plan de envío en la cuenta del cliente con estas referencias y estas cajas. Desde ahora las cajas quedan BLOQUEADAS en el ERP y en el enlace del cliente. Hasta confirmar el reparto se puede cancelar sin rastro."
        onConfirmar={async () => {
          const ok = await enviar({ accion: 'iniciar' }, '', 'iniciar')
          if (!ok) throw new Error('no')
          toast.success('Plan en marcha en Amazon')
        }}
      />
    </div>
  )
}

/* 2 · Embalaje ----------------------------------------------------- */

function FaseEmbalaje({ e, trabajando, enviar, onReabierto }: { e: EstadoDelEnvio; trabajando: string | null; enviar: Enviar; onReabierto: () => void }) {
  const [reabrir, setReabrir] = useState(false)
  const pasos: Array<{ texto: string; hecho: boolean; activo: boolean }> = [
    { texto: 'Amazon agrupa la mercancía', hecho: !!e.packingOptionId, activo: e.paso === 'embalaje_generar' },
    { texto: 'Agrupado confirmado', hecho: ['cajas', 'reparto_generar', 'reparto_elegir'].includes(e.paso) || faseDelPaso(e.paso) === 'reparto' || faseDelPaso(e.paso) === 'transporte' || e.paso === 'etiquetas', activo: e.paso === 'embalaje_confirmar' },
    { texto: 'Cajas mandadas (medidas, peso y contenido)', hecho: ['reparto_generar', 'reparto_elegir'].includes(e.paso) || faseDelPaso(e.paso) === 'transporte' || e.paso === 'etiquetas' || e.paso === 'reparto_confirmar', activo: e.paso === 'cajas' },
  ]
  return (
    <div className="space-y-3">
      <Tarjeta indice={0} icono={Boxes} titulo="Embalaje" subtitulo={e.cajasBloqueadas ? 'Las cajas están en Amazon: no se tocan sin reabrirlas' : 'Las cajas se pueden editar'} acciones={e.cajasBloqueadas ? <Insignia tono="gris" icono={Lock}>Bloqueadas</Insignia> : <Insignia tono="ambar" icono={Unlock}>Editables</Insignia>}>
        <ol className="space-y-2">
          {pasos.map((p) => (
            <li key={p.texto} className="flex items-center gap-2 text-[13px]">
              {p.hecho ? <CheckCircle2 className="h-4 w-4" style={{ color: COLOR_ESTADO.verde }} /> : p.activo ? <RefreshCw className="h-4 w-4 motion-safe:animate-spin" style={{ color: ACENTO.remesas }} /> : <Clock className="h-4 w-4 text-[var(--ls-t4)]" />}
              <span className={p.hecho || p.activo ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t3)]'}>{p.texto}</span>
            </li>
          ))}
        </ol>
      </Tarjeta>

      {e.paso === 'embalaje_elegir' && (
        <Tarjeta indice={1} variante="destacada" acento="remesas" icono={Boxes} titulo="Elige cómo agrupar" subtitulo="Amazon ofrece varias formas de agrupar la mercancía">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {e.opcionesEmbalaje.map((o) => (
              <div key={o.packingOptionId} className="rounded-[10px] border border-[var(--ls-linea)] p-3">
                <p className="text-[13px] font-semibold text-[var(--ls-t1)]">{o.grupos.length} grupo{o.grupos.length === 1 ? '' : 's'}</p>
                <p className="text-[12px] text-[var(--ls-t3)]">Tarifa {dinero(o.coste - o.descuento, o.moneda)} · caduca {fechaHora(o.caduca)}</p>
                <Boton className="mt-2" tamano="sm" variante="secundario" cargando={trabajando === o.packingOptionId} onClick={() => void enviar({ accion: 'elegir_embalaje', packingOptionId: o.packingOptionId }, '', o.packingOptionId)}>
                  Elegir esta
                </Boton>
              </div>
            ))}
          </div>
        </Tarjeta>
      )}

      {(e.paso === 'cajas_conflicto' || e.paso === 'cajas_reabiertas') && (
        <Tarjeta indice={1} variante="destacada" acento={e.paso === 'cajas_conflicto' ? COLOR_ESTADO.ambar : 'remesas'} icono={e.paso === 'cajas_conflicto' ? AlertTriangle : Unlock} titulo={e.paso === 'cajas_conflicto' ? 'Hay que rehacer alguna caja' : 'Cajas reabiertas'}>
          <p className="text-[12.5px] leading-[1.55] text-[var(--ls-t2)]">
            {e.paso === 'cajas_conflicto'
              ? 'Amazon quiere algunas referencias en grupos separados y hay cajas que las mezclan. Reabre las cajas, sepáralas y, cuando la remesa vuelva a estar «Lista», mándalas otra vez.'
              : 'Cuando el cliente termine de cambiarlas y la remesa vuelva a estar «Lista para enviar», se mandan otra vez y Amazon recalcula el reparto (las opciones de antes ya no valen).'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {e.acciones.includes('reabrir_cajas') && e.remesaEstado === 'lista' && (
              <Boton variante="secundario" icono={Unlock} onClick={() => setReabrir(true)}>
                Reabrir cajas
              </Boton>
            )}
            {e.acciones.includes('reenviar_cajas') && (
              <Boton variante="primario" icono={Send} disabled={e.remesaEstado !== 'lista'} cargando={trabajando === 'reenviar'} onClick={() => void enviar({ accion: 'reenviar_cajas' }, '', 'reenviar')}>
                Mandar las cajas otra vez
              </Boton>
            )}
          </div>
        </Tarjeta>
      )}

      {e.acciones.includes('reabrir_cajas') && e.paso !== 'cajas_conflicto' && (
        <div className="flex justify-end">
          <Boton variante="fantasma" icono={Unlock} onClick={() => setReabrir(true)}>
            Reabrir cajas
          </Boton>
        </div>
      )}

      <Confirmacion
        abierto={reabrir}
        onCambio={setReabrir}
        palabra={null}
        tono="normal"
        titulo="Reabrir las cajas"
        textoConfirmar="Reabrir"
        descripcion="La remesa vuelve a «Encajando» y las cajas se pueden cambiar en el ERP y en el enlace del cliente. Al volver a mandarlas, Amazon recalcula el reparto: las opciones de ahora dejan de valer."
        onConfirmar={async () => {
          const ok = await enviar({ accion: 'reabrir_cajas' }, '', 'reabrir')
          if (!ok) throw new Error('no')
          onReabierto()
        }}
      />
    </div>
  )
}

/* 3 · Reparto ------------------------------------------------------ */

function FaseReparto({ e, trabajando, enviar, ahora }: { e: EstadoDelEnvio; trabajando: string | null; enviar: Enviar; ahora: Date }) {
  const recomendada = e.opcionesReparto.find((o) => o.recomendada)?.placementOptionId ?? null
  const [elegida, setElegida] = useState<string | null>(e.placementOptionId ?? recomendada)
  const [confirmar, setConfirmar] = useState(false)
  const opcion = e.opcionesReparto.find((o) => o.placementOptionId === elegida) ?? null
  const confirmado = faseDelPaso(e.paso) === 'transporte' || e.paso === 'etiquetas'

  if (confirmado) {
    return (
      <Tarjeta indice={0} variante="destacada" acento="remesas" icono={Warehouse} titulo="Reparto confirmado" subtitulo={`Tarifa de reparto ${dinero(e.costeReparto, e.moneda)}`}>
        <ListaDeEnvios e={e} />
      </Tarjeta>
    )
  }
  if (e.paso === 'reparto_generar' || e.paso === 'reparto_confirmar') {
    return e.error ? (
      <EstadoVacio icono={AlertTriangle} titulo="Amazon ha parado el reparto" descripcion="Arriba tienes lo que ha dicho y el botón para reintentar." acento={COLOR_ESTADO.rojo} />
    ) : (
      <EstadoVacio icono={Warehouse} titulo={e.texto} descripcion="Puede tardar unos minutos. Esta pantalla se actualiza sola." acento="remesas" />
    )
  }
  if (!e.opcionesReparto.length) {
    return <EstadoVacio icono={Warehouse} titulo="Todavía no hay reparto" descripcion="Amazon reparte el envío por centros cuando tiene las cajas." acento="remesas" />
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {e.opcionesReparto.map((o, i) => {
          const activa = elegida === o.placementOptionId
          return (
            <Tarjeta
              key={o.placementOptionId}
              indice={i}
              variante={activa ? 'destacada' : 'interactiva'}
              acento="remesas"
              className={SIN_HOVER_TACTIL}
              onClick={o.caducada ? undefined : () => setElegida(o.placementOptionId)}
              icono={Warehouse}
              titulo={`${o.centros} centro${o.centros === 1 ? '' : 's'}`}
              subtitulo={o.caducada ? 'Caducada' : `Vale hasta ${fechaHora(o.caduca)}`}
              acciones={o.recomendada ? <Insignia tono="verde">La mejor</Insignia> : o.caducada ? <Insignia tono="gris">Caducada</Insignia> : null}
            >
              <p className="text-[26px] font-semibold tabular-nums tracking-[-0.02em] text-[var(--ls-t1)]">
                <CifraAnimada valor={o.neto} formato={(n) => dinero(n, o.moneda)} />
              </p>
              <p className="text-[12px] text-[var(--ls-t3)]">{o.neto === 0 ? 'Sin tarifa de reparto' : o.descuento ? `Tarifa ${dinero(o.coste, o.moneda)} − descuento ${dinero(o.descuento, o.moneda)}` : 'Tarifa de reparto (placement fee)'}</p>
              <div className="mt-2 flex flex-wrap gap-[6px]">
                {o.destinos.map((d) => (
                  <Insignia key={d.shipmentId} tono="gris" icono={MapPin}>
                    {d.destino ?? 'Centro'}
                    {d.ciudad ? ` · ${d.ciudad}` : ''}
                  </Insignia>
                ))}
              </div>
            </Tarjeta>
          )
        })}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <p className="text-[12px] text-[var(--ls-t3)] sm:mr-auto">Confirmar el reparto crea los envíos FBA de verdad y acepta su tarifa. No tiene vuelta atrás.</p>
        <Boton variante="primario" icono={CheckCircle2} disabled={!opcion || opcion.caducada || !e.acciones.includes('confirmar_reparto')} cargando={trabajando === 'reparto'} onClick={() => setConfirmar(true)}>
          Confirmar reparto
        </Boton>
      </div>
      <Confirmacion
        abierto={confirmar}
        onCambio={setConfirmar}
        palabra="REPARTO"
        titulo="Confirmar el reparto"
        textoConfirmar="Confirmar reparto"
        descripcion={opcion ? `${opcion.centros} centro${opcion.centros === 1 ? '' : 's'} con una tarifa de ${dinero(opcion.neto, opcion.moneda)}. Nacen los envíos FBA en la cuenta del cliente; a partir de aquí cancelar es cancelar envíos reales.` : ''}
        onConfirmar={async () => {
          const ok = await enviar({ accion: 'confirmar_reparto', placementOptionId: elegida, palabra: 'REPARTO' }, '', 'reparto')
          if (!ok) throw new Error('no')
        }}
      />
      {cuantoQueda(opcion?.caduca ?? null, ahora) && <p className="text-right text-[11.5px] text-[var(--ls-t4)]">Esta opción caduca en {cuantoQueda(opcion?.caduca ?? null, ahora)}</p>}
    </div>
  )
}

function ListaDeEnvios({ e }: { e: EstadoDelEnvio }) {
  if (!e.envios.length) return <p className="text-[12.5px] text-[var(--ls-t3)]">Sin envíos todavía.</p>
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {e.envios.map((s) => (
        <li key={s.shipmentId} className="flex items-center gap-3 rounded-[10px] border border-[var(--ls-linea)] px-3 py-2">
          <Warehouse className="h-4 w-4 shrink-0" style={{ color: ACENTO.remesas }} />
          <div className="min-w-0">
            <p className="truncate font-mono text-[13px] font-semibold text-[var(--ls-t1)]">{s.confirmacion ?? s.shipmentId}</p>
            <p className="truncate text-[11.5px] text-[var(--ls-t3)]">
              {s.destino ?? '—'}
              {s.ciudad ? ` · ${s.ciudad}` : ''}
              {s.estado ? ` · ${s.estado}` : ''}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}

/* 4 · Transporte --------------------------------------------------- */

/** El siguiente día laborable: UPS no recoge en fin de semana */
const manana = (): string => siguienteLaborable(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date()))

function FaseTransporte({ e, trabajando, enviar, ahora }: { e: EstadoDelEnvio; trabajando: string | null; enviar: Enviar; ahora: Date }) {
  const [dia, setDia] = useState(e.recogida?.dia ?? manana())
  const [contacto, setContacto] = useState({ nombre: e.recogida?.contacto?.nombre ?? e.direccion?.nombre ?? '', telefono: e.recogida?.contacto?.telefono ?? e.direccion?.telefono ?? '', email: e.recogida?.contacto?.email ?? e.direccion?.email ?? '' })
  const [confirmar, setConfirmar] = useState(false)
  const [tipo, setTipo] = useState<'paquete' | 'palet'>(e.palets ? 'palet' : 'paquete')
  const [pal, setPal] = useState({ cantidad: String(e.palets?.cantidad ?? 1), largo: String(e.palets?.largoCm ?? 120), ancho: String(e.palets?.anchoCm ?? 80), alto: e.palets ? String(e.palets.altoCm) : '', peso: e.palets ? String(e.palets.pesoKg) : '', apilable: e.palets?.apilable ?? false, confirmarPeso: false })
  const cuerpoCotizar = {
    accion: 'generar_transporte',
    dia,
    contacto,
    ...(tipo === 'palet' ? { palets: { cantidad: pal.cantidad, largoCm: pal.largo, anchoCm: pal.ancho, altoCm: pal.alto, pesoKg: pal.peso, apilable: pal.apilable, confirmarPeso: pal.confirmarPeso } } : {}),
  }
  const queda = cuantoQueda(e.transporteCaduca, ahora)
  const confirmado = !!e.transporteConfirmadoAt
  const porEnvio = useMemo(() => {
    const m = new Map<string, EstadoDelEnvio['opcionesTransporte']>()
    for (const o of e.opcionesTransporte) m.set(o.shipmentId, [...(m.get(o.shipmentId) ?? []), o])
    return m
  }, [e.opcionesTransporte])

  if (faseDelPaso(e.paso) !== 'transporte' && !confirmado) {
    return <EstadoVacio icono={Truck} titulo="El transporte va después del reparto" descripcion="Cuando se confirme el reparto, aquí se pide la cotización de UPS." acento="remesas" />
  }

  // En el táctil, 16 px: con menos, Safari del iPhone amplía la página al tocar el campo y no la devuelve a su tamaño (se queda descuadrada y
  // con scroll de lado hasta pellizcar). En el ordenador sigue en 13 px.
  const campo = 'h-10 w-full rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 text-[13px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-mod-remesas)] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:text-[16px]'
  const pedir = e.acciones.includes('generar_transporte')

  return (
    <div className="space-y-3">
      {(e.paso === 'transporte_datos' || (pedir && !e.seleccion.length)) && (
        <Tarjeta indice={0} variante="destacada" acento="remesas" icono={Truck} titulo="Recogida" subtitulo={tipo === 'palet' ? 'Cuándo estará el palé listo para que lo recoja el transportista' : 'Cuándo estará la mercancía lista para que UPS la recoja'}>
          <div className="mb-3">
            <Segmentado
              etiqueta="Tipo de envío"
              tamano="sm"
              opciones={[
                { id: 'paquete', texto: 'Paquetería (UPS)' },
                { id: 'palet', texto: 'Palés (transporte propio)' },
              ]}
              valor={tipo}
              onCambio={(v) => setTipo(v as 'paquete' | 'palet')}
            />
          </div>
          {tipo === 'palet' && (
            <div className="mb-3 rounded-[10px] border border-[var(--ls-linea)] p-3">
              <p className="mb-2 text-[12px] leading-[1.5] text-[var(--ls-t3)]">
                Medidas y peso de CADA palé, con la mercancía puesta y el palé incluido. Amazon no recibe palés de más de 183 cm de alto ni de 680 kg. Si no cabe en el plan de Amazon como palé, las cajas se mandan de otra forma.
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <label className="text-[12px] text-[var(--ls-t3)]">
                  Palés
                  <input className={campo} inputMode="numeric" value={pal.cantidad} onChange={(v) => setPal({ ...pal, cantidad: v.target.value })} />
                </label>
                <label className="text-[12px] text-[var(--ls-t3)]">
                  Largo (cm)
                  <input className={campo} inputMode="decimal" value={pal.largo} onChange={(v) => setPal({ ...pal, largo: v.target.value })} />
                </label>
                <label className="text-[12px] text-[var(--ls-t3)]">
                  Ancho (cm)
                  <input className={campo} inputMode="decimal" value={pal.ancho} onChange={(v) => setPal({ ...pal, ancho: v.target.value })} />
                </label>
                <label className="text-[12px] text-[var(--ls-t3)]">
                  Alto (cm)
                  <input className={campo} inputMode="decimal" value={pal.alto} onChange={(v) => setPal({ ...pal, alto: v.target.value })} placeholder="97" />
                </label>
                <label className="text-[12px] text-[var(--ls-t3)]">
                  Peso (kg)
                  <input className={campo} inputMode="decimal" value={pal.peso} onChange={(v) => setPal({ ...pal, peso: v.target.value })} placeholder="46,5" />
                </label>
              </div>
              <label className="mt-3 flex items-center gap-2 text-[12.5px] text-[var(--ls-t2)]">
                <input type="checkbox" checked={pal.apilable} onChange={(v) => setPal({ ...pal, apilable: v.target.checked })} />
                Se puede apilar otro palé encima
              </label>
              <label className="flex items-center gap-2 text-[12.5px] text-[var(--ls-t2)]" title="Solo si el peso que has puesto es el real aunque no cuadre con lo que pesan las cajas (p. ej. palés de madera pesados)">
                <input type="checkbox" checked={pal.confirmarPeso} onChange={(v) => setPal({ ...pal, confirmarPeso: v.target.checked })} />
                He comprobado el peso
              </label>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-[12px] text-[var(--ls-t3)]">
              Día de recogida
              <input type="date" className={campo} value={dia} min={new Date().toISOString().slice(0, 10)} onChange={(v) => setDia(v.target.value)} />
              {dia && esFinDeSemana(dia) && <span className="mt-1 block text-[11.5px]" style={{ color: COLOR_ESTADO.ambar }}>Es {new Date(`${dia}T12:00:00Z`).getUTCDay() === 6 ? 'sábado' : 'domingo'}: UPS no suele recoger en fin de semana</span>}
            </label>
            <label className="text-[12px] text-[var(--ls-t3)]">
              Contacto
              <input className={campo} value={contacto.nombre} onChange={(v) => setContacto({ ...contacto, nombre: v.target.value })} placeholder="Nombre" />
            </label>
            <label className="text-[12px] text-[var(--ls-t3)]">
              Teléfono
              <input className={campo} inputMode="tel" value={contacto.telefono} onChange={(v) => setContacto({ ...contacto, telefono: v.target.value })} />
            </label>
            <label className="text-[12px] text-[var(--ls-t3)]">
              Email
              <input className={campo} type="email" value={contacto.email} onChange={(v) => setContacto({ ...contacto, email: v.target.value })} />
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <Boton variante="primario" icono={Truck} cargando={trabajando === 'cotizar'} onClick={() => void enviar(cuerpoCotizar, '', 'cotizar')}>
              Pedir cotización a Amazon
            </Boton>
          </div>
        </Tarjeta>
      )}

      {e.paso === 'transporte_generar' && !e.error && <EstadoVacio icono={Truck} titulo="Pidiendo la cotización a Amazon…" descripcion="Se actualiza solo en cuanto Amazon conteste." acento="remesas" />}

      {e.seleccion.length > 0 && e.sinCobro && (
        <Tarjeta indice={1} variante="destacada" acento="remesas" icono={Truck} titulo="Transporte propio" subtitulo={`Recogida el ${fechaDia(e.recogida?.dia)}`}>
          <p className="text-[13px] leading-[1.55] text-[var(--ls-t2)]">
            Amazon no cobra nada: el palé lo lleva el transportista que elijas tú ({e.palets ? `${e.palets.cantidad} palé${e.palets.cantidad === 1 ? '' : 's'} de ${e.palets.largoCm}×${e.palets.anchoCm}×${e.palets.altoCm} cm y ${e.palets.pesoKg} kg` : 'palés'}). No hay coste que el cliente tenga que aceptar. Al confirmar, Amazon reserva la entrega y salen las etiquetas de caja y de palé.
          </p>
        </Tarjeta>
      )}

      {e.seleccion.length > 0 && !e.sinCobro && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr]">
          <Tarjeta indice={1} variante="destacada" acento="remesas" icono={Truck} titulo="Coste del transporte" subtitulo={[...new Set(e.seleccion.map((s) => s.transportista ?? 'Transportista de Amazon'))].join(', ')}>
            <p className="text-[34px] font-semibold tabular-nums leading-none tracking-[-0.02em] text-[var(--ls-t1)]">
              <CifraAnimada valor={e.costeTransporte ?? 0} formato={(n) => dinero(n, e.moneda)} />
            </p>
            <p className="mt-2 text-[12px] text-[var(--ls-t3)]">
              {e.seleccion.length} envío{e.seleccion.length === 1 ? '' : 's'} · recogida el {fechaDia(e.recogida?.dia)} · lo cobra Amazon en la cuenta del cliente
            </p>
            {!confirmado && (
              <p className="mt-2 inline-flex items-center gap-[6px] text-[12px]" style={{ color: e.cotizacionVigente ? COLOR_ESTADO.ambar : COLOR_ESTADO.rojo }}>
                <Clock className="h-[13px] w-[13px]" />
                {e.cotizacionVigente ? `La cotización caduca en ${queda ?? '—'} (${fechaHora(e.transporteCaduca)})` : 'La cotización ha caducado: pide otra'}
              </p>
            )}
            {e.sinAsociado.length > 0 && (
              <p className="mt-2 text-[12px]" style={{ color: COLOR_ESTADO.rojo }}>
                {e.sinAsociado.length} envío{e.sinAsociado.length === 1 ? '' : 's'} sin UPS de Amazon en paquetería: elige otra opción abajo.
              </p>
            )}
          </Tarjeta>

          {e.aceptacion && (
          <Tarjeta indice={2} icono={UserCheck} titulo="Aceptación del cliente" subtitulo="De antes: ahora el transporte lo confirma la agencia">
              <div className="space-y-1 text-[12.5px] text-[var(--ls-t2)]">
                <p className="flex items-center gap-2 font-semibold" style={{ color: COLOR_ESTADO.verde }}>
                  <CheckCircle2 className="h-4 w-4" /> Aceptado por {e.aceptacion.nombre ?? 'el cliente'}
                </p>
                <p>
                  {fechaHora(e.aceptacion.at)} · {dinero(e.aceptacion.coste, e.moneda)}
                  {e.aceptacion.ip ? ` · IP ${e.aceptacion.ip}` : ''}
                </p>
              </div>
          </Tarjeta>
          )}
        </div>
      )}

      {!confirmado && e.opcionesTransporte.length > 0 && e.acciones.includes('elegir_transporte') && (
        <Tarjeta indice={3} icono={Route} titulo="Opciones por envío" subtitulo="Por defecto, el UPS de Amazon más barato en paquetería">
          <div className="space-y-3">
            {[...porEnvio.entries()].map(([sid, ops]) => {
              const envio = e.envios.find((x) => x.shipmentId === sid)
              const elegida = e.seleccion.find((s) => s.shipmentId === sid)?.transportationOptionId
              return (
                <div key={sid}>
                  <p className="mb-1 font-mono text-[12px] text-[var(--ls-t3)]">
                    {envio?.confirmacion ?? sid} {envio?.destino ? `→ ${envio.destino}` : ''}
                  </p>
                  <div className="grid grid-cols-1 gap-[6px] sm:grid-cols-2">
                    {ops.slice(0, 8).map((o) => (
                      <button
                        key={o.transportationOptionId}
                        type="button"
                        disabled={!!trabajando || (o.coste === null && o.deAmazon)}
                        onClick={() => o.transportationOptionId !== elegida && void enviar({ accion: 'elegir_transporte', transportationOptionId: o.transportationOptionId }, '', o.transportationOptionId)}
                        className={`ls-elevar ${SIN_HOVER_TACTIL} flex items-center justify-between gap-2 rounded-[10px] border px-3 py-2 text-left text-[12.5px] disabled:opacity-50 [@media(pointer:coarse)]:min-h-[44px]`}
                        style={{ borderColor: o.transportationOptionId === elegida ? ACENTO.remesas : 'var(--ls-linea)', background: o.transportationOptionId === elegida ? mezcla(ACENTO.remesas, 8) : undefined }}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-[var(--ls-t1)]">{o.transportista ?? '—'}</span>
                          <span className="block truncate text-[11px] text-[var(--ls-t4)]">
                            {o.deAmazon ? 'Asociado de Amazon' : 'Transporte propio'} · {o.modo === 'SMALL_PARCEL' ? 'paquetería' : 'palés'}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums text-[var(--ls-t1)]">{o.coste === null && !o.deAmazon ? 'Sin cargo' : dinero(o.coste, o.moneda)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </Tarjeta>
      )}

      {!confirmado && e.seleccion.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {pedir && (
            <Boton variante="secundario" icono={RefreshCw} cargando={trabajando === 'cotizar'} onClick={() => void enviar(cuerpoCotizar, '', 'cotizar')} className="sm:mr-auto">
              Pedir otra cotización
            </Boton>
          )}
          <Boton variante="primario" icono={ShieldCheck} disabled={!e.acciones.includes('confirmar_transporte') || !e.cotizacionVigente} cargando={trabajando === 'transporte'} onClick={() => setConfirmar(true)}>
            Confirmar transporte
          </Boton>
        </div>
      )}

      {confirmado && (
        <Tarjeta indice={4} variante="destacada" acento={COLOR_ESTADO.verde} icono={CheckCircle2} titulo="Transporte confirmado" subtitulo={fechaHora(e.transporteConfirmadoAt)}>
          <AnulableHasta hasta={e.anulableHasta} ahora={ahora} />
        </Tarjeta>
      )}

      <Confirmacion
        abierto={confirmar}
        onCambio={setConfirmar}
        palabra="TRANSPORTE"
        titulo="Confirmar el transporte con Amazon"
        textoConfirmar="Confirmar transporte"
        descripcion={e.sinCobro ? 'Amazon reserva la entrega con transporte propio: no hay cargo. Después hay que imprimir las etiquetas y pasarle al transportista el nº de envío para que pida la cita en el almacén.' : `Se acepta el cargo de ${dinero(e.costeTransporte, e.moneda)} que Amazon cobra en la cuenta del cliente. Se puede anular sin coste durante unas 24 h en paquetería.`}
        onConfirmar={async () => {
          const ok = await enviar({ accion: 'confirmar_transporte', palabra: 'TRANSPORTE' }, '', 'transporte')
          if (!ok) throw new Error('no')
        }}
      />
    </div>
  )
}

function AnulableHasta({ hasta, ahora }: { hasta: string | null; ahora: Date }) {
  const queda = cuantoQueda(hasta, ahora)
  if (!hasta) return <p className="text-[12.5px] text-[var(--ls-t3)]">Amazon no ha dado plazo de anulación.</p>
  return (
    <p className="inline-flex items-center gap-2 text-[12.5px]" style={{ color: queda ? COLOR_ESTADO.ambar : 'var(--ls-t3)' }}>
      <Clock className="h-4 w-4" />
      {queda ? `Se puede anular sin coste durante ${queda} (hasta ${fechaHora(hasta)})` : `El plazo de anulación sin coste acabó el ${fechaHora(hasta)}`}
    </p>
  )
}

/* 5 · Etiquetas ---------------------------------------------------- */

const HOJAS = HOJAS_CAJA

function FaseEtiquetas({ e, remesaId, onEnviada }: { e: EstadoDelEnvio; remesaId: string; onEnviada: () => void }) {
  const [hoja, setHoja] = useState<HojaCaja>('a4_2')
  /** La hoja fijada para este cliente (migración 327): Solter, la térmica de 10 × 15 */
  const [hojaDelCliente, setHojaDelCliente] = useState<HojaCaja | null>(null)
  const [fijando, setFijando] = useState(false)
  useEffect(() => {
    let vivo = true
    fetch(`/api/fba/remesas/${remesaId}/preferencias-etiquetas`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((p: { caja?: HojaCaja | null } | null) => {
        if (!vivo || !p?.caja) return
        setHojaDelCliente(p.caja)
        setHoja(p.caja)
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [remesaId])
  async function fijarHoja() {
    setFijando(true)
    try {
      const res = await fetch(`/api/fba/remesas/${remesaId}/preferencias-etiquetas`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caja: hoja }) })
      const p = (await res.json().catch(() => null)) as { caja?: HojaCaja | null; error?: string } | null
      if (!res.ok) {
        toast.error(p?.error ?? 'No se ha podido guardar')
        return
      }
      setHojaDelCliente(p?.caja ?? hoja)
      toast.success('Esta hoja de cajas sale ya elegida en todos los envíos de este cliente')
    } finally {
      setFijando(false)
    }
  }
  const [pidiendo, setPidiendo] = useState(false)
  const [enlaces, setEnlaces] = useState<Array<{ shipmentId: string; confirmacion: string | null; destino: string | null; cajas: number; url: string | null; error: string | null }>>([])
  const [marcando, setMarcando] = useState(false)
  const [confirmarEnviada, setConfirmarEnviada] = useState(false)
  const [pidiendoPalet, setPidiendoPalet] = useState(false)
  const [enlacesPalet, setEnlacesPalet] = useState<Array<{ shipmentId: string; confirmacion: string | null; palets: number; url: string | null; error: string | null }>>([])
  const [bol, setBol] = useState(e.seguimientoLtl?.bol ?? '')
  const [guardandoBol, setGuardandoBol] = useState(false)
  const palets = e.palets

  async function pedirPalet() {
    setPidiendoPalet(true)
    // A4.9: la pestaña se abre en el mismo clic (después del fetch el navegador la bloquea); si no llega a usarse, se cierra
    const ventana = window.open('', '_blank')
    let usada = false
    try {
      const res = await fetch(`/api/fba/remesas/${remesaId}/amazon/etiquetas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hoja, tipo: 'palet' }) })
      const j = (await res.json().catch(() => null)) as { enlaces?: typeof enlacesPalet; error?: string } | null
      if (!res.ok) {
        toast.error(j?.error ?? 'No se han podido pedir las etiquetas de palé')
        return
      }
      setEnlacesPalet(j?.enlaces ?? [])
      const primera = j?.enlaces?.find((x) => x.url)
      if (primera?.url && ventana && !ventana.closed) {
        ventana.location.href = primera.url
        usada = true
      }
    } finally {
      // Si no se ha llegado a usar (error, sin enlace), se cierra. No se lee su dirección: tras ir a Amazon es de otro dominio y daría error
      if (!usada) ventana?.close()
      setPidiendoPalet(false)
    }
  }

  async function guardarBol() {
    setGuardandoBol(true)
    try {
      const res = await fetch(`/api/fba/remesas/${remesaId}/amazon`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'guardar_seguimiento', bol }) })
      const j = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(j?.error ?? 'No se ha podido guardar el seguimiento')
        return
      }
      toast.success('Seguimiento mandado a Amazon')
      onEnviada()
    } finally {
      setGuardandoBol(false)
    }
  }

  // LOS NÚMEROS DE UPS (1Z…) de cada caja, para pegarlos tal cual en el formulario de recogida de UPS (separados por comas)
  const deSeguimiento = (x: EstadoDelEnvio['seguimiento']) => Object.fromEntries((x?.envios ?? []).map((v) => [v.shipmentId, v.numeros ?? []]))
  const [numerosUps, setNumerosUps] = useState<Record<string, string[]>>(() => deSeguimiento(e.seguimiento))
  const [leyendoUps, setLeyendoUps] = useState(false)
  const leerUps = useCallback(async (aviso: boolean) => {
    setLeyendoUps(true)
    try {
      const res = await fetch(`/api/fba/remesas/${remesaId}/amazon/seguimiento`, { method: 'POST' })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.error ?? 'No se han podido leer los números de UPS')
      const n = deSeguimiento(j?.seguimiento ?? null)
      setNumerosUps(n)
      if (aviso && !Object.values(n).some((l) => l.length)) toast.message('Amazon aún no ha dado los números de UPS. Prueba en unos minutos')
    } catch (err) {
      if (aviso) toast.error(err instanceof Error ? err.message : 'No se han podido leer los números de UPS')
    } finally {
      setLeyendoUps(false)
    }
  }, [remesaId])
  const hayUps = Object.values(numerosUps).some((l) => l.length > 0)
  useEffect(() => {
    if (!hayUps && e.paso === 'etiquetas' && Object.keys(e.cajasAmazon ?? {}).length > 0) void leerUps(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (e.paso !== 'etiquetas') {
    return <EstadoVacio icono={Tags} titulo="Las etiquetas salen al confirmar el transporte" descripcion="Etiqueta de caja de Amazon con la de UPS, una por caja." acento="remesas" />
  }

  async function pedir() {
    setPidiendo(true)
    const ventana = window.open('', '_blank')
    let usada = false
    try {
      const res = await fetch(`/api/fba/remesas/${remesaId}/amazon/etiquetas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hoja }) })
      const j = (await res.json().catch(() => null)) as { enlaces?: typeof enlaces; error?: string } | null
      if (!res.ok) {
        toast.error(j?.error ?? 'No se han podido pedir las etiquetas')
        return
      }
      setEnlaces(j?.enlaces ?? [])
      const primera = j?.enlaces?.find((x) => x.url)
      if (primera?.url && ventana && !ventana.closed) {
        ventana.location.href = primera.url
        usada = true
      }
    } finally {
      // Si no se ha llegado a usar (error, sin enlace), se cierra. No se lee su dirección: tras ir a Amazon es de otro dominio y daría error
      if (!usada) ventana?.close()
      setPidiendo(false)
    }
  }

  // Al salir la mercancía se marca «Enviada» con el FBA… que ya dio Amazon (el primero, si hay varios)
  async function marcarEnviada() {
    const ref = e.envios.find((x) => x.confirmacion)?.confirmacion
    if (!ref) {
      toast.error('No hay número FBA todavía')
      return
    }
    setMarcando(true)
    try {
      const r1 = await fetch(`/api/fba/remesas/${remesaId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ referenciaEnvio: ref }) })
      if (!r1.ok) throw new Error(((await r1.json().catch(() => null)) as { error?: string } | null)?.error ?? 'No se ha podido guardar el nº FBA')
      const r2 = await fetch(`/api/fba/remesas/${remesaId}/estado`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hasta: 'enviada', desde: 'lista' }) })
      if (!r2.ok) throw new Error(((await r2.json().catch(() => null)) as { error?: string } | null)?.error ?? 'No se ha podido marcar como enviada')
      // A4.9: con varios FBA (Amazon lo repartió en varios centros) se dice: el seguimiento los sigue todos
      const fbas = e.envios.map((x) => x.confirmacion).filter((x): x is string => !!x)
      toast.success(fbas.length > 1 ? `Marcada como enviada: la remesa lleva ${fbas.length} envíos FBA (${fbas.join(', ')}) y se siguen todos` : `Marcada como enviada (${ref})`)
      onEnviada()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido marcar como enviada')
      throw err
    } finally {
      setMarcando(false)
    }
  }

  const cajasAmazon = Object.entries(e.cajasAmazon ?? {})

  const copiar = async (texto: string, cuantos: number) => {
    try {
      await navigator.clipboard.writeText(texto)
      toast.success(`${cuantos} número${cuantos === 1 ? '' : 's'} de UPS copiado${cuantos === 1 ? '' : 's'}: pégalos en UPS`)
    } catch {
      toast.error('No se ha podido copiar: selecciónalos y cópialos a mano')
    }
  }
  return (
    <div className="space-y-3">
      <LoQueQueda remesaId={remesaId} e={e} palets={!!palets} />

      <Tarjeta indice={0} variante="destacada" acento="remesas" icono={Printer} titulo="Etiquetas de caja y de UPS" subtitulo="Una por caja. Los enlaces de Amazon caducan: se piden al pulsar">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Segmentado etiqueta="Formato de hoja" tamano="sm" opciones={HOJAS.map((h) => ({ id: h.id, texto: h.texto }))} valor={hoja} onCambio={setHoja} />
            {hoja !== hojaDelCliente ? (
              <Boton variante="fantasma" tamano="sm" icono={Pin} cargando={fijando} onClick={() => void fijarHoja()} title="Que esta hoja salga elegida siempre en los envíos de este cliente">
                Fijar para este cliente
              </Boton>
            ) : (
              <span className="text-[11px] text-[var(--ls-t4)]">La hoja de este cliente</span>
            )}
          </div>
          <Boton variante="primario" icono={Download} cargando={pidiendo} onClick={() => void pedir()}>
            Descargar etiquetas
          </Boton>
        </div>
        {enlaces.length > 0 && (
          <ul className="mt-3 space-y-2">
            {enlaces.map((l) => (
              <li key={l.shipmentId} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[var(--ls-linea)] px-3 py-2 text-[12.5px]">
                <span className="font-mono text-[var(--ls-t1)]">
                  {l.confirmacion ?? l.shipmentId} · {l.cajas} caja{l.cajas === 1 ? '' : 's'}
                </span>
                {l.url ? (
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold" style={{ color: ACENTO.remesas }}>
                    <Download className="h-[13px] w-[13px]" /> Abrir PDF
                  </a>
                ) : (
                  <span style={{ color: COLOR_ESTADO.rojo }}>{l.error}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      {palets && (
        <>
          <Tarjeta indice={1} variante="destacada" acento="remesas" icono={Printer} titulo="Etiquetas de palé" subtitulo={`${palets.cantidad} palé${palets.cantidad === 1 ? '' : 's'} · se pegan en los 4 lados de cada palé, a la vista`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12.5px] leading-[1.5] text-[var(--ls-t3)]">Salen con el formato de hoja de arriba. Si el palé lleva varias referencias («SKU mixtos») no hace falta la etiqueta de «Un único SKU». No tapes las etiquetas de las cajas con el film opaco ni con cartón.</p>
              <Boton variante="primario" icono={Download} cargando={pidiendoPalet} onClick={() => void pedirPalet()}>
                Descargar etiquetas de palé
              </Boton>
            </div>
            {enlacesPalet.length > 0 && (
              <ul className="mt-3 space-y-2">
                {enlacesPalet.map((l) => (
                  <li key={l.shipmentId} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[var(--ls-linea)] px-3 py-2 text-[12.5px]">
                    <span className="font-mono text-[var(--ls-t1)]">
                      {l.confirmacion ?? l.shipmentId} · {l.palets} palé{l.palets === 1 ? '' : 's'}
                    </span>
                    {l.url ? (
                      <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold" style={{ color: ACENTO.remesas }}>
                        <Download className="h-[13px] w-[13px]" /> Abrir PDF
                      </a>
                    ) : (
                      <span style={{ color: COLOR_ESTADO.rojo }}>{l.error}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>

          <Tarjeta indice={2} icono={Truck} titulo="Seguimiento y cita del transportista" subtitulo="Amazon lo pide para reconocer el camión en el almacén">
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="flex-1 text-[12px] text-[var(--ls-t3)]">
                  Nº de conocimiento de embarque (BOL)
                  <input
                    className="mt-1 h-10 w-full rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 text-[13px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-mod-remesas)] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:text-[16px]"
                    value={bol}
                    onChange={(v) => setBol(v.target.value)}
                    placeholder={e.envios[0]?.confirmacion ?? 'FBA…'}
                  />
                </label>
                <Boton variante="primario" icono={CheckCircle2} cargando={guardandoBol} disabled={!e.acciones.includes('guardar_seguimiento')} onClick={() => void guardarBol()}>
                  Guardar en Amazon
                </Boton>
              </div>
              <p className="text-[12px] text-[var(--ls-t3)]">
                {e.seguimientoLtl ? `${e.seguimientoLtl.estado === 'pendiente' ? 'Amazon lo está procesando' : 'Guardado en Amazon'} ${fechaHora(e.seguimientoLtl.at)}: ${e.seguimientoLtl.bol}. ` : ''}Si el transportista no te da un número propio, déjalo en blanco y se usa el nº de envío FBA.
              </p>
              <div className="rounded-[10px] border border-[var(--ls-linea)] p-3 text-[12.5px] leading-[1.6] text-[var(--ls-t2)]">
                <p className="mb-1 font-semibold text-[var(--ls-t1)]">Qué darle al transportista</p>
                <ul className="list-disc space-y-[2px] pl-4">
                  <li>
                    Envío FBA <b className="font-mono">{e.envios[0]?.confirmacion ?? '—'}</b>
                    {e.envios[0]?.destino ? ` → almacén ${e.envios[0].destino}${e.envios[0].ciudad ? ` (${e.envios[0].ciudad})` : ''}` : ''}
                  </li>
                  <li>
                    {e.cajas.cajas} caja{e.cajas.cajas === 1 ? '' : 's'} en {palets.cantidad} palé{palets.cantidad === 1 ? '' : 's'} de {palets.largoCm}×{palets.anchoCm}×{palets.altoCm} cm y {palets.pesoKg} kg
                  </li>
                  <li>La referencia de Amazon (en Seller Central, «Seguimiento del envío») y la franja de entrega que Amazon confirmó</li>
                  <li>Tiene que reservar la CITA de entrega en el almacén dentro de esa franja: sin cita no los recibe nadie</li>
                </ul>
              </div>
            </div>
          </Tarjeta>
        </>
      )}

      {!palets && <DatosRecogidaUps e={e} numeros={Object.values(numerosUps).flat()} />}

      {cajasAmazon.length > 0 && (
        <Tarjeta indice={palets ? 3 : 1} icono={Boxes} titulo="Qué etiqueta va en cada caja" subtitulo="Emparejadas por contenido y peso con las cajas del ERP">
          <div className="space-y-3">
            {cajasAmazon.map(([sid, cajas]) => (
              <div key={sid}>
                <p className="mb-1 font-mono text-[12px] text-[var(--ls-t3)]">{e.envios.find((x) => x.shipmentId === sid)?.confirmacion ?? sid}</p>
                {(numerosUps[sid]?.length ?? 0) > 0 ? (
                  <div className="mb-2 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-semibold text-[var(--ls-t1)]">Números de seguimiento de UPS ({numerosUps[sid].length})</span>
                      <Boton variante="primario" tamano="sm" icono={Copy} onClick={() => void copiar(numerosUps[sid].join(','), numerosUps[sid].length)} className="ml-auto">
                        Copiar para UPS
                      </Boton>
                    </div>
                    <textarea readOnly value={numerosUps[sid].join(',')} onFocus={(ev) => ev.currentTarget.select()} rows={2} className="w-full resize-none rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2 py-1 font-mono text-[11.5px] text-[var(--ls-t1)]" aria-label="Números de UPS separados por comas" />
                    {numerosUps[sid].length > 30 && <p className="text-[11px]" style={{ color: COLOR_ESTADO.ambar }}>UPS admite 30 por recogida: pégalos en dos veces.</p>}
                  </div>
                ) : (
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-[var(--ls-t3)]">
                    <span>{leyendoUps ? 'Leyendo los números de UPS en Amazon…' : 'Los números de UPS (1Z…) aún no están: Amazon los da al confirmar el transporte.'}</span>
                    <Boton variante="secundario" tamano="sm" icono={RefreshCw} cargando={leyendoUps} onClick={() => void leerUps(true)}>
                      Leer números de UPS
                    </Boton>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-[6px] sm:grid-cols-3 lg:grid-cols-4">
                  {cajas.slice(0, 200).map((c) => (
                    <span key={c.boxId} className="truncate rounded-[8px] border border-[var(--ls-linea)] px-2 py-1 text-[11.5px] text-[var(--ls-t2)]">
                      <b className="text-[var(--ls-t1)]">Caja {c.numero ?? '¿?'}</b> · <span className="font-mono">{c.boxId}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Tarjeta>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <p className="text-[12px] text-[var(--ls-t3)] sm:mr-auto">{palets ? 'Cuando el transportista se lleve el palé' : 'Cuando UPS se lleve la mercancía'}, márcala como enviada: pasa a «Envíos» con su nº FBA.</p>
        <Boton variante="secundario" icono={Truck} cargando={marcando} onClick={() => setConfirmarEnviada(true)}>
          Marcar como enviada
        </Boton>
      </div>
      <Confirmacion
        abierto={confirmarEnviada}
        onCambio={setConfirmarEnviada}
        palabra={null}
        tono="normal"
        titulo="Marcar como enviada"
        textoConfirmar="Marcar enviada"
        descripcion="La remesa pasa a «Envíos» y se sigue por su nº FBA. Mientras dure el plazo de anulación, cancelar se hace desde la pestaña «Amazon (API)» del envío."
        onConfirmar={marcarEnviada}
      />
    </div>
  )
}

/* 6 · Seguimiento -------------------------------------------------- */

function FaseSeguimiento({ e, trabajando, enviar, ahora }: { e: EstadoDelEnvio; trabajando: string | null; enviar: Enviar; ahora: Date }) {
  const [cancelar, setCancelar] = useState(false)
  const hitos: Hito[] = e.operaciones.map((o) => ({
    id: o.id,
    titulo: `${o.operacion}${o.estado === 'en_curso' ? ' · en curso' : o.estado === 'fallo' ? ' · falló' : ''}`,
    descripcion: o.problemas.length ? o.problemas.map((p) => p.message).join('. ') : undefined,
    cuando: o.terminadaAt ?? o.creadaAt,
    tono: o.estado === 'ok' ? 'verde' : o.estado === 'fallo' ? 'rojo' : 'cian',
    icono: o.estado === 'ok' ? CheckCircle2 : o.estado === 'fallo' ? AlertTriangle : RefreshCw,
    autor: o.autor ?? undefined,
  }))
  const puedeCancelar = e.acciones.includes('cancelar')
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Tarjeta
          indice={0}
          icono={Route}
          titulo="Estado en Amazon"
          subtitulo={e.seguimiento ? `Leído ${fechaHora(e.seguimiento.at)}` : 'Sin leer todavía'}
          acciones={
            e.inboundPlanId ? (
              <Boton tamano="sm" variante="fantasma" icono={RefreshCw} cargando={trabajando === 'seguir'} onClick={() => void enviar({}, '/seguimiento', 'seguir')}>
                Leer
              </Boton>
            ) : null
          }
        >
          {e.seguimiento ? (
            <div className="space-y-2 text-[12.5px]">
              <p>
                Plan: <Insignia tono={e.seguimiento.estadoPlan === 'VOIDED' ? 'gris' : e.seguimiento.estadoPlan === 'ERRORED' ? 'rojo' : 'verde'}>{e.seguimiento.estadoPlan}</Insignia>
              </p>
              {e.seguimiento.envios.map((s) => (
                <p key={s.shipmentId} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{s.confirmacion ?? s.shipmentId}</span>
                  <Insignia tono="cian">{s.estado ?? '—'}</Insignia>
                  {s.invalidos > 0 && <Insignia tono="rojo">{s.invalidos} seguimiento(s) inválido(s)</Insignia>}
                </p>
              ))}
            </div>
          ) : (
            <ListaDeEnvios e={e} />
          )}
        </Tarjeta>
        <Tarjeta indice={1} icono={Ban} titulo="Cancelar" subtitulo={e.cancelable.motivo || 'Nada que cancelar'}>
          {e.transporteConfirmadoAt && <AnulableHasta hasta={e.anulableHasta} ahora={ahora} />}
          <div className="mt-3">
            <Boton variante="peligro" icono={Ban} disabled={!puedeCancelar} cargando={trabajando === 'cancelar'} onClick={() => setCancelar(true)}>
              Cancelar el plan en Amazon
            </Boton>
          </div>
        </Tarjeta>
      </div>

      <Tarjeta indice={2} icono={Clock} titulo="Operaciones con Amazon" subtitulo="Cada paso, con su resultado y quién lo lanzó">
        {hitos.length ? <LineaDeTiempo eventos={hitos} maximo={20} /> : <p className="text-[12.5px] text-[var(--ls-t3)]">Todavía no se ha hablado con Amazon.</p>}
        {e.avisos.length > 0 && (
          <div className="mt-3 rounded-[10px] border border-[var(--ls-linea)] p-3">
            <p className="mb-1 text-[12px] font-semibold text-[var(--ls-t2)]">Avisos de Amazon</p>
            <ul className="list-disc space-y-1 pl-4 text-[12px] text-[var(--ls-t3)]">
              {e.avisos.slice(-8).map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        )}
      </Tarjeta>

      <Confirmacion
        abierto={cancelar}
        onCambio={setCancelar}
        palabra={e.cancelable.grave ? 'CANCELAR' : null}
        titulo="Cancelar el plan en Amazon"
        textoConfirmar="Cancelar plan"
        descripcion={e.cancelable.grave ? 'Se cancelan los envíos FBA ya creados. Con el transporte de UPS confirmado, el cargo solo se anula dentro del plazo. Las cajas se desbloquean.' : 'Todavía no hay envíos reales: el plan se cancela sin rastro y las cajas se desbloquean.'}
        onConfirmar={async () => {
          const ok = await enviar({ accion: 'cancelar', grave: e.cancelable.grave, palabra: e.cancelable.grave ? 'CANCELAR' : undefined }, '', 'cancelar')
          if (!ok) throw new Error('no')
        }}
      />
    </div>
  )
}

/**
 * LOS DATOS PARA PEDIR LA RECOGIDA EN UPS, en el orden de su formulario y cada uno con su botón de copiar: empresa, dirección, ciudad,
 * código postal, teléfono, paquetes, peso y servicio (UPS Standard nacional: lo que pone la etiqueta del UPS de Amazon dentro de España).
 */
function DatosRecogidaUps({ e, numeros }: { e: EstadoDelEnvio; numeros: string[] }) {
  const d = e.direccion
  const contacto = e.recogida?.contacto ?? null
  const nacional = (d?.pais ?? 'ES').toUpperCase() === 'ES'
  const filas: Array<{ rotulo: string; valor: string | null }> = [
    { rotulo: 'Empresa o nombre', valor: d?.empresa || d?.nombre || null },
    { rotulo: 'Nombre de contacto', valor: contacto?.nombre ?? d?.nombre ?? null },
    { rotulo: 'Línea de dirección 1', valor: d?.linea1 ?? null },
    { rotulo: 'Dirección (línea 2)', valor: d?.linea2 || null },
    { rotulo: 'Ciudad', valor: d?.ciudad ?? null },
    { rotulo: 'Código postal', valor: d?.codigoPostal ?? null },
    { rotulo: 'Teléfono', valor: contacto?.telefono ?? d?.telefono ?? null },
    { rotulo: 'Paquetes en la recogida', valor: e.cajas.cajas ? String(e.cajas.cajas) : null },
    { rotulo: 'Peso total (kg)', valor: e.cajas.pesoKg ? String(Math.round(e.cajas.pesoKg * 10) / 10).replace('.', ',') : null },
    { rotulo: 'Servicio de UPS', valor: nacional ? 'UPS Standard (servicios nacionales)' : 'UPS Standard (servicios internacionales)' },
    { rotulo: 'Día de recogida', valor: e.recogida?.dia ? e.recogida.dia.split('-').reverse().join('/') : null },
  ]
  const copiar = async (texto: string, que: string) => {
    try {
      await navigator.clipboard.writeText(texto)
      toast.success(`${que} copiado`)
    } catch {
      toast.error('No se ha podido copiar: selecciónalo y cópialo a mano')
    }
  }
  return (
    <Tarjeta indice={1} icono={Truck} titulo="Datos para pedir la recogida en UPS" subtitulo="Tal cual van en el formulario de recogida de UPS. Pulsa en cada uno para copiarlo">
      <div className="grid gap-[6px] sm:grid-cols-2">
        {filas
          .filter((f) => f.valor)
          .map((f) => (
            <button
              key={f.rotulo}
              type="button"
              onClick={() => void copiar(f.rotulo === 'Servicio de UPS' ? 'UPS Standard' : (f.valor as string), f.rotulo)}
              className="group flex min-w-0 items-center justify-between gap-3 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-[7px] text-left transition-colors hover:border-[var(--ls-acc)]"
              title="Copiar"
            >
              <span className="min-w-0">
                <span className="block text-[11px] text-[var(--ls-t4)]">{f.rotulo}</span>
                <span className="block truncate text-[13px] font-medium text-[var(--ls-t1)]">{f.valor}</span>
              </span>
              <Copy className="h-[14px] w-[14px] shrink-0 text-[var(--ls-t4)] group-hover:text-[var(--ls-acc)]" />
            </button>
          ))}
      </div>
      {numeros.length > 0 && (
        <p className="mt-2 text-[12px] text-[var(--ls-t3)]">
          Los {numeros.length} números de seguimiento (1Z…) para comprobar los cargos están abajo, con «Copiar para UPS».
        </p>
      )}
    </Tarjeta>
  )
}

/** El error de Amazon en cristiano (qué ha pasado y qué hacer) con el texto original plegado debajo; si no se conoce, el texto tal cual */
function ErrorExplicado({ texto }: { texto: string }) {
  const x = explicarErrorAmazon(texto)
  if (!x)
    return (
      <p className="mt-1 text-[12.5px] leading-[1.5]" style={{ color: COLOR_ESTADO.rojo }}>
        Amazon dice: {texto}
        <span className="mt-1 block text-[12px] text-[var(--ls-t3)]">Corrige lo que diga y reintenta el paso, o cancela el plan en «Seguimiento».</span>
      </p>
    )
  return (
    <div className="mt-1 space-y-1 text-[12.5px] leading-[1.5]">
      <p className="font-semibold" style={{ color: COLOR_ESTADO.rojo }}>{x.titulo}</p>
      <p className="text-[var(--ls-t2)]">{x.queHacer}</p>
      <details className="text-[11.5px] text-[var(--ls-t4)]">
        <summary className="cursor-pointer select-none hover:text-[var(--ls-t2)]">Lo que ha contestado Amazon</summary>
        <p className="mt-1 break-words font-mono">{texto}</p>
      </details>
    </div>
  )
}

/**
 * LO QUE QUEDA PARA QUE SALGA, en orden y con su casilla (se recuerda en este navegador por remesa): imprimir, pegar cada etiqueta en su caja,
 * la pegatina de «pesado», pedir la recogida y marcarla como enviada. Es la lista que hasta ahora había que llevar de cabeza.
 */
function LoQueQueda({ remesaId, e, palets }: { remesaId: string; e: EstadoDelEnvio; palets: boolean }) {
  const clave = `envio-pasos-${remesaId}`
  const [hechos, setHechos] = useState<Record<string, boolean>>({})
  useEffect(() => {
    try {
      setHechos(JSON.parse(localStorage.getItem(clave) ?? '{}') as Record<string, boolean>)
    } catch {
      setHechos({})
    }
  }, [clave])
  const marcar = (id: string) =>
    setHechos((h) => {
      const n = { ...h, [id]: !h[id] }
      try {
        localStorage.setItem(clave, JSON.stringify(n))
      } catch {
        /* sin almacenamiento: la casilla vale mientras la pantalla esté abierta */
      }
      return n
    })
  const pesado = e.cajas.problemas.find((p) => p.texto.includes('«pesado»'))?.texto ?? null
  const pasos: Array<{ id: string; texto: string; detalle?: string }> = [
    { id: 'imprimir', texto: `Imprime las etiquetas: ${e.cajas.cajas} caja${e.cajas.cajas === 1 ? '' : 's'}`, detalle: palets ? 'Y las de palé' : 'Cada hoja lleva la de Amazon y la de UPS' },
    { id: 'pegar', texto: 'Pega cada etiqueta en su caja', detalle: 'La caja 1 con «Box 1 of …», y así: abajo, «Qué etiqueta va en cada caja»' },
    ...(pesado ? [{ id: 'pesado', texto: 'Pegatina de «pesado»', detalle: pesado }] : []),
    palets
      ? { id: 'recogida', texto: 'Pasa los datos al transportista', detalle: 'Con la referencia del envío y la cita en el almacén' }
      : { id: 'recogida', texto: `Pide la recogida en UPS${e.recogida?.dia ? ` para el ${fechaDia(e.recogida.dia)}` : ''}`, detalle: 'Con los datos de abajo: se copian con un toque' },
    { id: 'enviada', texto: 'Cuando se lo lleven, «Marcar como enviada»', detalle: 'Pasa a «Envíos» con su nº FBA' },
  ]
  const hechas = pasos.filter((p) => hechos[p.id]).length
  return (
    <Tarjeta indice={0} icono={ClipboardCheck} titulo="Lo que queda para que salga" subtitulo={hechas === pasos.length ? 'Todo hecho' : `${hechas} de ${pasos.length} hechos`}>
      <ol className="space-y-[6px]">
        {pasos.map((p, i) => {
          const ok = !!hechos[p.id]
          return (
            <li key={p.id}>
              <button type="button" onClick={() => marcar(p.id)} className="flex w-full items-start gap-3 rounded-[10px] px-2 py-[6px] text-left transition-colors hover:bg-[var(--ls-sup2)]" aria-pressed={ok}>
                <span className="mt-[1px] flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold" style={ok ? { background: COLOR_ESTADO.verde, borderColor: COLOR_ESTADO.verde, color: '#0b2e17' } : { borderColor: 'var(--ls-linea2)', color: 'var(--ls-t3)' }}>
                  {ok ? <CheckCircle2 className="h-[13px] w-[13px]" /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className={`block text-[13px] font-medium ${ok ? 'text-[var(--ls-t4)] line-through' : 'text-[var(--ls-t1)]'}`}>{p.texto}</span>
                  {p.detalle && <span className="block text-[11.5px] leading-[1.45] text-[var(--ls-t3)]">{p.detalle}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </Tarjeta>
  )
}

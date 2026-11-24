'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { MotionConfig } from 'framer-motion'
import {
  AlertTriangle, ArrowRight, Copy, Lock, MoreHorizontal, Plane, RefreshCw, Settings2, Sparkles, Target, Timer, Truck, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Boton } from '@/components/ui-ls/Boton'
import { EsqueletoTabla, EsqueletoTarjeta } from '@/components/ui-ls/Esqueleto'
import { EstadoVacio } from '@/components/ui-ls/EstadoVacio'
import { Insignia } from '@/components/ui-ls/Insignia'
import { Tarjeta } from '@/components/ui-ls/Tarjeta'
import { haceCuanto } from '@/components/ui-ls/utilidades'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { diaEnEspana } from '@/lib/fba/fechas'
import { ESTADOS_ACTIVOS, type EnvioPropuestoCalculado, type EnvioPropuestoGuardado, type PlanCliente, type RevisionIa } from '@/lib/fba/plan-tipos'
import { decimal, dias, dinero, entero, fechaCorta, unidades } from '../formato'
import { AjustesReposicion } from '../comun/AjustesReposicion'
import { BandaDeCalidad } from '../comun/BandaDeCalidad'
import { leerRespuesta } from '../comun/errores'
import { ESTADO_ENVIO, ORIGEN_ETAPA, PRIORIDAD, compararPrioridad } from '../comun/estilo-plan'
import type { CallbacksRemesas, ClienteRemesas, SesionRemesas } from '../comun/tipos-ui'
import { invalidarRemesas } from '../comun/useAgencia'
import { usePlan } from '../comun/usePlan'
import { cx } from '../comun/ui'
import { GruposDeAtencion } from './GruposDeAtencion'
import { PanelReponer } from './PanelReponer'
import { VendeFbmSinFba } from './VendeFbmSinFba'
import { TablaPlanSku } from './TablaPlanSku'
import { etapasDelPlazo, textoAcierto, textoPlazo, tonoAcierto } from './calculos'

/**
 * REPOSICIÓN DE UN CLIENTE (spec remesas-pro §1.5, §2, §6.3, D2, D5, D7, D8, D9, D10, D13, D16 y D43; paquete C5).
 *
 * Solo agencia (el cliente externo no ve esta sección, §1.3). De arriba abajo:
 *   1. BandaDeCalidad del plan, con «Confirmar plazos» (PUT /api/fba/alertas/config { confirmarPlazos: true } y
 *      recálculo), «Poner plazos» (abre los ajustes) y «Leer de Amazon» (solo admin, si quien monta la vista lo pasa).
 *   2. Cabecera: calculado hace X, el acierto del plan («acertó ±18 % el último mes») y los botones Recalcular
 *      (POST /api/fba/plan), Revisar con IA (POST /api/fba/plan/ia; 2 al día a mano), Propuesta a medida
 *      (`onPropuestaAMedida`) y Ajustes. En el móvil, del tercero en adelante van al menú «⋯».
 *   3. KPI: referencias que piden envío, unidades, roturas en 14 días, € en juego y primera rotura.
 *   4. El plazo hasta la venta etapa a etapa, con el origen de cada una (a mano, medido, de partida) y lo medido.
 *   5. Los envíos propuestos de este cliente (guardados si está la 316; si no, los calculados, sin gestión).
 *      Pulsar uno → `onAbrirEnvioPropuesto(id)`.
 *   6. La última revisión de la IA (resumen, avisos, ajustes sugeridos con su recálculo, mensajes con «Copiar»).
 *   7. MapaDeCobertura (ReferenceLine en L y L + M) y GruposDeAtencion (agotados, exceso, entrante, tallas).
 *   8. TablaPlanSku con TODAS las referencias (GET /api/fba/plan?todas=1).
 *   9. AjustesReposicion (de components/remesas/comun, S7), plegado hasta que se pide.
 *
 * Datos: `usePlan(cliente.id, { todas: true })` (memoria de 5 min; se vacía con invalidarRemesas tras cualquier
 * escritura). Sin pasada todavía, la ruta calcula al vuelo.
 *
 * API
 *   <VistaReposicion sesion cliente onAbrirEnvioPropuesto onIrA onPropuestaAMedida onImportarPedidos onLeerAmazon? leyendo? />
 */

export interface VistaReposicionProps extends CallbacksRemesas {
  sesion: SesionRemesas
  cliente: ClienteRemesas
  /** «Leer de Amazon» en la banda (solo admin: gasta cupo de informes) */
  onLeerAmazon?: () => void | Promise<void>
  leyendo?: boolean
}

const TEXTO_GRAVEDAD = { alta: { tono: 'rojo', texto: 'Importante' }, media: { tono: 'ambar', texto: 'Ojo' }, info: { tono: 'azul', texto: 'Nota' } } as const

/** Desplazamiento suave salvo con «reducir movimiento» */
const suave = (): ScrollBehavior =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'

async function copiar(texto: string, exito: string) {
  try {
    await navigator.clipboard.writeText(texto)
    toast.success(exito)
  } catch {
    toast.error('No se ha podido copiar: selecciona el texto y cópialo a mano')
  }
}

export function VistaReposicion({ sesion, cliente, onAbrirEnvioPropuesto, onIrA, onImportarPedidos, onLeerAmazon, leyendo }: VistaReposicionProps) {
  const esAgencia = sesion.esAgencia && sesion.actor === 'agencia'
  const puedeEditar = esAgencia && cliente.puedeEditar
  const datos = usePlan(esAgencia ? cliente.id : null, { todas: true })
  const plan = datos.deAgencia ? (datos.plan as PlanCliente) : null
  const hoy = plan?.hoy ?? diaEnEspana()

  const [skuAbierto, setSkuAbierto] = useState<string | null>(null)
  // C8: llegar con ?sku= (desde la ficha de Stock) abre esa referencia en la tabla del plan
  useEffect(() => {
    try {
      const sku = new URLSearchParams(window.location.search).get('sku')
      if (sku) setSkuAbierto(sku)
    } catch {
      /* sin URL: nada */
    }
  }, [cliente.id])
  const [ajustesAbiertos, setAjustesAbiertos] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [revisando, setRevisando] = useState(false)
  const [revisionNueva, setRevisionNueva] = useState<RevisionIa | null>(null)
  const [revisionCerrada, setRevisionCerrada] = useState(false)
  const [menu, setMenu] = useState(false)
  const refAjustes = useRef<HTMLDivElement>(null)
  const refTabla = useRef<HTMLDivElement>(null)
  const refMenu = useRef<HTMLDivElement>(null)

  // Al cambiar de cliente, nada de lo abierto del anterior
  useEffect(() => {
    setSkuAbierto(null)
    setRevisionNueva(null)
    setRevisionCerrada(false)
    setAjustesAbiertos(false)
  }, [cliente.id])

  useEffect(() => {
    if (ajustesAbiertos) refAjustes.current?.scrollIntoView({ behavior: suave(), block: 'start' })
  }, [ajustesAbiertos])

  useEffect(() => {
    if (!menu) return
    const fuera = (e: MouseEvent) => {
      if (refMenu.current && !refMenu.current.contains(e.target as Node)) setMenu(false)
    }
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false)
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [menu])

  const enviosGuardados = useMemo(
    () =>
      datos.envios
        .filter((e) => e.clienteId === cliente.id && ESTADOS_ACTIVOS.includes(e.estado))
        .sort((a, b) => Number(b.vencido) - Number(a.vencido) || compararPrioridad(a.prioridad, b.prioridad) || a.salirAntesDe.localeCompare(b.salirAntesDe)),
    [datos.envios, cliente.id],
  )
  const revisionGuardada = useMemo(() => {
    const conIa = datos.envios.filter((e) => e.ia).sort((a, b) => (b.ia?.creadoAt ?? '').localeCompare(a.ia?.creadoAt ?? ''))
    return conIa[0]?.ia ?? null
  }, [datos.envios])
  const revision = revisionCerrada ? null : revisionNueva ?? revisionGuardada

  if (!esAgencia) {
    return <EstadoVacio icono={Lock} acento="remesas" titulo="La reposición la lleva Liberty Seller" descripcion="Aquí se decide qué enviar y cuándo. Tú lo ves en «Stock» y en las propuestas." />
  }

  /* ---------------- acciones ---------------- */

  function abrirSku(sku: string | null) {
    setSkuAbierto(sku)
  }

  function abrirAjustes() {
    setMenu(false)
    if (ajustesAbiertos) refAjustes.current?.scrollIntoView({ behavior: suave(), block: 'start' })
    else setAjustesAbiertos(true)
  }

  async function confirmarPlazos() {
    setConfirmando(true)
    try {
      const r = await fetch('/api/fba/alertas/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clienteId: cliente.id, confirmarPlazos: true }),
      })
        .then((res) => leerRespuesta<unknown>(res, 'No se han podido confirmar los plazos'))
        .catch(() => ({ ok: false as const, estado: 0, error: 'No hay conexión con el servidor: comprueba la red y vuelve a probar.', datos: null }))
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(`Plazos de ${cliente.nombre} confirmados`)
      invalidarRemesas(cliente.id)
      // La pasada guardada aún dice «de partida»: se recalcula para que la banda lo vea
      await datos.recalcular()
    } finally {
      setConfirmando(false)
    }
  }

  async function revisarConIa() {
    setMenu(false)
    setRevisando(true)
    try {
      const r = await fetch('/api/fba/plan/ia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clienteId: cliente.id }) })
        .then((res) => leerRespuesta<{ revision: RevisionIa }>(res, 'No se ha podido revisar el plan con la IA'))
        .catch(() => ({ ok: false as const, estado: 0, error: 'No hay conexión con el servidor: comprueba la red y vuelve a probar.', datos: null }))
      if (!r.ok) {
        if (r.estado === 429) toast.message(r.error)
        else toast.error(r.error)
        return
      }
      setRevisionNueva(r.datos.revision)
      setRevisionCerrada(false)
      if (r.datos.revision.aviso) toast.warning(r.datos.revision.aviso)
      else toast.success('Plan revisado por la IA')
      invalidarRemesas(cliente.id)
    } finally {
      setRevisando(false)
    }
  }

  async function recalcular() {
    setMenu(false)
    await datos.recalcular()
  }

  /* ---------------- estados de carga ---------------- */

  if (!plan) {
    if (datos.error) {
      return (
        <EstadoVacio
          icono={AlertTriangle}
          acento="remesas"
          titulo={datos.estado === 403 ? 'No tienes acceso a este plan' : 'No se ha podido leer el plan'}
          descripcion={datos.error}
          accion={datos.estado === 403 ? undefined : { texto: 'Volver a probar', icono: RefreshCw, onClick: () => void datos.recargar() }}
        />
      )
    }
    return (
      <div className="space-y-4" aria-busy>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <EsqueletoTarjeta key={i} />
          ))}
        </div>
        <EsqueletoTabla columnas={6} filas={8} />
      </div>
    )
  }

  const { resumen, plazo, ajustes, medidas, calidad } = plan
  const moneda = plan.moneda || cliente.moneda
  const tp = textoPlazo(plazo, hoy)
  const acierto = textoAcierto(plan.acierto, hoy)
  const calculadoAt = datos.pasada?.calculadoAt ?? calidad.calculadoAt
  const sin316 = datos.migracion316 === false
  const enviosCalculados: EnvioPropuestoCalculado[] = sin316 ? plan.envios : []

  const botonesExtra = (
    <>
      <Boton tamano="sm" variante="secundario" icono={Sparkles} cargando={revisando} disabled={!puedeEditar || revisando || sin316} onClick={() => void revisarConIa()} title={sin316 ? 'Falta lanzar la migración 316' : 'La IA revisa el plan y avisa de lo raro (2 veces al día como mucho)'}>
        Revisar con IA
      </Boton>
      <Boton tamano="sm" variante="secundario" icono={Settings2} onClick={abrirAjustes}>
        Ajustes
      </Boton>
    </>
  )

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-w-0 space-y-4">
        <BandaDeCalidad
          calidad={calidad}
          esAdmin={sesion.esAdmin}
          puedeEditar={puedeEditar}
          hoy={hoy}
          onLeerAmazon={sesion.esAdmin ? onLeerAmazon : undefined}
          leyendo={leyendo}
          onConfirmarPlazos={puedeEditar ? confirmarPlazos : undefined}
          confirmando={confirmando}
          onPonerPlazos={puedeEditar ? abrirAjustes : undefined}
        />

        {/* Cabecera de la sección */}
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">Reponer · {cliente.nombre}</h2>
            <p className="mt-[2px] flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--ls-t4)]">
              <span>{calculadoAt ? `Plan calculado ${haceCuanto(calculadoAt)}` : 'Plan calculado ahora (sin pasada guardada)'}</span>
              {calidad.provisional && <Insignia tono="ambar" tamano="sm">Provisional</Insignia>}
              {acierto && plan.acierto && (
                <Insignia tono={tonoAcierto(plan.acierto.errorPct)} tamano="sm" icono={Target} title="Ritmo previsto hace 30 días frente a lo que se vendió de verdad">
                  {acierto}
                </Insignia>
              )}
              {!acierto && <span title="Hace falta una pasada de hace 30 días para medirlo">Acierto: aún sin medir</span>}
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Boton tamano="sm" variante="secundario" icono={RefreshCw} cargando={datos.recalculando} disabled={!puedeEditar || datos.recalculando} onClick={() => void recalcular()} title="Vuelve a calcular el plan con los datos de ahora (1 vez cada 2 minutos)">
              Recalcular
            </Boton>
            {/* «Propuesta a medida (IA)» está en la cabecera del cliente */}
            <span className="hidden items-center gap-2 lg:inline-flex">{botonesExtra}</span>
            <div ref={refMenu} className="relative lg:hidden">
              <Boton tamano="sm" variante="fantasma" icono={MoreHorizontal} soloIcono aria-label="Más acciones" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu((v) => !v)} />
              {menu && (
                <div role="menu" className="absolute right-0 top-[calc(100%+6px)] z-20 flex w-[220px] flex-col gap-1 rounded-[14px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-2 shadow-[var(--ls-sombra-2)] [&>button]:w-full [&>button]:justify-start">
                  {botonesExtra}
                </div>
              )}
            </div>
          </div>
        </div>

        {sin316 && (
          <p className="rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-2 text-[12.5px] text-[var(--ls-t2)]" style={{ borderLeft: `3px solid ${COLOR_ESTADO.ambar}` }}>
            Falta lanzar la migración 316: el plan se ve pero no se puede gestionar (ni guardar envíos propuestos, ni revisar con la IA).
          </p>
        )}

        {/* Cuándo reponer: semáforo, una barra de cobertura por referencia (o modelo) y los envíos abiertos. Sustituye a la fila de KPI y al mapa de cobertura */}
        <PanelReponer
          lineas={plan.lineas}
          plazo={plazo}
          plazoDePartida={Object.values(plazo.origen ?? {}).includes('partida')}
          hoy={hoy}
          moneda={moneda}
          envios={enviosGuardados}
          onAbrirSku={abrirSku}
          onAbrirEnvio={onAbrirEnvioPropuesto}
        />

        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          {/* Plazo con el origen de cada etapa */}
          <Tarjeta
            titulo="Plazo hasta la venta"
            subtitulo={`${dias(plazo.hastaLaVenta)} + ${dias(plazo.margen)} de margen`}
            icono={Timer}
            acento="remesas"
            acciones={
              puedeEditar ? (
                <Boton tamano="sm" variante="fantasma" onClick={abrirAjustes}>
                  Ajustar
                </Boton>
              ) : undefined
            }
          >
            <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {etapasDelPlazo(plazo).map((e) => (
                <li key={e.clave} className="min-w-0 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2">
                  <p className="truncate text-[11.5px] text-[var(--ls-t4)]">{e.titulo}</p>
                  <p className="text-[18px] font-semibold tabular-nums text-[var(--ls-t1)]">
                    {entero(e.dias)} <span className="text-[12px] font-normal text-[var(--ls-t3)]">d</span>
                  </p>
                  <Insignia tono={ORIGEN_ETAPA[e.origen].tono} tamano="sm" variante={e.origen === 'partida' ? 'contorno' : 'suave'}>
                    {ORIGEN_ETAPA[e.origen].texto}
                  </Insignia>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">{tp.frase}.</p>
            <p className="mt-1 text-[11.5px] leading-[1.5] text-[var(--ls-t4)]">
              {medidas.enviosMedidos > 0
                ? `Medido en ${entero(medidas.enviosMedidos)} envíos: transporte ${medidas.transporteMediano !== null ? dias(medidas.transporteMediano) : '—'} (mediana), recepción ${medidas.recepcionP75 !== null ? dias(medidas.recepcionP75) : '—'} (p75)`
                : 'Todavía no hay envíos suficientes para medir el plazo'}
              {medidas.cadenciaDias !== null ? ` · envía cada ${dias(medidas.cadenciaDias)}${medidas.tamanoTipico !== null ? `, ~${unidades(medidas.tamanoTipico)}` : ''}` : ''}
              {` · cubre ${dias(ajustes.coberturaObjetivo)} tras llegar (máximo ${dias(ajustes.coberturaMaxima)})`}.
            </p>
            {plazo.transporteUrgente !== null && (
              <p className="mt-1 flex items-center gap-1 text-[11.5px] text-[var(--ls-t3)]">
                <Plane className="h-3 w-3" aria-hidden /> En avión: {dias(plazo.transporteUrgente)} de transporte.
              </p>
            )}
            {plazo.sinConfirmar && puedeEditar && (
              <p className="mt-3 rounded-[10px] px-3 py-2 text-[12px] text-[var(--ls-t2)]" style={{ background: 'color-mix(in srgb, var(--ls-e-ambar) 10%, transparent)' }}>
                Hay etapas «de partida»: confírmalas en la banda de arriba si cuadran con cómo trabaja.
              </p>
            )}
          </Tarjeta>

          {/* Envíos propuestos de este cliente: los abiertos ya salen en el panel «Reponer»; aquí solo los calculados sin la 316 */}
          {sin316 && <Tarjeta
            titulo="Envíos propuestos"
            subtitulo={sin316 ? 'Calculados ahora (sin la 316 no se guardan)' : enviosGuardados.length === 0 ? 'Ninguno abierto' : `${entero(enviosGuardados.length)} abiertos`}
            icono={Truck}
            acento="remesas"
            acciones={
              <Boton tamano="sm" variante="fantasma" iconoDerecha={ArrowRight} onClick={() => onIrA('plan', undefined, { cliente: cliente.id })}>
                Ver en Plan
              </Boton>
            }
          >
            {!sin316 && enviosGuardados.length === 0 && enviosCalculados.length === 0 ? (
              <EstadoVacio compacto acento="remesas" icono={Truck} titulo="Nada que enviar por ahora" descripcion={resumen.primeraRotura ? `La primera rotura es el ${fechaCorta(resumen.primeraRotura, hoy)}: el plan avisará cuando toque.` : 'Ninguna referencia rompe a la vista.'} />
            ) : (
              <ul className="grid min-w-0 gap-2 sm:grid-cols-2">
                {enviosGuardados.map((e) => (
                  <TarjetaEnvio key={e.id} envio={e} hoy={hoy} moneda={moneda} onAbrir={() => onAbrirEnvioPropuesto(e.id)} />
                ))}
                {enviosCalculados.map((e) => (
                  <TarjetaEnvio key={e.clave} envio={e} hoy={hoy} moneda={moneda} />
                ))}
              </ul>
            )}
          </Tarjeta>}
        </div>

        {revision && <PanelRevision revision={revision} hoy={hoy} onCerrar={() => setRevisionCerrada(true)} onElegirSku={abrirSku} />}

        <div className="min-w-0">
          <GruposDeAtencion
            lineas={plan.lineas}
            ajustes={ajustes}
            hoy={hoy}
            clienteId={cliente.id}
            clienteNombre={cliente.nombre}
            puedeEditar={puedeEditar}
            onImportarPedidos={onImportarPedidos}
            onElegirSku={abrirSku}
            alCambiar={() => void datos.recargar()}
          />
        </div>

        {plan.calidad.fbmSinFba && plan.calidad.fbmSinFba.length > 0 && (
          <VendeFbmSinFba lista={plan.calidad.fbmSinFba} leidoHasta={plan.calidad.fbmLeidoHasta} hoy={hoy} />
        )}

        <div ref={refTabla} className="min-w-0 scroll-mt-24 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[14px] font-semibold text-[var(--ls-t1)]">Todas las referencias</h3>
            <span className="text-[12px] text-[var(--ls-t4)]">
              {entero(plan.lineas.length)} referencias · ritmo en ud/día, media de 14/30/90 días con stock · € a precio actual de Amazon
            </span>
          </div>
          <TablaPlanSku
            lineas={plan.lineas}
            ajustes={ajustes}
            hoy={hoy}
            moneda={moneda}
            clienteId={cliente.id}
            clienteNombre={cliente.nombre}
            puedeEditar={puedeEditar}
            abierta={skuAbierto}
            onAbrir={abrirSku}
            alCambiar={() => void datos.recargar()}
            cargando={datos.cargando}
          />
        </div>

        {ajustesAbiertos && (
          <div ref={refAjustes} className="min-w-0 scroll-mt-24 space-y-2">
            <div className="flex justify-end">
              <Boton tamano="sm" variante="fantasma" icono={X} onClick={() => setAjustesAbiertos(false)}>
                Cerrar ajustes
              </Boton>
            </div>
            <AjustesReposicion clienteId={cliente.id} clienteNombre={cliente.nombre} puedeEditar={puedeEditar} alGuardar={() => void datos.recargar()} />
          </div>
        )}
      </div>
    </MotionConfig>
  )
}

/* ------------------------------------------------------------------ */
/* Tarjeta de un envío propuesto                                       */
/* ------------------------------------------------------------------ */

function TarjetaEnvio({ envio: e, hoy, moneda, onAbrir }: { envio: EnvioPropuestoGuardado | EnvioPropuestoCalculado; hoy: string; moneda: string; onAbrir?: () => void }) {
  const p = PRIORIDAD[e.prioridad]
  const guardado = 'id' in e ? e : null
  const estado = guardado ? ESTADO_ENVIO[guardado.estado] : null
  const contenido = (
    <>
      <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r-full" style={{ background: COLOR_ESTADO[p.tono] }} />
      <div className="flex flex-wrap items-center gap-1">
        <Insignia tono={p.tono} variante={p.variante} vivo={p.vivo} tamano="sm">
          {p.texto}
        </Insignia>
        {estado && (
          <Insignia tono={estado.tono} variante={estado.variante} tamano="sm" punto={false}>
            {estado.texto}
          </Insignia>
        )}
        {guardado?.vencido && (
          <Insignia tono="rojo" tamano="sm" variante="solida">
            Vencido
          </Insignia>
        )}
        {e.provisional && <Insignia tono="ambar" tamano="sm" variante="contorno">Provisional</Insignia>}
      </div>
      <p className="mt-2 text-[13px] font-semibold text-[var(--ls-t1)]">
        Salir antes del {fechaCorta(e.salirAntesDe, hoy)}
        <span className="font-normal text-[var(--ls-t3)]"> · decidir antes del {fechaCorta(guardado?.fechaLimite ?? e.decidirAntesDe, hoy)}</span>
      </p>
      <p className="mt-[2px] text-[12px] tabular-nums text-[var(--ls-t3)]">
        {e.lineas.length} ref · {unidades(e.unidades)}
        {e.cajasEstimadas !== null ? ` · ${'cajasAproximadas' in e && !e.cajasAproximadas ? '' : '~'}${entero(e.cajasEstimadas)} cajas` : ''}
        {e.eurosEnRiesgo !== null && e.eurosEnRiesgo > 0 ? ` · ${dinero(e.eurosEnRiesgo, e.moneda || moneda)} en juego` : ''}
      </p>
      {e.porque[0] && <p className="mt-1 line-clamp-2 text-[11.5px] leading-[1.45] text-[var(--ls-t4)]">«{e.porque[0]}»</p>}
      {guardado?.responsableNombre && <p className="mt-1 text-[11.5px] text-[var(--ls-t4)]">Lleva: {guardado.responsableNombre}</p>}
    </>
  )
  const clase = 'relative block w-full min-w-0 overflow-hidden rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] py-[10px] pl-4 pr-3 text-left'
  return (
    <li className="min-w-0">
      {onAbrir ? (
        <button type="button" onClick={onAbrir} className={cx(clase, 'transition-colors hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ls-acc-graf)] ls-elevar')}>
          {contenido}
        </button>
      ) : (
        <div className={clase}>{contenido}</div>
      )}
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* Revisión de la IA                                                   */
/* ------------------------------------------------------------------ */

const TEXTO_AJUSTE = {
  factor_ritmo: (v: number) => `ritmo ×${decimal(v, 2)}`,
  mover_envio: (v: number) => `mover ${v > 0 ? '+' : ''}${entero(v)} días`,
  excluir: () => 'sacar del envío',
}

function PanelRevision({ revision: r, hoy, onCerrar, onElegirSku }: { revision: RevisionIa; hoy: string; onCerrar: () => void; onElegirSku: (sku: string) => void }) {
  const coste = r.costeUsd !== null ? `${decimal(r.costeUsd * 100, 2)} céntimos` : null
  return (
    <Tarjeta
      titulo="Revisión de la IA"
      subtitulo={[r.creadoAt ? `revisado ${haceCuanto(r.creadoAt)}` : null, coste, 'la aritmética sigue mandando'].filter(Boolean).join(' · ')}
      icono={Sparkles}
      acento="remesas"
      acciones={<Boton tamano="sm" variante="fantasma" icono={X} soloIcono aria-label="Ocultar la revisión" onClick={onCerrar} />}
    >
      <div className="min-w-0 space-y-3">
        {r.aviso && (
          <p className="rounded-[10px] px-3 py-2 text-[12.5px] text-[var(--ls-t2)]" style={{ background: 'color-mix(in srgb, var(--ls-e-ambar) 10%, transparent)' }}>
            {r.aviso}
          </p>
        )}
        {r.resumen && <p className="text-[13px] leading-[1.55] text-[var(--ls-t1)]">{r.resumen}</p>}

        {r.avisos.length > 0 && (
          <ul className="space-y-[6px]">
            {r.avisos.map((a, i) => (
              <li key={i} className="flex min-w-0 items-start gap-2 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">
                <Insignia tono={TEXTO_GRAVEDAD[a.gravedad].tono} tamano="sm">
                  {TEXTO_GRAVEDAD[a.gravedad].texto}
                </Insignia>
                <span className="min-w-0 flex-1">
                  {a.sku && (
                    <button type="button" onClick={() => onElegirSku(a.sku!)} className="mr-1 font-semibold text-[var(--ls-t1)] hover:underline">
                      {a.sku}:
                    </button>
                  )}
                  {a.texto}
                </span>
              </li>
            ))}
          </ul>
        )}

        {r.ajustesValidos.length > 0 && (
          <div className="space-y-[6px]">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-[var(--ls-t4)]">Sugerencias (se aplican desde el envío propuesto)</p>
            <ul className="space-y-[6px]">
              {r.ajustesValidos.map((a, i) => (
                <li key={i} className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[12.5px] text-[var(--ls-t2)]">
                  <button type="button" onClick={() => onElegirSku(a.sku)} className="font-semibold text-[var(--ls-t1)] hover:underline">
                    {a.sku}
                  </button>
                  <span>{a.tipo === 'factor_ritmo' ? TEXTO_AJUSTE.factor_ritmo(a.valor) : a.tipo === 'mover_envio' ? TEXTO_AJUSTE.mover_envio(a.dias) : TEXTO_AJUSTE.excluir()}</span>
                  <span className="tabular-nums text-[var(--ls-t3)]">
                    {entero(a.recalculo.antes)} → <b className="text-[var(--ls-t1)]">{entero(a.recalculo.despues)} ud</b>
                  </span>
                  <span className="min-w-0 basis-full text-[11.5px] text-[var(--ls-t4)] sm:basis-auto">{a.motivo}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {r.ajustesRechazados.length > 0 && <p className="text-[11.5px] text-[var(--ls-t4)]">{entero(r.ajustesRechazados.length)} sugerencias descartadas por no cuadrar con la aritmética.</p>}

        <div className="grid min-w-0 gap-2 md:grid-cols-2">
          {r.mensajeCliente && <Mensaje titulo="Para el cliente" texto={r.mensajeCliente} />}
          {r.mensajeEquipo && <Mensaje titulo="Para el equipo" texto={r.mensajeEquipo} />}
        </div>
        <p className="text-[11px] text-[var(--ls-t4)]">Revisado el {fechaCorta(r.creadoAt?.slice(0, 10), hoy)}{r.modelo ? ` con ${r.modelo}` : ''}.</p>
      </div>
    </Tarjeta>
  )
}

function Mensaje({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="min-w-0 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-[var(--ls-t4)]">{titulo}</span>
        <Boton tamano="sm" variante="fantasma" icono={Copy} onClick={() => void copiar(texto, 'Copiado')}>
          Copiar
        </Boton>
      </div>
      <p className="whitespace-pre-line text-[12.5px] leading-[1.55] text-[var(--ls-t2)]">{texto}</p>
    </div>
  )
}

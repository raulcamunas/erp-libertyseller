'use client'

import { useCallback, useMemo, type CSSProperties } from 'react'
import { ArrowRight, Boxes, CalendarClock, Coins, PackageCheck, PackageSearch, Sparkles, Timer, TrendingUp, Truck } from 'lucide-react'
import { Boton, EsqueletoTarjeta, EstadoVacio, FilaDeKpis, Insignia, Kpi, leerVariacion, porcentajeCorto } from '@/components/ui-ls'
import type { EnvioPropuestoCalculado, EnvioPropuestoGuardado, PlanCliente, PlanParaCliente } from '@/lib/fba/plan-tipos'
import { marketplaceLabel } from '@/lib/types/amazon'
import { BandaDeCalidad } from '../comun/BandaDeCalidad'
import { CONFIANZA, ESTADO_ENVIO, ORDEN_PRIORIDAD, PRIORIDAD } from '../comun/estilo-plan'
import type { CallbacksRemesas, ClienteRemesas, SesionRemesas } from '../comun/tipos-ui'
import { esPlanDeAgencia, usePlan } from '../comun/usePlan'
import { Tarjeta } from '../comun/ui'
import { decimal, dias as fmtDias, diasEntre, entero, fechaCorta, unidades } from '../formato'
import { barraDeStock, calidadDeInventario, din, proximoEnvioPropuesto, topCobertura, ventanaDeVentas, type LineaDeStock } from '../inventario/formato'
import { BarraStock, GraficoVentas90, MapaCobertura, TarjetaEnCamino, type BarraMapa } from '../inventario/piezas'
import { useConfirmarPlazos, useInventario, useLeerDeAmazon, useVentas90 } from '../inventario/useInventario'

/**
 * RESUMEN DE UN CLIENTE (spec remesas-pro §1.5 «Cliente → Resumen», §8, D25, D26, D39 y D41; paquete C3).
 *
 *   [Banda de calidad]
 *   KPI: Vendible · De camino · Ventas 30 d (ud y €, frente a los 30 anteriores) · Cobertura · 1ª rotura · € en juego
 *   [Stock en FBA ahora: barra apilada]            [Ventas 90 días: área + periodo anterior]
 *   [Lo próximo que hay que enviar]                [Envíos de camino: 3 tarjetas con progreso y «dudoso»]
 *   [Mapa de cobertura: las 15 referencias que antes rompen; barra = días que dura, raya = plazo]
 *
 * De dónde sale cada cosa (D25):
 *   · El plan (`usePlan`): KPI de stock, cobertura, rotura y €, el próximo envío propuesto, los envíos de camino
 *     (`plan.enCamino`, nunca `panelDeCliente`) y el mapa. El cliente externo recibe `PlanParaCliente` (D26): sin €, ni
 *     prioridades, ni envíos propuestos; aquí se le quitan además la tarjeta del próximo envío y el KPI de €.
 *   · Las ventas (`GET /api/fba/ventas?dias=90`): el gráfico y el KPI de 30 días frente a los 30 anteriores.
 *   · El inventario (`useInventario`, la misma lectura que la sección Stock): la barra apilada (reservado y no apto no
 *     están en el plan) y, si no hay plan, todo lo demás.
 *
 * El envío propuesto NO se embebe: se abre con `callbacks.onAbrirEnvioPropuesto(id)` (§10).
 *
 * API
 *   <ResumenCliente sesion cliente hoy callbacks />
 */

export interface ResumenClienteProps {
  sesion: SesionRemesas
  cliente: ClienteRemesas
  /** YYYY-MM-DD en Madrid (la página lo tiene) */
  hoy: string
  callbacks: CallbacksRemesas
}

type EnvioParaTarjeta =
  | { tipo: 'guardado'; envio: EnvioPropuestoGuardado }
  | { tipo: 'calculado'; envio: EnvioPropuestoCalculado }

/** Entrada escalonada del kit (.ls-aparecer: solo opacidad y 8 px, y nada con «reducir movimiento») */
const paso = (i: number): CSSProperties => ({ ['--ls-i' as string]: i }) as CSSProperties

export function ResumenCliente({ sesion, cliente, hoy, callbacks }: ResumenClienteProps) {
  const esAgencia = sesion.actor === 'agencia'
  const puedeEditar = esAgencia && cliente.puedeEditar
  const planR = usePlan(cliente.id)
  const inv = useInventario(cliente.id)
  const ventasR = useVentas90(cliente.id)

  const planAgencia: PlanCliente | null = esAgencia && esPlanDeAgencia(planR.plan) ? planR.plan : null
  const plan: PlanCliente | PlanParaCliente | null = planR.plan
  const datos = inv.datos
  const moneda = planAgencia?.moneda ?? cliente.moneda

  const recargarTodo = useCallback(() => {
    void inv.recargar()
    void planR.recargar()
    void ventasR.recargar()
  }, [inv, planR, ventasR])
  const lector = useLeerDeAmazon(cliente.id, recargarTodo)
  const plazos = useConfirmarPlazos(cliente.id, () => void planR.recargar())

  /* ---------- calidad ---------- */
  const calidad = plan ? plan.calidad : datos ? calidadDeInventario(datos, hoy) : null
  const mercado = cliente.mercadoLectura ?? plan?.calidad.mercado ?? datos?.marketplaceId ?? null

  /* ---------- cifras ---------- */
  const vendible = plan ? plan.resumen.vendibles : datos ? datos.resumen.vendibles : null
  const deCamino = plan ? plan.resumen.deCamino : datos ? datos.resumen.entrante : null
  const cobertura = plan ? plan.resumen.coberturaMediana : (datos?.resumen.coberturaMedia ?? null)
  const primeraRotura = plan
    ? plan.resumen.primeraRotura
    : datos
      ? (datos.skus.map((s) => s.seAgotaEl).filter((f): f is string => !!f).sort()[0] ?? null)
      : null
  const ventas = ventasR.datos
  const ventana = useMemo(() => (ventas ? ventanaDeVentas(ventas.porDia, 30, ventas.leidoDesde) : null), [ventas])
  const varEuros = ventana?.anterior ? leerVariacion(ventana.euros, ventana.anterior.euros) : null
  const enCamino = useMemo(() => {
    const lista = plan?.enCamino ?? []
    return [...lista].sort((a, b) => Number(a.dudoso) - Number(b.dudoso) || (a.llegadaPrevista ?? '9999').localeCompare(b.llegadaPrevista ?? '9999'))
  }, [plan])
  // De dónde sale el «De camino» del plan: lo de los envíos (sin lo dudoso) + lo que Amazon tiene entrante sin remesa en el ERP.
  // La tarjeta «Envíos de camino» suma lo sin recibir de cada envío (dudosos incluidos): sin este desglose las dos cifras no cuadran.
  const desgloseCamino = useMemo(() => {
    if (!plan) return null
    let sinRemesa = 0
    let dudoso = 0
    for (const l of plan.lineas as Array<{ deCamino: number; entranteSinRemesa?: number; dudoso?: number }>) {
      sinRemesa += Math.max(0, l.entranteSinRemesa ?? 0)
      dudoso += Math.max(0, l.dudoso ?? 0)
    }
    return { enEnvios: Math.max(0, plan.resumen.deCamino - sinRemesa), sinRemesa, dudoso }
  }, [plan])

  /* ---------- mapa ---------- */
  const barrasMapa: BarraMapa[] = useMemo(() => {
    const lineas: LineaDeStock[] = plan
      ? (plan.lineas as LineaDeStock[])
      : (datos?.skus ?? []).map((s) => ({
          sku: s.sku, asin: s.asin, nombre: s.nombre, modelo: null, talla: null, vendibles: s.vendibles, deCamino: s.entrante,
          coberturaDias: s.vendibles <= 0 ? 0 : s.cobertura, coberturaConLoQueViene: null, fechaRotura: s.seAgotaEl,
          ritmo: { base: s.estado === 'sin_datos' ? null : s.ritmoPlan, confianza: 'media', explicacion: '' },
        }))
    return topCobertura(lineas, 15).map((l) => ({
      sku: l.sku,
      nombre: l.nombre,
      dias: Math.max(0, l.coberturaConLoQueViene ?? l.coberturaDias ?? 0),
      barra: 0,
      topada: false,
      fechaRotura: l.fechaRotura,
      prioridad: esAgencia ? (l.prioridad ?? null) : null,
      fuera: esAgencia ? (l.fuera ?? null) : null,
    }))
  }, [plan, datos, esAgencia])

  /* ---------- próximo envío (agencia) ---------- */
  const proximo: EnvioParaTarjeta | null = useMemo(() => {
    if (!esAgencia) return null
    const g = proximoEnvioPropuesto(planR.envios)
    if (g) return { tipo: 'guardado', envio: g }
    const c = [...(planAgencia?.envios ?? [])].sort((a, b) => ORDEN_PRIORIDAD[a.prioridad] - ORDEN_PRIORIDAD[b.prioridad] || a.salirAntesDe.localeCompare(b.salirAntesDe))[0]
    return c ? { tipo: 'calculado', envio: c } : null
  }, [esAgencia, planR.envios, planAgencia])
  const otrosEnvios = esAgencia ? Math.max(0, (planR.envios.length || planAgencia?.envios.length || 0) - (proximo ? 1 : 0)) : 0

  const cargandoPlan = planR.cargando && !plan
  const diasRotura = primeraRotura ? diasEntre(hoy, primeraRotura) : null
  // Un único número por pregunta (§1.1): con plan, vendible y de camino son los del plan (el camino sin lo dudoso); reservado y
  // no apto, que el plan no trae, del inventario
  const barra = useMemo(() => {
    if (!datos) return null
    const b = barraDeStock(datos)
    if (!plan) return b
    const vendibleP = Math.max(0, plan.resumen.vendibles)
    const caminoP = Math.max(0, plan.resumen.deCamino)
    return { ...b, vendible: vendibleP, camino: caminoP, total: vendibleP + caminoP + b.reservado + b.noApto }
  }, [datos, plan])

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* ================= CABECERA ================= */}
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="truncate text-[17px] font-semibold tracking-[-0.015em] text-[var(--ls-t1)]">Resumen de {cliente.nombre}</h2>
          <p className="text-[12px] text-[var(--ls-t3)]">
            Amazon {mercado ? marketplaceLabel(mercado) : '—'}
            {calidad?.leidoHasta ? ` · ventas leídas hasta el ${fechaCorta(calidad.leidoHasta, hoy)}` : ' · sin ventas leídas'}
            {planR.pasada?.calculadoAt ? ` · plan calculado el ${fechaCorta(planR.pasada.calculadoAt.slice(0, 10), hoy)}` : ''}
          </p>
        </div>
        {/* «Propuesta a medida (IA)» está en la cabecera del cliente, encima de todas las secciones: aquí se repetía */}
      </div>

      {/* ================= BANDA DE CALIDAD ================= */}
      <BandaDeCalidad
        calidad={calidad}
        esAdmin={sesion.esAdmin}
        puedeEditar={puedeEditar}
        hoy={hoy}
        onLeerAmazon={sesion.esAdmin && datos?.conexionId ? () => lector.leer(datos.conexionId) : undefined}
        leyendo={lector.leyendo}
        onConfirmarPlazos={puedeEditar ? plazos.confirmar : undefined}
        confirmando={plazos.confirmando}
        onPonerPlazos={puedeEditar ? () => callbacks.onIrA('cliente', 'reposicion') : undefined}
        extra={
          planR.error && !plan
            ? [{ id: 'plan_error', tono: 'gris', texto: `El plan no se ha podido leer (${planR.error}): las cifras salen del inventario` }]
            : []
        }
      />

      {/* ================= KPI ================= */}
      <FilaDeKpis minimo={170}>
        <Kpi
          indice={0}
          etiqueta="Vendible"
          icono={Boxes}
          acento="remesas"
          valor={vendible}
          formato={(n) => `${entero(n)} ud`}
          cargando={vendible === null && (cargandoPlan || inv.cargando)}
          nota={plan ? `en ${entero(plan.resumen.referencias)} referencias` : 'en los almacenes de Amazon'}
        />
        <Kpi
          indice={1}
          etiqueta="De camino"
          icono={Truck}
          acento="remesas"
          valor={deCamino}
          formato={(n) => `${entero(n)} ud`}
          cargando={deCamino === null && (cargandoPlan || inv.cargando)}
          nota={
            plan && desgloseCamino
              ? [
                  `${entero(desgloseCamino.enEnvios)} ud en ${entero(enCamino.filter((e) => !e.dudoso).length)} envío${enCamino.filter((e) => !e.dudoso).length === 1 ? '' : 's'}`,
                  desgloseCamino.sinRemesa > 0 ? `${entero(desgloseCamino.sinRemesa)} entrantes sin remesa` : null,
                  desgloseCamino.dudoso > 0 ? `${entero(desgloseCamino.dudoso)} dudosas no cuentan` : enCamino.some((e) => e.dudoso) ? 'alguno dudoso no cuenta' : null,
                ].filter(Boolean).join(' + ').replace(/ \+ (\d[\d.]* dudosas no cuentan|alguno dudoso no cuenta)$/, ' · $1')
              : 'enviado y sin recibir'
          }
        />
        <Kpi
          indice={2}
          etiqueta="Ventas 30 días"
          icono={TrendingUp}
          acento="remesas"
          valor={ventana ? ventana.unidades : null}
          anterior={ventana ? (ventana.anterior?.unidades ?? null) : undefined}
          formato={(n) => `${entero(n)} ud`}
          cargando={ventasR.cargando && !ventana}
          nota={
            ventana
              ? `${ventana.euros !== null ? din(ventana.euros, ventas?.moneda ?? moneda) : 'sin €'}${varEuros?.proporcion != null ? ` (${varEuros.direccion === 'baja' ? '−' : '+'}${porcentajeCorto(varEuros.proporcion)})` : ''} · ${decimal(ventana.udDia, ventana.udDia < 1 ? 2 : 1)} ud/día`
              : ventasR.error ?? undefined
          }
        />
        <Kpi
          indice={3}
          etiqueta="Cobertura"
          icono={Timer}
          acento="remesas"
          valor={cobertura}
          formato={(n) => fmtDias(n)}
          cargando={cobertura === null && (cargandoPlan || inv.cargando)}
          nota={plan ? 'mediana, con lo que viene' : 'media, al ritmo actual'}
        />
        <Kpi
          indice={4}
          etiqueta="1ª rotura"
          icono={CalendarClock}
          acento="remesas"
          valor={diasRotura}
          formato={(n) => (n <= 0 ? 'ya' : `en ${fmtDias(n)}`)}
          cargando={diasRotura === null && (cargandoPlan || inv.cargando)}
          nota={
            primeraRotura
              ? `el ${fechaCorta(primeraRotura, hoy)}${planAgencia ? ` · ${entero(planAgencia.resumen.roturas14)} rompen en 14 d` : ''}`
              : 'nada rompe a la vista'
          }
        />
        {planAgencia && (
          <Kpi
            indice={5}
            etiqueta="€ en juego"
            icono={Coins}
            acento="remesas"
            valor={planAgencia.resumen.eurosEnRiesgo}
            formato={(n) => din(n, planAgencia.resumen.moneda ?? moneda)}
            nota="ventas perdidas si no sale nada"
          />
        )}
      </FilaDeKpis>

      {/* ================= STOCK Y VENTAS ================= */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="min-w-0 ls-aparecer" style={paso(6)}>
          <Tarjeta className="h-full" titulo="Stock en FBA ahora" ayuda={barra && !barra.conDesglose ? 'Amazon no ha dado el desglose de reservado: «no vendible» lo incluye' : 'Lo que hay en Amazon y lo que va de camino'}>
            {barra ? (
              barra.total > 0 ? (
                <BarraStock barra={barra} />
              ) : (
                <EstadoVacio compacto icono={Boxes} titulo="Nada en Amazon" descripcion="Ni stock ni nada de camino en este momento." />
              )
            ) : inv.error ? (
              <EstadoVacio compacto icono={Boxes} titulo="No se ha podido leer el stock" descripcion={inv.error} accion={{ texto: 'Reintentar', onClick: () => void inv.recargar() }} />
            ) : (
              <EsqueletoTarjeta alto={110} className="border-0 p-0" />
            )}
          </Tarjeta>
        </div>
        <div className="min-w-0 ls-aparecer" style={paso(7)}>
          <Tarjeta
            titulo="Ventas de los últimos 90 días"
            ayuda={ventas ? `Hasta el ${fechaCorta(ventas.hasta, hoy)}${ventas.anteriorCompleto ? ' · discontinua: los 90 días anteriores' : ' · sin los 90 anteriores: el libro no llega'}` : 'Unidades al día'}
            derecha={
              <Boton variante="fantasma" tamano="sm" iconoDerecha={ArrowRight} onClick={() => callbacks.onIrA('cliente', 'ventas')}>
                Ventas
              </Boton>
            }
          >
            {ventas ? (
              <GraficoVentas90 datos={ventas.porDia} anterior={ventas.anteriorCompleto ? ventas.anterior : null} etiqueta="Unidades vendidas al día en los últimos 90 días, con la media de 7 días y el periodo anterior" alto={220} />
            ) : ventasR.error ? (
              <EstadoVacio compacto icono={TrendingUp} titulo="No se han podido leer las ventas" descripcion={ventasR.error} accion={{ texto: 'Reintentar', onClick: () => void ventasR.recargar() }} />
            ) : (
              <div aria-hidden className="h-[220px] w-full animate-pulse rounded-[10px] bg-[var(--ls-sup2)] motion-reduce:animate-none" />
            )}
          </Tarjeta>
        </div>
      </div>

      {/* ================= PRÓXIMO ENVÍO Y ENVÍOS DE CAMINO ================= */}
      <div className={esAgencia ? 'grid min-w-0 gap-4 lg:grid-cols-2' : 'grid min-w-0 gap-4'}>
        {esAgencia && (
          <div className="min-w-0 ls-aparecer" style={paso(8)}>
            <Tarjeta
              titulo="Lo próximo que hay que enviar"
              ayuda={otrosEnvios > 0 ? `y ${entero(otrosEnvios)} envío${otrosEnvios === 1 ? '' : 's'} propuesto${otrosEnvios === 1 ? '' : 's'} más` : 'Del plan de reposición'}
              derecha={
                <Boton variante="fantasma" tamano="sm" iconoDerecha={ArrowRight} onClick={() => callbacks.onIrA('plan', undefined, { cliente: cliente.id })}>
                  Plan
                </Boton>
              }
            >
              {cargandoPlan ? (
                <EsqueletoTarjeta alto={120} className="border-0 p-0" />
              ) : !planAgencia ? (
                <EstadoVacio compacto icono={PackageSearch} titulo="Sin plan de reposición" descripcion="El plan no se ha podido leer: sin él no se sabe qué hay que enviar. Prueba a actualizar en un rato." />
              ) : proximo ? (
                <ProximoEnvio
                  proximo={proximo}
                  hoy={hoy}
                  moneda={moneda}
                  onAbrir={proximo.tipo === 'guardado' ? () => callbacks.onAbrirEnvioPropuesto(proximo.envio.id) : () => callbacks.onIrA('plan', undefined, { cliente: cliente.id })}
                />
              ) : (
                <EstadoVacio
                  compacto
                  icono={PackageCheck}
                  titulo="Nada que enviar por ahora"
                  descripcion={primeraRotura ? `La primera referencia se queda sin stock el ${fechaCorta(primeraRotura, hoy)}, con tiempo para un envío.` : 'Con lo que hay y lo que viene, no hace falta mandar nada.'}
                  accion={puedeEditar ? { texto: 'Propuesta a medida (IA)', icono: Sparkles, onClick: () => callbacks.onPropuestaAMedida(cliente.id) } : undefined}
                />
              )}
            </Tarjeta>
          </div>
        )}
        <div className="min-w-0 ls-aparecer" style={paso(9)}>
          <Tarjeta
            titulo="Envíos de camino"
            ayuda={
              (enCamino.length > 0 ? `${entero(enCamino.reduce((t, e) => t + Math.max(0, e.unidades - e.recibidas), 0))} ud sin recibir en estos envíos` : 'Enviados a Amazon y sin recibir del todo') +
              (desgloseCamino && desgloseCamino.sinRemesa > 0 ? ` · además, ${entero(desgloseCamino.sinRemesa)} ud entrantes que no están en ninguna remesa (impórtalas)` : '')
            }
            derecha={
              <span className="flex flex-wrap items-center justify-end gap-1">
                {puedeEditar && desgloseCamino && desgloseCamino.sinRemesa > 0 && (
                  <Boton variante="fantasma" tamano="sm" onClick={() => callbacks.onImportarPedidos(cliente.id)}>
                    Importar pedidos
                  </Boton>
                )}
                <Boton variante="fantasma" tamano="sm" iconoDerecha={ArrowRight} onClick={() => callbacks.onIrA('cliente', 'envios')}>
                  {enCamino.length > 3 ? `Ver los ${entero(enCamino.length)}` : 'Envíos'}
                </Boton>
              </span>
            }
          >
            {cargandoPlan ? (
              <EsqueletoTarjeta alto={120} className="border-0 p-0" />
            ) : !plan ? (
              <EstadoVacio compacto icono={Truck} titulo="Todavía no hay plan" descripcion="Los envíos de camino salen del plan de reposición, que aún no está calculado. En «Envíos» están todos." />
            ) : enCamino.length === 0 ? (
              <EstadoVacio compacto icono={Truck} titulo="Nada de camino" descripcion="Todos los envíos están recibidos." />
            ) : (
              <div className={esAgencia ? 'grid gap-2' : 'grid gap-2 sm:grid-cols-2 xl:grid-cols-3'}>
                {enCamino.slice(0, 3).map((e, i) => (
                  <TarjetaEnCamino key={e.remesaId} envio={e} hoy={hoy} indice={i} onAbrir={() => callbacks.onIrA('cliente', 'envios', { remesa: e.remesaId })} />
                ))}
              </div>
            )}
          </Tarjeta>
        </div>
      </div>

      {/* ================= MAPA DE COBERTURA ================= */}
      <div className="min-w-0 ls-aparecer" style={paso(10)}>
        <Tarjeta
          titulo="Mapa de cobertura"
          ayuda={`Las ${entero(barrasMapa.length || 15)} referencias que antes se quedan sin stock: días que duran${plan ? ' con lo que viene' : ' al ritmo actual'}${planAgencia ? ' · color = prioridad del plan' : ''}`}
          derecha={
            <Boton variante="fantasma" tamano="sm" iconoDerecha={ArrowRight} onClick={() => callbacks.onIrA('cliente', 'stock')}>
              Stock
            </Boton>
          }
        >
          {cargandoPlan && inv.cargando ? (
            <div aria-hidden className="h-[260px] w-full animate-pulse rounded-[10px] bg-[var(--ls-sup2)] motion-reduce:animate-none" />
          ) : (
            <MapaCobertura
              barras={barrasMapa}
              hoy={hoy}
              plazo={planAgencia ? { hastaLaVenta: planAgencia.plazo.hastaLaVenta, margen: planAgencia.plazo.margen } : null}
              onElegir={(sku) => callbacks.onIrA('cliente', 'stock', { sku })}
            />
          )}
          {!plan && barrasMapa.length > 0 && (
            <p className="mt-2 px-1 text-[11px] text-[var(--ls-t4)]">Sin plan calculado: días de stock al ritmo del inventario, sin contar lo que viene de camino.</p>
          )}
        </Tarjeta>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* El próximo envío propuesto, compacto                                */
/* ------------------------------------------------------------------ */

function ProximoEnvio({ proximo, hoy, moneda, onAbrir }: { proximo: EnvioParaTarjeta; hoy: string; moneda: string; onAbrir: () => void }) {
  const e = proximo.envio
  const p = PRIORIDAD[e.prioridad]
  const conf = CONFIANZA[e.confianza]
  const guardado = proximo.tipo === 'guardado' ? proximo.envio : null
  const lineas = guardado ? (guardado.lineasAceptadas ?? guardado.lineas) : proximo.envio.lineas
  const refs = lineas.filter((l) => l.cantidad > 0).length
  const porque = e.porque.slice(0, 2)
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Insignia tono={p.tono} variante={p.variante} vivo={p.vivo}>
          {p.texto}
        </Insignia>
        {guardado && (
          <Insignia tono={ESTADO_ENVIO[guardado.estado].tono} variante={ESTADO_ENVIO[guardado.estado].variante} tamano="sm">
            {ESTADO_ENVIO[guardado.estado].texto}
          </Insignia>
        )}
        {conf && (
          <Insignia tono={conf.tono} variante={conf.variante} tamano="sm">
            {conf.texto}
          </Insignia>
        )}
        {e.provisional && (
          <Insignia tono="ambar" variante="contorno" tamano="sm">
            Provisional
          </Insignia>
        )}
        {guardado?.vencido && (
          <Insignia tono="rojo" tamano="sm">
            Vencido
          </Insignia>
        )}
      </div>

      <p className="text-[13px] leading-[1.5] text-[var(--ls-t2)]">
        Decidir antes del <b className="font-semibold text-[var(--ls-t1)]">{fechaCorta(e.decidirAntesDe, hoy)}</b> · salir antes del{' '}
        <b className="font-semibold text-[var(--ls-t1)]">{fechaCorta(e.salirAntesDe, hoy)}</b>
        {e.aLaVenta ? ` · a la venta el ${fechaCorta(e.aLaVenta, hoy)}` : ''}
      </p>

      <dl className="grid grid-cols-3 gap-2">
        <div className="min-w-0 rounded-[10px] bg-[var(--ls-sup2)] px-3 py-2">
          <dt className="text-[11px] text-[var(--ls-t4)]">Unidades</dt>
          <dd className="truncate text-[15px] font-semibold tabular-nums text-[var(--ls-t1)]">{unidades(e.unidades)}</dd>
        </div>
        <div className="min-w-0 rounded-[10px] bg-[var(--ls-sup2)] px-3 py-2">
          <dt className="text-[11px] text-[var(--ls-t4)]">Referencias · cajas</dt>
          <dd className="truncate text-[15px] font-semibold tabular-nums text-[var(--ls-t1)]">
            {entero(refs)} · {e.cajasEstimadas === null ? '—' : `${'cajasAproximadas' in e && e.cajasAproximadas ? '~' : ''}${entero(e.cajasEstimadas)}`}
          </dd>
        </div>
        <div className="min-w-0 rounded-[10px] bg-[var(--ls-sup2)] px-3 py-2">
          <dt className="text-[11px] text-[var(--ls-t4)]">En juego</dt>
          <dd className="truncate text-[15px] font-semibold tabular-nums text-[var(--ls-t1)]">{e.eurosEnRiesgo === null ? 'sin precio' : din(e.eurosEnRiesgo, e.moneda ?? moneda)}</dd>
        </div>
      </dl>

      {porque.length > 0 && (
        <ul className="space-y-1">
          {porque.map((t, i) => (
            <li key={i} className="flex gap-2 text-[12px] leading-[1.5] text-[var(--ls-t3)]">
              <PackageSearch className="mt-[2px] h-[13px] w-[13px] shrink-0 text-[var(--ls-t4)]" aria-hidden />
              <span className="min-w-0">{t}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11.5px] text-[var(--ls-t4)]">
          {guardado ? (guardado.responsableNombre ? `Lo lleva ${guardado.responsableNombre}` : 'Sin responsable') : 'Calculado, sin guardar (falta la migración 316)'}
        </span>
        <Boton variante="primario" tamano="sm" iconoDerecha={ArrowRight} onClick={onAbrir}>
          {guardado ? 'Abrir el envío' : 'Ver en el plan'}
        </Boton>
      </div>
    </div>
  )
}

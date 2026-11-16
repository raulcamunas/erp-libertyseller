'use client'

import { useMemo } from 'react'
import { AlertTriangle, CalendarClock, Euro, ListChecks, RefreshCw, Truck, Users } from 'lucide-react'
import { Boton, EstadoVacio, FilaDeKpis, Kpi } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { diaEnEspana } from '@/lib/fba/fechas'
import { BandaDeCalidad } from '../comun/BandaDeCalidad'
import { SALUD } from '../comun/estilo-plan'
import type { CallbacksRemesas, SesionRemesas } from '../comun/tipos-ui'
import { useEnviosPropuestos } from '../comun/useEnviosPropuestos'
import { useEnviosNuevosDeTodos } from '../envios/useEnviosNuevos'
import { dinero, entero, fechaCorta } from '../formato'
import { GraficoSalidasSemana } from './GraficoSalidasSemana'
import { ListaPendientes } from './ListaPendientes'
import { EsqueletoSaludCliente, TarjetaSaludCliente } from './TarjetaSaludCliente'
import { avisosDeHoy, cuentaPorTono, ordenarClientes, puedeEditarCliente, useResumen } from './useResumen'

/**
 * VISTA «HOY» DE REMESAS A FBA (`/dashboard/remesas?vista=hoy`, la de entrada de la agencia) — spec remesas-pro §1.5,
 * §4.3, §6.3, D18, D34 y D42.
 *
 * Responde a «¿qué hay que hacer hoy y qué se nos escapa?», de arriba abajo:
 *   1. BandaDeCalidad con los avisos de TODOS los clientes, agrupados (lectura fallida, ventas atrasadas, plazos de
 *      partida y «falta la migración 316»). Cada uno lleva al cliente que toca.
 *   2. Cinco KPI (FilaDeKpis; en el móvil, carrusel con imán): salen esta semana · roturas en 14 días · € en juego por
 *      moneda, sin convertir («8.420 € + 1.200 $») · de camino · pendientes vencidos y de esta semana.
 *   3. Pendientes (ListaPendientes, con su acción principal y «⋯») junto a las salidas previstas por semana.
 *   4. Tarjetas de salud por cliente: rojo → ámbar → verde y el gris («sin datos») al final; dentro, por € en juego.
 *      Con la chispa de 30 días y el «+N» de envíos nuevos en Amazon (useEnviosNuevosDeTodos).
 *
 * Solo agencia (la ruta del resumen da 403 al cliente externo). No embebe el panel del envío propuesto: recibe los
 * `CallbacksRemesas` y la página (I1) lo monta una vez.
 *
 * API
 *   <VistaHoy sesion callbacks />
 */

export interface VistaHoyProps {
  sesion: SesionRemesas
  callbacks: CallbacksRemesas
}

const hora = (ms: number | string | null | undefined): string | null => {
  if (ms === null || ms === undefined) return null
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })
}

const plural = (n: number, uno: string, varios: string) => `${entero(n)} ${n === 1 ? uno : varios}`

export function VistaHoy({ sesion, callbacks }: VistaHoyProps) {
  const hoy = useMemo(() => diaEnEspana(), [])
  const { resumen, aviso, cargando, error, recargar } = useResumen(sesion.esAgencia)
  const pendientes = useEnviosPropuestos(sesion.esAgencia ? { pendientes: true } : null)
  const { porCliente: enviosNuevos } = useEnviosNuevosDeTodos(sesion.esAgencia)

  const clientes = useMemo(() => ordenarClientes(resumen?.clientes ?? []), [resumen])
  const nombres = useMemo(() => Object.fromEntries((resumen?.clientes ?? []).map((c) => [c.clienteId, c.nombre])), [resumen])
  const avisos = useMemo(() => avisosDeHoy(resumen?.clientes ?? [], aviso, hoy), [resumen, aviso, hoy])
  const tonos = cuentaPorTono(clientes)
  const k = resumen?.kpis
  const euros = useMemo(() => [...(k?.eurosEnJuego ?? [])].filter((x) => Number.isFinite(x.total)).sort((a, b) => b.total - a.total), [k])
  const sinMigracion = resumen ? !resumen.migracion316 : false
  const cargandoPrimera = cargando && !resumen

  const irACliente = (id: string) => callbacks.onIrA('cliente', 'resumen', { cliente: id })
  const actualizar = () => {
    void recargar({ servidor: true })
    void pendientes.recargar()
  }

  /** «8.420 € + 1.200 $»: la primera (la mayor) se anima; las demás van detrás tal cual */
  const formatoEuros = (n: number) =>
    euros.length === 0 ? dinero(n, 'EUR') : [dinero(n, euros[0].moneda), ...euros.slice(1).map((x) => dinero(x.total, x.moneda))].join(' + ')

  if (error && !resumen) {
    return (
      <EstadoVacio
        acento="remesas"
        icono={AlertTriangle}
        titulo="No se ha podido leer el resumen de hoy"
        descripcion={error}
        accion={{ texto: 'Volver a probar', icono: RefreshCw, onClick: actualizar }}
        accionSecundaria={{ texto: 'Ver el plan', onClick: () => callbacks.onIrA('plan') }}
      />
    )
  }

  const calculado = hora(resumen?.calculadoAt)

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {avisos.length > 0 && (
        <BandaDeCalidad
          calidad={null}
          esAdmin={sesion.esAdmin}
          hoy={hoy}
          extra={avisos.map((a) => ({
            id: a.id,
            tono: a.tono,
            texto: a.texto,
            accion:
              a.clienteId && a.accion === 'plazos' && puedeEditarCliente(sesion, a.clienteId)
                ? { texto: 'Poner plazos', onClick: () => callbacks.onIrA('cliente', 'reposicion', { cliente: a.clienteId as string }) }
                : a.clienteId && a.accion
                  ? { texto: `Ver ${nombres[a.clienteId] ?? 'el cliente'}`, onClick: () => irACliente(a.clienteId as string) }
                  : undefined,
          }))}
        />
      )}

      {/* Qué día y de cuándo son las cifras */}
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="truncate text-[16px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">Hoy, {fechaCorta(hoy)}</h2>
          <p className="text-[12px] text-[var(--ls-t4)]">
            {cargandoPrimera ? 'Leyendo el último plan de cada cliente…' : `Del último plan de cada cliente${calculado ? ` · leído a las ${calculado}` : ''} · € a precio actual de Amazon`}
          </p>
        </div>
        <Boton tamano="sm" variante="secundario" icono={RefreshCw} cargando={cargando && !!resumen} onClick={actualizar} title="Vuelve a leer el resumen y los pendientes (sin esperar a la memoria de 3 minutos)">
          Actualizar
        </Boton>
      </div>

      <FilaDeKpis minimo={180}>
        <Kpi
          indice={0}
          acento="remesas"
          icono={CalendarClock}
          etiqueta="Salen esta semana"
          valor={k?.salenEstaSemana ?? null}
          formato={(n) => plural(Math.round(n), 'envío', 'envíos')}
          nota="envíos propuestos que tienen que salir hasta el domingo"
          cargando={cargandoPrimera}
          onClick={() => callbacks.onIrA('plan')}
        />
        <Kpi
          indice={1}
          acento={COLOR_ESTADO.rojo}
          icono={AlertTriangle}
          etiqueta="Roturas en 14 días"
          valor={k?.roturas14 ?? null}
          formato={(n) => `${entero(n)} ref.`}
          nota="referencias que se quedan sin stock"
          cargando={cargandoPrimera}
          onClick={() => callbacks.onIrA('plan')}
        />
        <Kpi
          indice={2}
          acento="remesas"
          icono={Euro}
          etiqueta="€ en juego"
          valor={k ? (euros[0]?.total ?? 0) : null}
          formato={formatoEuros}
          nota={euros.length > 1 ? 'por moneda, sin convertir' : 'ventas que se pierden si no se envía'}
          cargando={cargandoPrimera}
          onClick={() => callbacks.onIrA('plan')}
        />
        <Kpi
          indice={3}
          acento="remesas"
          icono={Truck}
          etiqueta="De camino"
          valor={k?.deCaminoEnvios ?? null}
          formato={(n) => plural(Math.round(n), 'envío', 'envíos')}
          nota={k ? `${entero(k.deCaminoUnidades)} ud hacia Amazon` : undefined}
          cargando={cargandoPrimera}
          onClick={() => callbacks.onIrA('tablero')}
        />
        <Kpi
          indice={4}
          acento={k && k.pendientesVencidos > 0 ? COLOR_ESTADO.rojo : 'remesas'}
          icono={ListChecks}
          etiqueta="Pendientes"
          valor={k?.pendientesVencidos ?? null}
          formato={(n) => plural(Math.round(n), 'vencido', 'vencidos')}
          nota={k ? `${entero(k.pendientesEstaSemana)} vencen esta semana` : undefined}
          cargando={cargandoPrimera}
          onClick={() => {
            const quieto = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
            document.getElementById('hoy-pendientes')?.scrollIntoView({ behavior: quieto ? 'auto' : 'smooth', block: 'start' })
          }}
        />
      </FilaDeKpis>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div id="hoy-pendientes" className="min-w-0 scroll-mt-24">
          <ListaPendientes datos={pendientes} sesion={sesion} callbacks={callbacks} />
        </div>
        <div className="min-w-0">
          <GraficoSalidasSemana
            salidas={resumen?.salidasPorSemana ?? null}
            nombres={nombres}
            hoy={hoy}
            cargando={cargandoPrimera}
            sinMigracion={sinMigracion}
            onVerPlan={() => callbacks.onIrA('plan')}
          />
        </div>
      </div>

      <section aria-labelledby="hoy-clientes" className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="hoy-clientes" className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">
            <Users className="h-4 w-4 text-[var(--ls-mod-remesas)]" aria-hidden />
            Clientes
          </h2>
          {clientes.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--ls-t3)]">
              {(['rojo', 'ambar', 'verde', 'gris'] as const)
                .filter((t) => tonos[t] > 0)
                .map((t) => (
                  <span key={t} className="inline-flex items-center gap-[6px]">
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: COLOR_ESTADO[SALUD[t].tono] }} />
                    {entero(tonos[t])} {SALUD[t].corto.toLowerCase()}
                  </span>
                ))}
            </p>
          )}
        </div>

        {cargandoPrimera ? (
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <EsqueletoSaludCliente key={i} />
            ))}
          </div>
        ) : clientes.length === 0 ? (
          <EstadoVacio
            compacto
            acento="remesas"
            icono={Users}
            titulo="Ningún cliente que ver"
            descripcion={
              sesion.esAdmin
                ? 'No hay clientes con Remesas a FBA. Conecta su cuenta de Amazon para empezar.'
                : 'Pide a un administrador que te dé acceso a Remesas.'
            }
            accion={{ texto: 'Ir al tablero', onClick: () => callbacks.onIrA('tablero') }}
          />
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {clientes.map((c, i) => (
              <TarjetaSaludCliente
                key={c.clienteId}
                cliente={c}
                hoy={hoy}
                indice={i}
                enviosNuevos={enviosNuevos[c.clienteId] ?? 0}
                onAbrir={irACliente}
                onAbrirEnvio={callbacks.onAbrirEnvioPropuesto}
                onImportar={puedeEditarCliente(sesion, c.clienteId) ? callbacks.onImportarPedidos : undefined}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Euro, Gauge, Loader2, Package, RefreshCw, Undo2 } from 'lucide-react'
import { EstadoVacio, Esqueleto, FilaDeKpis, Kpi } from '@/components/ui-ls'
import { BOTON } from '@/lib/estilo/denso'
import { diaEnEspana } from '@/lib/fba/fechas'
import { marketplaceLabel } from '@/lib/types/amazon'
import { BandaDeCalidad } from '../comun/BandaDeCalidad'
import type { ClienteRemesas, SesionRemesas } from '../comun/tipos-ui'
import { cx, Segmentado } from '../comun/ui'
import { decimal, dinero, entero } from '../formato'
import { GraficoVentasDiarias } from './GraficoVentasDiarias'
import { SalidasPorAlmacen } from './SalidasPorAlmacen'
import { TopReferencias } from './TopReferencias'
import { calidadDeVentas, datosDelGrafico, kpisDeVentas, PERIODOS, textoHasta, textoPeriodo, useVentas, type DiasVentas } from './useVentas'

/**
 * SECCIÓN «VENTAS» DEL CLIENTE (`?vista=cliente&seccion=ventas`) — spec remesas-pro §6.3 y §11 D36.
 *
 * La ven la agencia y el cliente externo (no lleva nada de agencia). Datos de `GET /api/fba/ventas` (`useVentas`).
 *   1. BandaDeCalidad arriba: sin API, libro sin leer o atrasado, aviso de la copia del libro elegida.
 *   2. Periodo: 7 · 30 · 90 · 365 días.
 *   3. KPI: unidades, € (a precio actual de Amazon), ud/día y devoluciones. Con `Variacion` frente al periodo anterior
 *      de los mismos días SOLO si el libro lo cubre entero; si no, la nota «el libro no llega tan atrás».
 *      Devoluciones: con su tasa sobre lo vendido (el contrato no trae las del periodo anterior).
 *   4. Gráfico de unidades y € (por semanas con 365), hasta el último día leído.
 *   5. Top 20 con chispa y velocidad · Salidas por almacén de Amazon (país).
 *
 *   <VistaVentas sesion cliente onLeerAmazon? leyendo? />
 *   `onLeerAmazon` (solo admin, gasta cupo de Amazon): si llega, la banda enseña «Leer de Amazon».
 */
export interface VistaVentasProps {
  sesion: SesionRemesas
  cliente: ClienteRemesas
  onLeerAmazon?: () => void | Promise<void>
  leyendo?: boolean
}

export function VistaVentas({ sesion, cliente, onLeerAmazon, leyendo }: VistaVentasProps) {
  const [dias, setDias] = useState<DiasVentas>(30)
  const hoy = useMemo(() => diaEnEspana(), [])
  const { datos: ventas, cargando, error, recargar } = useVentas(cliente.id, dias)

  const kpis = useMemo(() => (ventas ? kpisDeVentas(ventas) : null), [ventas])
  const serie = useMemo(() => (ventas ? datosDelGrafico(ventas).datos : []), [ventas])
  const calidad = useMemo(() => (ventas ? calidadDeVentas(ventas, hoy) : null), [ventas, hoy])

  const moneda = ventas?.moneda ?? cliente.moneda ?? 'EUR'
  const mercado = ventas?.mercado ?? cliente.mercadoLectura
  const comparar = kpis?.anterior ?? null
  const notaComparacion = (ventas && !ventas.anteriorCompleto) ? 'el libro no llega tan atrás' : `frente a los ${dias === 365 ? '365' : dias} días anteriores`

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {calidad && (
        <BandaDeCalidad
          calidad={calidad}
          esAdmin={sesion.esAdmin}
          hoy={hoy}
          onLeerAmazon={sesion.esAdmin ? onLeerAmazon : undefined}
          leyendo={leyendo}
        />
      )}

      {/* Cabecera de la sección: qué periodo y hasta qué día */}
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="truncate text-[16px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">Ventas FBA de {cliente.nombre}</h2>
          <p className="truncate text-[12px] text-[var(--ls-t4)]">
            {ventas ? `${textoPeriodo(dias)}, ${textoHasta(ventas, hoy)}` : textoPeriodo(dias)}
            {mercado ? ` · libro de Amazon ${marketplaceLabel(mercado)}` : ''}
            {' · € a precio actual de Amazon'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Segmentado
            etiqueta="Periodo"
            valor={dias}
            onCambio={(d) => setDias(d)}
            opciones={PERIODOS.map((d) => ({ id: d, texto: d === 365 ? '1 año' : `${d} días`, titulo: d === 365 ? 'Último año, por semanas' : `Últimos ${d} días` }))}
          />
          <button
            type="button"
            onClick={() => void recargar({ servidor: true })}
            disabled={cargando}
            className={cx(BOTON.base, BOTON.secundario)}
            title="Volver a leer las ventas del servidor"
            aria-label="Actualizar las ventas"
          >
            {cargando ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {error && !ventas ? (
        <div className="rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
          <EstadoVacio
            icono={AlertTriangle}
            titulo="No se han podido leer las ventas"
            descripcion={error}
            accion={{ texto: 'Volver a probar', onClick: () => void recargar() }}
          />
        </div>
      ) : !ventas || !kpis ? (
        <EsqueletoVentas />
      ) : (
        <>
          {error && (
            <p className="text-[12px] text-[var(--ls-t3)]">
              <AlertTriangle className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden />
              No se ha podido actualizar ({error}); se ven los datos de antes.
            </p>
          )}

          <FilaDeKpis minimo={200}>
            <Kpi
              indice={0}
              acento="remesas"
              icono={Package}
              etiqueta="Unidades vendidas"
              valor={kpis.unidades}
              formato={(n) => entero(Math.round(n))}
              anterior={comparar ? comparar.unidades : undefined}
              nota={notaComparacion}
              serie={serie.length >= 2 ? serie.map((d) => d.unidades) : undefined}
            />
            <Kpi
              indice={1}
              acento="remesas"
              icono={Euro}
              etiqueta="Ventas"
              valor={kpis.euros}
              formato={(n) => dinero(n, moneda)}
              anterior={comparar && kpis.euros !== null ? comparar.euros : undefined}
              nota={kpis.euros === null ? 'sin precio en Amazon' : notaComparacion}
            />
            <Kpi
              indice={2}
              acento="remesas"
              icono={Gauge}
              etiqueta="Velocidad"
              valor={kpis.udDia}
              formato={(n) => `${decimal(n, n > 0 && n < 1 ? 2 : 1)} ud/día`}
              anterior={comparar ? comparar.udDia : undefined}
              nota={(ventas && !ventas.anteriorCompleto) ? notaComparacion : 'media del periodo, con y sin stock'}
            />
            <Kpi
              indice={3}
              acento="remesas"
              icono={Undo2}
              etiqueta="Devoluciones"
              valor={kpis.devoluciones}
              formato={(n) => entero(Math.round(n))}
              mejor="baja"
              nota={kpis.tasaDevolucion === null ? 'sin ventas en el periodo' : `${decimal(kpis.tasaDevolucion, 1)} % de lo vendido`}
            />
          </FilaDeKpis>

          <div className="ls-aparecer min-w-0" style={{ ['--ls-i' as string]: 4 }}>
            <GraficoVentasDiarias ventas={ventas} hoy={hoy} clienteNombre={cliente.nombre} />
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="ls-aparecer min-w-0 xl:col-span-2" style={{ ['--ls-i' as string]: 5 }}>
              <TopReferencias ventas={ventas} clienteNombre={cliente.nombre} />
            </div>
            <div className="ls-aparecer min-w-0" style={{ ['--ls-i' as string]: 6 }}>
              <SalidasPorAlmacen ventas={ventas} clienteNombre={cliente.nombre} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function EsqueletoVentas() {
  return (
    <div className="flex min-w-0 flex-col gap-4" aria-busy="true" aria-label="Cargando las ventas">
      <FilaDeKpis minimo={200}>
        {[0, 1, 2, 3].map((i) => (
          <Kpi key={i} etiqueta="…" valor={null} cargando />
        ))}
      </FilaDeKpis>
      <div className="rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4">
        <Esqueleto className="h-[12px] w-1/3" />
        <Esqueleto className="mt-4 h-[220px] w-full lg:h-[280px]" />
      </div>
    </div>
  )
}

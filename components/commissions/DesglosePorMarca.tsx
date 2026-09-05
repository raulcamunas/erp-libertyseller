/**
 * EL DESGLOSE DE UNA COMISIÓN PARTIDA POR MARCA (Keslem).
 *
 * Vive aparte porque lo pintan DOS sitios: la calculadora, al terminar el
 * cálculo, y la página del reporte —incluida la pública, que es el enlace que
 * se le manda al cliente con la factura—.
 *
 * Estaba escrito solo dentro de la calculadora, y eso tenía dos consecuencias:
 * el cálculo de Keslem no se podía guardar (el botón de guardar vive en el
 * bloque de al lado, el de los clientes normales), y si se hubiera guardado, la
 * página del reporte habría reventado al abrirlo: hace `report.data.summary`, y
 * un cálculo por marca no tiene `summary` ni `rows`, sino `bloques`.
 */

export interface BloqueMarca {
  etiqueta: string
  anterior: number
  actual: number
  excedente: number
  tasa: number
  comision: number
}

export interface DatosPorMarca {
  modo: 'por_marca'
  cliente: string
  marca: string | null
  catalogoReferencias: number
  bloques: BloqueMarca[]
  sinUbicar?: {
    anterior: number
    actual: number
    referencias: { asin: string; importe: number }[]
    total: number
  }
  totalComision: number
}

/** Si un objeto guardado en `commission_reports.data` es un cálculo por marca */
export function esPorMarca(data: unknown): data is DatosPorMarca {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { modo?: unknown }).modo === 'por_marca' &&
    Array.isArray((data as { bloques?: unknown }).bloques)
  )
}

const eur = (n: number) =>
  `€${Number(n ?? 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function DesglosePorMarca({ datos }: { datos: DatosPorMarca }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <p className="mb-3 text-[12px] text-white/50">
        {datos.cliente} · comparando los dos informes ·{' '}
        {Number(datos.catalogoReferencias ?? 0).toLocaleString('es-ES')} referencias en catálogo
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-[13px]">
          <thead>
            <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/40">
              <th className="pb-1.5 text-left font-semibold">Bloque</th>
              <th className="pb-1.5 text-right font-semibold">Año anterior</th>
              <th className="pb-1.5 text-right font-semibold">Año actual</th>
              <th className="pb-1.5 text-right font-semibold">Excedente</th>
              <th className="pb-1.5 text-right font-semibold">Comisión</th>
            </tr>
          </thead>
          <tbody>
            {datos.bloques.map((b) => (
              <tr key={b.etiqueta} className="border-b border-white/[0.05]">
                <td className="py-2 text-white/85">{b.etiqueta}</td>
                <td className="py-2 text-right tabular-nums text-white/60">{eur(b.anterior)}</td>
                <td className="py-2 text-right tabular-nums text-white/60">{eur(b.actual)}</td>
                {/* Un excedente negativo NO resta: la comisión de ese bloque es
                    cero. Se pinta en rojo para que se vea que ese año fue peor,
                    pero un año peor no genera deuda del cliente. */}
                <td
                  className={`py-2 text-right tabular-nums ${
                    b.excedente >= 0 ? 'text-emerald-300' : 'text-red-300'
                  }`}
                >
                  {eur(b.excedente)}
                </td>
                <td className="py-2 text-right tabular-nums font-semibold text-[#FF6600]">
                  {eur(b.comision)}
                  <span className="ml-1 text-[10px] font-normal text-white/35">
                    {(b.tasa * 100).toFixed(0)}%
                  </span>
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={4} className="py-2 text-right text-[12px] text-white/50">
                Total a facturar
              </td>
              <td className="py-2 text-right text-[16px] font-bold tabular-nums text-[#FF6600]">
                {eur(datos.totalComision)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* LO QUE NO SE HA PODIDO UBICAR SE DICE, NO SE REPARTE.
          Suelen ser productos retirados que ya no salen en el informe de
          listados. Meterlos en terceros «porque son mayoría» cambiaría el
          importe sin que nadie lo supiera. */}
      {(datos.sinUbicar?.total ?? 0) > 0 && datos.sinUbicar && (
        <div className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/[0.05] p-2.5">
          <p className="text-[11.5px] leading-relaxed text-amber-100/85">
            <strong>{datos.sinUbicar.total} referencias sin ubicar</strong> — no están en el
            catálogo, así que no se sabe de qué marca son y{' '}
            <strong>se han dejado fuera del cálculo</strong>. Suman {eur(datos.sinUbicar.anterior)}{' '}
            el año anterior y {eur(datos.sinUbicar.actual)} el actual. Suele ser producto retirado:
            sube el informe de listados más reciente y vuelve a calcular.
          </p>
          <p className="mt-1 text-[10.5px] text-amber-100/50">
            {datos.sinUbicar.referencias
              .slice(0, 8)
              .map((r) => `${r.asin} (${r.importe} €)`)
              .join(' · ')}
          </p>
        </div>
      )}
    </div>
  )
}

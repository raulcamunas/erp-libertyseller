'use client'

import { COMPARATIVA, type IdPropuesta } from './propuestas'

/**
 * LAS TRES FRENTE A LO DE HOY, con los números del diagnóstico.
 *
 * La columna de la propuesta que se está mirando se resalta, para que se pueda
 * saltar de una maqueta a otra y leer la tabla sin perder el sitio.
 *
 * La columna «hoy» marca en rojo Y con la palabra las casillas que son el
 * problema a resolver: si el color fuera el único canal, esta tabla estaría
 * incumpliendo el mismo criterio 5 que evalúa.
 */
export function TablaComparativa({ activa }: { activa: IdPropuesta }) {
  return (
    <div className="cmp-tabla-caja">
      <table className="cmp-tabla">
        <caption
          style={{
            captionSide: 'top',
            textAlign: 'left',
            padding: '10px 12px 6px',
          }}
        >
          <span className="cmp-h2">Las tres frente a lo de hoy</span>
          <span className="cmp-s" style={{ display: 'block', marginTop: 2 }}>
            Los números de «hoy» salen del informe de diagnóstico, medidos sobre este repositorio. Los
            de las tres propuestas, de la memoria que trae cada una. La columna que estás mirando va
            resaltada.
          </span>
        </caption>
        <thead>
          <tr>
            <th style={{ minWidth: 190 }}>Criterio</th>
            <th className="cmp-col-prop" data-on={activa === 'hoy' ? '1' : undefined}>
              Como está hoy
            </th>
            <th className="cmp-col-prop" data-on={activa === 'denso' ? '1' : undefined}>
              Denso y sobrio
            </th>
            <th className="cmp-col-prop" data-on={activa === 'claro' ? '1' : undefined}>
              Claro y nítido
            </th>
            <th className="cmp-col-prop" data-on={activa === 'estructurado' ? '1' : undefined}>
              Estructurado por contexto
            </th>
          </tr>
        </thead>
        <tbody>
          {COMPARATIVA.map((f, i) => (
            <tr key={f.criterio} data-zebra={i % 2 === 1 ? 'si' : undefined}>
              <td>
                <strong className="cmp-t1">{f.criterio}</strong>
                <br />
                <span className="cmp-s">{f.detalle}</span>
              </td>
              <td
                className="cmp-col-prop cmp-td-hoy"
                data-on={activa === 'hoy' ? '1' : undefined}
                data-falla={f.hoyFalla ? 'si' : undefined}
              >
                {f.hoyFalla && <strong>Falla · </strong>}
                {f.hoy}
              </td>
              <td className="cmp-col-prop" data-on={activa === 'denso' ? '1' : undefined}>
                {f.denso}
              </td>
              <td className="cmp-col-prop" data-on={activa === 'claro' ? '1' : undefined}>
                {f.claro}
              </td>
              <td className="cmp-col-prop" data-on={activa === 'estructurado' ? '1' : undefined}>
                {f.estructurado}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

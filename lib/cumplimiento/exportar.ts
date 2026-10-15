import { ACCION_ES, ROTULO_TEMA, estadoDeFicha, type FilaCumplimiento } from './tipos'

/**
 * EL CSV DE CUMPLIMIENTO, PARA MANDÁRSELO AL CLIENTE.
 * PURO: recibe las filas y devuelve el texto. Se prueba en exportar.prueba.ts.
 *
 * UNA FILA POR INCIDENCIA, no por listing: quien lo abre en Excel quiere filtrar
 * por «Mercancías peligrosas» o por «Oculto en las búsquedas», y con una celda que
 * junta cinco incidencias no puede. El SKU se repite; es lo que hace que se pueda
 * filtrar y ordenar.
 *
 * Separado por «;» y con la coma decimal en mente: es lo que abre bien el Excel en
 * español. El BOM lo añade quien lo sirve.
 */

const CABECERA = [
  'SKU',
  'ASIN',
  'Producto',
  'País',
  'Estado en Amazon',
  'Con stock',
  'Gravedad',
  'Tema',
  'Código de Amazon',
  'Mensaje de Amazon',
  'Atributos',
  'Qué hace Amazon',
  'Plazo de gracia hasta',
  'Abierta desde',
  'Revisado',
]

const ESTADO_ES = { comprable: 'Comprable', visible: 'Visible, no comprable', oculto: 'Oculto' } as const
const GRAVEDAD_ES = { error: 'Error', aviso: 'Aviso', info: 'Sugerencia' } as const

/**
 * Un valor listo para una celda.
 *
 * Una celda que EMPIEZA por `=`, `+`, `@` o `-` seguido de letra la interpreta Excel
 * como fórmula, y el texto sale de Amazon y del catálogo del cliente: un título que
 * empiece por «=» no puede ejecutar nada en el ordenador de quien abre el fichero.
 * Se le antepone una comilla simple, que Excel no muestra. Un número negativo
 * («-5») no se toca.
 */
export function celda(v: string | number | boolean | null | undefined): string {
  let t = v === null || v === undefined ? '' : String(v)
  if (/^[=+@]/.test(t) || /^-[^\d\s.,]/.test(t)) t = `'${t}`
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

const dia = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '')

export function aCsv(filas: readonly FilaCumplimiento[], nombrePais: (id: string) => string): string {
  const lineas: string[] = [CABECERA.join(';')]

  for (const f of filas) {
    for (const i of f.incidencias) {
      lineas.push(
        [
          f.sku,
          f.asin,
          f.titulo,
          nombrePais(f.marketplace_id),
          ESTADO_ES[estadoDeFicha(f.estado)],
          f.con_stock ? 'Sí' : 'No',
          GRAVEDAD_ES[i.gravedad],
          ROTULO_TEMA[i.tema].corto,
          i.codigo,
          i.mensaje,
          i.atributos.join(', '),
          i.acciones.map((a) => ACCION_ES[a] ?? a).join(' · '),
          i.exencion?.estado === 'EXEMPT_UNTIL_EXPIRY_DATE' ? dia(i.exencion.caduca) : '',
          dia(i.desde),
          dia(f.revisado_at),
        ]
          .map(celda)
          .join(';')
      )
    }
  }
  return lineas.join('\r\n')
}

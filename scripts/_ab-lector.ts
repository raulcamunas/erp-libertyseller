/**
 * A/B DEL LECTOR CONFIGURABLE.
 *
 * Se ejecuta ANTES y DESPUÉS de tocar lib/stock-sync/lector.ts y las dos
 * salidas se comparan byte a byte. Todo lo que hay aquí son libros construidos
 * en memoria: no hace falta ningún fichero de cliente.
 *
 *   npx tsx <este fichero> > antes.json
 *   ... cambios ...
 *   npx tsx <este fichero> > despues.json
 *   diff antes.json despues.json
 */

import * as XLSX from 'xlsx'
import { PERFIL_SHOPLAMP_EAN, PERFIL_SHOPLAMP_STOCK, leerEan, leerStock } from '../lib/stock-sync/lector'
import { crossStock } from '../lib/stock-sync/engine'

function libro(hojas: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new()
  for (const [nombre, filas] of Object.entries(hojas)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), nombre)
  }
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer)
}

const salida: Record<string, unknown> = {}

function prueba(nombre: string, fn: () => unknown): void {
  try {
    salida[nombre] = { ok: true, valor: fn() }
  } catch (error) {
    salida[nombre] = { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/* 1. El caso normal, hoja por nombre */
prueba('normal', () =>
  leerStock(
    libro({
      Browser: [
        ['Articulo', 'Descrip.Propia', 'St. Real'],
        ['0050119247', 'LED PLAFON', 12],
        ['080997933', 'LED PLS', '3'],
      ],
    }),
    PERFIL_SHOPLAMP_STOCK
  )
)

/* 2. La hoja del perfil no existe: aviso + reconocimiento por columnas */
prueba('hojaQueNoEsta', () =>
  leerStock(
    libro({
      Resumen: [['Total'], [42]],
      Detalle: [
        ['Articulo', 'St. Real'],
        ['A1', 5],
      ],
    }),
    PERFIL_SHOPLAMP_STOCK
  )
)

/* 3. Cabecera no en la primera fila + fila en blanco de separación */
prueba('cabeceraAbajo', () =>
  leerStock(
    libro({
      Browser: [
        ['INFORME DE STOCK'],
        [],
        ['Articulo', 'St. Real', 'Descripcion'],
        [],
        ['A1', 7, 'uno'],
        ['', '', ''],
        ['A2', 0, 'dos'],
      ],
    }),
    PERFIL_SHOPLAMP_STOCK
  )
)

/* 4. fila_cabecera y fila_datos fijadas a mano */
prueba('filasFijadas', () =>
  leerStock(
    libro({
      Hoja1: [
        ['basura', 'basura'],
        ['Ref', 'Stock'],
        ['no-leer', 1],
        ['A9', 4],
      ],
    }),
    {
      nombre: 'Fijado',
      tipo: 'stock',
      hoja: 'Hoja1',
      filaCabecera: 2,
      filaDatos: 4,
      columnas: { referencia: ['Ref'], stock: ['Stock'] },
    }
  )
)

/* 5. Casa por prefijo: tiene que avisar */
prueba('porPrefijo', () =>
  leerStock(
    libro({
      Browser: [
        ['Articulo', 'Stock value', 'St. Realmente'],
        ['A1', 1234.5, 9],
      ],
    }),
    {
      nombre: 'Prefijo',
      tipo: 'stock',
      hoja: 'Browser',
      columnas: { referencia: ['Articulo'], stock: ['St. Real'] },
    }
  )
)

/* 6. Exclusión mutua: coste y precio no pueden llevarse la misma columna */
prueba('exclusionMutua', () =>
  leerStock(
    libro({
      Browser: [
        ['Articulo', 'St. Real', 'Precio'],
        ['A1', 1, '12,50'],
      ],
    }),
    {
      nombre: 'Exclusion',
      tipo: 'stock',
      hoja: 'Browser',
      columnas: {
        referencia: ['Articulo'],
        stock: ['St. Real'],
        coste: ['Precio'],
        precio: ['Precio'],
      },
    }
  )
)

/* 7. Falta una obligatoria: el mensaje de error entero */
prueba('faltaObligatoria', () =>
  leerStock(
    libro({
      Browser: [
        ['Articulo', 'Descripcion'],
        ['A1', 'uno'],
      ],
    }),
    PERFIL_SHOPLAMP_STOCK
  )
)

/* 8. Columna opcional apuntada que el fichero no trae: aviso, no error */
prueba('opcionalAusente', () =>
  leerStock(
    libro({
      Browser: [
        ['Articulo', 'St. Real'],
        ['A1', 3],
      ],
    }),
    {
      nombre: 'Opcional',
      tipo: 'stock',
      hoja: 'Browser',
      columnas: { referencia: ['Articulo'], stock: ['St. Real'], precio: ['PVP'] },
    }
  )
)

/* 9. CSV con separador y codificación del perfil */
prueba('csvEspanol', () => {
  const csv = new TextEncoder().encode(
    'Articulo;St. Real;Precio\n0001;1.499;62,72\n0002;3;1.499\n'
  )
  return leerStock(csv, {
    nombre: 'CSV',
    tipo: 'stock',
    csvSeparador: ';',
    csvCodificacion: 'utf-8',
    columnas: { referencia: ['Articulo'], stock: ['St. Real'], precio: ['Precio'] },
  })
})

/* 10. Fichero vacío y libro sin filas */
prueba('ficheroVacio', () => leerStock(new Uint8Array(0), PERFIL_SHOPLAMP_STOCK))

/* 11. Perfil de tipo equivocado */
prueba('tipoEquivocado', () => leerStock(libro({ Browser: [['a', 'b']] }), PERFIL_SHOPLAMP_EAN))

/* 12. EAN: filtro por tipo 1 */
prueba('ean', () => {
  const lectura = leerEan(
    libro({
      Browser: [
        ['Cod.Articulo', 'Codigo de Barras', 'Tipo'],
        ['0080997933', '5410288431161', 1],
        ['0080997933', '0080997933.01', 2],
        ['080997933', '5410288302201', 1],
      ],
    }),
    PERFIL_SHOPLAMP_EAN
  )
  return { ...lectura, indice: [...lectura.indice.entries()] }
})

/* 13. EAN sin columna de tipo: avisa */
prueba('eanSinTipo', () => {
  const lectura = leerEan(
    libro({
      Browser: [
        ['Cod.Articulo', 'EAN'],
        ['A1', '5410288431161'],
      ],
    }),
    PERFIL_SHOPLAMP_EAN
  )
  return { ...lectura, indice: [...lectura.indice.entries()] }
})

/* 14. El cruce entero por el camino del lector */
prueba('cruce', () => {
  const lectura = leerStock(
    libro({
      Browser: [
        ['Articulo', 'Descrip.Propia', 'St. Real'],
        ['0080997933', 'PLAFON', 1],
        ['080997933', 'PLS', 0],
        ['0050119247', 'OTRO', 7],
      ],
    }),
    PERFIL_SHOPLAMP_STOCK
  )
  const ean = leerEan(
    libro({
      Browser: [
        ['Cod.Articulo', 'Codigo de Barras', 'Tipo'],
        ['0080997933', '5410288431161', 1],
        ['080997933', '5410288302201', 1],
      ],
    }),
    PERFIL_SHOPLAMP_EAN
  )
  return crossStock({
    mappings: [
      { sku_amazon: 'SKU-A', ref_erp: '80997933', ean_erp: '5410288431161' },
      { sku_amazon: 'SKU-B', ref_erp: '80997933' },
      { sku_amazon: 'SKU-C', ref_erp: '50119247' },
    ],
    stockLines: lectura.lineas,
    eanIndex: ean.indice,
  })
})

console.log(JSON.stringify(salida, null, 2))

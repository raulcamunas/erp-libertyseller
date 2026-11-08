'use client'

import { Plus, X } from 'lucide-react'
import { textoDe, type Bloque, type Segmento } from '@/lib/tareas-clientes/bloques'

/**
 * UNA TABLA DEL CUERPO DE LA TAREA: una cuadrícula de celdas de una línea. Se pueden escribir las celdas, añadir y quitar filas, y marcar la primera fila y la primera columna
 * como encabezados. Columnas: solo en una tabla nueva (hecha aquí); una que ya está en Notion no deja cambiar su ancho (la API de Notion no lo permite) y no se ofrece.
 *
 * Una celda que no se toca conserva su formato (negrita, enlaces…); la que se escribe aquí queda como texto llano.
 */

const MAX_FILAS = 100
const MAX_COLUMNAS = 20

type Celda = Segmento[]

export function TablaEditable({ bloque: b, soloLectura, onCambio }: { bloque: Bloque; soloLectura: boolean; onCambio: (cambios: Partial<Bloque>) => void }) {
  const filas: Celda[][] = b.filas ?? []
  const ancho = Math.max(1, ...filas.map((f) => f.length))
  const ids = b.filaIds ?? []
  const puedeColumnas = !b.notion_id && !soloLectura

  const poner = (nuevas: Celda[][], nuevosIds: Array<string | null> = ids) => onCambio({ filas: nuevas, filaIds: nuevosIds })

  const escribir = (f: number, c: number, valor: string) => {
    const copia = filas.map((fila) => [...fila])
    while (copia[f].length <= c) copia[f].push([])
    copia[f][c] = valor === '' ? [] : [{ t: valor }]
    poner(copia)
  }
  const anadirFila = () => poner([...filas, Array.from({ length: ancho }, () => [])], [...filas.map((_, i) => ids[i] ?? null), null])
  const quitarFila = (f: number) => {
    if (filas.length <= 1) return
    poner(filas.filter((_, i) => i !== f), filas.map((_, i) => ids[i] ?? null).filter((_, i) => i !== f))
  }
  const anadirColumna = () => poner(filas.map((fila) => [...Array.from({ length: ancho }, (_, i) => fila[i] ?? []), []]))
  const quitarColumna = (c: number) => {
    if (ancho <= 1) return
    poner(filas.map((fila) => Array.from({ length: ancho }, (_, i) => fila[i] ?? []).filter((_, i) => i !== c)))
  }

  return (
    <div className="tc-tabla-editor">
      <div className="overflow-x-auto">
        <table>
          <tbody>
            {puedeColumnas && ancho > 1 && (
              <tr className="tc-tabla-quitar-col" aria-hidden={soloLectura}>
                {Array.from({ length: ancho }, (_, c) => (
                  <td key={c}><button type="button" aria-label={`Quitar la columna ${c + 1}`} onClick={() => quitarColumna(c)}><X className="h-3 w-3" /></button></td>
                ))}
                <td />
              </tr>
            )}
            {filas.map((fila, f) => (
              <tr key={f} data-encabezado={b.encabezadoFila && f === 0 ? 'true' : undefined}>
                {Array.from({ length: ancho }, (_, c) => (
                  <td key={c} data-encabezado={b.encabezadoColumna && c === 0 ? 'true' : undefined}>
                    <input value={textoDe(fila[c] ?? [])} onChange={(e) => escribir(f, c, e.target.value)} readOnly={soloLectura} aria-label={`Fila ${f + 1}, columna ${c + 1}`} />
                  </td>
                ))}
                {!soloLectura && filas.length > 1 && (
                  <td className="tc-tabla-quitar-fila"><button type="button" aria-label={`Quitar la fila ${f + 1}`} onClick={() => quitarFila(f)}><X className="h-3 w-3" /></button></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!soloLectura && (
        <div className="tc-tabla-acciones">
          <button type="button" onClick={anadirFila} disabled={filas.length >= MAX_FILAS}><Plus className="h-3 w-3" /> Fila</button>
          {puedeColumnas && <button type="button" onClick={anadirColumna} disabled={ancho >= MAX_COLUMNAS}><Plus className="h-3 w-3" /> Columna</button>}
          <label><input type="checkbox" className="tc-casilla" checked={Boolean(b.encabezadoFila)} onChange={(e) => onCambio({ encabezadoFila: e.target.checked })} /> Encabezado de fila</label>
          <label><input type="checkbox" className="tc-casilla" checked={Boolean(b.encabezadoColumna)} onChange={(e) => onCambio({ encabezadoColumna: e.target.checked })} /> Encabezado de columna</label>
        </div>
      )}
    </div>
  )
}

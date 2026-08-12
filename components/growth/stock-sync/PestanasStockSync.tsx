'use client'

import { useState, type ReactNode } from 'react'
import { History, Upload } from 'lucide-react'

/**
 * LAS DOS CARAS DEL SUBMÓDULO, y solo para quien tiene las dos.
 *
 * «Ejecuciones» es lo que ve TODO EL MUNDO y lo que se abre de entrada: qué ha
 * hecho el ERP en la cuenta de este cliente y qué valor cambió en cada SKU.
 *
 * «Subida manual» es la pantalla de antes —el volcado a mano y la tabla de
 * mapeo— y solo aparece para los clientes que tienen mapeo importado. Hoy eso
 * es uno. No se decide por su nombre sino por si el dato existe: el día que otro
 * importe su mapeo le sale sola, y el día que ese deje de usarla desaparece sin
 * tocar código.
 *
 * Este componente NO renderiza nada de las dos pantallas: las recibe ya
 * montadas por el servidor y solo enseña una. Así el panel de ejecuciones sigue
 * cargando sus datos en el servidor, sin que la pestaña obligue a convertir
 * media pantalla en cliente.
 */
export function PestanasStockSync({
  ejecuciones,
  manual,
}: {
  ejecuciones: ReactNode
  manual: ReactNode
}) {
  const [vista, setVista] = useState<'ejecuciones' | 'manual'>('ejecuciones')

  return (
    <div className="flex flex-col h-full gap-3 min-w-0">
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {(
          [
            { id: 'ejecuciones' as const, icono: History, texto: 'Ejecuciones' },
            { id: 'manual' as const, icono: Upload, texto: 'Subida manual y mapeo' },
          ]
        ).map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setVista(p.id)}
            className={`px-2.5 py-1 rounded-full border text-[11px] font-medium flex items-center gap-1.5 transition-colors ${
              vista === p.id
                ? 'border-[#FF6600]/60 bg-[#FF6600]/15 text-white'
                : 'border-white/10 text-white/40 hover:text-white/80'
            }`}
          >
            <p.icono className="h-3 w-3" />
            {p.texto}
          </button>
        ))}
      </div>

      {/* Las dos se montan y se esconde la que no toca, en vez de desmontarla.
          La de subida manual guarda ficheros elegidos y el resultado del último
          proceso en su estado: desmontarla al cambiar de pestaña tiraría un
          fichero recién procesado que todavía no se ha descargado. */}
      <div className={`flex-1 min-h-0 min-w-0 ${vista === 'ejecuciones' ? 'flex' : 'hidden'}`}>
        {ejecuciones}
      </div>
      <div className={`flex-1 min-h-0 min-w-0 ${vista === 'manual' ? 'flex' : 'hidden'}`}>
        {manual}
      </div>
    </div>
  )
}

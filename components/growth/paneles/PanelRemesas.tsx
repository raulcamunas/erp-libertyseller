import { Boxes } from 'lucide-react'
import type { ClienteGrowth } from '@/lib/growth/clientes'
import { panelDeCliente } from '@/lib/fba/datos'
import { diaEnEspana } from '@/lib/fba/fechas'
import { TableroRemesas } from '@/components/growth/remesas/TableroRemesas'

/**
 * REMESAS A FBA: QUÉ MANDAMOS Y CUÁNTO QUEDA VIVO DE CADA ENVÍO.
 *
 * Sustituye a un Excel con una pestaña por envío donde la columna «Unidades
 * Vendidas» se rellenaba a mano. En el de ShoesF había 9 envíos y 1.200 unidades
 * enviadas, con 30 ventas apuntadas: siete de los nueve estaban a cero. La
 * estructura era buena; lo que no se sostiene es teclear 375 líneas.
 *
 * El cálculo entero pasa en el servidor. A la pantalla le llega ya repartido.
 */
export async function PanelRemesas({ cliente }: { cliente: ClienteGrowth }) {
  if (!cliente.amazonClientId) {
    return (
      <div className="glass-card flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
        <Boxes className="h-8 w-8 text-white/20" />
        <p className="text-sm text-white/60">
          {cliente.nombre} todavía no tiene ficha de Amazon, así que no hay dónde colgar sus
          remesas.
        </p>
      </div>
    )
  }

  const panel = await panelDeCliente(cliente.amazonClientId, { hoy: diaEnEspana() })

  return (
    <TableroRemesas
      clienteId={cliente.amazonClientId}
      clienteNombre={cliente.nombre}
      panel={panel}
    />
  )
}

export function InfoRemesas() {
  return (
    <div className="space-y-2 text-[11px] leading-relaxed text-white/50">
      <p>
        Cada envío que mandas a los almacenes de Amazon, y cuántas unidades le quedan vivas. Las
        ventas se descuentan del envío más antiguo primero.
      </p>
      <p>
        Lo que descuenta son las ventas, las mermas y las retiradas. Los traslados entre almacenes
        de Amazon no, porque no se ha vendido nada.
      </p>
      <p className="text-white/35">
        Amazon mezcla la mercancía de todos los envíos: el reparto por remesa es una convención
        contable nuestra, no algo que Amazon distinga. El total sí es un hecho, y el descuadre lo
        dice.
      </p>
    </div>
  )
}

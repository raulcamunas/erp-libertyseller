import { ShieldCheck } from 'lucide-react'
import { Vacio } from '@/components/plataforma/comun'
import { ListaInfo, SeccionInfo } from '@/components/ui/BotonInfo'
import type { ClienteGrowth } from '@/lib/growth/clientes'
import { listarVerificaciones } from '@/lib/stock-sync/verificacion-consulta'
import { TableroVerificacion } from '@/components/growth/verificacion/TableroVerificacion'

/**
 * SUBMÓDULO «VERIFICACIÓN DE STOCK».
 *
 * Media hora después de subir el stock de un cliente con verificación activada, se
 * vuelve a leer Amazon y se comprueba que lo enviado ha quedado bien. Aquí se ve el
 * historial y el informe de cada una. El aviso a Slack sale de la misma
 * verificación.
 *
 * Es de cualquier cliente que mande volcado de stock: si no tiene verificación
 * activada, la pantalla lo dice en vez de enseñarse vacía como si fuera una avería.
 */
export async function PanelVerificacionStock({ cliente }: { cliente: ClienteGrowth }) {
  if (!cliente.stockClientId) {
    return (
      <Vacio icono={<ShieldCheck />} titulo="Este cliente no manda volcado de stock">
        La verificación comprueba el stock que se sube a Amazon desde su fichero, y{' '}
        <strong>{cliente.nombre}</strong> no tiene ninguno configurado.
      </Vacio>
    )
  }

  const lista = await listarVerificaciones(cliente.stockClientId)
  // La llave remonta la pantalla al cambiar de cliente arriba.
  return <TableroVerificacion key={cliente.slug} stockClientId={cliente.stockClientId} inicial={lista} />
}

export function InfoVerificacionStock() {
  return (
    <>
      <SeccionInfo titulo="Qué hace">
        <p>
          Cada vez que el sincronismo sube el stock de un cliente con verificación (hoy Lenobotics y Shoplamp), se apunta
          una comprobación para <strong>30 minutos después</strong>. Pasado ese tiempo se lee en Amazon, en directo, lo
          que tiene cada SKU enviado, y se compara con lo que se mandó descontando las ventas del intervalo.
        </p>
        <p>
          Solo <strong>lee</strong>: no corrige nada por su cuenta. Lo que falla se ve aquí y en el aviso a Slack.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Qué resultados hay">
        <ListaInfo>
          <li>
            <strong>Correcto</strong> — Amazon tiene lo enviado, o lo enviado menos lo vendido desde entonces.
          </li>
          <li>
            <strong>Rechazado</strong> — Amazon no aceptó el cambio.
          </li>
          <li>
            <strong>No se aplicó</strong> — Amazon lo aceptó pero el SKU sigue con el valor de antes.
          </li>
          <li>
            <strong>Distinto</strong> — hay más de lo que se mandó: alguien o algo ha escrito encima.
          </li>
          <li>
            <strong>Ha bajado</strong> — hay menos de lo esperado. Casi siempre es una venta; no cuenta como fallo.
          </li>
          <li>
            <strong>Sin verificar</strong> — Amazon no devolvió el listing o su cantidad.
          </li>
        </ListaInfo>
      </SeccionInfo>

      <SeccionInfo titulo="Las ventas del intervalo">
        <p>
          Se cuentan con los pedidos de Amazon. Si la aplicación no tiene permiso para leerlos, o hay demasiados, la
          verificación sigue sin ellos y lo dice: entonces una bajada no se puede distinguir de un cambio que no se aplicó
          y se marca como «ha bajado», nunca como fallo.
        </p>
      </SeccionInfo>
    </>
  )
}

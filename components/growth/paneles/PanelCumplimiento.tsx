import { ClipboardCheck } from 'lucide-react'
import { Vacio } from '@/components/plataforma/comun'
import { ListaInfo, SeccionInfo } from '@/components/ui/BotonInfo'
import type { ClienteGrowth } from '@/lib/growth/clientes'
import { conexionesDeCliente } from '@/lib/cumplimiento/conexiones'
import { paginaDeCliente, resumenDeCliente } from '@/lib/cumplimiento/consulta'
import { hayRevisionEnCurso } from '@/lib/cumplimiento/revisar'
import { FILTROS_POR_DEFECTO } from '@/lib/cumplimiento/tipos'
import { TableroCumplimiento } from '@/components/growth/cumplimiento/TableroCumplimiento'

/**
 * SUBMÓDULO «CUMPLIMIENTO».
 *
 * Los listings de UN cliente que Amazon marca con errores o tiene ocultos, y por qué:
 * atributos que faltan, seguridad de producto, mercancías peligrosas, códigos de
 * barras, imágenes... con lo que Amazon hace por cada causa y desde cuándo.
 *
 * Es de cualquier cliente con la cuenta de Amazon conectada. Todo cuelga de ese
 * cliente: no hay ninguna vista que junte o compare varios.
 */
export async function PanelCumplimiento({ cliente }: { cliente: ClienteGrowth }) {
  if (!cliente.amazonClientId) {
    return (
      <Vacio icono={<ClipboardCheck />} titulo="Este cliente no tiene la cuenta de Amazon conectada">
        Las incidencias se leen de la cuenta de Amazon de <strong>{cliente.nombre}</strong>, y todavía
        no la ha autorizado. Se conecta desde <strong>Amazon API · Cuentas</strong>.
      </Vacio>
    )
  }

  const [resumen, conexiones] = await Promise.all([
    resumenDeCliente(cliente.amazonClientId),
    conexionesDeCliente(cliente.amazonClientId).catch(() => []),
  ])
  const pagina = resumen.ok ? await paginaDeCliente(cliente.amazonClientId, FILTROS_POR_DEFECTO, 0) : null

  return (
    // La llave remonta la pantalla al cambiar de cliente arriba.
    <TableroCumplimiento
      key={cliente.slug}
      slug={cliente.slug}
      nombre={cliente.nombre}
      resumenInicial={resumen}
      paginaInicial={pagina && !('error' in pagina) ? pagina : { filas: [], hayMas: false }}
      enCursoInicial={hayRevisionEnCurso(conexiones.map((c) => c.id))}
    />
  )
}

export function InfoCumplimiento() {
  return (
    <>
      <SeccionInfo titulo="Qué hace">
        <p>
          Cada hora lee en Amazon, listing a listing, las <strong>incidencias</strong> que Amazon le pone: lo que le
          falta, lo que está mal y <strong>qué ha hecho por ello</strong> —ocultarlo en las búsquedas, impedir que se
          compre, quitarlo del catálogo—. Aquí se ven las de <strong>un solo cliente</strong>, las más graves primero.
        </p>
        <p>
          Solo <strong>lee</strong>: no corrige nada en Amazon. Arreglar la ficha se hace en Seller Central; después, el
          botón <em>Revisar de nuevo</em> de la fila comprueba si Amazon ya lo da por bueno.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Lo que NO es">
        <p>
          No es el panel <strong>«Gestionar su cumplimiento»</strong> ni <strong>«Salud de la cuenta»</strong> de Seller
          Central: Amazon no los publica por ninguna API, así que los casos abiertos allí (avisos de GPSR, certificados
          que pide Amazon) no se ven aquí.
        </p>
        <p>
          Sí se ve todo lo que Amazon pega al propio listing, que incluye los atributos de seguridad de producto y de
          mercancías peligrosas cuando faltan. Si una incidencia de Seller Central no aparece aquí, es porque Amazon no
          la ha puesto en el listing.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Cómo se leen las cifras">
        <ListaInfo>
          <li>
            <strong>Con stock y con problema</strong> — lo que se está dejando de vender hoy. Es lo primero que mirar.
          </li>
          <li>
            <strong>Errores</strong> — Amazon dice que algo obligatorio falta o está mal. <strong>Ocultos</strong> — además
            ha sacado el listing de las búsquedas o de la venta.
          </li>
          <li>
            <strong>Solo avisos</strong> — recomendaciones de Amazon. No bloquean nada y no cuentan como «necesitan
            atención».
          </li>
          <li>
            <strong>Plazo de gracia</strong> — Amazon a veces da hasta una fecha para arreglarlo. Hasta entonces el
            listing no está oculto, pero sigue contando como error.
          </li>
        </ListaInfo>
      </SeccionInfo>

      <SeccionInfo titulo="Por qué «revisados» no es «todos»">
        <p>
          Amazon solo deja leer las incidencias de <strong>20 listings por llamada</strong>, y el cupo se comparte con
          el resto del ERP. Una cuenta grande no se revisa entera en una hora: cada pasada coge primero los listings{' '}
          <strong>con stock que aún no se han visto</strong>, luego los que ya tienen problemas (para enterarse pronto de
          que se han arreglado) y después el resto. Los números de arriba son los de lo revisado, y la barra dice cuánto
          falta.
        </p>
        <p>
          Se vuelve a mirar cada 6 horas lo que tiene problemas, cada 24 h lo que tiene stock y cada 72 h el resto.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="El tema es una ayuda para agrupar">
        <p>
          Amazon no dice «esto es de normativa». El tema se deduce de los nombres de los atributos y del texto del
          mensaje, y sirve para filtrar. El <strong>mensaje de Amazon</strong> sale siempre al lado, tal cual: si el tema
          no cuadra, manda el mensaje.
        </p>
      </SeccionInfo>
    </>
  )
}

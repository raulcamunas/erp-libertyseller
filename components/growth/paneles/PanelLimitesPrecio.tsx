import { Link2Off } from '@/components/ui/iconos'
import { Vacio } from '@/components/plataforma/comun'
import { ListaInfo, SeccionInfo } from '@/components/ui/BotonInfo'
import type { ClienteGrowth } from '@/lib/growth/clientes'
import { createServiceClient } from '@/lib/supabase/service'
import { AMAZON_MARKETPLACES } from '@/lib/types/amazon'
import { DESVIO_SOSPECHOSO } from '@/lib/precios-limites/diagnostico'
import { TableroLimitesPrecio } from '@/components/growth/limites/TableroLimitesPrecio'

/**
 * SUBMÓDULO «SINCRONIZAR PRECIO MÍN Y MÁX» — ARREGLAR LOS «ERROR DE PRECIO».
 *
 * Para cualquier cliente con la cuenta de Amazon conectada. El cliente se elige
 * arriba, en el selector de Growth Partner, y el país aquí dentro.
 *
 * Esta parte solo averigua QUÉ PAÍSES puede elegir: los que ese cliente nos ha
 * autorizado en su cuenta. Todo lo demás —buscar, leer, corregir— lo hace la
 * pantalla contra /api/precios-limites.
 */
export async function PanelLimitesPrecio({ cliente }: { cliente: ClienteGrowth }) {
  if (!cliente.amazonClientId) {
    return (
      <Vacio icono={<Link2Off />} titulo={`${cliente.nombre} no tiene su cuenta de Amazon conectada`}>
        Para leer y corregir los límites de precio hace falta su cuenta de Amazon. Se conecta desde{' '}
        <strong>Amazon API · Cuentas</strong>.
      </Vacio>
    )
  }

  const service = createServiceClient()
  const { data } = await service
    .from('amazon_connections')
    .select('marketplace_ids, default_marketplace_id, status, is_active')
    .eq('client_id', cliente.amazonClientId)
    .eq('is_active', true)
    .limit(1)

  const conexion = ((data ?? []) as Array<{
    marketplace_ids: string[] | null
    default_marketplace_id: string | null
    status: string
  }>)[0]

  if (!conexion || conexion.status !== 'activa') {
    return (
      <Vacio icono={<Link2Off />} titulo={`La cuenta de ${cliente.nombre} no está activa`}>
        Reconéctala desde <strong>Amazon API · Cuentas</strong> y vuelve aquí.
      </Vacio>
    )
  }

  // Solo los países que tienen nombre en nuestra tabla: un código en bruto en un
  // desplegable no lo entiende nadie, y los países que no están en la tabla
  // tampoco tienen ficha de catálogo en el ERP.
  const mercados = (conexion.marketplace_ids ?? [])
    .map((id) => AMAZON_MARKETPLACES.find((m) => m.id === id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m))
    .map((m) => ({ id: m.id, label: m.label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es'))

  if (mercados.length === 0) {
    return (
      <Vacio icono={<Link2Off />} titulo="Esta cuenta no tiene ningún país autorizado">
        Hay que volver a autorizarla desde <strong>Amazon API · Cuentas</strong>.
      </Vacio>
    )
  }

  const inicial =
    mercados.find((m) => m.id === conexion.default_marketplace_id)?.id ?? mercados[0].id

  return (
    // La llave remonta la pantalla al cambiar de cliente arriba: sin ella se vería
    // el nombre nuevo con la lista de errores del cliente anterior debajo.
    <TableroLimitesPrecio
      key={cliente.slug}
      clientId={cliente.amazonClientId}
      mercados={mercados}
      mercadoInicial={inicial}
    />
  )
}

export function InfoLimitesPrecio() {
  return (
    <>
      <SeccionInfo titulo="Qué es un «Error de precio»">
        <p>
          Un listing con fijación automática de precios lleva un <strong>mínimo</strong> y un{' '}
          <strong>máximo</strong>. Cuando el precio que tiene publicado se sale de ese rango, Amazon
          lo marca como «Error de precio» y <strong>deja de venderlo</strong>:
        </p>
        <ListaInfo>
          <li>
            Precio <strong>62,73</strong>, mínimo <strong>63,99</strong> → está por debajo del suelo.
          </li>
          <li>
            Precio <strong>80,00</strong>, máximo <strong>75,90</strong> → está por encima del techo.
          </li>
        </ListaInfo>
        <p>
          Pasa cuando el precio lo mueve el ERP o un fichero y el mínimo se queda viejo.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Qué hace esta pantalla">
        <p>
          Hace pasar el <strong>límite roto</strong> a valer el precio, y solo ese:
        </p>
        <ListaInfo>
          <li>Precio por debajo del mínimo → el <strong>mínimo</strong> pasa a ser el precio.</li>
          <li>Precio por encima del máximo → el <strong>máximo</strong> pasa a ser el precio.</li>
        </ListaInfo>
        <p>
          El otro límite no se toca, ni la rebaja programada, ni el precio. Y no hay cuenta: el
          límite nuevo es <strong>el mismo número</strong> que el precio, no un precio más o menos
          algo.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Qué mirar antes de pulsar: el desvío">
        <p>
          La última columna dice cuánto se aparta el precio de su límite. Un mínimo un 2 % por encima
          es un mínimo viejo. Uno un 80 % por encima suele ser <strong>un precio mal puesto</strong>:
          «arreglarlo» bajando el suelo dejaría vender a un precio que nadie quería.
        </p>
        <p>
          Va ordenado de mayor desvío a menor y avisa de cuántas pasan del{' '}
          {Math.round(DESVIO_SOSPECHOSO * 100)} %. Se pueden desmarcar una a una.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Qué mirar: tres alcances">
        <p>
          El mínimo y el máximo <strong>no están en nuestro catálogo</strong>: solo se leen de Amazon,
          a veinte referencias por llamada. Un catálogo de 15.000 son 750 llamadas. Por eso se elige
          hasta dónde mirar:
        </p>
        <ListaInfo>
          <li>
            <strong>Los que no se pueden comprar</strong> — rápido (un minuto o dos) y es donde caen
            los errores de precio.
          </li>
          <li>
            <strong>Todos los que tienen stock</strong> — los que se pueden vender ahora mismo.
          </li>
          <li>
            <strong>Todo el catálogo con precio</strong> — varios minutos, y la única forma de estar
            seguro de que no queda ninguno.
          </li>
        </ListaInfo>
        <p>
          Si el país no sale con referencias es que no está activado para la ingesta y no tenemos su
          catálogo: se activa en <strong>Amazon API · Cuentas</strong>.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Corregir vuelve a leer, y deja constancia">
        <p>
          Con la fijación automática el precio <strong>se mueve mientras tienes la pantalla
          abierta</strong>. Por eso «Corregir» no usa lo que ves: vuelve a leer cada listing justo
          antes y aplica la misma regla sobre el precio de ese instante. Si entre medias ya estaba
          arreglado, no lo toca y lo dice.
        </p>
        <p>
          Cada corrección queda en el registro de eventos con el mínimo y el máximo de antes y de
          después. <strong>Simular</strong> pregunta a Amazon si lo aceptaría sin cambiar nada.
        </p>
        <p>
          El estado «Error de precio» tarda unos minutos en pasar a activo en Seller Central.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Una cosa a tener presente">
        <p>
          Si el listing tiene <strong>fijación automática de precios</strong> (el icono ↻ junto al
          precio en Seller Central), el mínimo es lo más bajo que esa regla puede llegar a poner. Con
          el mínimo igual al precio de hoy la regla ya no puede <em>bajar</em> más; sí puede seguir
          subiendo hasta el máximo.
        </p>
      </SeccionInfo>
    </>
  )
}

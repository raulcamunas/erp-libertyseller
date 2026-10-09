import { Tag } from '@/components/ui/iconos'
import { Vacio } from '@/components/plataforma/comun'
import { ListaInfo, SeccionInfo } from '@/components/ui/BotonInfo'
import type { ClienteGrowth } from '@/lib/growth/clientes'
import { construirPlan, SLUG_SHOPLAMP } from '@/lib/precios-shoplamp/plan'
import { DESTINOS, EXCLUIDOS, SUELO_DESTINO_CENTIMOS } from '@/lib/precios-shoplamp/reglas'
import { TableroPreciosShoplamp } from '@/components/growth/precios/TableroPreciosShoplamp'

/**
 * SUBMÓDULO «PRECIOS SHOPLAMP» — ESPAÑA MANDA, LOS DEMÁS SE CALCULAN.
 *
 * España es el precio base. Francia e Italia van a +7 € y Alemania a +6 €:
 * es lo que cuesta mandar el pedido, porque el almacén está en España. Y fuera de
 * España no hay nada por debajo de 15 €.
 * Esa es la regla entera y vive en lib/precios-shoplamp/reglas.ts.
 *
 *
 * ============ ESTE SUBMÓDULO ES DE UN SOLO CLIENTE, A PROPÓSITO ============
 *
 * Es la primera pantalla del ERP que solo existe para un cliente, y se pidió
 * así: «SOLO para Shoplamp». No es una limitación temporal a la espera de
 * generalizarla — un recargo fijo en euros es una decisión comercial de ESTE
 * cliente, y ofrecérselo a los otros quince sería ofrecer que publiquen precios
 * calculados con una regla que nadie ha acordado con ellos.
 *
 * Se cierra en TRES sitios, y los tres hacen falta:
 *
 *   1. El botón solo aparece cuando el cliente elegido arriba es Shoplamp
 *      (`soloCliente` en components/growth/modulos.ts).
 *   2. Esta pantalla comprueba el slug otra vez, por si alguien llega con un
 *      enlace montado a mano.
 *   3. `construirPlan()` resuelve el cliente POR SLUG dentro de la función: no
 *      lo recibe por parámetro. Aunque alguien llame a la ruta de la API con
 *      otro id de cliente, no hay por dónde colarlo.
 *
 * El primero es comodidad, el segundo es cortesía, el TERCERO es el que cierra.
 */
export async function PanelPreciosShoplamp({ cliente }: { cliente: ClienteGrowth }) {
  if (cliente.slug !== SLUG_SHOPLAMP) {
    return (
      <Vacio icono={<Tag />} titulo="Esta pantalla es solo de Shoplamp">
        La regla de precios que aplica —España como base, +7 € en Francia e Italia y +6 € en
        Alemania, y nada por debajo de 15 € fuera de España— es un acuerdo con ese cliente y
        nada más. Para trabajar los precios de{' '}
        <strong>{cliente.nombre}</strong>, elige Shoplamp arriba o usa el resto de submódulos.
      </Vacio>
    )
  }

  const plan = await construirPlan()

  return <TableroPreciosShoplamp key={cliente.slug} plan={plan} />
}

export function InfoPreciosShoplamp() {
  return (
    <>
      <SeccionInfo titulo="La regla">
        <p>
          El precio de <strong>España</strong> es la base. Sobre él se suma una cantidad fija en
          cada país:
        </p>
        <ListaInfo>
          {DESTINOS.map((d) => (
            <li key={d.marketplaceId}>
              <strong>{d.pais}</strong> — base + {(d.recargoCentimos / 100).toFixed(2)} €
            </li>
          ))}
        </ListaInfo>
        <p>
          Es lo que cuesta mandar el pedido a cada país: el almacén está en España y de ahí sale
          todo. Ni porcentajes, ni redondeo a <em>,99</em>, ni recálculo de IVA: siete euros son
          siete euros sobre el precio que ve el comprador. La tabla está en un solo sitio
          (<code>lib/precios-shoplamp/reglas.ts</code>) y cambiarla no obliga a tocar nada más.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo={`El suelo: nada por debajo de ${(SUELO_DESTINO_CENTIMOS / 100).toFixed(0)} €`}>
        <p>
          Fuera de España <strong>ningún precio baja de {(SUELO_DESTINO_CENTIMOS / 100).toFixed(2)} €</strong>.
          El recargo se aplica primero y, si el resultado no llega, se sube hasta el suelo: una
          referencia que vale 1 € en España y saldría a 7 € en Alemania se publica a{' '}
          <strong>15 €</strong>.
        </p>
        <ListaInfo>
          <li>
            Por encima de 15 € <strong>no cambia nada</strong>: una base de 20 € sigue siendo 26 € en
            Francia, no 15.
          </li>
          <li>
            Lo ha puesto el suelo y no el recargo se marca en la columna «Quedaría» con{' '}
            <strong>▲ suelo</strong>, para distinguir «de 1 € a 15 €» de «de 1 € a 7 €».
          </li>
          <li>
            <strong>No inventa precio.</strong> Una referencia sin precio en España sigue sin
            precio, no sale a 15 €.
          </li>
          <li>
            No se aplica a España: es la base, y el suelo es de los destinos.
          </li>
        </ListaInfo>
      </SeccionInfo>

      <SeccionInfo titulo="Un recargo fijo NO sube lo mismo arriba que abajo">
        <p>
          Es lo único de esta pantalla que hay que mirar antes de pulsar. Sobre una referencia de
          200 € siete euros son un <strong>+3,5 %</strong>. Sobre una de 1,07 €, que con el suelo
          pasa a 15 €, un <strong>+1.302 %</strong>. Y en este catálogo hay referencias de los dos
          tipos.
        </p>
        <p>
          Por eso cada fila enseña su subida en tanto por ciento, la tabla viene{' '}
          <strong>ordenada de mayor subida a menor</strong> —lo que más sube, arriba— y las que más
          que duplican su precio salen avisadas y en ámbar. Se pueden desmarcar una a una o
          filtrarlas de un clic.
        </p>
        <p>
          La regla se aplica tal y como se pidió. Lo que esta pantalla garantiza es que no se
          aplique <em>sin verla</em>.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Qué se empareja, y qué se aparta">
        <ListaInfo>
          <li>
            <strong>Por SKU</strong>, que es el identificador del vendedor y el mismo en todos sus
            marketplaces europeos. El ASIN no sirve de clave: cambia por país.
          </li>
          <li>
            <strong>Sin precio en España no hay regla.</strong> Una referencia que existe fuera y
            no aquí se aparta y se dice; no se adivina su base.
          </li>
          <li>
            <strong>Las que ya están en su precio no se tocan.</strong> Se comparan en céntimos,
            así que no se gasta cupo de Amazon mandando el mismo número.
          </li>
          <li>
            <strong>Sin tipo de producto no se puede enviar.</strong> Amazon lo exige en cada
            cambio, así que esas filas se enseñan pero no se pueden marcar.
          </li>
        </ListaInfo>
      </SeccionInfo>

      <SeccionInfo titulo="Reino Unido no está, y no es un olvido">
        {EXCLUIDOS.map((e) => (
          <p key={e.marketplaceId}>
            <strong>{e.pais}</strong> — {e.motivo}
          </p>
        ))}
        <p>
          El ERP ya se comió este fallo una vez: un perfil en euros publicando contra amazon.co.uk,
          el cliente vendiendo un 17 % caro y ni un error por ningún lado. Está escrito en{' '}
          <code>lib/stock-sync/proceso.ts</code>. Así que estos mercados no están «sin marcar»: no
          se puede llegar a ellos ni pidiéndolo a mano.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Simular antes de aplicar">
        <p>
          <strong>Simular</strong> manda <code>validateOnly</code> a Amazon: contesta si aceptaría
          cada precio y no cambia nada, ni deja registro. El botón de aplicar está apagado hasta
          que la simulación de esa misma selección ha pasado, y se vuelve a apagar en cuanto se
          marca o desmarca una fila.
        </p>
        <p>
          Y es lo que detecta el caso que esta pantalla no puede ver sola: si una
          referencia tiene <strong>precio mínimo o máximo</strong> configurado en Seller Central y
          el precio nuevo se sale de ese rango, Amazon lo rechaza. Esos límites viven en{' '}
          <code>purchasable_offer</code> y no están en el espejo del catálogo, así que aquí no se
          pueden enseñar — pero la simulación los saca uno a uno antes de publicar nada. El cambio
          se manda con <code>merge</code>, así que el mínimo, el máximo y una rebaja programada{' '}
          <strong>no se borran</strong>: solo cambia el precio.
        </p>
        <p>
          El precio <strong>no viaja en la petición</strong>: se recalcula en el servidor leyendo
          otra vez el de España. Lo que sí viaja es lo que la pantalla creía que iba a publicar, y
          si no coincide, esa fila no se manda y se dice por qué. Es el seguro contra el caso
          aburrido: alguien cambia un precio base mientras la pantalla está abierta.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Dónde queda lo que se envía">
        <p>
          Cada cambio queda en el registro de <strong>Amazon API · Cambios</strong> con su valor
          anterior, su valor nuevo, quién lo mandó y el identificador del lote. Los tramos de un
          mismo envío comparten lote: es lo que permite reconocerlos juntos —y, el día que se
          implemente deshacer, revertirlos juntos—.
        </p>
        <p>
          El precio tarda unos minutos en verse en la ficha de Amazon. La columna «hoy allí» sale
          del espejo del catálogo, que se refresca con la ingesta: justo después de aplicar seguirá
          enseñando el precio viejo un rato.
        </p>
      </SeccionInfo>
    </>
  )
}

import { Link2Off } from '@/components/ui/iconos'
import { Vacio } from '@/components/plataforma/comun'
import { ListaInfo, SeccionInfo } from '@/components/ui/BotonInfo'
import type { ClienteGrowth } from '@/lib/growth/clientes'
import { TableroFbmFba } from '@/components/growth/fbmfba/TableroFbmFba'

/**
 * SUBMÓDULO «FBM → FBA» — QUÉ MERECE PASAR A LOGÍSTICA DE AMAZON.
 *
 * El motor está en lib/plataforma/fbmfba/** —el margen, las cinco reglas y el
 * veredicto— y esta es su pantalla. Aquí no se decide nada: se pinta lo que el
 * motor ya decidió, con la razón que él escribió y los números con los que la
 * escribió. Se comprueba entero, sin base de datos, con
 * scripts/check-margen-fbmfba.ts.
 *
 *
 * ============ LO QUE HAY QUE GRABARSE ANTES DE TOCAR NADA ============
 *
 * LA FÓRMULA DE LA ESPECIFICACIÓN LE FALTAN CUATRO COSAS, Y LAS CUATRO SESGAN EN
 * LA MISMA DIRECCIÓN: a favor de migrar a FBA. Ninguna da ningún error.
 *
 *   1. EL IVA ES UN PARÁMETRO POR PAÍS, y además hay que saber SI EL PRECIO LO
 *      LLEVA DENTRO. En la Unión Europea sí; en Estados Unidos el impuesto se
 *      añade en el pago y dividir allí por (1 + IVA) hunde el margen un 20 %.
 *   2. EL PRECIO DE REFERENCIA DE AMAZON NO LLEVA ENVÍO. En FBM y en Prime del
 *      vendedor hay que restar el porte real, que sale de los costes. Sin él, el
 *      margen del canal propio sale inflado justo en el cliente de 13.700
 *      referencias, que es el que más FBM tiene.
 *   3. LAS TARIFAS DE AMAZON NO INCLUYEN NI ALMACENAMIENTO NI FLETE DE ENTRADA.
 *      Con esos dos a cero se le descuenta un coste real al canal propio y al de
 *      Amazon no.
 *   4. LA TARIFA SE PIDE A UN PRECIO CONCRETO y no se reescala: la comisión es
 *      un porcentaje CON MÍNIMOS y la de logística va por tramos de tamaño.
 *
 * Y EL PRECIO DE REFERENCIA ES UN TECHO CON DOS SENTIDOS: si la oferta destacada
 * ya es nuestra, está POR ENCIMA del precio actual y calcular el margen ahí es
 * inflarlo. Hay que comprobar SIEMPRE quién la tiene antes de interpretarlo.
 *
 * Y un límite operativo: podemos RECOMENDAR la migración, no EJECUTARLA. Crear
 * el envío de entrada necesita un permiso que la aplicación no tiene.
 */
export function PanelFbmFba({ cliente }: { cliente: ClienteGrowth }) {
  if (!cliente.amazonClientId) {
    return (
      <Vacio icono={<Link2Off />} titulo={`${cliente.nombre} no tiene su cuenta de Amazon conectada`}>
        Para comparar los dos escenarios hacen falta sus referencias, sus tarifas y su ranking, y
        todo eso se lee de su cuenta. Se conecta desde <strong>Amazon API · Cuentas</strong>.
      </Vacio>
    )
  }

  return (
    // La llave remonta el tablero al cambiar de cliente arriba. Sin ella React
    // reutilizaría el componente y su estado —los filtros, la ficha abierta—
    // sobreviviría a la navegación: se vería el nombre nuevo arriba y las
    // referencias del anterior debajo.
    <TableroFbmFba
      key={cliente.slug}
      clientId={cliente.amazonClientId}
      nombreCliente={cliente.nombre}
    />
  )
}

export function InfoFbmFba() {
  return (
    <>
      <SeccionInfo titulo="Qué compara">
        <p>
          Para cada referencia que hoy envía el cliente, cuánto margen le queda así y cuánto le
          quedaría si la guardara Amazon. La diferencia, en puntos, y si compensa moverla.
        </p>
        <p>
          Pinchando una fila se abre de dónde sale cada euro, línea a línea y en las dos columnas.
          Un margen sin desglose se obedece; uno con desglose se discute, y discutirlo es lo que
          hace que se detecte cuando está mal.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Sin coste no hay análisis, y el hueco se ve">
        <p>
          Amazon no da lo que le costó el producto al cliente. Ese dato se mete en{' '}
          <strong>Amazon API · Costes</strong>, y sin él esta pantalla no puede decir nada de esa
          referencia. No la calcula con un cero: la deja en «no evaluable» y dice qué falta.
        </p>
        <p>
          No es escrupulosidad. <strong>Todo lo que falta en este cálculo son costes</strong>, así
          que un margen a medias sale siempre MEJOR que el de verdad, es perfectamente creíble y
          nadie lo revisa. Un hueco se ve; un número inflado, no.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="El impuesto del país no es una constante, y son dos datos">
        <ListaInfo>
          <li>
            <strong>Cuánto es.</strong> Cambia por país y por categoría, y ningún endpoint de Amazon
            lo da con los permisos que tenemos: los informes de IVA están detrás de permisos
            fiscales que no están concedidos.
          </li>
          <li>
            <strong>Si el precio lo lleva dentro.</strong> En la Unión Europea el precio que se ve
            en la ficha va con impuesto. En Estados Unidos se añade en el pago.{' '}
            <strong>Dividir donde no toca mueve el margen un 20 %</strong> y el número que sale es
            perfectamente creíble.
          </li>
        </ListaInfo>
        <p>
          Por eso se guarda con fecha de vigencia y con dueño: los tipos cambian por ley y el margen
          que se le enseñó a un cliente en marzo tiene que seguir cuadrando con el tipo de marzo.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Lo que Amazon no incluye en su estimación de tarifas">
        <ListaInfo>
          <li>
            <strong>El almacenamiento</strong> mientras el producto espera en su centro logístico.
          </li>
          <li>
            <strong>El flete de entrada</strong>: llevarlo hasta allí.
          </li>
          <li>
            <strong>El porte del canal propio</strong> tampoco está en ninguna respuesta de la API,
            porque lo paga el cliente. El precio de referencia de Amazon es precio de listing{' '}
            <em>sin envío</em>.
          </li>
        </ListaInfo>
        <p>
          Con esos a cero, <em>todo</em> sale a favor de migrar. Por eso son datos que hay que
          poner, y por eso una referencia sin ellos no produce recomendación.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="El precio de referencia es un TECHO, y tiene dos sentidos opuestos">
        <ListaInfo>
          <li>
            <strong>Si no tenemos la oferta destacada</strong> (↓) — es el techo al que habría que
            bajar para venderla de verdad. Ese es el precio realista con el que calcular.
          </li>
          <li>
            <strong>Si ya la tenemos</strong> (↑) — es el techo hasta el que se podría{' '}
            <strong>subir</strong> sin perderla, y normalmente está por encima del precio de hoy.
            Calcular el margen ahí sería sumar un ingreso que nadie ha decidido cobrar, y encima
            justo en las referencias que ya van bien.
          </li>
        </ListaInfo>
        <p>
          Así que se calcula al menor de los dos y la flecha de la columna dice cuál es el caso. No
          hay ningún campo de Amazon que los distinga: se sabe comparando quién tiene hoy la oferta
          destacada con nosotros.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="La rotación: «no lo sabemos» no es «no rota»">
        <p>
          Con los permisos concedidos <strong>no tenemos datos de ventas</strong>: las unidades
          entran por CSV. Cuando no hay ninguna, lo único que queda es el ranking, que{' '}
          <strong>ORDENA pero NO MIDE</strong>: dice que un producto se vende más que otro, no
          cuántos, y no es comparable entre categorías.
        </p>
        <p>
          Por eso una referencia sin datos sale como «no evaluable» y no como «no rota». Descartarla
          sería tirar catálogo bueno porque nadie importó un fichero. Y un descarte por ranking se
          marca como revisable, no como definitivo.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Si Amazon vende en el ASIN: sí, no, y «no se sabe»">
        <p>
          Competir contra la propia Amazon no se gana con logística, así que un ASIN donde vende
          ella se descarta. Pero <strong>no hay forma fiable de detectarlo</strong>: Amazon no
          publica ningún campo que identifique su oferta, y la marca de FBA no sirve porque un
          tercero que envía por FBA devuelve exactamente lo mismo.
        </p>
        <p>
          Así que el veredicto tiene tres valores y <strong>«no se sabe» es el caso normal</strong>.
          Con «no se sabe» la referencia baja a <strong>revisar</strong>, nunca a descartada. Solo se
          puede afirmar el «sí» con la lista de identificadores de Amazon Retail rellenada a mano en
          el monitor de Buy Box.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Las medidas del producto no valen todas igual">
        <p>
          La tarifa de Amazon se calcula sobre el <strong>embalaje</strong>, y un salto de tramo de
          tamaño son céntimos o son euros. No existe en toda la API ninguna señal que diga si una
          medida la comprobó Amazon o la escribió el vendedor, así que se guarda de dónde salió cada
          una.
        </p>
        <p>
          Y una cosa contraintuitiva: la única procedencia fiable —que Amazon ya haya cobrado con
          esas medidas— <strong>solo se da en referencias que YA están en FBA</strong>, o sea justo
          las que este análisis no tiene que evaluar. Para un candidato de verdad, lo mejor posible
          es «del catálogo de Amazon».
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Los umbrales los pones tú, y mientras tanto no se recomienda">
        <ListaInfo>
          <li>
            <strong>El colchón de margen en FBA.</strong> No es «que dé más que hoy»: una referencia
            puede mejorar y quedarse en un 2 %, y un 2 % vendiendo al techo significa que en cuanto
            un competidor baje un céntimo hay inventario muerto en un almacén de Amazon —y sacarlo
            de ahí cuesta dinero—. La especificación habla de un 10-12 %.
          </li>
          <li>
            <strong>La mejora mínima</strong> que justifica el trabajo de preparar y mandar el
            envío.
          </li>
          <li>
            <strong>La rotación mínima</strong> y el ranking a partir del cual dudar.
          </li>
        </ListaInfo>
        <p>
          Mientras falten, la pantalla <strong>informa pero no recomienda</strong>: un umbral
          inventado por el programa produce migraciones sin base, y las paga el cliente. Lo que
          propone la especificación se enseña al lado del campo vacío, pero hay que guardarlo para
          que exista — y entonces tiene fecha y dueño.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Recomendar sí, ejecutar no">
        <p>
          Desde aquí no se crea ningún envío a Amazon: la aplicación no tiene ese permiso, y no es
          un descuido de esta pantalla. La salida es una lista de candidatos con su porqué, que se{' '}
          <strong>exporta</strong> con el motivo entero y las salvedades, para decidirla con el
          cliente y ejecutarla a mano en Seller Central.
        </p>
      </SeccionInfo>
    </>
  )
}

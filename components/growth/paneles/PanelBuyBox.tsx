import { Link2Off } from '@/components/ui/iconos'
import { Vacio } from '@/components/plataforma/comun'
import { ListaInfo, SeccionInfo } from '@/components/ui/BotonInfo'
import type { ClienteGrowth } from '@/lib/growth/clientes'
import { TableroBuyBox } from '@/components/growth/buybox/TableroBuyBox'

/**
 * SUBMÓDULO «BUY BOX» — DÓNDE LA GANAMOS Y DÓNDE NO.
 *
 * El motor está en lib/plataforma/buybox/** —diagnóstico, lectura de ofertas,
 * rotación del techo y cola— y esta es su pantalla. Aquí no se decide nada: se
 * pinta lo que el motor ya decidió, con la razón que él escribió y los números
 * con los que la escribió.
 *
 *
 * ============ LO QUE HAY QUE GRABARSE ANTES DE TOCAR NADA ============
 *
 * EL PRECIO DESTACADO QUE DA AMAZON (FOEP) ES UN TECHO, NO UN OBJETIVO, Y TIENE
 * DOS SENTIDOS SEGÚN QUIÉN TENGA HOY LA OFERTA DESTACADA:
 *
 *   · NO LA TENEMOS → OFENSIVO: el techo al que habría que bajar para
 *     conquistarla.
 *   · SÍ LA TENEMOS → DEFENSIVO: el techo hasta el que se puede SUBIR sin
 *     perderla. Normalmente está POR ENCIMA del precio actual.
 *
 * No hay ningún campo que distinga los dos casos: hay que comparar el vendedor
 * de la oferta destacada actual con el nuestro. La regla ingenua «precio actual
 * > techo, luego bajar» recorta precio sistemáticamente en las referencias que
 * YA VAN BIEN, y es el fallo más caro de todo el proyecto.
 *
 * Por eso la pantalla los reparte en DOS TABLAS con DOS JUEGOS DE CABECERAS
 * —«Bajar hasta» y «Se puede subir hasta»— y no en una sola con un filtro. El
 * detalle está escrito en components/growth/buybox/TableroBuyBox.tsx.
 *
 * Y tres precisiones más:
 *   · Es precio de listing SIN ENVÍO. Con catálogo mayoritariamente FBM,
 *     compararlo contra el precio puerta a puerta de la competencia es una
 *     comparación inválida.
 *   · «Sin techo» es la AUSENCIA del dato, nunca un cero ni un null. Un cero
 *     solo puede venir de un fallo nuestro.
 *   · NO se puede saber con fiabilidad si quien nos gana es Amazon Retail. El
 *     veredicto es ternario —sí / no / indeterminado—, nunca un booleano.
 */
export function PanelBuyBox({ cliente }: { cliente: ClienteGrowth }) {
  if (!cliente.amazonClientId) {
    return (
      <Vacio icono={<Link2Off />} titulo={`${cliente.nombre} no tiene su cuenta de Amazon conectada`}>
        Para saber quién tiene la oferta destacada hay que poder leer las ofertas de sus productos,
        y para eso el cliente tiene que autorizar la aplicación. Se hace desde{' '}
        <strong>Amazon API · Cuentas</strong>: se genera un enlace, el cliente entra con su usuario
        de Seller Central y acepta.
      </Vacio>
    )
  }

  return (
    // La llave remonta el tablero al cambiar de cliente arriba. Sin ella React
    // reutilizaría el componente y su estado —la lista abierta, los filtros, la
    // ficha— sobreviviría a la navegación: se vería el nombre nuevo arriba y las
    // referencias del anterior debajo.
    <TableroBuyBox
      key={cliente.slug}
      clientId={cliente.amazonClientId}
      nombreCliente={cliente.nombre}
    />
  )
}

export function InfoBuyBox() {
  return (
    <>
      <SeccionInfo titulo="Qué es la Buy Box">
        <p>
          Es el botón de comprar de la ficha de un producto. Cuando varios vendedores ofrecen lo
          mismo, Amazon elige uno y ese se lleva la enorme mayoría de las ventas. Los demás siguen
          ahí, pero casi nadie llega a ellos.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Por qué hay tres listas y no una tabla">
        <ListaInfo>
          <li>
            <strong>No la tenemos</strong> — con el porqué de cada una y qué haría falta para
            recuperarla.
          </li>
          <li>
            <strong>La tenemos</strong> — con cuánto se podría subir sin perderla.
          </li>
          <li>
            <strong>Sin juicio</strong> — las que no se pudieron leer. No cuentan como perdidas: un
            fallo de lectura contado como pérdida mueve el porcentaje que se le enseña al cliente.
          </li>
        </ListaInfo>
        <p>
          Están separadas a propósito, y es lo más importante de esta pantalla. La explicación está
          en el apartado siguiente.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="El precio de referencia de Amazon es un TECHO, no un objetivo">
        <p>
          Amazon puede decir a qué precio prevé que una oferta esté destacada. Ese número{' '}
          <strong>tiene dos sentidos opuestos</strong> y confundirlos es el error más caro de todo
          esto:
        </p>
        <ListaInfo>
          <li>
            <strong>Si no la tenemos</strong> — es el techo al que habría que bajar para
            conquistarla. Eso sí es «qué nos haría falta», y así se titula la columna.
          </li>
          <li>
            <strong>Si ya la tenemos</strong> — es el techo hasta el que se puede{' '}
            <strong>subir</strong> sin perderla, y normalmente está por encima del precio actual.
            Eso no es un problema: es margen que estamos dejando sobre la mesa, y es la oportunidad
            que el repricer nativo de Amazon nunca ve, porque no sube precios.
          </li>
        </ListaInfo>
        <p>
          No hay ningún campo que distinga los dos casos: se sabe comparando quién tiene hoy la
          oferta destacada con nosotros. Leerlo siempre como «bajar hasta ahí» recorta precio justo
          en los productos que ya iban bien, y no da ningún error: la pantalla se ve verde. Por eso
          las dos listas no se pueden ver a la vez y sus cabeceras son distintas.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="El porqué, entero, en tres sitios">
        <p>
          Cada veredicto lleva su razón escrita con los números con los que se decidió: no una
          etiqueta, una frase. Un cliente que recibe «no recuperable» discute; uno que recibe «bajar
          a 24,90 € dejaría un 3,1 % de margen, por debajo de tu mínimo del 12 %, y quien la tiene
          entrega por FBA» entiende.
        </p>
        <ListaInfo>
          <li>
            El botón <strong>Ver el porqué</strong> lo añade bajo cada fila de la tabla.
          </li>
          <li>Pinchando una referencia se abre su ficha, con la razón y todos los números.</li>
          <li>
            <strong>Exportar</strong> saca un fichero para el cliente con el motivo completo, no solo
            la etiqueta.
          </li>
        </ListaInfo>
      </SeccionInfo>

      <SeccionInfo titulo="El histórico es lo que sustituye a Keepa, y lo empezamos nosotros">
        <p>
          Amazon <strong>no da histórico</strong> de nada de esto. El que hay es el que este módulo
          guarda cada noche: qué parte del tiempo tuvimos la oferta destacada, cómo evoluciona el
          número de competidores y hasta dónde ha bajado cada uno.
        </p>
        <p>
          Como se acaba de encender, <strong>lo normal durante semanas es que no haya ninguno</strong>
          . La pantalla dice siempre cuántos barridos lo sostienen, y con cero no pinta un cero: un
          «0 % de referencias perdidas» sobre cero lecturas se lee como «vamos perfectos» y es
          exactamente lo contrario de la verdad.
        </p>
        <p>
          En la ficha de cada referencia, el porcentaje del tiempo viene con cuánto pesa una sola
          lectura. Con cuatro lecturas, una noche mueve la cifra veinticinco puntos: eso no describe
          el mes, describe la última subasta.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Lo que no se puede saber, se dice">
        <ListaInfo>
          <li>
            <strong>Si quien nos gana es Amazon</strong> vendiendo directamente: no hay forma fiable
            de distinguirlo. Amazon no publica ningún campo que identifique su propia oferta, y la
            marca de FBA no sirve porque un tercero que envía por FBA devuelve exactamente lo mismo.
            El veredicto tiene tres valores —sí, no y «no se sabe»—, y «no se sabe» es el caso
            normal. Solo se puede afirmar el «sí» con la lista de identificadores de Amazon Retail
            rellenada a mano.
          </li>
          <li>
            <strong>El precio de referencia no incluye el envío.</strong> En un catálogo que envía el
            propio vendedor, compararlo contra el precio puerta a puerta de la competencia es
            comparar dos cosas distintas. Por eso el precio con envío se enseña pero no se usa para
            decidir.
          </li>
          <li>
            <strong>No se puede pedir separado para Prime y no Prime.</strong> En un cliente con
            Prime propio (SFP) en parte del catálogo, ese único número mezcla dos competiciones
            distintas. Las filas donde eso pasa lo avisan al pasar el ratón.
          </li>
          <li>
            <strong>«Sin techo» no es cero, y tiene dos sabores:</strong> que Amazon no lo dé, o que
            no se le haya preguntado en esta ronda. Con la rotación, lo segundo es lo habitual y se
            distingue del primero.
          </li>
        </ListaInfo>
      </SeccionInfo>

      <SeccionInfo titulo="Por qué el techo va por turnos">
        <p>
          Pedirlo es la llamada más cara que hay: Amazon admite{' '}
          <strong>una petición cada treinta segundos</strong>. Las trece mil referencias del cliente
          grande serían casi tres horas cada noche, y en cuatro países no cabe en ninguna ventana.
        </p>
        <p>
          Así que las ofertas se barren enteras cada noche y el techo va por rotación: a cada
          referencia le toca cada pocas noches. El botón <strong>Pedir el techo</strong> adelanta el
          turno de las que se estén mirando ahora — no llama a Amazon en ese momento, deja el encargo
          para el barrido siguiente.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Nada sale hacia Amazon desde aquí">
        <p>
          Esta pantalla observa, diagnostica y <strong>propone</strong> un precio en simulacro con su
          explicación. Cambiar un precio se hace a mano, en <strong>Amazon API · Catálogo</strong>, y
          queda registrado con quién y cuándo. No hay repricing automático, y el día que lo haya
          arrancará apagado.
        </p>
        <p>
          Los umbrales —margen mínimo, precio suelo, precio techo, margen de seguridad bajo el techo,
          referencias con precio impuesto por la marca— no vienen puestos por el código. Mientras
          falten, el motor informa y no recomienda, y el botón{' '}
          <strong>«decisiones sin tomar»</strong> dice cuáles son y qué se pierde por cada una.
        </p>
      </SeccionInfo>
    </>
  )
}

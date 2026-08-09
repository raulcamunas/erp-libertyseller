'use client'

import { PlataformaBoard } from '@/components/plataforma/PlataformaBoard'
import { ListaInfo, SeccionInfo } from '@/components/ui/BotonInfo'

/**
 * PESTAÑA «INGESTA» — LO QUE ANTES ERA «PLATAFORMA AMAZON».
 *
 * El módulo A1 entero: qué trabajos hay contra Amazon y en qué van, de qué datos
 * disponemos de cada cliente (cobertura) y la ficha de cada SKU con su histórico.
 *
 * ERA UN MÓDULO APARTE Y AHORA ES UNA PESTAÑA. El motivo del cambio es el mismo
 * que el de toda la reorganización: era información sobre lo que guardamos —o
 * sea, las tripas—, y tenerla en otro sitio del menú obligaba a saber de antemano
 * en cuál de los dos módulos estaba cada cosa. /dashboard/plataforma sigue
 * funcionando y redirige aquí.
 *
 * EL FUNCIONAMIENTO NO SE HA TOCADO: es el mismo PlataformaBoard, con su selector
 * de cliente, sus tres vistas y su ficha de SKU.
 *
 * LO QUE SÍ HA CAMBIADO ES EL TEXTO. Estas pantallas llevaban párrafos de ayuda
 * encima de los controles: una caja azul permanente en la ficha de SKU diciendo
 * qué datos todavía no se guardan, otra en el editor de criterio, y notas de tres
 * frases bajo campos de un diálogo. Todo eso está ahora en InfoIngesta, aquí
 * abajo, y no se ha perdido ni una idea: se ha movido detrás del botón de
 * información de la cabecera.
 *
 * LO QUE SE HA QUEDADO EN PANTALLA, a propósito, es lo ACCIONABLE DE HOY: un
 * trabajo que ha fallado, un cliente sin criterio activo, «no hay ni un ranking
 * guardado, lanza el trabajo». Esconder eso detrás de un botón es no darlo.
 *
 * A1 SOLO LEE de Amazon. Desde aquí no se cambia ni un precio ni una unidad de
 * stock en la tienda de nadie: eso es la pestaña Catálogo. Lo único que se
 * escribe aquí es NUESTRA decisión de de qué SKU nos ocupamos.
 */
export function PanelIngesta() {
  return (
    <div className="h-full min-h-0 min-w-0">
      <PlataformaBoard />
    </div>
  )
}

export function InfoIngesta() {
  return (
    <>
      <SeccionInfo titulo="Qué se ve aquí">
        <ListaInfo>
          <li>
            <strong>Ingesta</strong> — qué trabajos hay contra Amazon, en qué van, cuándo fue el
            último barrido completo y el último diario, qué falló y por qué.
          </li>
          <li>
            <strong>Cobertura</strong> — de las referencias de este cliente, cuántas tienen cada
            dato. Es la pantalla que dice de qué se puede uno fiar.
          </li>
          <li>
            <strong>Seguimiento</strong> — el criterio de «referencia activa» y la tabla de SKU.
          </li>
          <li>
            <strong>Ficha de SKU</strong> — un producto y sus series históricas, en una ventana,
            porque se abre desde las otras dos y volver atrás no puede costar recargar la tabla.
          </li>
        </ListaInfo>
      </SeccionInfo>

      <SeccionInfo titulo="De aquí solo se lee">
        <p>
          Ni un precio ni una unidad de stock salen hacia Amazon desde esta pestaña. Lo único que se
          escribe es <strong>nuestra</strong> decisión de qué referencias nos ocupan cada noche. Los
          cambios en la tienda del cliente se hacen en la pestaña Catálogo, uno a uno y con registro.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="La ficha de SKU todavía crece">
        <p>
          Precio histórico, Buy Box, competidores y tarifas <strong>no se guardan aún</strong>: los
          llena el módulo A2, el monitor de Buy Box, que vive en Growth Partner. Las tablas ya existen
          y están vacías, así que la ficha crecerá sola en cuanto A2 corra por primera vez. No hay
          nada que hacer al respecto, y por eso esto ya no ocupa sitio en la pantalla.
        </p>
        <p>
          El <strong>ranking es el único dato que no se puede reconstruir hacia atrás</strong>: el día
          que no se guarda, se pierde para siempre. Por eso la ficha de una referencia que no está en
          seguimiento no va a tener serie por mucho que se espere.
        </p>
        <p>
          Las series se buscan por <strong>vendedor, país y SKU</strong>, y no por el identificador de
          la fila del catálogo. Es lo que hace que el histórico sobreviva a que Amazon deje de
          devolver un listing y semanas después vuelva a devolverlo.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Cambiar el criterio no mueve los SKU en el acto">
        <p>
          Guardar el criterio de seguimiento cambia <strong>la regla</strong>, no el conjunto de
          referencias que ya está marcado. Ese conjunto se mueve en el siguiente «Recalcular SKU en
          seguimiento», que se lanza desde Ingesta y <strong>no gasta ni una llamada a Amazon</strong>:
          es una cuenta sobre lo que ya tenemos guardado.
        </p>
        <p>
          El criterio se puede acotar por país. Sin ningún país marcado vale para todos los del
          cliente. Existe porque un cliente puede tener cuarenta referencias en Estados Unidos y trece
          mil en España, y el criterio que sirve para uno arruina el otro.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="El cupo de Amazon se cuenta por cuenta de vendedor">
        <p>
          Dos clientes distintos pueden estar barriéndose a la vez sin estorbarse; dos trabajos de la
          misma cuenta, no. Es lo que decide cuántos trabajos caben en la ventana nocturna y por qué
          el lanzador no deja encolar dos cosas sobre la misma cuenta y país.
        </p>
        <p>
          Un trabajo lanzado <strong>sobre unas pocas referencias</strong> es como se prueba un
          barrido sin gastar una noche de cupo, y no cuenta como barrido completo: el planificador lo
          ignora al calcular la cadencia, así que no hace que el de verdad se salte un día.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Por qué se pide un motivo al cancelar o al marcar a mano">
        <p>
          Lo exige la base de datos además de la pantalla. Un trabajo cancelado sin explicación deja a
          quien lo mire mañana sin saber si hay que relanzarlo, y una referencia marcada a mano sin
          motivo no contesta dentro de tres meses la pregunta «¿por qué este producto no se
          refresca?» sin que alguien tenga que reconstruir la decisión.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Qué mide cada línea de la cobertura">
        <p>
          Las ocho barras llevaban su explicación debajo, y ocupaban más sitio que los datos. Están
          aquí, y también al pasar el ratón por encima de cada fila.
        </p>
        <ListaInfo>
          <li>
            <strong>En seguimiento diario</strong> — los que se refrescan cada noche. Lo deciden el
            criterio del cliente y las marcas manuales.
          </li>
          <li>
            <strong>A la venta</strong> — listings BUYABLE. Uno que no está a la venta no tiene Buy
            Box que perder ni precio que vigilar.
          </li>
          <li>
            <strong>Con precio</strong> — sin precio no hay margen que calcular ni oferta que
            comparar.
          </li>
          <li>
            <strong>Con atributos de catálogo</strong> — marca, categoría y medidas leídas de Catalog
            Items. Lo llena el trabajo «Atributos de catálogo».
          </li>
          <li>
            <strong>Con dimensiones de embalaje</strong> — las del EMBALAJE, que son las que usa
            Amazon para calcular la tarifa de FBA. Las del producto no valen para eso.
          </li>
          <li>
            <strong>…y certificadas por Amazon</strong> — las medidas que dio Amazon, no las que
            midió alguien a ojo. Sobre las demás, la tarifa de FBA que calcule A4 es una conjetura.
          </li>
          <li>
            <strong>Con ranking</strong> — sobre los que están en seguimiento. El ranking es el dato
            que <strong>no se puede reconstruir hacia atrás</strong>: el día que no se guarda, se
            pierde.
          </li>
        </ListaInfo>
        <p>
          Y el inventario: <strong>leído</strong> es FBA con existencias; <strong>no aplica</strong>{' '}
          es FBM, y eso no es un agujero sino la respuesta correcta —su stock es el del propio
          listing—; <strong>no se pudo leer</strong> se intentó y falló, y nunca se guarda como cero,
          porque un cero falso dispara una alerta de reposición que no existe.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="La cobertura siempre enseña la fracción, no solo el porcentaje">
        <p>
          «100 %» sobre cinco referencias y «100 %» sobre trece mil son la misma cifra y no son la
          misma noticia. Esta pantalla existe justo para decidir de qué fiarse, así que la fracción
          va siempre delante.
        </p>
        <p>
          Cuando no hay ni un ranking guardado, el aviso se queda en pantalla porque hay algo que
          hacer: lanzar «Ranking de ventas (BSR)». Lo que no cabía ahí es la consecuencia — sin esa
          serie, la ficha de SKU no tiene nada que pintar y el filtro de rotación de A4 se queda sin
          uno de sus dos datos.
        </p>
        <p>
          Los recuentos se calculan <strong>en la base de datos</strong>, no en el navegador: contar
          «cuántas referencias tienen ranking» aquí obligaría a traerse la serie histórica entera. Por
          eso la pantalla dice a qué hora se leyó.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Un cliente recién conectado tiene esto vacío">
        <p>
          Y es normal: el primer censo del catálogo tarda una noche entera. La diferencia entre
          «esto está roto» y «esto todavía no ha corrido» está escrita en cada pantalla vacía, con
          lo que falta y qué hay que hacer. Vacío nunca se pinta como un cero: una referencia sin
          ranking medido vale «no lo sabemos», no cero.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Un cliente, una vista">
        <p>
          No hay ni una pantalla que mezcle clientes, ni una media del conjunto, ni una comparativa.
          Es el compromiso firmado ante Amazon: los datos de un vendedor se usan exclusivamente para
          operar y asesorar <strong>su</strong> cuenta. La única lista que enseña varios a la vez
          muestra métricas de nuestro propio proceso, cada uno por separado y en orden alfabético
          para que ni el orden sea un ranking.
        </p>
      </SeccionInfo>
    </>
  )
}

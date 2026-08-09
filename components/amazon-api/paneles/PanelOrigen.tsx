'use client'

import { AlertTriangle } from 'lucide-react'
import { PerfilesPanel } from '@/components/amazon/PerfilesPanel'
import { Aviso } from '@/components/plataforma/comun'
import { ListaInfo, SeccionInfo } from '@/components/ui/BotonInfo'
import type { PropsPanel } from '../tipos'

/**
 * PESTAÑA «ORIGEN» — DE DÓNDE SALE EL FICHERO DE CADA CLIENTE.
 *
 * Aquí se CONFIGURA la lectura: por SFTP, de una carpeta de Drive, de un correo
 * o subido a mano; qué columna es el SKU y cuál las unidades; y los frenos que
 * impiden que un fichero a medias vacíe el inventario de un cliente.
 *
 * SINCRONIZAR DE VERDAD NO PASA POR AQUÍ: eso es Growth Partner. Es el corte del
 * módulo —configurar aquí, trabajar allí— y esta pestaña es el ejemplo más claro
 * de por qué existe: el origen se toca una vez y el sincronismo, dos veces por
 * semana.
 *
 *
 * ============ «ESTE CLIENTE NO SINCRONIZA» YA SE PUEDE DECIR ============
 *
 * Era el hueco de esta pestaña y ya está construido. Hasta ahora la única forma
 * de decirlo era no crear el perfil, y eso es indistinguible de «alguien empezó
 * a configurarlo y lo dejó a medias» — la clase de ambigüedad que hace que nadie
 * se fíe de la pantalla. Ahora es un estado con su fecha, su autor y su motivo
 * (migración 127), la lista de clientes lo enseña de un vistazo y el ciclo
 * automático lo respeta: no es una etiqueta, es una decisión.
 *
 * LA PANTALLA ENTERA VIVE EN components/amazon/PerfilesPanel.tsx y de ahí cuelgan
 * la configuración del perfil, el explorador del origen, el simulacro y el
 * historial. Aquí solo se decide qué se enseña cuando los orígenes no cargan, y
 * se escribe la explicación del botón de información.
 */
export function PanelOrigen({ perfiles }: PropsPanel) {
  if (!perfiles) {
    return (
      <Aviso tono="ambar" icono={AlertTriangle}>
        <span className="font-semibold text-[var(--ls-t1)]">
          No se han podido cargar los orígenes.
        </span>{' '}
        Sus tablas no han contestado. El catálogo y el resto de pestañas funcionan igual: vuelve a
        cargar la página y, si sigue igual, mira los registros del servidor.
      </Aviso>
    )
  }

  return (
    <div className="h-full min-h-0 min-w-0">
      <PerfilesPanel initialData={perfiles} />
    </div>
  )
}

export function InfoOrigen() {
  return (
    <>
      <SeccionInfo titulo="Qué se configura aquí">
        <p>
          De dónde sale el fichero de stock de cada cliente y cómo se lee. Sincronizar de verdad se
          hace en <strong>Growth Partner</strong>: esto es la configuración, que se toca una vez, y
          aquello es el trabajo, que se hace dos veces por semana.
        </p>
        <ListaInfo>
          <li>
            <strong>SFTP</strong> — se conecta a su servidor y coge el último fichero de una
            carpeta.
          </li>
          <li>
            <strong>Drive</strong> — una carpeta compartida; se explora y se elige el patrón de
            nombre.
          </li>
          <li>
            <strong>Correo</strong> — el volcado llega adjunto a un buzón que vigilamos.
          </li>
          <li>
            <strong>A mano</strong> — alguien lo sube. Es el que menos gusta y el que más se usa.
          </li>
        </ListaInfo>
      </SeccionInfo>

      <SeccionInfo titulo="Los tres estados de la lista">
        <p>
          La columna de la izquierda son los <strong>clientes</strong>, no los perfiles, porque la
          pregunta de todos los días no es qué hay configurado sino a quién le falta.
        </p>
        <ListaInfo>
          <li>
            <strong>Sincroniza</strong> — tiene al menos un perfil de stock activo y entra en el
            ciclo automático.
          </li>
          <li>
            <strong>No sincroniza</strong> — alguien decidió que no hace falta. Consta cuándo, quién
            y por qué, y deja de contar como pendiente.
          </li>
          <li>
            <strong>Sin configurar</strong> — ni lo uno ni lo otro. Es lo único que hay que atender.
          </li>
        </ListaInfo>
        <p>
          Los dos últimos se veían igual hasta ahora —cero perfiles— y por eso la lista de
          pendientes no servía para nada: nunca se sabía si era trabajo por hacer o clientes que no
          lo necesitan.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Marcar «no hace falta» no borra nada">
        <p>
          La configuración de columnas de ese cliente —que costó una tarde con su fichero delante— se
          queda guardada. Lo que cambia es que sus perfiles dejan de procesarse: el ciclo automático
          los salta. El día que vuelva, se desmarca y funciona sin tocar nada.
        </p>
        <p>
          La decisión la toma <strong>solo un administrador</strong>, y no por costumbre: dejar de
          mandarle stock a un cliente congela su inventario en Amazon en lo último que se subió.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Los frenos existen por un motivo concreto">
        <p>
          Un fichero cortado a la mitad, o con la columna de unidades vacía, no da ningún error: se
          lee perfectamente y pone a cero medio catálogo. Cuando eso sube a Amazon, el cliente deja
          de vender esa misma tarde y recuperarlo no es solo volver a subir el número.
        </p>
        <p>
          Por eso el perfil lleva límites —cuántas filas de menos se toleran, cuánta caída de stock
          agregada— y por eso lo primero que se hace con un origen nuevo es un{' '}
          <strong>simulacro</strong>, que enseña exactamente qué habría pasado sin que salga nada
          hacia Amazon. El envío automático de un perfil nuevo nace <strong>apagado</strong>.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Un perfil nuevo nace con nombres de columna puestos">
        <p>
          Se crea con los nombres que usan los ERP españoles que ya hemos visto y con los frenos ya
          fijados, para que el botón de <strong>Probar</strong> sirva desde el primer momento: lee el
          fichero con lo que hay puesto y enseña qué columna se ha llevado cada campo. Sin eso se
          rellenan diez campos a ciegas y el fallo aparece al procesar.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="El fichero de códigos de barras no es un extra">
        <p>
          Un cliente puede entregar dos ficheros: el volcado de stock y el índice de códigos de
          barras de su ERP. El segundo no se manda a Amazon —alimenta la vía de cruce por EAN, que es
          la que desempata las referencias que solo se diferencian en los ceros a la izquierda—. Con
          los datos reales resuelve 245 de 395 referencias, así que cuando falta se dice en la lista.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Las credenciales no se enseñan">
        <p>
          Las llaves de un SFTP o de un buzón se guardan cifradas y no vuelven a salir a pantalla
          nunca, ni siquiera para el que las metió. Se pueden reemplazar; no se pueden leer.
        </p>
      </SeccionInfo>
    </>
  )
}

import type { Dispatch, SetStateAction } from 'react'
import type { AmazonView, PerfilesVista } from '@/lib/amazon/client'

/**
 * LO QUE RECIBE CUALQUIER PANEL DE AMAZON API.
 *
 * Uno solo para las ocho pestañas, aunque casi ninguna use la mitad. Es lo que
 * permite que el mapa PANELES de Carcasa.tsx sea un `Record<PestanaId,
 * ComponentType<PropsPanel>>` y que añadir una pestaña sea una línea: con ocho
 * firmas distintas, la carcasa tendría que conocer los detalles de cada panel y
 * añadir el noveno obligaría a tocarla.
 *
 * Está en su propio fichero y no en Carcasa.tsx para romper el ciclo: la carcasa
 * importa los paneles, y los paneles importan estos tipos.
 */
export interface PropsPanel {
  /**
   * Los clientes, sus conexiones y el recuento de referencias de cada una.
   *
   * EL ESTADO LO LLEVA LA CARCASA y lo comparten las pestañas, no cada panel el
   * suyo. Desconectar una cuenta en «Cuentas» tiene que quitarla del selector de
   * «Catálogo» en el acto; con un estado por pestaña, las dos contarían cosas
   * distintas hasta recargar la página.
   */
  data: AmazonView
  /**
   * Es el `setState` de la carcasa TAL CUAL, no un envoltorio, para que acepte
   * el actualizador funcional `onData(prev => …)`.
   *
   * Sin eso, un panel que quiera modificar una sola conexión tiene que leer
   * `data` del render actual y meterlo en las dependencias de su callback, y ese
   * callback baja hasta el catálogo, donde es dependencia del efecto de carga y
   * del temporizador de refresco: cambiar de identidad en cada render lo pone a
   * cargar en bucle. Con el actualizador funcional, la referencia es estable
   * —`setState` lo es— y no hace falta capturar `data`.
   */
  onData: Dispatch<SetStateAction<AmazonView>>

  /**
   * LA CONEXIÓN QUE SE ESTÁ MIRANDO, COMPARTIDA POR LAS OCHO PESTAÑAS.
   *
   * `null` = todavía no se ha elegido ninguna.
   *
   * Vive en la carcasa y no en cada panel por una razón muy concreta: seis de
   * las ocho pestañas son POR CLIENTE, y elegirlo de nuevo en cada una sería
   * exactamente el «está todo pegado y se entiende como el culo» del que viene
   * esta reorganización. Elegido en el catálogo, seguirlo estando al mirar sus
   * marcas o sus costes.
   *
   * Es la CONEXIÓN y no el cliente porque un cliente puede tener dos —Europa y
   * Estados Unidos son regiones distintas, con su propia llave y su propio
   * catálogo—. Un panel que trabaje por cliente saca el suyo con
   * `data.connections.find(c => c.id === conexionId)?.client_id`.
   *
   * NO va en la URL a propósito, al revés que la pestaña: la dirección de una
   * pestaña se pasa por chat sin pensar, y con el cliente dentro se estaría
   * repartiendo por ahí a quién le estamos mirando el catálogo.
   */
  conexionId: string | null
  onConexionId: Dispatch<SetStateAction<string | null>>

  /**
   * Los perfiles de lectura del fichero del cliente. `null` = no se han podido
   * cargar; la pestaña Origen lo dice y las demás siguen funcionando.
   */
  perfiles: PerfilesVista | null

  /** Qué variable de entorno falta, si falta alguna. Solo el nombre, nunca el valor */
  configError: string | null

  /**
   * ¿Sigue la aplicación en BORRADOR en el portal de Amazon? Lo decide
   * appIsDraft() en el servidor, porque lee una variable de entorno que en el
   * navegador no existe. De esto depende que se hable del tope de 25
   * autorizaciones, que SOLO existe mientras no esté publicada en el Appstore.
   */
  appDraft: boolean

  /**
   * ENVUELVE CUALQUIER COSA QUE DESMONTE EL CATÁLOGO.
   *
   * Las ediciones de precio y stock sin enviar viven en memoria y son de un solo
   * cliente: irse las pierde, y no se guardan en ningún sitio. Hay tres formas
   * de perderlas —cambiar de cliente, cambiar de pestaña y recargar— y las dos
   * primeras tienen que pasar por la misma pregunta.
   *
   * La lleva la carcasa y no el panel porque el cambio de pestaña lo dispara la
   * carcasa. Cuando el guardián vivía dentro del catálogo, salir por la otra
   * puerta lo esquivaba y los cambios desaparecían sin decir nada.
   */
  alSalir: (accion: () => void) => void

  /** Cuántas ediciones sin enviar hay y de qué cliente. Alimenta a `alSalir` */
  onPendientes: (n: number, cliente: string) => void
}

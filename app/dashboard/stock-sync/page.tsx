import { permanentRedirect } from 'next/navigation'
import { PARAM_MODULO } from '@/components/growth/modulos'

/**
 * /dashboard/stock-sync — YA NO ES UN MÓDULO. REDIRIGE.
 *
 * El sincronismo de stock es ahora un submódulo de Growth Partner. Se movió
 * porque sincronizar el stock de un cliente es TRABAJAR sobre su cuenta, y ese es
 * el corte que separa los dos módulos de Amazon: configurar de dónde sale su
 * fichero se hace en Amazon API · Origen; sincronizarlo de verdad, allí.
 *
 * LA DIRECCIÓN SE QUEDA VIVA porque es la que tiene en marcadores quien sube el
 * stock dos veces por semana. Una dirección que un día contesta 404 no se lee
 * como «esto se ha movido»: se lee como «esto se ha roto», y encima el día que
 * hay prisa.
 *
 * NO SE HA BORRADO NADA: es el mismo tablero, con el mismo cruce y los mismos
 * ficheros. La pantalla vive ahora en components/growth/stock-sync/** y la carga
 * de datos en components/growth/paneles/PanelStockSync.tsx.
 *
 * LO ÚNICO QUE HA CAMBIADO ES QUE YA NO ELIGE CLIENTE POR SU CUENTA: lo elige el
 * selector de arriba de Growth Partner, común a todos sus submódulos. Por eso el
 * redirect no lleva cliente: cae en el primero de la lista, igual que antes caía
 * en el primer cliente activo.
 *
 *
 * ============ AVISO QUE HAY QUE CONFIRMAR ============
 *
 * Growth Partner es SOLO ADMIN, por decisión de arquitectura: desde ahí se ven
 * los datos de las cuentas de los clientes. Esta pantalla, en cambio, la usaba
 * hasta hoy la persona de operaciones, cuyo rol es 'employee' y que tenía el
 * permiso suelto 'stock-sync'.
 *
 * O sea que este redirect la deja fuera: pasa el filtro de esta ruta y rebota en
 * el gate de /dashboard/growth. Es una consecuencia buscada de la decisión, pero
 * hay que confirmarla antes del martes que toca subir stock. Si hay que
 * arreglarlo, la forma limpia es que Growth Partner admita también a quien tenga
 * el permiso 'stock-sync' y le enseñe solo ese submódulo — no abrir el módulo
 * entero.
 *
 * El permiso 'stock-sync' NO se ha borrado de user_app_permissions, justamente
 * para que esa puerta siga siendo posible sin tener que acordarse de a quién se
 * le había dado.
 */
export default function StockSyncPage() {
  permanentRedirect(`/dashboard/growth?${PARAM_MODULO}=stock-sync`)
}

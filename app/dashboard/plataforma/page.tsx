import { permanentRedirect } from 'next/navigation'
import { PARAM_PESTANA } from '@/components/amazon-api/pestanas'

/**
 * /dashboard/plataforma — YA NO ES UN MÓDULO. REDIRIGE.
 *
 * Lo que era «Plataforma Amazon» —los trabajos de ingesta, la cobertura de datos
 * y la ficha de SKU— es ahora la pestaña «Ingesta» de Amazon API. Se movió porque
 * es información sobre lo que GUARDAMOS, o sea las tripas, y tenerla en un módulo
 * aparte del menú obligaba a saber de antemano en cuál de los dos estaba cada
 * cosa.
 *
 * LA DIRECCIÓN SE QUEDA VIVA porque hay gente con esta pestaña abierta y en
 * marcadores, y porque está pegada en conversaciones. Una dirección que un día
 * contesta 404 no se lee como «esto se ha movido»: se lee como «esto se ha roto».
 *
 * `permanentRedirect` (308) y no el temporal: el traslado es definitivo, así que
 * el navegador puede recordarlo y ahorrarse el viaje la próxima vez.
 *
 * NO SE HA BORRADO NADA. El contenido lo pinta el mismo PlataformaBoard de
 * siempre, ahora desde components/amazon-api/paneles/PanelIngesta.tsx.
 *
 * El control de acceso no se pierde por redirigir: el destino es solo-admin y lo
 * comprueba por su cuenta, además del gate que middleware.ts sigue teniendo sobre
 * esta ruta.
 */
export default function PlataformaPage() {
  permanentRedirect(`/dashboard/amazon-api?${PARAM_PESTANA}=ingesta`)
}

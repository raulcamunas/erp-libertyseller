import { EsqueletoDeAgenda } from '@/components/agenda/EsqueletoDeAgenda'

/**
 * Lo que se ve al pulsar «Agenda», mientras el servidor prepara la semana: la barra y la rejilla con su forma. Sin esto salía el esqueleto genérico de
 * app/dashboard/loading.tsx (un título y cuatro bloques), que no se parece a nada de lo que llega después.
 */
export default function CargandoAgenda() {
  return <EsqueletoDeAgenda />
}

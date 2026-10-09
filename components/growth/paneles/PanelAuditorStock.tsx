import { Activity } from 'lucide-react'
import { Vacio } from '@/components/plataforma/comun'
import { ListaInfo, SeccionInfo } from '@/components/ui/BotonInfo'
import type { ClienteGrowth } from '@/lib/growth/clientes'
import {
  cuentaAuditada,
  hayAuditoriaEnCurso,
  MERCADO_AUDITADO,
  PRESUPUESTO_MS,
  RETENCION_DIAS,
  SLUG_AUDITADO,
} from '@/lib/auditor-stock/auditar'
import { listarAuditorias } from '@/lib/auditor-stock/consulta'
import { TableroAuditorStock } from '@/components/growth/auditor/TableroAuditorStock'

/**
 * SUBMÓDULO «AUDITOR DE STOCK» — SOLO PARA SHOESF.
 *
 * Cada 15 minutos lee el stock de toda la cuenta y apunta cuántos listings tienen
 * y cuántos no, con el SKU, el ASIN y la cantidad de los que sí.
 *
 *
 * ============ ESTE SUBMÓDULO ES DE UN SOLO CLIENTE, A PROPÓSITO ============
 *
 * Igual que Precios Shoplamp, y se cierra en los mismos tres sitios: el botón
 * solo aparece con ShoesF elegido (`soloCliente` en modulos.ts), esta pantalla
 * comprueba el slug otra vez, y la ruta resuelve la cuenta POR SLUG dentro de sí
 * misma sin recibirla de fuera. El tercero es el que cierra de verdad.
 *
 * No es una limitación a la espera de generalizarlo: leer el catálogo entero de
 * una cuenta cada quince minutos son ~700 llamadas a Amazon, y eso solo se
 * justifica donde hay un error concreto que perseguir.
 */
export async function PanelAuditorStock({ cliente }: { cliente: ClienteGrowth }) {
  if (cliente.slug !== SLUG_AUDITADO) {
    return (
      <Vacio icono={<Activity />} titulo="Este auditor es solo de ShoesF">
        Lee el stock de toda la cuenta cada 15 minutos, y eso son unas 700 llamadas a Amazon cada
        vez: solo se justifica donde hay un error concreto que perseguir. Para mirar el stock de{' '}
        <strong>{cliente.nombre}</strong> usa el resto de submódulos.
      </Vacio>
    )
  }

  const cuenta = await cuentaAuditada()
  if ('error' in cuenta) {
    return (
      <Vacio icono={<Activity />} titulo="No se puede auditar esta cuenta">
        {cuenta.error} Se conecta desde <strong>Amazon API · Cuentas</strong>.
      </Vacio>
    )
  }

  const lista = await listarAuditorias(cuenta.connectionId, MERCADO_AUDITADO)

  return (
    // La llave remonta la pantalla al cambiar de cliente arriba.
    <TableroAuditorStock
      key={cliente.slug}
      inicial={lista}
      enCursoInicial={hayAuditoriaEnCurso()}
    />
  )
}

export function InfoAuditorStock() {
  return (
    <>
      <SeccionInfo titulo="Qué hace">
        <p>
          Cada <strong>15 minutos</strong> pregunta a Amazon, en directo, cuánto stock tiene cada
          listing de ShoesF, y apunta cuántos tienen y cuántos no. Se puede bajar a 10 desde{' '}
          <strong>Sistema</strong>, sin tocar nada más.
        </p>
        <p>
          No escribe nada en Amazon: solo lee. Y no toca el catálogo del ERP ni el stock de nadie.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Cómo leer la pantalla">
        <ListaInfo>
          <li>
            <strong>Arriba</strong>, las cifras de la última auditoría completa: con stock, sin
            stock, unidades, y cuántos <strong>entran</strong> y <strong>salen</strong> respecto a la
            anterior.
          </li>
          <li>
            <strong>A la izquierda</strong>, las auditorías por horas, cada hora en un desplegable.
            El número de la derecha es cuántos tenían stock al final de esa hora, y el de color, lo
            que cambió dentro de ella.
          </li>
          <li>
            <strong>A la derecha</strong>, los productos de la auditoría que elijas: SKU, ASIN y
            cantidad. Pinchando otra fila de la izquierda cambia.
          </li>
        </ListaInfo>
      </SeccionInfo>

      <SeccionInfo titulo="Entran y salen: lo que sirve para perseguir un error">
        <p>
          Una venta que baja un SKU de 12 a 11 no es un cambio de estado y pasa cientos de veces al
          día. Lo que interesa es que un producto <strong>aparezca</strong> (pase de 0 a tener) o{' '}
          <strong>desaparezca</strong> (pase de tener a 0).
        </p>
        <p>
          Un SKU solo cuenta como «sale» si esta vez se ha <strong>leído y tiene cero</strong>. Que no
          aparezca en la lista no basta: puede que Amazon no lo haya devuelto, y contarlo como
          salida inventaría una caída de stock que no ha ocurrido.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="«Sin dato» no es «sin stock»">
        <p>
          Si Amazon devuelve un listing sin cantidad, no se sabe cuánto hay. Se cuenta aparte, como{' '}
          <strong>sin dato</strong>, y no se suma a los agotados: hacerlo daría una falsa alarma cada
          vez que Amazon devolviera un listing a medias.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Completa, parcial y error">
        <ListaInfo>
          <li>
            <strong>Completa</strong> — se leyeron todos. Es la que cuenta para las cifras y las
            comparaciones.
          </li>
          <li>
            <strong>Parcial</strong> — Amazon fue lento y se acabó el tiempo ({Math.round(PRESUPUESTO_MS / 1000)}{' '}
            s) antes de terminar. Sus cifras valen solo para lo leído, así que no se comparan con las
            demás ni calculan entran y salen.
          </li>
          <li>
            <strong>Error</strong> — no se pudo leer la cuenta. Suena en la campana, y la pantalla
            lo dice encima.
          </li>
        </ListaInfo>
      </SeccionInfo>

      <SeccionInfo titulo="FBM y FBA, y de dónde sale la cantidad">
        <p>
          La cantidad de los productos <strong>FBM</strong> (los que envía el vendedor) es la que
          Amazon dice <em>ahora</em>. La de los <strong>FBA</strong> no la da la API de listados: se
          toma del último inventario de Amazon que tenemos, que se lee <strong>una vez al día</strong>.
          Por eso van marcados como FBA y se pueden filtrar: no son un dato de hace un minuto.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Lo que cuesta">
        <p>
          Leer unos 14.000 listings son unas <strong>700 llamadas</strong> a Amazon, a 5 por
          segundo: <strong>dos o tres minutos de cada cuarto de hora</strong>. A 10 minutos serían
          cuatro de cada diez, y las demás lecturas del catálogo harían cola detrás. Conviene
          mirar cómo va antes de bajarlo.
        </p>
        <p>
          Solo se audita <strong>España</strong>: el stock de ShoesF sale de un único almacén y es
          el mismo número en todos los países, así que leer los cuatro sería gastar cuatro veces
          el cupo para ver el mismo dato.
        </p>
        <p>
          Se guardan {RETENCION_DIAS} días y se ven las últimas 72 horas.
        </p>
      </SeccionInfo>
    </>
  )
}

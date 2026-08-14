import Link from 'next/link'
import { Link2Off } from '@/components/ui/iconos'
import { createClient } from '@/lib/supabase/server'
import { StockSyncBoard } from '@/components/growth/stock-sync/StockSyncBoard'
import { PanelEjecuciones } from '@/components/growth/stock-sync/PanelEjecuciones'
import { PestanasStockSync } from '@/components/growth/stock-sync/PestanasStockSync'
import {
  ejecucionesDeCliente,
  estadoDePerfiles,
  tieneMapeoManual,
} from '@/lib/growth/ejecuciones'
import type { StockMapping, StockRun } from '@/lib/types/stock-sync'
import { Vacio } from '@/components/plataforma/comun'
import { ListaInfo, SeccionInfo } from '@/components/ui/BotonInfo'
import type { ClienteGrowth } from '@/lib/growth/clientes'

/**
 * SUBMÓDULO «SINCRONISMO DE STOCK» — antes /dashboard/stock-sync.
 *
 * Del volcado del ERP del cliente al fichero de stock que se sube a Amazon. Es
 * TRABAJO sobre la cuenta de un cliente, y por eso está aquí y no en Amazon API:
 * allí se configura de dónde sale su fichero (pestaña Origen) y aquí se
 * sincroniza de verdad, dos veces por semana.
 *
 * La mudanza está terminada:
 *
 *   · La pantalla vive entera en components/growth/stock-sync/**.
 *   · El tablero YA NO TRAE SU PROPIA LISTA DE CLIENTES. El cliente llega del
 *     selector de arriba, común a todo Growth Partner, que es lo que se pidió:
 *     «lo dividimos dentro de cada módulo qué cliente manejamos».
 *   · Los párrafos de ayuda que había encima de los controles se han ido al botón
 *     de información de arriba a la derecha —lo escribe InfoStockSync, aquí
 *     abajo—. No se ha perdido ni una frase: se ha movido.
 *   · La dirección vieja sigue viva y redirige aquí.
 *
 * EL FUNCIONAMIENTO NO SE HA TOCADO: el cruce, los tres ficheros, el interruptor
 * de los sin resolver y el historial hacen exactamente lo de siempre. Es la
 * pantalla que se usa dos veces por semana y está verificada contra ficheros
 * reales; mover de sitio y reescribir a la vez es como se rompen esas cosas.
 *
 *
 * ============ CUMPLIMIENTO ANTE AMAZON: UNA CONSULTA MENOS QUE ROZA A NADIE ============
 *
 * La versión anterior leía, para pintar su lista, el recuento de mapeos y la
 * última ejecución DE TODOS LOS CLIENTES: dos consultas por cada uno. Ahora se
 * pide el mapeo y el historial DE UNO, el elegido arriba. Los datos de un
 * vendedor se usan exclusivamente para operar su cuenta, así que la consulta que
 * no hace falta es la que no se hace.
 */

// Supabase corta cualquier consulta a 1000 filas y un .limit() mayor no lo
// salta. El mapeo de un cliente con catálogo grande pasa de ahí sin despeinarse,
// y quedarse a medias aquí no da error: enseñaría el catálogo incompleto y quien
// lo mirase daría por perdidos listings que sí están.
const PAGE = 1000

/** Procesos que se enseñan de entrada; el mismo número que espera el tablero */
const RUNS_LIMIT = 30

/** La pestaña de Amazon API donde se configura de dónde sale el fichero */
const RUTA_ORIGEN = '/dashboard/amazon-api?p=origen'

/**
 * Consulta paginada. El orden lo fija quien llama y siempre termina en una
 * columna única, porque .range() sobre un orden con empates puede repetir o
 * saltarse filas entre tramos.
 */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) {
      console.error('Error cargando sincronismo de stock:', error)
      break
    }
    const chunk = (data as T[]) ?? []
    out.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return out
}

export async function PanelStockSync({ cliente }: { cliente: ClienteGrowth }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  // Un cliente que no está dado de alta en el sincronismo no es un error ni una
  // pantalla rota: hay clientes que no mandan volcado y no lo van a mandar.
  if (!cliente.stockClientId) {
    return (
      <Vacio icono={<Link2Off />} titulo={`${cliente.nombre} no manda volcado de stock`}>
        Si el suyo tiene que llegar, se dice en{' '}
        <Link href={RUTA_ORIGEN} className="underline underline-offset-2 hover:text-[var(--ls-t1)]">
          Amazon API · Origen
        </Link>
        .
      </Vacio>
    )
  }

  const clienteId = cliente.stockClientId

  // Solo admin y partner pueden borrar, igual que las políticas de la migración
  // 106. Con RLS un borrado sin permiso no da error, simplemente no borra: el
  // tablero necesita saberlo de antemano para ofrecer desactivar en su lugar.
  //
  // Hoy Growth Partner es solo-admin, así que esto es siempre true. Se deja
  // calculado y no puesto a mano porque el día que se abra el módulo a alguien
  // más, el que se olvide de esta línea le está dando el botón de borrar.
  const { data: perfil } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  const canDelete = perfil?.role === 'admin' || perfil?.role === 'partner'

  /**
   * LO QUE VE TODO EL MUNDO ES EL HISTORIAL DE EJECUCIONES.
   *
   * Antes esta pantalla abría en el formulario de SUBIR EL VOLCADO A MANO, con
   * su tabla de mapeo al lado, para todos los clientes. Eso describe cómo se
   * trabajaba cuando el stock se subía dos veces por semana pulsando un botón, y
   * cómo trabaja HOY un solo cliente. Para el resto el ciclo entra cada quince
   * minutos y lo hace solo, así que la pantalla enseñaba un botón para hacer
   * algo que ya se estaba haciendo — y no contestaba la única pregunta que
   * importa: qué le ha hecho el ERP a esta cuenta.
   *
   * La subida manual NO SE BORRA y NO SE ESCONDE: pasa a ser la segunda pestaña,
   * disponible para todos los clientes. Es la salida mientras el sincronismo
   * automático de un cliente no esté fino, y con un cliente vendiendo no se
   * puede esperar a que el conector funcione para poder trabajar.
   */
  const [ejecuciones, perfiles, conMapeo] = await Promise.all([
    ejecucionesDeCliente(clienteId),
    // El estado VIVO de cada perfil. No es lo mismo que el historial: cuando un
    // fallo se repite igual, el ciclo lo reintenta pero no escribe fila, y sin
    // esto la pantalla parece parada. Ver estadoDePerfiles().
    estadoDePerfiles(clienteId),
    tieneMapeoManual(clienteId),
  ])

  const panelEjecuciones = (
    <PanelEjecuciones
      key={cliente.slug}
      clientId={clienteId}
      clientName={cliente.nombre}
      ejecuciones={ejecuciones}
      perfiles={perfiles}
      className="flex-1 min-h-0 min-w-0"
    />
  )

  /**
   * LA PESTAÑA DE SUBIDA MANUAL ESTÁ SIEMPRE. Nunca condicionada.
   *
   * Estuvo condicionada a que el cliente YA tuviera mapeo, y era un agujero:
   * el botón de importar el mapeo vive dentro de esa pestaña, así que un cliente
   * sin mapeo no tenía forma de crear el suyo. Justo el que más lo necesita —el
   * que hoy cruza por referencia y casa el 27 %— era el que no podía.
   *
   * Y hay una segunda razón, que es la que la mantiene aquí a largo plazo:
   * mientras el sincronismo automático de un cliente no esté fino, subir el
   * fichero a mano es la salida. Quitarla obliga a esperar a que el conector
   * funcione para poder trabajar, y eso no es una opción con un cliente
   * vendiendo.
   *
   * Lo que SÍ sigue siendo condicional es CARGAR el mapeo: son miles de filas
   * paginadas de mil en mil. Si el cliente no tiene, se pasa vacío y la tabla
   * sale con su botón de importar, que es exactamente lo que hace falta.
   */
  const [mappings, runs] = await Promise.all([
    conMapeo
      ? fetchAll<StockMapping>((from, to) =>
          supabase
            .from('stock_mappings')
            .select('*')
            .eq('client_id', clienteId)
            .order('sku_amazon')
            .order('id')
            .range(from, to)
        )
      : Promise.resolve([] as StockMapping[]),
    supabase
      .from('stock_runs')
      .select('*')
      .eq('client_id', clienteId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(RUNS_LIMIT),
  ])

  return (
    <PestanasStockSync
      ejecuciones={panelEjecuciones}
      manual={
        <StockSyncBoard
          // Cambiar de cliente arriba tiene que REMONTAR el tablero. Sin la llave,
          // React reutiliza el componente y su estado interno —los ficheros que
          // había elegidos, el resultado del último proceso con su botón de
          // descarga— sobrevive a la navegación: se vería el nombre nuevo arriba y
          // el fichero del anterior listo para bajar.
          key={cliente.slug}
          clientId={clienteId}
          clientName={cliente.nombre}
          initialMappings={mappings}
          initialRuns={(runs.data as StockRun[]) || []}
          currentUserId={user.id}
          canDelete={canDelete}
        />
      }
    />
  )
}

/**
 * TODO EL TEXTO QUE ANTES ESTABA EN MEDIO DE LA PANTALLA.
 *
 * Es una petición literal: «no pongas tanto texto explicativo, hazlo bonito sin
 * tanto texto; pon un botón de información arriba y explica todo pero no en medio
 * de la pantalla». Lo que había encima de los controles —de dónde se baja la
 * plantilla de Amazon, qué pasa con los listings de FBA, qué hace el interruptor
 * de enviar a cero, qué es el trabajo pendiente— está aquí, entero.
 *
 * LO QUE NO SE HA TRAÍDO AQUÍ, a propósito: «este cliente no tiene tabla de
 * mapeo» y el aviso de la plantilla. Son accionables HOY y esconderlos detrás de
 * un botón es no darlos.
 */
export function InfoStockSync() {
  return (
    <>
      <SeccionInfo titulo="Qué hace este submódulo">
        <p>
          Coge el volcado de stock que manda el ERP del cliente, lo cruza con su catálogo de Amazon
          y produce el fichero que se sube. El cruce se hace por el mapeo: qué referencia del
          cliente es qué referencia de Amazon.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="De dónde sale el fichero se configura en Amazon API">
        <p>
          Aquí se sube a mano, que es como se trabaja hoy dos veces por semana. Que el volcado de un
          cliente llegue solo —por SFTP, de una carpeta de Drive o de un buzón de correo—, con qué
          columnas se lee, con qué frenos, y el simulacro que enseña qué pasaría sin mandar nada a
          Amazon, todo eso se configura en{' '}
          <Link href={RUTA_ORIGEN} className="underline underline-offset-2">
            Amazon API · Origen
          </Link>
          . También se dice allí que <strong>un cliente no sincroniza</strong>, que es una decisión
          de primera y no un perfil a medias.
        </p>
        <p>
          Esos controles no se duplican aquí: dos sitios donde tocar lo mismo acaban diciendo cosas
          distintas, y el que se mira menos es el que miente.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Los tres ficheros que se suben">
        <ListaInfo>
          <li>
            <strong>Volcado de stock</strong> (obligatorio) — el <code>ARTICULOS_STOCK_COSTE
            PROMEDIO</code> del ERP del cliente. Es de donde salen las unidades.
          </li>
          <li>
            <strong>Fichero de EAN</strong> (opcional) — el <code>ARTICULOS_EAN</code>. Sirve para
            desempatar las referencias que se pisan entre sí.
          </li>
          <li>
            <strong>Plantilla de Amazon</strong> (opcional) — la de «Precio y cantidad». Sin ella
            sale el Excel de tres columnas de siempre.
          </li>
        </ListaInfo>
        <p>
          Los dos del ERP se llaman casi igual y salen de la misma pantalla, así que se avisa cuando
          un fichero no parece el de su hueco. No se bloquea —el nombre lo puede cambiar
          cualquiera—, pero el fallo se manifiesta como «no ha casado nada» y desde ahí no hay quien
          lo adivine.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="La plantilla tiene que ser la de ese cliente">
        <p>
          Descárgala de Seller Central <strong>del propio cliente</strong>, en la carga masiva de
          inventario, eligiendo «Precio y cantidad». Si la subes, se te devuelve esa misma plantilla
          rellenada —el SKU en la columna del SKU y las unidades en la de cantidad—, lista para
          subirla sin tocar nada.
        </p>
        <p>
          Lleva grabada dentro la cuenta de vendedor: la plantilla de otro cliente se rellena igual
          de bien y el fallo no se ve hasta que Seller Central devuelve un error por cada SKU,
          porque ninguno existe en esa cuenta.
        </p>
        <p>
          Que sea de otra semana no es problema: Amazon convierte solo las desactualizadas a la
          versión del día. Bajar la última evita arrastrar validaciones viejas, pero no es lo que
          rompe una carga.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Con plantilla, los SKU de FBA dejan de estarlo">
        <p>
          La plantilla lleva una cantidad para cada SKU que case, y Amazon avisa en sus
          instrucciones de que indicar cantidad en un SKU gestionado por él lo convierte en
          gestionado por el vendedor. Lo provoca la columna de cantidad, que va siempre.
        </p>
        <p>
          El mapeo no distingue qué listings están en FBA, así que la única forma de proteger uno es
          que su SKU no salga en el fichero: <strong>desactívalo en «Base de datos actual»</strong>{' '}
          antes de procesar.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="El interruptor de enviar a 0">
        <p>
          Apagado, lo que no casa se queda fuera del fichero y Amazon conserva el stock que ya
          tenía. Encendido, todo lo que el volcado no explique se publica con 0 unidades.
        </p>
        <p>
          Nace apagado y así debe quedarse salvo que te conste que el fichero del cliente viene
          completo: si un día llega a medias, enciende listings a cero que sí tenían producto, el
          cliente deja de vender esa misma tarde y recuperarlo no es solo volver a subir el número.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Una referencia sin dato no vale cero">
        <p>
          Si el volcado no trae una referencia, eso no significa que tenga cero unidades: significa
          que no lo sabemos. Mandar un cero a Amazon la retira de la venta. Los dos casos se tratan
          distinto y la pantalla los distingue: «0 unidades reales» es un cero del ERP, «sin
          resolver» es que no hay dato.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Los listings sin resolver son el trabajo pendiente">
        <p>
          Cada fila es un producto publicado del que hoy no sabemos las unidades. Van agrupados por
          motivo y de mayor a menor, porque lo que hay que hacer depende del motivo y no del SKU:
          ochenta filas suelen ser tres o cuatro tareas.
        </p>
        <p>
          Arreglar su línea en «Base de datos actual» hace que la próxima vez case sola. Cada grupo
          lleva escrito qué lo arregla.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="La base de datos actual">
        <p>
          Cada fila es un listing publicado en Amazon. Se edita al vuelo y se guarda sola; si otro
          la está tocando a la vez, el cambio aparece aquí sin recargar.
        </p>
        <ListaInfo>
          <li>
            <strong>Importar</strong> actualiza los SKU que ya existan y da de alta los nuevos. No
            borra nada, así que las correcciones hechas a mano en columnas que el fichero no traiga
            se conservan.
          </li>
          <li>
            <strong>Desactivar</strong> saca la línea del fichero pero conserva el histórico de lo
            que se subió. Es lo que hay que usar para retirar algo temporalmente, en vez de borrar.
          </li>
          <li>
            La <strong>REF_ERP se guarda tal cual se escribe</strong>, con sus ceros a la izquierda:
            en el ERP del cliente «0080997933» y «080997933» son dos artículos distintos.
          </li>
        </ListaInfo>
      </SeccionInfo>

      <SeccionInfo titulo="El historial responde a «¿por qué mi producto salió a cero?»">
        <p>
          Queda anotado qué fichero se cruzó cada día y qué se subió. La flecha de la columna «sin
          casar» compara con el proceso anterior: que un lunes pasen de 86 a 300 no significa que el
          cliente haya dado de alta 214 productos, significa que ha cambiado el formato del volcado
          o que la exportación salió a medias.
        </p>
      </SeccionInfo>
    </>
  )
}

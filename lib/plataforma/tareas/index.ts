/**
 * EL REGISTRO DE TAREAS
 * =====================
 * El motor (lib/plataforma/motor.ts) no conoce ninguna tarea: se las enchufan
 * aquí. Añadir una es importarla y meterla en la lista de abajo; su tipo ya está
 * declarado en el CHECK de amazon_jobs (migración 123), así que no hace falta
 * migración ninguna.
 *
 * Se llama a `registrarTareas()` al principio de cualquier ruta que vaya a
 * ejecutar el motor. Es IDEMPOTENTE porque el registro es un Map indexado por
 * tipo: registrar dos veces la misma tarea la sustituye por sí misma. Hace falta
 * llamarlo en cada petición y no una vez al arrancar porque en Next cada ruta
 * puede vivir en su propio módulo cargado bajo demanda, y un registro que se
 * hiciera «al importar» dependería de que alguien importara el fichero.
 *
 *
 * QUÉ HAY Y QUÉ NO
 * ----------------
 * A1 trae CUATRO tareas:
 *
 *   recalcular_activos   — quién entra en el refresco diario. No habla con
 *                          Amazon, así que ejercita el motor entero sin gastar
 *                          cupo y se puede probar las veces que haga falta.
 *   censo_catalogo       — GET_MERCHANT_LISTINGS_ALL_DATA. La única forma de
 *                          enumerar un catálogo de más de 1.000 referencias.
 *   enriquecer_catalogo  — searchCatalogItems: marca, categoría, medidas y, de
 *                          paso, el ranking de ventas.
 *   snapshot_bsr         — lo mismo pero solo el ranking, a diario y sobre el
 *                          subconjunto en seguimiento.
 *   inventario_fba       — getInventorySummaries a la serie de inventario, con
 *                          los tres estados (conocido / no aplica / desconocido).
 *
 * Ya tienen tarea A2 (precios y Buy Box) y las TARIFAS. La que falta son las
 * importaciones (A5): está declarada en la base y NO tiene tarea todavía. Eso no falla en
 * silencio: un trabajo de un tipo sin tarea se cierra con error y levanta un
 * evento que suena en la campana (ver conCerrojo() en motor.ts). Es a propósito:
 * un trabajo esperando para siempre a alguien que lo procese es indistinguible
 * de un trabajo que va lento.
 */

import { registrarTarea, type Tarea } from '../motor'
import { tareaCensoCatalogo } from './censo-catalogo'
import { tareaEnriquecerCatalogo, tareaSnapshotBsr } from './catalogo-items'
import { tareaInventarioFba } from './inventario-fba'
import { tareaRecalcularActivos } from './recalcular-activos'
// A2 · el monitor de Buy Box. Vive en lib/plataforma/buybox/** y se enchufa aquí
// igual que las de A1: su tipo ya estaba declarado en el CHECK de amazon_jobs.
import { tareaSnapshotPrecios } from '../buybox/tarea'
// A4/A5 · las tarifas de Amazon. Sin ellas no hay margen que calcular en
// ningun modulo: margen() contesta «hace falta una estimacion de tarifas».
import { tareaTarifas } from './tarifas'

const TAREAS: Tarea[] = [
  tareaRecalcularActivos,
  tareaCensoCatalogo,
  tareaEnriquecerCatalogo,
  tareaSnapshotBsr,
  tareaInventarioFba,
  tareaSnapshotPrecios,
  tareaTarifas,
]

export function registrarTareas(): void {
  for (const tarea of TAREAS) registrarTarea(tarea)
}

export {
  tareaRecalcularActivos,
  tareaCensoCatalogo,
  tareaEnriquecerCatalogo,
  tareaSnapshotBsr,
  tareaInventarioFba,
  tareaSnapshotPrecios,
}

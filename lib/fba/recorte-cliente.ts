import type { PlanCliente, PlanParaCliente } from './plan-tipos'

/**
 * LO QUE VE EL CLIENTE EXTERNO DEL PLAN (spec remesas-pro §11 D26).
 * PURA: sin base de datos ni red. Se comprueba con recorte-cliente.prueba.ts.
 *
 * `GET /api/fba/plan` con actor `cliente` devuelve esto, leído de la última pasada guardada (nunca calcula).
 * Se queda con lo que es SUYO: stock, ritmo, cobertura, fechas de rotura y los envíos que ya van de camino.
 * Se queda fuera lo que es de la agencia: €, prioridades, ajustes y plazos, la revisión de la IA, los envíos propuestos,
 * el porqué de cada línea (lleva € y prioridades) y los avisos internos.
 *
 * Cada objeto se construye campo a campo, sin `...`: un campo nuevo en `LineaPlan` no se cuela solo al navegador del cliente.
 */

/** Los avisos de calidad son frases ya redactadas: las que hablan de dinero se quedan en la agencia */
const CON_DINERO = /[€$£]|\beuros?\b|\bd[oó]lares?\b|\bUSD\b|\bEUR\b|\bGBP\b/i

export function planParaCliente(plan: PlanCliente, calculadoAt: string | null): PlanParaCliente {
  return {
    clienteId: plan.clienteId,
    hoy: plan.hoy,
    calculadoAt,
    calidad: {
      libro: plan.calidad.libro,
      leidoHasta: plan.calidad.leidoHasta,
      diasAtraso: plan.calidad.diasAtraso,
      mercado: plan.calidad.mercado,
      avisos: plan.calidad.avisos.filter((a) => !CON_DINERO.test(a)),
    },
    lineas: plan.lineas.map((l) => ({
      sku: l.sku,
      asin: l.asin,
      nombre: l.nombre,
      modelo: l.modelo,
      talla: l.talla,
      vendibles: l.vendibles,
      deCamino: l.deCamino,
      coberturaDias: l.coberturaDias,
      coberturaConLoQueViene: l.coberturaConLoQueViene,
      fechaRotura: l.fechaRotura,
      ritmo: { base: l.ritmo.base, confianza: l.ritmo.confianza, explicacion: l.ritmo.explicacion },
    })),
    enCamino: plan.enCamino.map((c) => ({
      remesaId: c.remesaId,
      nombre: c.nombre,
      referenciaEnvio: c.referenciaEnvio,
      estadoAmazon: c.estadoAmazon,
      fechaEnvio: c.fechaEnvio,
      llegadaPrevista: c.llegadaPrevista,
      unidades: c.unidades,
      recibidas: c.recibidas,
      dudoso: c.dudoso,
    })),
    resumen: {
      referencias: plan.resumen.referencias,
      vendibles: plan.resumen.vendibles,
      deCamino: plan.resumen.deCamino,
      primeraRotura: plan.resumen.primeraRotura,
      coberturaMediana: plan.resumen.coberturaMediana,
    },
  }
}

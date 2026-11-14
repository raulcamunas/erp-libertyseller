/**
 * EL CORREO QUE LLEVA EL ANÁLISIS AL LEAD.
 *
 * HTML de correo de verdad: tablas, estilos en línea y 600 px de ancho, para
 * que se vea igual en Gmail, Outlook y el móvil. Enseña un adelanto del
 * informe (las cifras clave y los tres puntos que más pesan, en un panel con la
 * misma cara que la página) y empuja a abrirlo; abajo, el comercial con su
 * WhatsApp y su teléfono, y la baja.
 *
 * La entradilla (dos o tres frases) la puede escribir la IA; si no llega, va
 * una fija. Todo lo demás sale de los datos del informe: nada inventado.
 */
import type { InformeAnalisis } from './construir'
import { esSinAmazon, type InformeSinAmazon } from '@/lib/analisis-sin-amazon/construir'
import { depurar } from '@/lib/analisis-sin-amazon/calidad'

/** El correo vale para los dos informes: el de una cuenta de Amazon y el de una tienda que no vende allí (clase 'sin_amazon') */
export type InformeDelCorreo = InformeAnalisis | InformeSinAmazon

export type DatosCorreoAnalisis = {
  /** enlace público del informe */
  url: string
  /** enlace de baja (deja de recibir correos) */
  urlBaja: string
  comercial: { nombre: string; whatsapp?: string | null; telefono?: string | null }
  /** 2-3 frases de apertura; si falta, va una fija */
  entradilla?: string | null
  /** «Hola, Marta:»; si falta, «Hola, equipo de <tienda>:» */
  saludo?: string | null
  /** base de las imágenes (el logo) */
  base?: string
}

const N = '#FF6600'
const NEGRO = '#0E0E0E'
const GRIS = '#5E5852'
const LINEA = '#E5E1DB'
const SOFT = '#F7F5F2'

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const miles = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const fecha = (iso: string) => {
  const [a, m, d] = iso.split('-').map(Number)
  return `${d} de ${MESES[m - 1]} de ${a}`
}

const saludoDe = (inf: InformeDelCorreo, d: Pick<DatosCorreoAnalisis, 'saludo'>) => d.saludo?.trim() || `Hola, equipo de ${inf.vendedor.nombre}:`

const entradillaFija = (inf: InformeDelCorreo) => {
  if (esSinAmazon(inf))
    return inf.caso === 'revendida'
      ? `Hemos mirado ${inf.marca.nombre} en Amazon.es: tiene ${miles(inf.marca.modelos)} fichas y las están vendiendo otras tiendas, no tú. Te lo hemos dejado todo en un análisis, con lo que se vende de lo tuyo y contra quién compites.`
      : `Hemos mirado qué se vende en Amazon.es de lo que tú vendes en tu web, a qué precio y contra quién. Tu marca todavía no está, y te lo hemos dejado todo en un análisis.`
  const altas = inf.oportunidades.filter((o) => o.prioridad === 'alta').length
  return `Hemos revisado con datos públicos de Amazon la cuenta de ${inf.vendedor.nombre}: catálogo, Buy Box, stock, reputación y competencia. ${
    altas > 0 ? 'Hay varios puntos que te están costando ventas ahora mismo, y te los hemos dejado ordenados.' : 'Tienes una buena base y recorrido para vender más.'
  }`
}

/** Las piezas que cambian según el informe: titular, cifras del panel, los puntos y el pie del adelanto */
type Piezas = {
  etiqueta: string
  titular: string
  titular2: string | null
  kpis: [string, string, boolean][]
  puntos: { cifra: string; titulo: string; impacto: string | null; alta: boolean }[]
  pieAdelanto: string
  preheader: string
  pieLegal: string
}

function piezasDe(original: InformeDelCorreo): Piezas {
  // En el correo solo entran los mercados que valen (lib/analisis-sin-amazon/calidad.ts): ni accesorios que no son lo suyo ni cifras de otra gama
  const inf = esSinAmazon(original) ? depurar(original) : original
  if (esSinAmazon(inf)) {
    const m = inf.mercados[0]
    return {
      etiqueta: 'Tu oportunidad en Amazon',
      titular: inf.titular[0],
      titular2: inf.titular[1],
      kpis: [
        [miles(inf.marca.modelos), 'fichas de tu marca en Amazon', false],
        inf.caso === 'revendida' ? [miles(inf.marca.vendedores.length), 'tiendas la venden', false] : [m?.precioMediano ? `${miles(m.precioMediano)} €` : '—', 'precio mediano en Amazon', false],
        inf.marca.sinVendedor
          ? [`${inf.marca.sinVendedor} de ${inf.marca.revisadas}`, 'sin nadie que las venda', true]
          : inf.catalogo.productos > 0
            ? [miles(inf.catalogo.productos), 'productos en tu web', false]
            : [m?.resenasMediana ? miles(m.resenasMediana) : '—', 'reseñas de mediana de los que más venden', false],
        [m ? (m.modo === 'ventas' ? `+${miles(m.ventasMes)}` : miles(m.resenasMediana ?? 0)) : '—', m ? (m.modo === 'ventas' ? 'uds/mes en tu categoría' : 'reseñas de mediana de los que más venden') : 'en tu categoría', false],
      ],
      // Arriba van las cifras de su marca; abajo, dónde compite en Amazon (sin repetir lo de arriba)
      puntos: inf.mercados.length
        ? inf.mercados.slice(0, 3).map((x, i) => {
            const quien = x.marcas.slice(0, 3).map((y) => y.marca).join(', ')
            return {
              cifra: x.modo === 'ventas' ? `+${miles(x.ventasMes)}` : x.precioMediano ? `${miles(x.precioMediano)} €` : '—',
              titulo: x.nombre,
              impacto: `${x.modo === 'ventas' ? 'unidades al mes entre los más vendidos' : 'precio mediano de los que más venden'}${quien ? ` · mandan ${quien}` : ''}`,
              alta: i === 0,
            }
          })
        : inf.claves.slice(0, 3).map((c, i) => ({ cifra: c.cifra, titulo: c.titulo.charAt(0).toUpperCase() + c.titulo.slice(1), impacto: c.detalle, alta: i === 0 })),
      pieAdelanto: `${inf.caso === 'revendida' ? '+ quién vende tu marca, ficha a ficha' : '+ lo que encuentra quien te busca'}${inf.mercados.length ? ' · lo más vendido de lo tuyo · lo que te llegaría por venta' : ''} · cómo lo haríamos`,
      preheader: `${inf.titular[0]} ${inf.titular[1]} · ${inf.claves.map((c) => `${c.cifra} ${c.titulo}`).join(' · ')}`,
      pieLegal: `Análisis hecho con datos públicos de Amazon y de tu web del ${fecha(inf.fecha)}.`,
    }
  }
  const v12 = inf.valoraciones[2]
  const altas = inf.oportunidades.filter((o) => o.prioridad === 'alta').length
  const top = inf.oportunidades.slice(0, 3)
  return {
    etiqueta: 'Análisis de tu cuenta de Amazon',
    titular: `Hemos revisado la cuenta de ${inf.vendedor.nombre} en Amazon.`,
    titular2: altas > 0 ? `${altas === 1 ? 'Un punto te está' : `${altas} puntos te están`} costando ventas.` : null,
    kpis: [
      [miles(inf.cifras.productos), 'productos en España', false],
      [inf.cifras.buyBox === null ? '—' : `${inf.cifras.buyBox} %`, 'Buy Box en tus ofertas', (inf.cifras.buyBox ?? 100) < 60],
      [v12.positivas === null ? '—' : `${v12.positivas} %`, 'positivas · 12 meses', (v12.negativas ?? 0) >= 10 && (v12.numero ?? 0) >= 10],
      [`${inf.cifras.mercadosActivos} / 5`, 'mercados con ventas', false],
    ],
    puntos: top.map((o) => ({ cifra: o.cifra, titulo: o.titulo, impacto: o.impacto ?? null, alta: o.prioridad === 'alta' })),
    pieAdelanto: `+ ${inf.productos.length} productos uno a uno${inf.competencia?.rivales.length ? ' · tu competencia directa' : ''}${inf.puedeEditarFichas ? ' · el cambio de SEO de julio de 2026' : ''} · por dónde empezaríamos`,
    preheader: `${altas > 0 ? `${altas} puntos que te están costando ventas` : 'Lo que hemos visto en tu cuenta'} · ${top.map((o) => `${o.cifra} ${o.titulo.toLowerCase()}`).join(' · ')}`,
    pieLegal: `Análisis hecho con datos públicos de Amazon del ${fecha(inf.fecha)}. No tenemos acceso a tu Seller Central.`,
  }
}

/** La parte de texto del correo (para quien no ve HTML) y lo que queda en el historial del lead */
export function textoCorreoAnalisis(inf: InformeDelCorreo, d: DatosCorreoAnalisis): string {
  const tel = d.comercial.telefono ? (/\+?\d[\d\s]{7,}/.exec(d.comercial.telefono)?.[0] ?? '').trim() : ''
  return [
    saludoDe(inf, d),
    '',
    d.entradilla?.trim() || entradillaFija(inf),
    '',
    ...piezasDe(inf).puntos.map((o) => `· ${o.cifra} ${o.titulo}`),
    '',
    `Ver el análisis completo: ${d.url}`,
    '',
    `${d.comercial.nombre} · Liberty Seller${tel ? ` · ${tel}` : ''}`,
    '',
    `Si no quieres recibir más correos nuestros: ${d.urlBaja}`,
  ].join('\n')
}

export function asuntoCorreoAnalisis(inf: InformeDelCorreo): string {
  if (esSinAmazon(inf))
    return inf.caso === 'revendida' ? `${inf.marca.nombre} ya se vende en Amazon (y no la vendes tú)` : `${inf.vendedor.nombre}: lo que se vende de lo tuyo en Amazon`
  const altas = inf.oportunidades.filter((o) => o.prioridad === 'alta').length
  return altas > 0
    ? `${inf.vendedor.nombre}: ${altas === 1 ? 'un punto te está' : `${altas} puntos te están`} costando ventas en Amazon`
    : `${inf.vendedor.nombre}: hemos revisado tu cuenta de Amazon`
}

export function correoAnalisisHtml(inf: InformeDelCorreo, d: DatosCorreoAnalisis): string {
  const base = d.base ?? 'https://app.libertyseller.com'
  const pz = piezasDe(inf)
  const nombre = esc(inf.vendedor.nombre)
  const tel = d.comercial.telefono ? (/\+?\d[\d\s]{7,}/.exec(d.comercial.telefono)?.[0] ?? '').trim() : ''
  const wa = d.comercial.whatsapp
    ? `https://wa.me/${d.comercial.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola ${d.comercial.nombre}, he visto el análisis de ${inf.vendedor.nombre} en Amazon y me gustaría saber más.`)}`
    : null
  const entradilla = d.entradilla?.trim() || entradillaFija(inf)
  const preheader = pz.preheader

  const kpi = (valor: string, rotulo: string, rojo = false) => `
    <td width="50%" style="padding:6px;" valign="top">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#16181C;border:1px solid #23262B;border-radius:10px;">
        <tr><td style="padding:12px 14px;">
          <div style="font:800 22px/1.1 Inter,Arial,sans-serif;color:${rojo ? '#F87171' : '#FFFFFF'};letter-spacing:-0.4px;">${esc(valor)}</div>
          <div style="font:700 10px/1.4 Inter,Arial,sans-serif;color:#8A8F98;text-transform:uppercase;letter-spacing:0.6px;padding-top:3px;">${esc(rotulo)}</div>
        </td></tr>
      </table>
    </td>`

  const fila = (o: Piezas['puntos'][number]) => `
    <tr><td style="padding:5px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#16181C;border:1px solid ${o.alta ? '#5A2A10' : '#23262B'};border-radius:10px;">
        <tr>
          <td width="92" valign="top" style="padding:14px 0 14px 14px;font:800 24px/1 Inter,Arial,sans-serif;color:${o.alta ? N : '#FFFFFF'};letter-spacing:-0.6px;">${esc(o.cifra)}</td>
          <td valign="top" style="padding:13px 14px 13px 8px;">
            <div style="font:700 14px/1.35 Inter,Arial,sans-serif;color:#FFFFFF;">${esc(o.titulo)}</div>
            ${o.impacto ? `<div style="font:600 12.5px/1.45 Inter,Arial,sans-serif;color:#FF9A57;padding-top:3px;">${esc(o.impacto)}</div>` : ''}
          </td>
        </tr>
      </table>
    </td></tr>`

  const boton = (href: string, texto: string, fondo: string, color: string, borde = fondo) => `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
      <tr><td align="center" bgcolor="${fondo}" style="border-radius:10px;border:1px solid ${borde};">
        <a href="${esc(href)}" target="_blank" style="display:inline-block;padding:15px 28px;font:800 14px/1 Inter,Arial,sans-serif;color:${color};text-decoration:none;text-transform:uppercase;letter-spacing:0.8px;border-radius:10px;">${texto}</a>
      </td></tr>
    </table>`

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${esc(asuntoCorreoAnalisis(inf))}</title>
</head>
<body style="margin:0;padding:0;background:#EDEAE5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EDEAE5;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FFFFFF;border-radius:16px;overflow:hidden;">

  <!-- cabecera -->
  <tr><td bgcolor="${NEGRO}" style="background:${NEGRO};padding:26px 32px 28px;border-top:3px solid ${N};">
    <img src="${base}/logos/logo.png" width="150" alt="Liberty Seller" style="display:block;border:0;width:150px;height:auto;">
    <div style="font:700 11px/1.4 Inter,Arial,sans-serif;color:${N};text-transform:uppercase;letter-spacing:1.6px;padding-top:26px;">● ${esc(pz.etiqueta)}</div>
    <div style="font:800 28px/1.15 Inter,Arial,sans-serif;color:#FFFFFF;letter-spacing:-0.8px;padding-top:10px;">${esc(pz.titular)}</div>
    ${pz.titular2 ? `<div style="font:800 28px/1.15 Inter,Arial,sans-serif;color:${N};letter-spacing:-0.8px;">${esc(pz.titular2)}</div>` : ''}
  </td></tr>

  <!-- entradilla -->
  <tr><td style="padding:28px 32px 6px;font:400 15.5px/1.65 Inter,Arial,sans-serif;color:#2A2622;">
    <p style="margin:0 0 14px;">${esc(saludoDe(inf, d))}</p>
    ${entradilla
      .split(/\n\s*\n/)
      .map((p) => `<p style="margin:0 0 12px;">${esc(p.trim())}</p>`)
      .join('')}
  </td></tr>

  <!-- adelanto del informe -->
  <tr><td style="padding:20px 32px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0E1013;border-radius:14px;">
      <tr><td style="padding:11px 16px;border-bottom:1px solid #1F2227;font:700 10.5px/1 Inter,Arial,sans-serif;color:#8A8F98;text-transform:uppercase;letter-spacing:0.6px;">
        <span style="color:#FF5F57;">●</span> <span style="color:#FEBC2E;">●</span> <span style="color:#28C840;">●</span>&nbsp;&nbsp;Resumen · datos del ${esc(fecha(inf.fecha))}
      </td></tr>
      <tr><td style="padding:10px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>${kpi(...pz.kpis[0])}${kpi(...pz.kpis[1])}</tr>
          <tr>${kpi(...pz.kpis[2])}${kpi(...pz.kpis[3])}</tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:4px 6px 2px;">
          ${pz.puntos.map(fila).join('')}
        </table>
      </td></tr>
      <tr><td style="padding:2px 16px 16px;font:600 12px/1.5 Inter,Arial,sans-serif;color:#8A8F98;text-align:center;">
        ${esc(pz.pieAdelanto)}
      </td></tr>
    </table>
  </td></tr>

  <!-- botón -->
  <tr><td style="padding:26px 32px 8px;" align="center">
    ${boton(d.url, 'Ver el análisis completo &rarr;', N, '#FFFFFF')}
    <div style="font:400 12.5px/1.5 Inter,Arial,sans-serif;color:${GRIS};padding-top:10px;">Es una página privada para ${nombre}. No hace falta registrarse.</div>
  </td></tr>

  <!-- comercial -->
  <tr><td style="padding:22px 32px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SOFT};border:1px solid ${LINEA};border-radius:14px;">
      <tr><td style="padding:20px 22px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td width="44" valign="middle"><div style="width:44px;height:44px;border-radius:22px;background:${N};font:800 18px/44px Inter,Arial,sans-serif;color:#FFFFFF;text-align:center;">${esc(d.comercial.nombre.charAt(0).toUpperCase())}</div></td>
          <td valign="middle" style="padding-left:12px;">
            <div style="font:700 15px/1.3 Inter,Arial,sans-serif;color:#141414;">${esc(d.comercial.nombre)}</div>
            <div style="font:400 13px/1.4 Inter,Arial,sans-serif;color:${GRIS};">Tu contacto en Liberty Seller${tel ? ` · ${esc(tel)}` : ''}</div>
          </td>
        </tr></table>
        <div style="font:400 14px/1.6 Inter,Arial,sans-serif;color:#2A2622;padding:14px 0 16px;">Si quieres saber más, escríbeme o llámame y te pongo en contacto con nuestro equipo de estrategia, que te lo explica todo. Sin compromiso: si no hay recorrido, te lo diremos.</div>
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          ${wa ? `<td style="padding-right:8px;"><a href="${esc(wa)}" target="_blank" style="display:inline-block;padding:12px 18px;background:#141414;border-radius:9px;font:800 12.5px/1 Inter,Arial,sans-serif;color:#FFFFFF;text-decoration:none;text-transform:uppercase;letter-spacing:0.6px;">WhatsApp</a></td>` : ''}
          ${tel ? `<td><a href="tel:${esc(tel.replace(/[^\d+]/g, ''))}" style="display:inline-block;padding:11px 18px;background:#FFFFFF;border:1px solid #141414;border-radius:9px;font:800 12.5px/1 Inter,Arial,sans-serif;color:#141414;text-decoration:none;text-transform:uppercase;letter-spacing:0.6px;">Llamar</a></td>` : ''}
        </tr></table>
      </td></tr>
    </table>
  </td></tr>

  <!-- pie -->
  <tr><td style="padding:24px 32px 28px;font:400 11.5px/1.6 Inter,Arial,sans-serif;color:#8A847C;">
    ${esc(pz.pieLegal)}<br>
    Liberty Seller · <a href="https://libertyseller.com" style="color:#8A847C;">libertyseller.com</a><br>
    Si no quieres recibir más correos nuestros, <a href="${esc(d.urlBaja)}" style="color:#8A847C;">date de baja aquí</a>.
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`
}

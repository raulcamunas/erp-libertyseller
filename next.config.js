/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  eslint: {
    ignoreDuringBuilds: true,
  },

  /**
   * NO ANUNCIAR CON QUÉ ESTÁ HECHO EL ERP.
   *
   * Antes toda respuesta llevaba `X-Powered-By: Next.js` (comprobado con
   * `curl -D - /auth/login`). No es un agujero por sí mismo, pero le ahorra a
   * quien busca objetivos el paso de averiguar contra qué está atacando, y es
   * lo primero que se filtra por versión en los buscadores de servidores
   * expuestos. Quitarla no cambia nada de lo que hace la aplicación.
   */
  poweredByHeader: false,

  /**
   * CABECERAS DE SEGURIDAD.
   *
   * LO QUE PASABA ANTES (medido con curl contra el servidor):
   *
   *     $ curl -D - -o /dev/null http://SERVIDOR/auth/login
   *     HTTP/1.1 200 OK
   *     X-Powered-By: Next.js
   *
   * Y NADA MÁS: ni una sola cabecera de seguridad en toda la aplicación
   * (grep de strict-transport|x-frame|x-content-type|referrer-policy|
   * permissions-policy|content-security -> 0 coincidencias).
   *
   * Cada una para un ataque CONCRETO. Ninguna cambia un píxel ni una
   * funcionalidad: la aplicación ya va por HTTPS y no se embebe en un iframe de
   * otro sitio.
   */
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            /**
             * QUÉ IMPIDE: que alguien en la misma red (un wifi, un proxy)
             * fuerce la primera visita por http:// y lea la sesión. La cookie
             * de @supabase/ssr NO lleva el atributo `secure`, así que en una
             * petición en claro viaja entera y con ella se entra al ERP.
             * Con HSTS el navegador se niega a hablar en claro con este
             * dominio, así que el degradado no llega a ocurrir.
             */
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
          {
            /**
             * QUÉ IMPIDE: clickjacking. Sin esto, una página del atacante puede
             * cargar /dashboard en un iframe invisible encima de un botón
             * cualquiera y conseguir que un admin con la sesión abierta pulse
             * lo que no quiere (borrar, enviar, cambiar precios).
             * DENY y no SAMEORIGIN porque el ERP no se embebe a sí mismo en
             * ningún sitio.
             */
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            /**
             * QUÉ IMPIDE: que el navegador adivine el tipo de un fichero y lo
             * ejecute como si fuera otra cosa. Es lo que convierte un CSV o un
             * XLSX subido por un cliente en HTML con script cuando se sirve de
             * vuelta.
             */
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            /**
             * QUÉ IMPIDE: que las URL del ERP —que llevan identificadores de
             * cliente, de factura y de informe— salgan en la cabecera Referer
             * hacia sitios de fuera al pinchar un enlace externo. Con
             * strict-origin-when-cross-origin fuera solo va el origen, nunca la
             * ruta. Dentro del ERP la cabecera sigue completa, así que no
             * cambia nada de la navegación.
             */
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            /**
             * QUÉ IMPIDE: que un script inyectado (o un iframe de terceros)
             * encienda la cámara, la ubicación o pida un pago en nombre del
             * usuario.
             *
             * `microphone=(self)` NO es un descuido: el ERP graba audio de
             * verdad en components/agenda/AudioRecordingField.tsx. Poniendo
             * `microphone=()` esa grabación DEJARÍA DE FUNCIONAR, que es
             * justo lo que no puede pasar.
             */
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(self), geolocation=(), payment=()',
          },
          {
            /**
             * CSP PARCIAL, Y A PROPÓSITO PARCIAL.
             *
             * Van SOLO tres directivas, y las tres gobiernan cosas que esta
             * aplicación NO USA. Por eso se pueden poner en modo de bloqueo de
             * verdad —no en `Report-Only`— sin riesgo de dejar una pantalla en
             * blanco:
             *
             *   · base-uri 'self'   QUÉ IMPIDE: que un `<base href="//atacante">`
             *     inyectado cambie a dónde apuntan TODAS las rutas relativas de
             *     la página de golpe —los scripts de Next incluidos— y se lleve
             *     la sesión sin haber ejecutado ni una línea de JavaScript.
             *     Es el multiplicador clásico de cualquier XSS. COMPROBADO que
             *     no rompe nada: no hay ni un `<base` en app/, components/ ni
             *     lib/, y Next no lo emite.
             *
             *   · object-src 'none' QUÉ IMPIDE: colar contenido ejecutable por
             *     `<object>`, `<embed>` o `<applet>`, que es la vía por la que
             *     un fichero subido por un cliente se convierte en código.
             *     COMPROBADO: cero `<object` y cero `<embed` en todo el repo.
             *
             *   · frame-ancestors 'none' QUÉ IMPIDE: lo mismo que la
             *     X-Frame-Options de arriba —clickjacking sobre /dashboard—,
             *     pero por la vía moderna, que es la que respetan los
             *     navegadores que ya ignoran X-Frame-Options.
             *
             * LO QUE NO ESTÁ Y POR QUÉ: NO hay `script-src` ni `style-src`.
             * Meterlos es lo que de verdad frena un XSS, pero Next inyecta
             * scripts en línea para hidratar y framer-motion escribe estilos en
             * línea, así que exige un nonce por petición desde el middleware y
             * una vuelta al ERP pantalla por pantalla en un navegador —con
             * sesión, incluidas las de gráficas y las de subir ficheros—.
             * Eso es un trabajo aparte y sin verificar entero NO se pone: una
             * CSP de scripts mal puesta no degrada la aplicación, la deja
             * muerta. `frame-src` tampoco se toca, porque
             * components/invoices/InvoiceDetail.tsx pinta la factura en un
             * <iframe srcDoc>.
             */
            key: 'Content-Security-Policy',
            value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
          },
        ],
      },
    ]
  },
  experimental: {
    /**
     * `ssh2` NO SE EMPAQUETA: se deja como dependencia de Node en el servidor.
     *
     * Lo usa el conector de SFTP (lib/stock-sync/origenes/sftp.ts) a través de
     * ssh2-sftp-client. Sin esta línea, `next build` FALLA — no da un aviso,
     * falla:
     *
     *     ./node_modules/ssh2/lib/protocol/crypto/build/Release/sshcrypto.node
     *     Module parse failed: Unexpected character '<binario>' (1:0)
     *
     * Porque ssh2 trae un binding NATIVO opcional (`sshcrypto.node`, que acelera
     * el cifrado) y webpack intenta leerlo como si fuera JavaScript. El binding
     * es opcional de verdad: ssh2 lo carga dentro de un try/catch y si no está
     * usa la implementación en JavaScript puro, que es lo que va a pasar en el
     * contenedor de Alpine. Pero para que ese try/catch llegue a ejecutarse, el
     * módulo tiene que quedarse FUERA del paquete de webpack.
     *
     * Con `output: 'standalone'` esto además es lo correcto por otro motivo: el
     * trazado de ficheros de Next copia al contenedor los paquetes externos con
     * lo que necesiten, mientras que un paquete metido a la fuerza en el bundle
     * se habría dejado atrás el fichero binario de todas formas.
     */
    serverComponentsExternalPackages: ['ssh2', 'ssh2-sftp-client'],
  },
}

module.exports = nextConfig

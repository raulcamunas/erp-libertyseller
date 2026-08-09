/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  eslint: {
    ignoreDuringBuilds: true,
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

/** Portas locais dos servidores da tarefa: livre (dá para escutar) e aberta (algo responde). */
import { createConnection, createServer } from 'node:net'

/** Dá para escutar na porta (em todas as interfaces, como um `pnpm dev` costuma fazer). */
export function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ port, exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}

function connects(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })
    const done = (ok: boolean): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/** Algo responde na porta em localhost (IPv4 ou IPv6: o Vite às vezes só escuta no `::1`). */
export async function portOpen(port: number, timeoutMs = 500): Promise<boolean> {
  const [v4, v6] = await Promise.all([
    connects('127.0.0.1', port, timeoutMs),
    connects('::1', port, timeoutMs)
  ])
  return v4 || v6
}

// Só Linux, só dev: cria ~/.local/share/applications/orkio-dev.desktop para a doca/barra de
// tarefas (GNOME Wayland e outros) mostrar o ícone do Orkio em vez da engrenagem genérica.
// Idempotente; oculto no menu de apps (NoDisplay). Rodado pelo `predev`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'linux') process.exit(0)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'applications')
const file = join(dir, 'orkio-dev.desktop')
const content = `[Desktop Entry]
Type=Application
Name=Orkio (dev)
Icon=${join(root, 'resources', 'icon.png')}
Exec=sh -c "cd '${root}' && pnpm dev"
StartupWMClass=orkio-dev
NoDisplay=true
Terminal=false
`
let current = ''
try {
  current = readFileSync(file, 'utf8')
} catch {
  /* ainda não existe */
}
if (current !== content) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, content)
  console.log(`[orkio] ícone de dev registrado em ${file}`)
}

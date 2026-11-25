/**
 * Superfícies repetidas (classes do Tailwind), para não copiar a mesma string em cada tela:
 * - `section`: bloco de uma tela de configuração/formulário (título + conteúdo), como `SettingsCard`;
 * - `list`: caixa de uma lista ou tabela (linhas com divisórias dentro).
 * Componente com título usa `SettingsCard`/`SettingsGroup`; estas são para quem monta o próprio miolo.
 */
export const SURFACE = {
  section: 'flex flex-col gap-4 rounded-xl border border-border-soft bg-card p-5',
  list: 'overflow-hidden rounded-xl border border-border-soft bg-card'
} as const

/** "Sincronizar tarefas do Notion!" → "sincronizar-tarefas-do-notion" (máx. 40 caracteres). */
export function slugify(title: string, max = 40): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const cut = slug.slice(0, max).replace(/-+$/g, '')
  return cut || 'tarefa'
}

/** Branch da tarefa: `<ID>/<slug-do-título>` (o ID liga a branch às automações da 2D/3B). */
export function taskBranchName(displayId: string, title: string): string {
  return `${displayId}/${slugify(title)}`
}

# Changelog

Mudanças do Orkio por versão. Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
versões em [SemVer](https://semver.org/lang/pt-BR/). Escreva em "Não lançado" a cada mudança
visível; o `pnpm release` move a seção para a versão nova e as notas do release saem daqui.

## [Não lançado]

### Adicionado

- Agentes embutidos: Implementador, Revisor, QA, Triagem, Documentador e Corretor de PR já vêm
  prontos em todo projeto, sem criar arquivo nem aprovar. Para ajustar um, use "Duplicar".
- Orquestrador de tarefas (tela Agentes): puxa tarefas da coluna de fila para os agentes, por
  prioridade do Notion, e passa cada uma para a etapa seguinte quando o fluxo da etapa termina bem
  (ex.: Prioridades → Em andamento com o Implementador → Revisando com o Revisor → Revisado).
  Respeita o limite de tarefas ao mesmo tempo e a capacidade de cada agente; gates, push e falhas
  continuam parando em você. "Configurar orquestrador" sugere o caminho a partir do quadro.

## [0.2.1] - 2026-11-21

### Corrigido

- O `/spec` que atualiza uma task que já existia em `backlog/tasks/` (em vez de criar uma nova)
  agora vincula a tarefa a ela; antes o passo falhava com "terminou sem criar task".
- Um passo do alva-flow que usa a task do Backlog não roda mais com o argumento vazio quando a task
  não foi vinculada: o fluxo para antes de gastar uma execução e oferece "Rodar /spec de novo".

## [0.2.0] - 2026-11-21

### Adicionado

- Instaladores para macOS (Apple Silicon e Intel) e Windows, publicados por CI a cada versão.
- Atualizações automáticas: o Orkio procura versões novas ao abrir e a cada 4 horas, baixa em
  segundo plano e instala ao reiniciar, sem interromper execuções do Claude Code, fluxos ou
  escritas no Notion.
- Tela Configurações com Atualizações (canal Estável ou Beta) e Sobre.
- "O que há de novo" depois de cada atualização.
- A sessão do Claude Code na tarefa agora é uma conversa: respostas completas em markdown,
  ferramentas agrupadas numa frase ("Rodou 6 comandos · Editou 2 arquivos") que abre os detalhes,
  falhas e bloqueios em destaque e o fechamento com turnos, tempo e custo.
- Spec e plano da task do Backlog.md na própria tarefa: os gates "Aprovar spec" e "Aprovar plano"
  (novos nos fluxos Alva) mostram o texto, os critérios e as perguntas em aberto antes de você
  aprovar, e a seção "Spec e plano" deixa ler a task a qualquer hora.
- Diff legível nos gates e em "Ver diff": resumo de arquivos e +/−, um cartão por arquivo com as
  linhas adicionadas e removidas coloridas e numeradas, arquivos novos, renomeados e binários
  indicados, e os arquivos novos ainda fora do git listados.
- Quando um passo do fluxo falha ou o fluxo para, um cartão explica o que aconteceu e o que fazer:
  o motivo registrado, a causa provável (arquivos fora de commit, credenciais do git, push
  recusado, tempo esgotado...) e as saídas: "Rodar /commit de novo", "Ver o que falta commitar",
  "Ver a sessão do passo", Retomar, Pular e Cancelar. Com um fluxo em andamento, o botão manual do
  Claude Code dá lugar a uma explicação em vez de falhar ao clicar.

## [0.1.0] - 2026-11-20

### Adicionado

- Conexões com Notion (OAuth ou token) e GitHub (Device Flow ou token).
- Projetos locais ligados ao GitHub, quadro por projeto sincronizado com o Notion e automações
  pelos eventos do git/GitHub.
- Claude Code por tarefa (worktree isolado, permissões pelo Orkio), fluxos de tarefa, integração
  com o alva-flow e entrega (push da branch da tarefa, review, CI).

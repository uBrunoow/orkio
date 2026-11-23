# Changelog

Mudanças do Orkio por versão. Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
versões em [SemVer](https://semver.org/lang/pt-BR/). Escreva em "Não lançado" a cada mudança
visível; o `pnpm release` move a seção para a versão nova e as notas do release saem daqui.

## [Não lançado]

## [0.2.8] - 2026-11-23

### Mudado

- Interface nova: o menu tem só Quadro, Agentes e Configurações. A lista lateral mostra o que
  espera você, o que está rodando e o que fazer a seguir no projeto; o sino reúne o que espera
  você em todos os projetos e as PRs com atenção (a Visão geral saiu).
- A tarefa abre numa tela própria: as fases no topo (Spec, Plano, Implementar, Revisão, PR), a
  conversa com o Claude Code no centro e, ao lado, o painel da fase (spec, plano, mudanças, PR e
  CI, detalhes). Em janelas estreitas o painel vai para cima da conversa.
- Configurações reúnem Integrações (em lista, com o estado de cada uma), Projetos (com as
  checagens e "Continuar configuração"), Quadro e automações (abas Colunas, Automações com
  quantas vezes cada regra disparou na semana, Fluxos e Entrega) e Agentes do projeto (regras e
  orquestrador).
- Agentes em cards com o que cada um está fazendo, atividade das últimas 12 horas e vagas.
- Primeiros passos: do zero à primeira tarefa em sete passos, com o estado real de cada um; dá
  para parar e continuar depois pela lista lateral.
- Visual novo em todas as telas (shadcn/ui + Tailwind): mais denso, com divisórias finas, tabelas
  com cabeçalho de coluna e IDs em fonte mono, igual ao mockup aprovado.
- Conectar o GitHub passou a ser obrigatório nos Primeiros passos.

### Adicionado

- "Buscar tarefa" procura no banco de Tarefas do Notion inteiro (título ou ID, de qualquer pessoa
  e projeto); a tarefa que não está no quadro abre no Notion.
- A conta conectada aparece no rodapé da lista lateral e no canto da barra, com "Sair" (desconecta
  o GitHub e o Notion deste computador).

### Removido

- Contexto do Claude: o contexto vem só da tarefa (briefing do Notion).

## [0.2.7] - 2026-11-23

### Mudado

- fix(notion): abre links das páginas em notion.com.

## [0.2.6] - 2026-11-23

### Mudado

- O quadro mostra só as tarefas em que você é responsável no Notion, não as de todo o projeto.
  O campo Responsável passa a ser obrigatório no mapeamento das Tarefas (Integrações); a conexão
  precisa ser da sua conta ("Entrar com Notion" ou token pessoal).

### Corrigido

- Com muitos plugins do Claude Code instalados, o catálogo de comandos ficava sem os comandos dos
  plugins e a tela alva-flow dizia que faltava o plugin, mesmo instalado e atualizado.

## [0.2.5] - 2026-11-23

### Mudado

- O banco de Tarefas do Notion não precisa mais de uma propriedade de ID: sem ela, a tarefa é a
  página do Notion. A branch e a PR se ligam à tarefa pela branch que o Orkio cria, pelo link da
  tarefa do Notion no corpo da PR ou por "Vincular branch" em Detalhes > GitHub.
- Branches novas seguem a convenção `feat/`, `fix/` ou `hotfix/` (com o ID do Notion quando há:
  `feat/ORK-142-listar-pedidos`). O tipo padrão é `feat/`; em "Nova sessão…" dá para trocar.
  Branches antigas (`ORK-142/...`) continuam funcionando.
- Push: `hotfix/<nome>` de uma tarefa pode ir para o GitHub; `hotfix` sozinho, `hotfix-x` e
  `release*` continuam protegidos.

## [0.2.4] - 2026-11-23

### Corrigido

- Linux: o atalho do Orkio aparece com o ícone na busca e no dock (o pacote só trazia o ícone
  em 1024×1024, tamanho que o GNOME não procura).

## [0.2.3] - 2026-11-23

### Adicionado

- Linux (x64): AppImage, que roda em qualquer distro e se atualiza sozinho, e .deb para
  Ubuntu/Debian. O site sugere o AppImage para quem abre no Linux. Os tokens ficam no chaveiro do
  sistema (GNOME Keyring ou KWallet).

## [0.2.2] - 2026-11-23

### Adicionado

- Piloto automático na sessão da tarefa: cada passo de um fluxo aparece na conversa como um turno
  do piloto (o fluxo, "passo 2 de 6" e o comando que ele mandou ao Claude Code), seguido da
  resposta do Claude. No fim da sessão, o plano do fluxo como uma lista de tarefas: feito, agora,
  esperando você e a seguir.
- "Copiar diagnóstico" em Configurações > Sobre: versões, banco local, filas e conexões, sem
  tokens, contas, títulos ou caminhos, para colar ao pedir ajuda.

- Responder ao Claude quando o fluxo para: o cartão de problema tem "Responder e continuar", que
  manda a sua resposta na mesma sessão do passo (por exemplo, as respostas das perguntas do
  `/spec` que ficaram sem resposta) e o fluxo segue dali, sem rodar o comando do zero.

- Agentes embutidos: Implementador, Revisor, QA, Triagem, Documentador e Corretor de PR já vêm
  prontos em todo projeto, sem criar arquivo nem aprovar. Para ajustar um, use "Duplicar".
- Orquestrador de tarefas (tela Agentes): puxa tarefas da coluna de fila para os agentes, por
  prioridade do Notion, e passa cada uma para a etapa seguinte quando o fluxo da etapa termina bem
  (ex.: Prioridades → Em andamento com o Implementador → Revisando com o Revisor → Revisado).
  Respeita o limite de tarefas ao mesmo tempo e a capacidade de cada agente; gates, push e falhas
  continuam parando em você. "Configurar orquestrador" sugere o caminho a partir do quadro.

### Mudado

- Todo merge na `main` lança uma versão (patch por padrão); o rótulo da PR só escolhe outro tipo,
  e `release:none` não lança.
- Fluxos de tarefa: a barra de salvar fica fixa no rodapé, com quantas alterações não salvas há e
  "Descartar alterações".
- Quadro: quando a verificação do GitHub falha, a linha das automações diz quando tenta de novo.
- Quadro: com a tarefa aberta ao lado, dá para rolar as últimas colunas para fora de baixo dela; o
  ponto de cada coluna usa a cor escolhida para a etapa; a branch longa no card termina em "…".
- Aprovação no fluxo: o cartão diz o que acontece ao aprovar e ao recusar; a tarefa em tela cheia
  abre no fim da conversa, onde está a decisão.
- Termos mais simples: "Pasta de trabalho" (antes "Ambiente"), "Documentos para o Notion" (antes
  "Artefatos"), "Modelos do alva-flow" e "resumo da tarefa" (antes "briefing").
- Mesma largura nas telas de formulário e nas de lista; a barra de salvar não tem mais sombra e
  "Salvar fluxo" fica desligado sem alterações.
- A tarefa virou uma sessão: uma conversa só com os eventos do Notion e do GitHub, os passos do
  fluxo, as respostas inteiras do Claude Code em cada execução e as suas decisões. Logo depois de
  cada execução aparece o que ela produziu: a spec ou o plano do Backlog.md (/spec, /plan) e os
  arquivos, commits e o diff da implementação.
- Campo de mensagem no fim da sessão: o que você escreve continua a última conversa do Claude Code
  na tarefa, no mesmo ambiente e sem repetir o briefing. `/` sugere os comandos instalados e
  Ctrl/Cmd+Enter envia. "Nova sessão…" abre o formulário completo (briefing editável, modo,
  comando, rodar como agente).
- "Em que pé está" no topo da tarefa: Spec, Plano, Código, PR, Revisão e Merge, lidos do
  Backlog.md, das execuções e do GitHub.
- O pedido que espera você aparece no fim da conversa, logo acima do campo; o aviso do topo leva
  até ele.
- No painel do Quadro, abas Sessão, Mudanças e Detalhes; na tela cheia, o estado (etapa,
  mudanças, GitHub, documentos, agente, opções) fica numa coluna à direita e o histórico completo
  fica recolhido.

### Corrigido

- O pacote do macOS não quebra mais quando o certificado de assinatura não está configurado (o
  release ficava parado em rascunho).
- A pergunta do Claude Code não é mais negada depois de 10 minutos: ela espera a sua resposta por
  até 24 horas, em "Esperando você". Pedidos de permissão continuam expirando em 10 minutos.
- Login com Notion: os erros do serviço de login dizem a causa (site fora do alcance, intermediário
  local parado em dev ou endereço de retorno não liberado no intermediário) em vez de sempre pedir
  para verificar a internet. Um build com a URL do intermediário trocada pelo endereço de retorno
  do app esconde o login com Notion em vez de falhar a cada tentativa.
- "Rodar como <agente>" desmarcado no formulário do Claude Code agora vale (a escolha não chegava
  ao app).

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

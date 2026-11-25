# Changelog

Mudanças do Orkio por versão. Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
versões em [SemVer](https://semver.org/lang/pt-BR/). Escreva em "Não lançado" a cada mudança
visível; o `pnpm release` move a seção para a versão nova e as notas do release saem daqui.

## [Não lançado]

## [0.2.16] - 2026-11-25

### Adicionado

- Configurações reorganizadas: menu lateral em grupos (Básico, Conexões, Agentes e ferramentas,
  Projeto, App) com "Buscar configuração", e cada seção diz no topo a quem a mudança vale. Seções
  novas: Geral (modelo padrão das sessões, se o Claude Code edita sozinho ou pergunta antes quando
  não há agente, decisões "sempre neste projeto" para revogar, privacidade), Aparência (reduzir
  movimento, tamanho do texto), Notificações (aviso do sistema, som, projetos silenciados), Atalhos
  (a lista e um atalho global para trazer o Orkio para a frente), Terminal, Provedores e uso (o
  Claude Code e o medidor de uso) e Diagnóstico ("Conferir tudo", copiar o diagnóstico e o espaço
  usado pelo Orkio).
- **Segredos**: guarde tokens e chaves com a criptografia do sistema. Depois de salvo, o valor não
  aparece de novo; você escolhe quais agentes e servidores MCP podem usar cada um, e o Orkio só o
  põe como variável de ambiente deles na hora de rodar. Nunca vai para o log.
- **Servidores MCP**: catálogo com GitHub, Notion, Linear, Sentry, Context7 e Playwright
  ("Adicionar" em um clique, escolhendo o segredo), os servidores que o seu Claude Code já carrega
  (só leitura, com "Copiar para o Orkio") e servidores feitos à mão. Todo servidor chega desligado:
  o comando só roda depois que você liga, para todas as execuções ou só para os agentes escolhidos.
- **Skills**: veja as skills que o Claude Code enxerga no projeto e desligue as que não quer nas
  execuções do Orkio (no seu terminal continuam todas).

### Alterado

- O liga/desliga do medidor de uso do Claude mudou de Atualizações para Configurações › Provedores e uso.

## [0.2.15] - 2026-11-25

### Mudado

- feat(agentes): editor simples, memória por agente e revisão até ficar limpo (Fase 3).

## [0.2.14] - 2026-11-25

### Mudado

- feat(sessao): terminal embutido, Continuar no Claude, editar mensagem e ramificar daqui (Fase 2).

## [0.2.13] - 2026-11-25

### Mudado

- feat(tarefas): "Como deve rodar?" com fluxos nativos, configuração por tarefa e kanban derivado (Fase 1).

## [0.2.12] - 2026-11-25

### Adicionado

- Barra do app com os menus Sessão, Ir, Janela e Ajuda: cada item mostra o atalho e fica apagado
  quando não dá para usar agora.
- Abas: cada tela e cada tarefa abre numa aba. Feche com Ctrl/⌘+W (ou o botão do meio), reabra com
  Ctrl/⌘+Shift+T, passe de uma para outra com Ctrl+Tab e arraste para reordenar. As abas voltam
  quando você reabre o Orkio. "Nova aba" (Ctrl/⌘+T) abre um ponto de partida com as telas e o que
  espera você.
- Dock à esquerda com as telas (Quadro, Tarefas, Agentes, Configurações) e o botão para mostrar ou esconder
  a lista de tarefas (Ctrl/⌘+B).
- A paleta (Ctrl/⌘+K) agora faz qualquer coisa: além de tarefas, telas e projetos, roda as ações
  dos menus (nova aba, verificar agora, abrir o que espera você, conectar o Notion...). Ctrl/⌘+P
  busca tarefas no Notion e Ctrl/⌘+Shift+O troca de projeto.
- O sino separa "Precisa de você" de "Concluído" (fluxos e execuções que terminaram), com
  "Limpar concluídos".
- Medidor de uso do Claude na barra (experimental): quanto da janela de 5 horas e da semanal a sua
  assinatura já usou e quando renovam. O Orkio lê do login do Claude Code neste computador, só na
  hora e sem guardar nada; desligue em Configurações › Atualizações ou no próprio medidor.
- Ajuda › Atalhos do teclado lista todos os atalhos.
- "Como deve rodar?" em cada tarefa: **Rodar uma vez** (o Claude faz, um revisor confere, você vê o
  diff e a PR sai), **Com aprovação** (a spec e o plano passam por você antes de mexer no código) ou
  **Quebrar em passos** (o plano vira fatias pequenas, feitas uma de cada vez). Funcionam sem o
  plugin alva-flow; os fluxos Alva continuam como opção.
- Cada coluna do quadro define o padrão ("Como as colunas rodam", na tela Tarefas) e cada tarefa
  troca o que quiser na aba Detalhes, ou ao mover o card para uma coluna que roda: o modo, quem
  revisa (outro agente; quem implementa nunca revisa o próprio trabalho), o modelo e se pede
  evidência. Cada item diz se veio da coluna ou foi escolhido para a tarefa, e fica travado
  enquanto o fluxo roda.
- Tela **Tarefas** (Ctrl/⌘+2): em que pé está cada tarefa em que os agentes mexeram — Precisa de
  você, Trabalhando, Aguardando, Em revisão (com CI falhando, mudanças pedidas, conflito ou pronta)
  e Concluído —, calculado do fluxo e da PR, em Kanban ou Lista, com os filtros "Em andamento" e
  "Precisa de atenção". O quadro do Notion continua sendo o do time.
- **Terminal dentro do Orkio**: a aba "Terminal" da tarefa (Ctrl/⌘+Shift+J, ou "Terminal no Orkio"
  em Detalhes) abre um terminal na pasta de trabalho da tarefa, já na branch dela. Trocar de aba não
  fecha nada: o que rodou continua lá quando você volta.
- **Continuar no Claude**: quando o Orkio empaca (uma permissão que ele não consegue resolver, por
  exemplo), o botão ao lado do campo da sessão pausa o que está rodando e abre essa mesma conversa
  do Claude Code no terminal, para você resolver na mão. Enquanto ela está com você, o Orkio não
  roda nada na tarefa, e a tarefa aparece como "Com você no terminal" no sino e na tela Tarefas.
  Para devolver: "O Claude continua o passo" (ele retoma de onde você parou) ou "Passo feito" (o que
  você fez conta como o passo e o fluxo segue). No terminal valem as configurações do seu Claude
  Code, não as regras do Orkio.
- **Editar mensagem** e **Ramificar daqui** na conversa da tarefa: editar devolve o seu texto ao campo
  e a conversa volta até antes dele; ramificar abre uma conversa nova a partir de uma resposta do
  Claude. Os arquivos da pasta de trabalho continuam como estão.
- **Criar agente ficou simples**: cor, nome, "O que faz?", instruções (com "Começar de" um modelo:
  implementar, revisar código, escrever testes, documentar) e o modelo, com a prévia do card ao
  lado, mudando enquanto você escreve. No **Avançado**: nome curto, grupo, "O que ele pode fazer
  sozinho?" em cartões (edita arquivos sozinho, pede antes de agir ou só lê — e isso vale de
  verdade nas execuções), comando preferido (já vem escolhido quando você roda como ele), limites,
  entrega e fluxo preferido. O card da lista mostra o que o agente faz e o grupo.
- **Memória dos agentes**: cada agente guarda notas curtas que voltam no início das próximas
  conversas dele. Ele mesmo anota o que vai servir de novo (preferências, convenções do projeto) e
  você vê, edita, arquiva ou apaga em Agentes › Memória (botão com o cérebro no card). Notas podem
  valer em todo lugar ou só no projeto, e ter validade; segredos são apagados ao gravar e o
  histórico deixa voltar para uma versão anterior.
- **Revisão até ficar limpo** nos fluxos nativos: o revisor (outro agente, só leitura) responde com
  Bloqueios, Detalhes e Evidência; quem implementou corrige os bloqueios e o revisor olha de novo,
  até não sobrar bloqueio (no máximo 3 rodadas). Cada rodada fica em `.orkio/revisao/rodada-N.md`.
  Se os mesmos bloqueios voltam, o fluxo para como "Travado"; no limite de rodadas, "Esgotado".

### Alterado

- O revisor não pede mais a sua aprovação a cada `git diff`: o Orkio grava o diff da tarefa para
  ele antes da revisão, e ler o git na pasta da tarefa passa sozinho nos passos só de leitura. O
  limite por dia e de fluxos ao mesmo tempo do revisor agora também vale para os passos de revisão
  (sem vaga, a revisão espera e começa sozinha).
- Pontos de aprovação: "Pedir ajustes" virou **Pedir mudanças** (o seu comentário volta para o
  passo anterior sem perder o que já foi feito). O gate do diff dos fluxos nativos também aceita
  "Pedir mudanças", além de Aprovar e Recusar.
- Finais honestos: um fluxo termina como Concluído, Nada a fazer, Bloqueado, Esgotado, Travado,
  Falhou ou Cancelado (antes, quase tudo era "Concluído" ou "Cancelado"). Esgotado, travado e
  falhou vão para "Precisa de você" na tela Tarefas; encerrar um fluxo parado por falha conta como
  "Falhou".

- A conversa da tarefa ficou mais compacta: as rodadas de ferramentas viram uma linha discreta
  ("Rodou 3 comandos · Usou 1 ferramenta") que abre a lista, e o texto do Claude aparece inteiro.
- Ctrl/⌘+W fecha a aba, não mais a janela; o menu nativo do sistema saiu (no macOS ficam só o menu
  do app e Editar).
- Atalhos das telas: Quadro Ctrl/⌘+1, Tarefas Ctrl/⌘+2, Agentes Ctrl/⌘+3, Configurações Ctrl/⌘+4.

## [0.2.11] - 2026-11-24

### Alterado

- "O que há de novo" abre num modal (depois de atualizar e em Configurações › Atualizações), em vez
  de um painel no topo da página.

## [0.2.10] - 2026-11-24

### Adicionado

- Integrações › Orkio bot: mostra se o GitHub App que publica as revisões (orkio[bot]) está
  instalado no repositório de cada projeto, com o botão "Instalar no GitHub", antes de a primeira
  revisão falhar.

## [0.2.9] - 2026-11-24

### Adicionado

- Modelo e raciocínio: escolha o modelo do Claude Code (padrão, Fable, Opus, Sonnet, Haiku ou
  outro nome) e o raciocínio (Baixo a Máximo) no campo da sessão, só para a próxima mensagem, no
  perfil de cada agente e em cada passo dos fluxos. O raciocínio aparece com o Claude Code 2.1.300
  ou mais novo. A conversa mostra o modelo e o raciocínio usados.
- Anexos no campo da sessão: até 5 arquivos por mensagem (imagens, PDF, Markdown e texto, até
  10 MB cada), lidos pelo Claude Code dentro da pasta da tarefa.
- Subagentes visíveis: quando o Claude Code delega trabalho, a conversa mostra cada subagente,
  o estado dele e as ferramentas que usou; acima do campo, "Esperando N subagentes".
- Custo por mensagem: cada execução mostra o que ela custou, não o total da sessão. Na primeira
  vez que uma sessão antiga é retomada, o custo mostrado é o acumulado da sessão (uma vez).
- Botão "Abrir PR" na aba PR & CI (e no painel Ambiente): envia a branch da tarefa (com a sua
  aprovação) e roda o /alva-flow:pr; sem o alva-flow, envia a branch e abre a página para criar a
  PR no GitHub. Quando o Claude tenta fazer push e o Orkio bloqueia, o aviso na conversa já traz o
  "Abrir PR".
- Cartão da PR ao passar o mouse no chip da PR: título, autor, há quanto tempo, linhas e arquivos
  alterados, revisão e CI.
- Painel "Ambiente" na tarefa: projeto, pasta e branch, "Abrir terminal aqui" (terminal do
  sistema na pasta da tarefa), editores, quanto do contexto do Claude a conversa já usa e as
  mudanças (+N −M) com a PR ou o "Abrir PR".
- "Manter o computador acordado enquanto agentes trabalham" (Configurações › Atualizações ›
  Energia): impede a suspensão só enquanto o Claude Code ou um fluxo roda.
- Aba "Revisão" na tarefa com os comentários da PR (texto, autor, arquivo e linha, resolvidos ou
  não) e as revisões; imagens dos comentários aparecem como texto, sem carregar nada.
- Revisão publicada como orkio[bot]: o fluxo "Alva: revisão publicada" roda o /review, o agente
  resume a revisão (sem mexer no código) e o Orkio mostra o tipo ("Pedir alterações" ou
  "Comentar"), o resumo e os comentários por linha, como texto exato (sem HTML nem imagens);
  aprovado, publica na PR pelo site do Orkio
  (precisa do GitHub App do Orkio instalado no repositório). Comentários fora do diff aparecem
  como aviso e não são publicados. O Orkio nunca aprova PRs.
- Sem configurar nada: em projetos com os fluxos Alva, a coluna Revisando ganha o "Alva: revisão
  publicada" e a Revisado o "Alva: comentários da PR" (só colunas sem fluxo; seus fluxos não
  mudam). As cópias antigas dos fluxos Alva passam para a versão nova; se a cópia tinha mudanças,
  ela fica guardada como "<nome> (cópia anterior)", sem coluna. Tudo fica no histórico de
  configuração.

### Mudado

- Integrações em grade de cartões, por seção (Tarefas, Código, Agentes de código), com busca
  (atalho "/"), "N de M prontas" e o próximo passo pendente já aberto.
- Piloto automático na barra de fases: clicar nas fases abre o plano do fluxo (passos feitos, o de
  agora e os próximos) e "Cancelar fluxo"; no fim da conversa fica só uma linha com "Ver plano".
  Cada fase aparece uma vez. Em janelas estreitas, só a fase de agora mostra o nome (as feitas
  ficam com ✓).
- Comentários da PR: na coluna Revisado, o agente lê os comentários e propõe um plano de correção
  (sem mexer no código); você aprova, pede ajustes (até 3 vezes, pelo cartão ou pelo campo da
  sessão) ou recusa, e só então ele corrige, commita e responde as threads. Para usar nos fluxos já
  criados, "Recriar fluxos Alva" na tela alva-flow.
- Fluxos de tarefa: passo com pedido em texto (em vez de um comando), opção "Só leitura" e gate
  que mostra o resultado do Claude Code com "Pedir ajustes…".
- O orquestrador não puxa mais tarefas de Prioridades sozinho: a tarefa só começa quando você a
  move para a primeira etapa de trabalho; dali ele continua passando a tarefa adiante.
- Mensagens na sessão da tarefa não esperam o piloto automático: escrever enquanto um passo roda
  interrompe e ele continua com a sua mensagem; com o fluxo pedindo uma escolha, citar a opção
  (ex.: "é a task-5") escolhe.
- Os trechos do caminho na barra do topo são clicáveis.
- Atualizações: o Orkio procura a versão nova logo ao abrir e, quando termina de baixar com nada
  rodando, pergunta "Reiniciar agora?" para já abrir na versão nova (antes só instalava ao fechar).

### Corrigido

- O agente consegue ler a PR (revisões, comentários, threads e CI) com o GitHub CLI fora do passo de
  entrega: `gh pr view`, `gh api` só leitura e GraphQL sem mutation, só no repositório do projeto.
  Publicar, comentar, resolver threads e fazer merge continuam só no passo com modo entrega.
- Revisão do orkio[bot] com comentário por linha sai como "Pedir alterações" (antes podia sair como
  comentário e a tarefa não ia para Revisado).
- Depois da revisão, o fluxo "Alva: comentários da PR" começa sozinho em Revisado. Antes, o Revisor
  continuava atribuído e, como ele não entrega, o fluxo era recusado; e, se a revisão movia a
  tarefa antes de o fluxo dela terminar, Revisado não começava o fluxo dele.
- Contas do GitHub conectadas pelo login (OAuth) voltam a ver revisões, comentários e CI das PRs
  (o Orkio pedia uma permissão de organização que essas contas não têm); se faltar permissão, o
  Quadro avisa.
- Configurações › Projetos em janelas estreitas: o estado e as ações descem para baixo do nome do
  projeto, em vez de espremer o texto até quebrar letra por letra.
- Publicar a revisão como orkio[bot] num app sem o endereço do site (ex.: `pnpm dev` aberto antes
  de definir `MAIN_VITE_SITE_URL`) agora diz isso, em vez de culpar o GitHub App do site.
- O histórico da tarefa mostra o nome do agente que o orquestrador atribuiu ("Implementador"), e
  não o identificador dele.
- Cancelar o fluxo pelo plano da barra de fases mostra o erro se não der certo, em vez de fechar
  sem dizer nada.
- O /spec de uma tarefa nova não pede mais para escolher entre todas as tasks do Backlog.md.
- A spec e o plano aparecem nas abas Spec/Plano enquanto o Claude pede a aprovação.
- Fluxos não rodam em tarefa sem descrição no Notion (o passo para e explica o que fazer).

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

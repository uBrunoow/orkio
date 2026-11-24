/**
 * Textos do site em pt-BR. O inglês entra depois com o mesmo formato (`Dictionary`).
 * Afirme só o que o Orkio faz hoje (ver site/PRODUCT.md). Os dados da prévia do app são de
 * exemplo e a página diz isso.
 */
export const ptBR = {
  locale: 'pt-BR',
  meta: {
    title: 'Orkio — do contexto ao commit',
    description:
      'App de desktop que liga Notion, GitHub e Claude Code: a tarefa sai do Notion, anda no quadro, vira código num ambiente só dela e chega à PR com a sua aprovação.'
  },
  skip: 'Pular para o conteúdo',
  nav: {
    label: 'Navegação principal',
    how: 'Como funciona',
    automations: 'Recursos',
    safety: 'Segurança',
    download: 'Baixar',
    faq: 'Perguntas',
    github: 'GitHub',
    githubLabel: 'Código do Orkio no GitHub',
    stars: 'estrelas'
  },
  hero: {
    title: 'Suas tarefas do Notion viram PRs revisadas. Com você no controle.',
    lead: 'O Orkio é um app de desktop que liga Notion, GitHub e Claude Code. A tarefa entra no quadro, o agente trabalha num ambiente só dela e a PR chega para você aprovar.',
    github: 'Ver no GitHub',
    note: 'Grátis para macOS, Windows e Linux. Usa o seu login do Claude Code.'
  },
  preview: {
    label: 'Prévia do app Orkio',
    description:
      'Uma janela do Orkio com dados de exemplo: a tarefa ORK-142 anda pelo quadro, o Claude Code trabalha nela, o Orkio pede sua aprovação antes do push e a revisão da PR volta como plano de correção.',
    sample: 'Dados de exemplo. A janela responde aos cliques.',
    scenesLabel: 'Momentos da tarefa',
    play: 'Continuar a prévia',
    pause: 'Pausar a prévia',
    project: 'exportador',
    task: 'Exportar relatório em CSV',
    taskId: 'ORK-142',
    branch: 'feat/ORK-142-exportar-csv',
    side: {
      waiting: 'Esperando você',
      running: 'Rodando',
      todo: 'A fazer',
      board: 'Quadro',
      agents: 'Agentes',
      settings: 'Configurações'
    },
    phases: ['Spec', 'Plano', 'Implementar', 'Revisão', 'PR'],
    scenes: [
      { id: 'quadro', tab: 'Quadro', title: 'Você move o card. O agente começa.' },
      { id: 'sessao', tab: 'Sessão', title: 'O Claude Code trabalha no ambiente da tarefa.' },
      { id: 'push', tab: 'Push', title: 'Nada sai sem você ver o que vai.' },
      { id: 'revisao', tab: 'Revisão', title: 'A revisão volta como um plano para aprovar.' }
    ],
    board: {
      columns: ['Prioridades', 'Em andamento', 'Revisando', 'Finalizada'],
      others: [
        { id: 'ORK-139', title: 'Filtro por período no painel', col: 0 },
        { id: 'ORK-145', title: 'Erro ao importar planilha vazia', col: 0 },
        { id: 'ORK-131', title: 'Paginação na lista de clientes', col: 2 },
        { id: 'ORK-128', title: 'Login com SSO do Google', col: 3 }
      ],
      agent: 'Implementador',
      running: 'Implementando',
      pr: 'PR #57'
    },
    session: {
      autopilot: 'Piloto automático · Alva: implementar e entregar · passo 3 de 9',
      command: '/alva-flow:implement TASK-12',
      lines: [
        {
          kind: 'text',
          text: 'Vou criar o exportador em src/export/csv.ts e ligar no botão da tela de relatórios.'
        },
        {
          kind: 'tool',
          text: 'Editou 4 arquivos',
          detail: 'src/export/csv.ts, src/reports/ReportsPage.tsx e mais 2'
        },
        { kind: 'tool', text: 'Rodou pnpm test', detail: '128 testes passaram' },
        {
          kind: 'agents',
          text: '2 subagentes',
          detail: 'Revisar acessibilidade · Conferir datas no fuso'
        },
        {
          kind: 'text',
          text: 'Pronto. O CSV sai com cabeçalho, datas em ISO e separador configurável.'
        }
      ],
      model: 'Opus',
      effort: 'Alto',
      placeholder: 'Escreva para o agente…',
      context: 'Contexto usado: 38%',
      cost: 'US$ 0,42 nesta mensagem'
    },
    push: {
      title: 'Enviar a branch para o GitHub?',
      destination: 'Destino',
      commits: 'Commits',
      changes: 'Mudanças',
      stat: '4 arquivos · +186 −12',
      commitList: ['feat(export): exportar relatório em CSV', 'test(export): datas e separador'],
      approve: 'Fazer push',
      reject: 'Recusar',
      done: 'Push feito. A PR #57 abriu e a tarefa foi para Revisando.'
    },
    review: {
      pill: 'Pedir alterações',
      by: 'orkio[bot] revisou a PR #57',
      comments: [
        { where: 'src/export/csv.ts:42', text: 'Escape aspas duplas dentro dos campos.' },
        { where: 'src/export/csv.ts:88', text: 'Datas sem fuso podem trocar de dia.' }
      ],
      planTitle: 'Plano de correção',
      plan: [
        'Escapar aspas com a regra do RFC 4180 e cobrir com teste.',
        'Converter as datas para UTC antes de formatar.'
      ],
      approve: 'Aprovar correções',
      revise: 'Pedir ajustes…',
      approved: 'Correções aprovadas. O agente começou a corrigir.'
    }
  },
  how: {
    title: 'Um caminho só, do pedido ao merge',
    lead: 'Cada parada conversa com a ferramenta que você já usa. O Orkio liga uma na outra e para onde você precisa decidir.',
    steps: [
      {
        name: 'Notion',
        text: 'Você escolhe os bancos de Projetos e Tarefas. O Orkio lê as suas tarefas, com o ID e o status de cada uma.'
      },
      {
        name: 'Quadro',
        text: 'Um kanban por projeto, com colunas ligadas ao status do Notion. Mover o card atualiza o Notion.'
      },
      {
        name: 'Claude Code',
        text: 'Cada tarefa roda num worktree próprio, com o briefing da página. Você acompanha a conversa e aprova o que o agente pede.'
      },
      {
        name: 'PR',
        text: 'Commit, push da branch da tarefa e PR aberta, cada passo depois da sua aprovação. Revisão e CI aparecem no card.'
      },
      {
        name: 'Finalizada',
        text: 'Mergeou? A tarefa vai para Finalizada sozinha, e o Notion acompanha.'
      }
    ],
    rulesTitle: 'O GitHub diz o que aconteceu. Regras dizem para onde a tarefa vai.',
    rules: [
      { when: 'Branch ORK-142 criada', then: 'Em andamento' },
      { when: 'PR aberta', then: 'Revisando' },
      { when: 'Alterações pedidas', then: 'Revisado' },
      { when: 'Novo pedido de review', then: 'Revisando' },
      { when: 'PR mergeada', then: 'Finalizada' }
    ]
  },
  features: {
    title: 'O que acontece dentro de uma tarefa',
    items: [
      {
        id: 'agentes',
        title: 'Agentes que pegam a tarefa e passam adiante',
        text: 'Implementador, Revisor e Corretor de PR já vêm prontos; os seus são arquivos .md no repositório, com instruções, modelo e limites. Você começa a tarefa movendo o card. Quando o fluxo de uma coluna termina, o orquestrador leva a tarefa para a próxima.',
        points: [
          'Perfis versionáveis, revisados antes de rodar',
          'Limite de passos e de custo por dia'
        ]
      },
      {
        id: 'fluxos',
        title: 'Fluxos ligados às colunas',
        text: 'Cada coluna pode rodar uma sequência: comandos do Claude Code, pedidos em texto, gates de aprovação e ações do Orkio. Os modelos do alva-flow cobrem planejar, implementar, revisar e abrir a PR.',
        points: ['Gate com o diff na tela', 'Falha sempre pausa e explica o que fazer']
      },
      {
        id: 'revisao',
        title: 'A revisão da PR vem para dentro',
        text: 'A aba Revisão mostra as threads da PR. O agente revisa e você aprova o texto antes de ele sair como orkio[bot]. Os comentários, seus ou do time, viram um plano de correção que você aprova antes de o código mudar.',
        points: ['O Orkio nunca aprova PRs', 'Até 3 rodadas de ajuste no plano']
      },
      {
        id: 'sessao',
        title: 'Uma conversa por tarefa',
        text: 'Escreva no campo da tarefa e a sessão do Claude Code continua de onde parou. Escolha modelo e raciocínio por mensagem, anexe imagens e PDFs, veja cada subagente e quanto custou cada resposta.',
        points: [
          'Abra o terminal ou o editor na pasta da tarefa',
          'Mostra quanto do contexto já foi usado'
        ]
      }
    ],
    agents: {
      lanes: [
        { stage: 'Em andamento', agent: 'Implementador', tag: 'entrega' },
        { stage: 'Revisando', agent: 'Revisor', tag: 'só leitura' },
        { stage: 'Revisado', agent: 'Corretor de PR', tag: 'entrega' }
      ],
      next: 'passa para'
    },
    flow: {
      name: 'Alva: implementar e entregar',
      steps: [
        { name: '/implement', state: 'done' },
        { name: '/review', state: 'done' },
        { name: 'Ver o diff', state: 'gate' },
        { name: '/commit', state: 'next' },
        { name: 'Push da branch', state: 'next' },
        { name: '/pr', state: 'next' }
      ],
      states: { done: 'feito', gate: 'esperando você', next: 'a seguir' }
    },
    composer: {
      models: ['Padrão do Claude Code', 'Opus', 'Sonnet', 'Haiku'],
      efforts: ['Baixo', 'Médio', 'Alto', 'Muito alto', 'Máximo'],
      model: 'Modelo',
      effort: 'Raciocínio',
      attachment: 'tela-relatorios.png'
    }
  },
  safety: {
    title: 'Nada vai para a main sem você',
    lead: 'Delegar ao agente não é entregar as chaves. O Orkio decide o que o Claude Code pode fazer e para nos pontos que importam.',
    points: [
      {
        title: 'Push só da branch da tarefa',
        text: 'Sem força, sem apagar branch, nunca na main, develop ou production. Merge e release continuam com você.'
      },
      {
        title: 'Gate antes de publicar',
        text: 'Antes do push você vê os commits, o diff e o destino. Antes de pedir review, quem vai revisar.'
      },
      {
        title: 'Permissões pelo Orkio',
        text: 'Ler e editar só dentro do ambiente da tarefa. Comandos de shell pedem sua aprovação; o que é perigoso é bloqueado e fica no histórico.'
      },
      {
        title: 'Seus tokens ficam com você',
        text: 'Guardados só no seu computador, cifrados pelo sistema. O Orkio usa o seu login do Claude Code e não pede chave da Anthropic.'
      }
    ],
    blocked: ['git push --force origin main', 'gh pr merge 57 --squash', 'cat ~/.ssh/id_ed25519'],
    blockedTitle: 'Bloqueado pelo Orkio, sem perguntar'
  },
  tools: {
    title: 'Usa o que você já tem',
    lead: 'Sem conta nova e sem servidor no meio. O Orkio conversa direto com as suas ferramentas, do seu computador.',
    items: [
      {
        name: 'Notion',
        text: 'Login com OAuth ou token. Bancos de Projetos e Tarefas, status e o conteúdo da página como briefing.'
      },
      {
        name: 'GitHub',
        text: 'Login pelo Device Flow ou token. Branches, PRs, revisões e CI de cada tarefa.'
      },
      {
        name: 'Claude Code',
        text: 'O CLI claude com a sua assinatura. Os comandos, skills e plugins que você já instalou.'
      }
    ]
  },
  download: {
    title: 'Baixe o Orkio',
    lead: 'Grátis. Você só precisa das suas contas do Notion, do GitHub e do Claude Code.',
    suggested: 'Baixar para',
    hero: 'Baixar o Orkio',
    version: 'Versão',
    published: 'publicada em',
    others: 'Todos os sistemas',
    all: 'Todos os arquivos no GitHub',
    soon: 'O primeiro release público sai em breve.',
    unavailable: 'Não conseguimos ler o último release agora. Os arquivos estão no GitHub.',
    linux: 'Este release não tem versão para Linux.',
    forYou: 'Para este computador',
    systems: {
      mac: {
        name: 'macOS',
        files: { 'mac-arm64': 'Apple Silicon (M1 ou mais novo)', 'mac-x64': 'Intel' },
        note: 'Não sabe qual? Menu Apple, Sobre este Mac: “Apple M…” é Apple Silicon.'
      },
      windows: {
        name: 'Windows',
        files: { windows: 'Instalador 64 bits' },
        note: 'Atualiza sozinho quando sai versão nova.'
      },
      linux: {
        name: 'Linux',
        files: {
          'linux-appimage': 'AppImage (qualquer distro)',
          'linux-deb': '.deb (Ubuntu, Debian)'
        },
        note: 'Precisa de um chaveiro do sistema (GNOME Keyring ou KWallet) para guardar os tokens. O AppImage se atualiza sozinho.'
      }
    },
    labels: {
      'mac-arm64': 'macOS (Apple Silicon)',
      'mac-x64': 'macOS (Intel)',
      windows: 'Windows',
      'linux-appimage': 'Linux (AppImage)',
      'linux-deb': 'Linux (.deb)'
    }
  },
  faq: {
    title: 'Perguntas',
    items: [
      {
        q: 'O que o agente faz sem me perguntar?',
        a: 'Lê e edita arquivos dentro do ambiente da tarefa. Comandos de shell pedem sua aprovação (uma vez ou sempre neste projeto). Push, PR e comentários no GitHub só acontecem nos passos de entrega, na branch da tarefa; merge, força e outras branches são bloqueados.'
      },
      {
        q: 'O Orkio guarda meus tokens em algum servidor?',
        a: 'Não. Os tokens do Notion e do GitHub ficam só no seu computador, cifrados pelo sistema (Keychain no macOS, DPAPI no Windows, chaveiro do sistema no Linux). O site do Orkio só repassa a troca do login OAuth do Notion, porque o Notion exige um segredo que um app de desktop não pode guardar, e não grava nada.'
      },
      {
        q: 'Preciso de chave de API da Anthropic?',
        a: 'Não. O Orkio usa o CLI do Claude Code instalado no seu computador, com o seu login e a sua assinatura.'
      },
      {
        q: 'O Orkio escreve no meu Notion?',
        a: 'Só o status da tarefa quando o card muda de coluna (e, se você pedir, publica um documento como subpágina). O conteúdo das páginas não é gravado no seu disco.'
      },
      {
        q: 'Quem publica a revisão na PR?',
        a: 'O orkio[bot], um GitHub App instalado no repositório, e só depois que você aprova o texto exato. Ele comenta ou pede alterações; aprovar a PR continua com o time.'
      },
      {
        q: 'Funciona com GitHub Enterprise ou GitLab?',
        a: 'Hoje, só github.com. Repositórios do GitHub Enterprise aparecem com recursos limitados.'
      }
    ]
  },
  close: {
    title: 'Do contexto ao commit.',
    lead: 'Baixe, conecte Notion, GitHub e Claude Code, e mova a primeira tarefa.'
  },
  footer: {
    tagline: 'Do contexto ao commit.',
    privacy: 'Privacidade',
    terms: 'Termos',
    github: 'GitHub',
    releases: 'Versões',
    rights: 'Orkio'
  },
  legal: {
    updated: 'Atualizado em',
    back: 'Voltar ao início',
    contactMissing: 'contato a definir'
  }
} as const

export type Dictionary = typeof ptBR

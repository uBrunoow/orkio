# Fluxo Git no Notion — design

Data: 2026-11-26. Pedido: Bruno (base [TI] Tarefas da Alva).

## Intenção

O time passou a acompanhar, numa propriedade do banco de Tarefas do Notion, em que ponto do fluxo
do GitHub cada tarefa de dev está ("Etapa Git"), com o link da PR e a data do merge na dev. Serve
para saber com quem está cada tarefa e tirar relatórios do que entrou em cada período. Hoje tudo é
à mão, e a data sai errada quando alguém atualiza a etapa depois. O Orkio já vê os eventos do
GitHub de cada tarefa (3B); ele passa a preencher esses campos sozinho e a mostrar a etapa no
card do Quadro.

Na base da Alva os campos já existem: `Etapa Git` (select: Branch criada, PR aguardando review,
Ajustes solicitados, Mergeada na dev, PR para main aberta, Em produção), `PR` (url),
`Merge na dev` (date), `Em produção em` (date). Uma automação do próprio Notion grava a data
quando a etapa muda.

## Objetivos

- Mapear, no assistente "Bancos e campos", um **Fluxo Git** opcional: a propriedade da etapa
  (select ou status), qual opção corresponde a cada etapa que o Orkio conhece, a propriedade do
  link da PR (url) e a da data do merge (date). Sugestão automática pelo nome (sem acento/caixa).
- Com o mapeamento, cada evento do GitHub de uma tarefa escreve no Notion:

  | Evento (3B)                                               | Etapa              | Outros               |
  | --------------------------------------------------------- | ------------------ | -------------------- |
  | `branch.created`                                          | Branch criada      | —                    |
  | `pr.opened` / `pr.ready_for_review` (destino que conta)   | PR aguardando rev. | PR = URL da PR       |
  | `pr.changes_requested`                                    | Ajustes solicitados| —                    |
  | `pr.review_requested` com a etapa em "Ajustes solicitados"| PR aguardando rev. | —                    |
  | `pr.merged` (destino que conta)                           | Mergeada na dev    | data = `closed_at`   |

- Mostrar a etapa atual (valor do Notion) como selo no card do Quadro (um e vários projetos) e na
  visão Lista, com a cor da opção do Notion.
- Histórico da tarefa registra cada atualização ("Etapa Git → Mergeada na dev").

## Fora do escopo

- "PR para main aberta" e "Em produção": a PR dev→main não pertence a uma tarefa no Orkio (o
  fluxo é feat → dev). Continuam manuais no Notion.
- Criar as propriedades no Notion (o assistente só mapeia as que existem).
- Rodar sem o app aberto ou para tarefas de outras pessoas (limite conhecido: o Orkio só lista as
  tarefas da pessoa logada e só observa com o app aberto; eventos que aconteceram com o app
  fechado disparam ao abrir, como na 3B).

## Antiobjetivos

- Desfazer uma etapa que alguém pôs à mão mais adiante (ex.: "Em produção" virar "Mergeada na
  dev").
- Escrever num campo que a pessoa não mapeou, ou criar opção de select.
- Mudar a coluna do quadro do Orkio por causa da Etapa Git (são coisas separadas).

## Regras

- **Ordem e "só para frente":** a ordem das etapas é a ordem das opções no Notion (como o
  comunicado). O Orkio só escreve se a opção nova vier depois da atual, com duas exceções: ir para
  "Ajustes solicitados" (de "PR aguardando review" ou depois dela, até "Mergeada na dev"
  exclusive) e voltar de "Ajustes solicitados" para "PR aguardando review". Etapa atual vazia →
  escreve. Etapa atual sem correspondência no mapeamento (ex.: "Em produção") mas depois na ordem
  → não escreve.
- **Destino que conta:** PR com base diferente de `main`/`master` (`NEVER_PR_BASES` de
  `shared/delivery.ts`). PR da tarefa direto para a main (hotfix) não vira "PR aguardando review"
  nem "Mergeada na dev". Para isso os sinais guardam `baseRef` (REST `base.ref`) em
  `PullRequestSummary` e no `PrSnapshot`.
- **PR (url):** grava só se o campo estiver vazio ou com outra URL da mesma tarefa; nunca apaga.
- **Data do merge:** `closed_at` da PR mergeada (horário do GitHub, com hora), não "agora". A
  automação do Notion pode reescrever a data com o horário da mudança; aceitável (diferença de
  minutos com o app aberto). Documentar.
- **Pausa:** respeita a pausa global e a da tarefa das automações (evento consumido, como na 3B).
  "Bloqueada" não impede (é sobre mover no quadro).
- **Idempotência:** cada evento aplica uma vez (chave própria em `task_events`, ex.
  `gitflow:<chave do evento>`), mesma transação do snapshot. Primeira observação = linha de base
  (não escreve), como a 3B.
- **Sem mapeamento ou com campo quebrado** (apagado, tipo mudou, opção apagada): não escreve;
  `checkMapping` avisa (opcional = aviso, nunca bloqueia as tarefas).

## Abordagens consideradas

1. **Fluxo Git no mapeamento do banco (escolhida).** Campos opcionais no assistente "Bancos e
   campos", valem para o banco inteiro, escrita pela fila do quadro (offline, retentativa,
   rollback). Genérico: serve para qualquer workspace.
2. Nova ação "definir propriedade" nas automações de cada projeto: mais flexível, mas configurada
   projeto a projeto, link/data viram casos especiais e a tela do fluxo pesa.
3. Fixo pelos nomes "Etapa Git"/"PR"/"Merge na dev": rápido, quebra ao renomear e só serve à Alva.

Bruno escolheu a 1 e pediu os selos no quadro.

## Como (decidido)

- **Config:** `notion.gitFlow` opcional em `orkio-config` (sem migração, ausente = desligado):
  `{ stage: { id, name, type: 'select'|'status' }, options: { branch?, review?, changes?, merged? }
  (cada um `{ id, name }` da opção), prUrl?: { id, name }, mergedAt?: { id, name } }`. Só ids e
  nomes. Validador em `shared/` (renderer e main).
- **Leitura:** `parseTaskPage` passa a ler o valor da etapa (`gitStage: { id?, name, color } |
  null`) e, se mapeados, a URL da PR atual; vão no `NotionTask` (memória, como o status).
- **Escrita:** `PropertyWrite` ganha `url` e `date` (`{ type: 'date', start }` com hora);
  `encode/decode/match/apply/key` cobrem os dois. A escrita entra na pendência da tarefa
  (`NotionWriteQueue`, uma por tarefa) somando-se a um movimento do quadro que esteja pendente;
  recusa permanente faz o rollback só do que ela mudou.
- **Motor:** função pura em `shared/` (ex. `shared/git-flow.ts`): `gitFlowWrites(evento, tarefa,
  mapeamento, pr) → PropertyWrites | null` com as regras acima; testada sozinha. O
  `AutomationService` chama depois de avaliar as regras do quadro, no mesmo ciclo e transação.
- **Histórico:** evento novo `git_flow` no catálogo `shared/task-events.ts` (etapa, PR, origem
  `automation`, `inSession: false`).
- **UI:** seção "Fluxo Git (opcional)" no assistente (propriedade, quatro opções com sugestão,
  PR, data), com o texto de que "PR para main aberta"/"Em produção" ficam manuais. Selo no card:
  ponto com a cor da opção do Notion + nome (`StatusToken`/peça pequena, não `Badge`), só quando a
  tarefa tem valor; mesmo selo na Lista e no painel da tarefa (aba Detalhes › GitHub).
- **E2E:** Notion simulado com a propriedade select, url e date; GitHub simulado com a PR para
  `dev` passando por aberta → changes requested → review pedida → merged; confere o PATCH e o
  selo. Caso hotfix para `main` não escreve.

## Decisões depois da revisão (chamadas do Claude, aprovadas junto com o documento)

- **Escrita separada do quadro.** A pendência do quadro é reconstruída do estado local
  (`BoardService.syncDesired`) e apagada quando nada difere; misturar a Etapa Git nela faria um
  movimento do card apagar a escrita do Git, e uma recusa do Git desfazer o movimento. Então
  `pending_writes` ganha o tipo da escrita (`board` | `git_flow`, migração do SQLite, chave tarefa +
  tipo): PATCH próprio, retentativa pela mesma `NotionWriteQueue`, recusa permanente só descarta a
  escrita do Git (evento no histórico, sem rollback do quadro, porque o quadro não mudou). Escritas
  do Git seguidas na mesma tarefa se juntam (a última etapa vence; PR e data acumulam).
- **Só projetos com quadro e vínculo com o Notion** (os mesmos `automationProjectIds` da 3B): é
  onde o Orkio já observa o GitHub. Sem quadro, nada acontece; o assistente diz isso.
- **Preencher o que já existe ao ligar.** Ao salvar o Fluxo Git pela primeira vez (ou ao mudar a
  propriedade da etapa), o próximo ciclo calcula a etapa pelo estado atual de cada tarefa listada
  (branch → Branch criada; PR aberta para destino que conta → PR aguardando review, ou Ajustes
  solicitados se a decisão da review for alterações pedidas; PR mergeada nesse destino → Mergeada
  na dev com o `closed_at`) e escreve com as mesmas regras (só para frente, PR só se vazio). Assim
  o relatório não perde as tarefas que já estavam no meio. Fica marcado no config
  (`gitFlow.backfilledAt` por banco) para rodar uma vez.
- **Valor de comparação.** As regras usam a etapa "desejada": a da escrita do Git pendente, se
  houver; senão o último valor lido do Notion. Vários eventos no mesmo ciclo são aplicados em
  ordem, cada um sobre o resultado do anterior (a função pura recebe a etapa atual e devolve a
  nova).
- **Campo PR:** escreve se estiver vazio ou se o valor atual for o link de outra PR do mesmo
  repositório (`github.com/<owner>/<repo>/pull/<n>`; ex.: PR fechada e reaberta como outra; o Orkio
  não guarda o histórico de PRs da tarefa, então "mesmo repositório" é o critério). Qualquer outro
  valor fica como está.
- **Destino que conta vale para todos os eventos de PR** (aberta, pronta, alterações pedidas,
  review pedida, merge): PR da tarefa para `main`/`master` não mexe na Etapa Git.

## Deixado para quem constrói

- Nomes exatos de tipos/funções, onde o selo fica no layout do card (seguir o mockup e o espaço da
  linha da PR), e o texto do histórico.
- Se a sugestão de opções usa também a cor/posição além do nome.
- Atualizar `CLAUDE.md` (seções Notion, Automações, Quadro) e o CHANGELOG.

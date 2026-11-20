# Orkio — design do site

Derivado de `brand/BRAND.md` e `brand/tokens.css`. A marca manda; referências externas (landings
de ferramentas de dev) só inspiram ritmo e composição.

## Direção

**Painel de controle silencioso.** Preto piano, linhas finas, uma grade técnica discreta ao fundo
e o laranja como sinal: aparece onde há ação ou agente trabalhando. O site mostra o produto
(quadro, fluxo, gate, diff) em vez de ilustrar com metáforas.

## Cor (tokens, nada de hex solto fora de `app/tokens.css`)

| Token                              | Valor     | Uso                                       |
| ---------------------------------- | --------- | ----------------------------------------- |
| `--bg`                             | `#0A0A0B` | fundo                                     |
| `--surface`                        | `#141416` | cartões, mockups                          |
| `--raised`                         | `#1E1E21` | elementos sobre cartões                   |
| `--border`                         | `#2C2C30` | linhas, grade                             |
| `--text`                           | `#F2F2F0` | texto principal                           |
| `--muted`                          | `#8F8F94` | texto de apoio (contraste 6,3:1 no fundo) |
| `--accent`                         | `#FF5B1F` | CTA principal, símbolo, estados de agente |
| `--on-accent`                      | `#0A0A0B` | texto sobre laranja (sempre preto)        |
| `--success`/`--warning`/`--danger` |           | chips de status nos mockups               |

Laranja com parcimônia: um CTA primário por seção, o símbolo, o ponto "hub" e chips de agente.

## Tipografia (fontes locais via `next/font/local`)

- **Jost** só no wordmark (300, letter-spacing 0,25em), slogan (400, 0,4em, caixa alta) e
  títulos grandes (h1/h2, 400–500).
- **Inter** em todo o resto (400/500/600).
- **JetBrains Mono** em IDs (`ORK-142`), comandos, branches e trechos de terminal.
- Escala fluida com `clamp()`; parágrafos até ~68 caracteres.

## Forma e composição

- Raio `8px` (controles) e `12px` (cartões). Bordas de 1px em `--border`; sem sombras pesadas.
- Grade de fundo em linhas de 1px com máscara radial (some nas bordas). Sem gradiente no símbolo.
- Seções com título curto em Jost + subtítulo em Inter `--muted`.
- "Como funciona": cinco passos numerados em linha (Notion → Quadro → Claude Code → PR →
  Finalizada), com chips de status.
- Automações: frases de regra ("Quando a PR abrir → Revisando") como linhas de uma lista densa.
- Segurança: mockup de gate (commits, `diff --stat`, destino) com "Fazer push" e "Recusar".
- Download: um botão principal com o arquivo sugerido para o sistema e os outros como links.

## Movimento

Pouco e com propósito: o ponto "hub" do símbolo pulsa devagar; chips de status mudam de estado no
mockup do quadro. Tudo desliga com `prefers-reduced-motion: reduce`.

## Acessibilidade

- Contraste AA no mínimo (texto principal ~17:1; apoio 6,3:1; laranja sobre preto 6,5:1).
- Foco visível em laranja (`outline` 2px + offset), "Pular para o conteúdo" no topo.
- Landmarks (`header`, `nav`, `main`, `footer`), um `h1`, hierarquia sem saltos.
- Mockups decorativos com `aria-hidden` e uma descrição em texto ao lado.
- `lang="pt-BR"`; nada depende só de cor.

## Privacidade

Sem cookies, sem rastreadores, sem fontes ou scripts de terceiros. Vercel Analytics só se ligado
depois, sem cookies e com aviso na /privacidade.

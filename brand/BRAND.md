# Orkio — Identidade visual

## Arquivos
| Arquivo | Uso |
|---|---|
| `orkio-symbol.svg` | Símbolo completo em laranja. Tamanhos ≥ 48 px (splash, tela vazia, onboarding). |
| `orkio-symbol-currentcolor.svg` | Mesmo símbolo herdando a cor do CSS (`color`). Use em componentes React. |
| `orkio-symbol-simple.svg` | Versão simplificada, traço grosso (`currentColor`). Tamanhos < 48 px (sidebar, barra do app). |
| `orkio-app-icon.svg` / `-1024.png` | Ícone do app: fundo laranja, símbolo preto. Fonte para gerar .icns / .ico / .png. |
| `orkio-app-icon-dark.svg` / `-1024.png` | Variante escura (alternativa). |
| `tokens.css` | Cores, fontes e raios. |

## Símbolo
Poliedro facetado em linhas finas. O vértice da direita (com ponto sólido) é o "hub": o Orkio coordenando agentes e ferramentas.
Não distorcer, não girar, não aplicar gradiente, sombra ou brilho.

## Wordmark
"ORKIO" em maiúsculas, **Jost Light (300)**, letter-spacing ≈ 0.25em, cor `--text` sobre preto (ou `--on-accent` sobre laranja).
Em tamanhos pequenos (≤ 18 px, ex. barra do app) usar Jost 400.
Slogan: "DO CONTEXTO AO COMMIT", Jost 400, corpo pequeno, letter-spacing ≈ 0.4em.
O wordmark é texto renderizado com a fonte (não há SVG de texto) — mantenha a fonte Jost empacotada no app.

## Combinações
- Principal: símbolo laranja + wordmark off-white sobre preto piano.
- Destaque: símbolo e wordmark pretos sobre laranja.

## Interface
- Texto da UI em Inter. Jost só para logo e títulos grandes. IDs (ORK-142) em mono.
- Laranja com parcimônia: ação principal, símbolo, estados de agente.
- Texto sobre laranja sempre preto (`--on-accent`), nunca branco (contraste insuficiente).
- Dark mode é o padrão.

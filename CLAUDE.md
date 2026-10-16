# CLAUDE.md

Guia para trabalhar neste repositório (Claude Code e desenvolvedores). Mantenha este arquivo atualizado quando a estrutura mudar.

## Visão geral

**Controle de Estoque Pro** — sistema de estoque para assistência técnica de informática.
Três partes que conversam com a mesma API:

1. **Backend** Node.js + Express 5 (REST + Socket.io), em `src/`.
2. **Frontend web** SPA em HTML/CSS/JS puro (sem framework nem build), servido pelo próprio Express, em `src/public/`.
3. **Extensão Chrome/Edge** (Manifest V3), em `extension/`, que consome a mesma API e recebe os mesmos eventos de tempo real.

- Repositório: `Francisco-Vian4/Sistema-de-estoque` (branch `main`)
- Idioma: código, mensagens de erro, UI e banco de dados em **português**. Mantenha assim.
- Stack: Node 18+ (CommonJS, `"type": "commonjs"`), Express 5, Socket.io 4, JWT, bcryptjs, multer, `pg`, `sql.js`, `xlsx`, `pdfkit` + `pdfkit-table`, `docx`.

## Comandos

```bash
npm install          # instalar dependências
cp .env.example .env # criar o .env (PowerShell: Copy-Item .env.example .env)
npm start            # sobe o servidor em http://localhost:3000  (npm run dev faz o mesmo, sem hot reload)
npm run seed         # roda só o seed (usuários + importação da planilha)
npm run seed:demo    # gera ~12 meses de movimentações FICTÍCIAS para o Painel Geral (veja abaixo). Pare o servidor antes
node test_suite.js   # testes de integração (o servidor precisa estar rodando em localhost:3000)
# Banco isolado para testar sem tocar em data/estoque.db:
#   SQLITE_PATH=/tmp/teste.db PORT=3100 node src/server.js   (outro terminal: TEST_PORT=3100 node test_suite.js)
```

- `npm test` **não** roda os testes (é o placeholder do npm). Use `node test_suite.js`.
- Não há linter, formatter nem build configurados.
- A extensão não tem build: Chrome/Edge → `chrome://extensions` → modo desenvolvedor → "Carregar sem compactação" → pasta `extension/`. Depois de editar, clique em recarregar na página de extensões.

## Mapa do código

```
src/
├── server.js                  Ponto de entrada: Express, CORS aberto, estáticos, Socket.io, initDatabase() + runSeed() antes do listen
├── seed.js                    Cria os 2 usuários padrão e, se produtos estiver vazio, importa a planilha de data/
├── seed-demo.js               Dados de DEMONSTRAÇÃO: histórico de vendas/reposições para os gráficos (só SQLite local)
├── config/
│   ├── database.js            Adaptador de banco (PostgreSQL ou SQLite via sql.js) + migrations (CREATE TABLE IF NOT EXISTS)
│   └── auth.js                generateToken, authMiddleware (Bearer ou ?token=), requireRole
├── routes/api.routes.js       TODAS as rotas /api e o multer de upload
├── controllers/
│   ├── auth.controller.js     login, me, listUsers, createUser
│   ├── product.controller.js  CRUD de produtos, stats (KPIs antigos), categorias
│   ├── dashboard.controller.js GET /api/dashboard (Painel Geral)
│   ├── movement.controller.js ENTRADA / SAIDA / AJUSTE e histórico
│   └── report.controller.js   Geração de PDF, Excel e Word
├── services/
│   ├── excel-import.service.js  Parser da planilha + regras de cálculo (calculateStatus/Margem/ValorTotal)
│   ├── dashboard.service.js     buildOverview(): cards com variação, série mensal, ranking, itens parados (função pura)
│   └── realtime.service.js      notifyStockUpdate / broadcastEvent sobre o Socket.io
└── public/                    Frontend web
    ├── index.html             Página única: dashboard, tabela, movimentações, usuários, todos os modais
    ├── css/styles.css         Design system Estoque Pro: tokens em :root + todos os componentes
    ├── favicon.svg            Logo do sistema (mesma da sidebar: caixa branca sobre quadrado azul #2563EB); apple-touch-icon.png é a versão 180px
    └── js/
        ├── icons.js           Ícones Lucide embutidos: <i data-ic="box"></i> no HTML, icon('box') em template string
        ├── charts.js          renderAreaChart(): gráfico mensal em SVG puro (1 série = área preenchida; 2+ = linhas com legenda)
        ├── auth.js            Login, sessão (localStorage: estoque_token, estoque_user), visibilidade por perfil
        ├── app.js             Toda a lógica das telas (carregamento, tabelas, modais, relatórios, upload)
        └── socket-client.js   Conexão WebSocket e atualização das telas ao receber eventos
extension/                     manifest.json, popup.html/css/js, socket.io.min.js, icons/
data/controle_estoque_assistencia_tecnica.xlsx   Planilha base (35 produtos) usada pelo seed
test_suite.js                  Testes de ponta a ponta contra localhost:3000 (HTTP + Socket.io)
src/Estoque-Pro-System.html    Documentação do design system (bundle React minificado; abrir no navegador, não editar)
```

## Arquitetura: o que você precisa saber antes de mexer

### Banco de dados (`src/config/database.js`)
- Se `DATABASE_URL` começa com `postgres://` ou `postgresql://`, usa PostgreSQL/Supabase. Se a conexão falhar, **cai silenciosamente para SQLite** (só um `console.warn`). Confira a linha "Banco de Dados ativo" no log de inicialização.
- Sem `DATABASE_URL`, usa SQLite via **sql.js** (WASM, banco inteiro em memória). Cada escrita regrava o arquivo `data/estoque.db` inteiro (`saveSqliteDisk`). Serve para desenvolvimento, não para carga.
- Toda query passa por `db.query(sql, params)`. **Escreva SQL com placeholders `$1, $2...`**: no SQLite eles são trocados por `?` automaticamente. Detalhe: essa troca é posicional, então não reutilize o mesmo `$n` duas vezes nem os use fora de ordem.
- SQL precisa funcionar nos dois bancos. Cuidado com sintaxe específica de um deles (`RETURNING`, `ILIKE`, `NOW()` etc.). No SQLite o retorno de INSERT é só `rows[0].id`, via `last_insert_rowid()`.
- Migrations são apenas `CREATE TABLE IF NOT EXISTS` em `runMigrations()`. **Não há sistema de versionamento de schema**: mudar uma coluna exige alterar as duas versões do DDL (Postgres e SQLite) **e** uma migração manual (`ALTER TABLE`) para quem já tem banco criado.
- Tabelas: `produtos` (20 campos de negócio + `id`, `created_at`, `updated_at`), `usuarios`, `movimentacoes_estoque`.
- `data/estoque.db` está no `.gitignore`. Cada dev tem o seu banco local, e os dados não são compartilhados pelo Git.

### Autenticação e perfis (`src/config/auth.js`)
- JWT de 7 dias. Aceita `Authorization: Bearer <token>` ou `?token=` (necessário para downloads de relatório por link direto).
- Dois perfis: `admin` e `user` (exibido como "Operador").
  - `admin`: tudo, incluindo editar/excluir produto, movimentar estoque, importar planilha e gerenciar usuários.
  - `user`: consulta, cadastro de produto e relatórios.
- **A restrição de perfil está só em `requireRole` nas rotas** (`api.routes.js`). Para proteger uma rota nova, adicione o `requireRole('admin')` lá.
- **Atenção, pendência de segurança:** custo, margem e valor total são escondidos do operador apenas na interface (`app.js`, `auth.js`). A API (`GET /products`, `/products/:id`, relatórios) devolve esses campos para qualquer usuário autenticado. Se isso precisar ser sigiloso de verdade, filtre no backend.
- `JWT_SECRET` tem valor padrão embutido no código caso o `.env` não o defina. `.env.example` traz um valor de exemplo. **Troque em qualquer ambiente real.**
- Senhas padrão (`admin123`, `user123`) são criadas pelo seed e impressas no log. Só servem para desenvolvimento.

### Regras de negócio (`src/services/excel-import.service.js`)
Centralizadas aqui e reutilizadas pelos controllers. Altere **neste lugar**, nunca duplicando a conta:
- `calculateStatus(qtd, min, max)`: `qtd <= 0` → `SEM ESTOQUE`; `min > 0 && qtd <= min` → `ESTOQUE BAIXO`; `max > 0 && qtd > max` → `EXCESSO`; senão `OK`.
- `calculateMargem(custo, venda)`: `((venda - custo) / custo) * 100`, `0` se custo ≤ 0.
- `calculateValorTotal(qtd, custo)`: `qtd * custo`.
- `status` pode ser enviado manualmente no corpo da requisição (`body.status || calculateStatus(...)`) e prevalece sobre o cálculo.
- A importação lê a aba `Estoque` (ou a primeira aba) e faz insert/update por `codigo`.

### Tempo real (`src/services/realtime.service.js`)
- Todo controller que altera dados chama `notifyStockUpdate(tipo, dados)`, que emite o evento Socket.io **`stock_updated`** com `{ type, data, timestamp }`.
- Valores de `type` em uso: `PRODUCT_CREATED`, `PRODUCT_UPDATED`, `PRODUCT_DELETED`, `STOCK_MOVEMENT`.
- O broadcast é global (`io.emit`), sem salas nem checagem de autenticação no socket. Se criar uma operação de escrita nova, chame `notifyStockUpdate` e trate o evento em `src/public/js/socket-client.js` e em `extension/popup.js`.

### Movimentações (`movement.controller.js`)
- Tipos: `ENTRADA`, `SAIDA`, `AJUSTE`. Cada uma grava `quantidade_anterior` e `quantidade_nova`, recalcula `status` e `valor_total_estoque` e registra o usuário responsável (`usuario_nome` é gravado em texto).
- Só admin pode criar movimentações. Qualquer usuário autenticado pode listar.

### Relatórios (`report.controller.js`)
PDF (`pdfkit-table`), Excel (`xlsx`, 2 abas: Estoque e Resumo) e Word (`docx`). Aceitam filtros de categoria e status por query string. A ordem e os nomes das **20 colunas** estão duplicados aqui; se mudar uma coluna de produto, atualize também os três formatos.

### Uploads
`POST /api/upload/image` e `POST /api/import/excel` gravam em `src/public/uploads/` com nome `timestamp-aleatório.ext`, sem validação de tipo nem de tamanho. O conteúdo da pasta é ignorado pelo Git (só o `.gitkeep` é versionado).

### Design system (frontend web)
Fonte da verdade visual: `src/Estoque-Pro-System.html`. Os valores abaixo já estão em `src/public/css/styles.css` como variáveis `--*` em `:root`: **use as variáveis, não hex solto**.
- **Cores:** azul `#2563EB` (hover `#1D4ED8`, soft `#EFF6FF`/`#DBEAFE`) só para ação primária e dados. Neutros slate (`#F8FAFC` fundo do app, `#F1F5F9` divisor, `#E2E8F0` borda, `#64748B` texto secundário, `#0F172A` texto). Semânticas: verde `#10B981` = positivo/ganho (**nunca** para ação), âmbar `#F59E0B` = atenção, vermelho `#EF4444` = alerta/negativo.
- **Tipografia:** Inter (400/500/600/700) e JetBrains Mono para códigos. Display 32/36 bold · valor grande 28/32 bold · H3 de card 16–18 semibold · corpo 14/20 · caption 12/16 · micro 11/14 semibold maiúsculo. Valores monetários sempre bold, tracking -0.02em.
- **Forma:** base de 4px. Raios 8 / 12 / 16 / 20, botões e campos de busca em pílula. Sombras `--shadow-card` e `--shadow-hover`. Sidebar 280px fixa. Máx. 4 cards por linha.
- **Componentes:** botão primário pílula (h40, sombra azul); secundário branco com borda; badges em pílula com fundo suave + borda; tabela com cabeçalho cinza claro e zebra só no hover; foco sempre com anel de 2px (`:focus-visible`).
- **Movimento:** hover de card sobe 2px (200ms, `--ease-out-expo`); botão ativo `scale(.98)`; gráfico anima em 600ms; `prefers-reduced-motion` desliga tudo.
- **Ícones:** Lucide outline 1.75px via `icons.js` no shell e no dashboard. O restante do app (tabelas, modais, toasts) ainda usa Font Awesome. Ao mexer nessas telas, prefira migrar para `icon('nome')` (adicione o path ao mapa `ICONS`).

### Dados de demonstração (`npm run seed:demo`)
- Sem movimentações o Painel Geral fica vazio (ranking, gráfico e variações). O script gera ~530 movimentações em 12 meses, com perfis de produto (vendendo / pararam de vender / nunca saíram) e reposições coerentes.
- **Não altera o saldo atual dos produtos**: o histórico é construído de trás para a frente e termina no saldo que já existe. Reescreve `created_at` e `data_entrada` dos produtos para datas compatíveis (reimportar a planilha restaura `data_entrada`).
- Recusa rodar com `DATABASE_URL` (nunca polui o Supabase), com servidor ligado na porta do app ou se já houver movimentações (use `-- --limpar` para refazer). Faz backup em `data/estoque.bak-AAAAMMDD-HHMMSS.db` (ignorado pelo Git); para desfazer, pare o servidor e copie o backup por cima de `data/estoque.db`.
- Usa semente fixa: os dois devs geram exatamente o mesmo histórico. Dados fictícios: **nunca** rodar em banco que tenha movimentações reais.

### Painel Geral (`GET /api/dashboard`)
- Cálculo em `dashboard.service.js` (`buildOverview`, função pura: recebe produtos e movimentações). O saldo de 30 dias atrás é **reconstruído desfazendo as movimentações** (`quantidade_nova - quantidade_anterior`); custo e preço usam o valor atual (não há histórico de preço). Sem produtos existentes naquela data, a variação vem `null` e a tela mostra "Sem histórico para comparar".
- "Itens sem saída" = produtos com saldo > 0 sem movimentação `SAIDA` nos últimos `period` dias (se nunca saiu, conta a partir de `data_entrada`, aceita `dd/mm/aaaa` ou ISO, com `created_at` como reserva).
- **Risco de ruptura** (card que substituiu "Estoque baixo"): item em risco = tem saída nos últimos 30 dias **e** (já zerou **ou** esgota em até 15 dias). Prazo = `saldo × 30 ÷ unidades vendidas em 30 dias` (calculado com o total vendido, não com a divisão por dia, para não errar na borda de 15,0). Itens parados não entram (sem ritmo não há prazo). O subtexto do card mostra o **menor prazo** (pior caso) e quantos já zeraram; o link "Ver detalhes" abre o modal com saldo, consumo/dia, prazo, giro 30d e reposição sugerida (ordenado do mais urgente). Limiar e janela ficam nas constantes `LIMIAR_RUPTURA_DIAS` e `CONSUMO_DIAS` do `dashboard.service.js`.
- **Reposição sugerida** = cobrir 30 dias de consumo (nunca menos que o estoque mínimo), limitada ao estoque máximo quando houver. **Giro 30d** = unidades vendidas ÷ saldo médio (saldo atual e de 30 dias atrás).
- **Itens sem saída**: número = quantidade; subtexto = capital parado **a custo** (`saldo × preço de custo`, só admin; operador vê "há N+ dias sem saída").
- A variação vs. período anterior desses dois cards ficou no tooltip do subtexto (e no modal de risco). Variações: contagens são absolutas; margem em p.p.; valor do estoque em %.
- `cards.estoque_baixo` (status abaixo do mínimo cadastrado) continua na resposta e alimenta só o **sino** do topo, que abre o catálogo filtrado por `ESTOQUE BAIXO`.
- Clique (ou Enter) num ponto do gráfico abre o modal "Vendas de <mês>" (`openMonthSales` em `app.js` → `GET /api/dashboard/sales`): lista numerada por quantidade vendida, com total no final. O valor vendido é `quantidade × preço de venda ATUAL` (sem histórico de preço) e só vai para admin. O total de unidades do modal sempre bate com o ponto do gráfico.
- **Cards do topo reposicionáveis** (`#statGrid`, cada card tem `data-card`): arraste com o mouse (reordena ao vivo, com animação), **segure e arraste no toque** ou use **Alt + setas** no card focado. A ordem fica no `localStorage` do navegador, **por usuário** (`estoque_cards_order_<id>`), e o botão "Restaurar ordem dos cards" no cabeçalho volta ao padrão (`STAT_CARD_DEFAULT_ORDER` em `app.js`). Card novo: dê um `data-card` único, acrescente-o a essa constante e mantenha `tabindex="0"`. O arraste usa **eventos de ponteiro (`initStatCards` em `app.js`), não o drag-and-drop nativo do HTML5**: o nativo desenha uma imagem fantasma translúcida que o CSS não controla e não funciona em toque. Aqui o que acompanha o cursor é uma cópia opaca do card (`.drag-ghost`) e o original vira um encaixe tracejado (`.drag-slot`). Não reintroduza o atributo `draggable`. "Ver detalhes" e outros botões dentro do card continuam clicáveis (não iniciam arraste).
- **Seletor de métrica do gráfico** (`#metricSelect`, config em `CHART_METRICS` no `app.js`): *Itens vendidos* (padrão), *Faturamento (R$)* e *Entradas x Saídas*. Mesmo card, mesmo seletor de período, título dinâmico. Trocar a métrica **não** refaz a requisição: `serie[]` já traz `valor` (unidades vendidas), `entradas` e, só para admin, `faturamento`. Faturamento = `unidades vendidas × preço de venda ATUAL` e a opção some do seletor para o operador. Entradas x Saídas ignora `AJUSTE` e não é clicável (o modal de vendas só faz sentido para saídas). Margem e giro ficam fora do seletor de propósito (candidatos a Relatórios).
- `valor_estoque` e `margem_media` **só vão na resposta para admin** (o operador vê cards `.user-only` sem valores financeiros).
- A seção "Itens por categoria" do painel antigo foi removida (o alvo visual não a tem); `/products/stats` continua existindo.

### Frontend e extensão
- Sem framework: funções globais em `app.js`/`auth.js`, HTML montado por template string, modais definidos em `index.html`. Ao inserir dados de usuário em template string, use `escapeHtml()` (definido em `app.js`; o painel novo já usa, o código antigo das tabelas e modais ainda não).
- Título e subtítulo da página vêm de `TAB_META` em `app.js` (`switchTab`). Elementos `.admin-only` / `.user-only` são mostrados ou escondidos por `applyUserPermissions()` (`auth.js`).
- A extensão (`extension/popup.*`) **ainda usa o visual antigo**; o design system só foi aplicado ao app web.
- A extensão tem URL do servidor configurável no popup (padrão `http://localhost:3000`) e guarda token em `chrome.storage.local`. `host_permissions` já cobre localhost e `https://*/*`.
- `extension/socket.io.min.js` é uma cópia local da biblioteca cliente, sem CDN.

## API (resumo)

Prefixo `/api`. Todas exigem token, exceto `POST /auth/login`. Detalhes completos no `README.md`.

| Área | Rotas | Perfil |
|---|---|---|
| Auth | `POST /auth/login`, `GET /auth/me` | qualquer |
| Usuários | `GET/POST /auth/users` | admin |
| Produtos | `GET /products` (`?q=&categoria=&status=&sort=&order=`), `/products/stats`, `/products/categories`, `/products/:id` | qualquer |
| Painel | `GET /dashboard` (`?period=7|30|90&months=3|6|12`) | qualquer (valores financeiros só para admin) |
| Painel | `GET /dashboard/sales?month=AAAA-MM` (detalhe das vendas do mês, abre ao clicar no ponto do gráfico) | qualquer (valor em R$ só para admin) |
| Produtos | `POST /products` | qualquer |
| Produtos | `PUT/DELETE /products/:id` | admin |
| Movimentos | `POST /movements` | admin |
| Movimentos | `GET /movements` | qualquer |
| Relatórios | `GET /reports/pdf\|excel\|word` | qualquer |
| Upload | `POST /api/upload/image` (campo `image`) | qualquer |
| Importação | `POST /import/excel` (campo `excel`) | admin |

Respostas seguem o formato `{ success: boolean, ... }` com `error` em caso de falha. Mantenha esse padrão em rotas novas.
**Ordem de rotas importa:** `/products/stats` e `/products/categories` são declaradas antes de `/products/:id`.

## Variáveis de ambiente (`.env`, nunca commitar)

| Variável | Uso |
|---|---|
| `PORT` | Porta do servidor (padrão 3000) |
| `JWT_SECRET` | Assinatura dos tokens |
| `DATABASE_URL` | Opcional. Se definido, usa PostgreSQL/Supabase |
| `DB_SSL` | `true` para forçar SSL no Postgres (Supabase já ativa automaticamente) |
| `SQLITE_PATH` | Opcional. Arquivo do SQLite (padrão `data/estoque.db`). Útil para testes isolados |

## Testes

`test_suite.js` é um script único que faz chamadas HTTP e escuta Socket.io contra `localhost:3000`, **sem mock**. Isso significa que:
- O servidor precisa estar rodando antes (`npm start` em outro terminal).
- Ele cria, altera e apaga dados no banco ativo. **Não rode contra um banco Supabase compartilhado/de produção.**
- Baseline atual: **63 testes passando** (o README ainda diz 29, de antes do painel). Confirme rodando antes de alterar.
- `TEST_PORT` muda a porta alvo (padrão 3000). Combine com `SQLITE_PATH` para testar num banco descartável.

## Trabalho em dupla (Git)

- `main` é a base estável. **Não commite direto nela:** cada tarefa em uma branch.
- Nome das branches: `feat/<assunto>`, `fix/<assunto>`, `docs/<assunto>`. Exemplo: `feat/filtro-fornecedor`.
- Antes de começar: `git checkout main && git pull`, depois `git checkout -b feat/...`.
- Commits pequenos, em português, no padrão do histórico (Conventional Commits): `feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`.
- Abra Pull Request para `main` e peça revisão do outro antes do merge.
- Combinem **quem mexe em qual arquivo** quando for algo grande. Os pontos que mais geram conflito:
  - `src/public/js/app.js` e `src/public/index.html` (arquivos grandes, tudo concentrado).
  - `src/config/database.js` (schema) e `src/routes/api.routes.js`.
  - `package.json` / `package-lock.json`. Não commite `package-lock.json` alterado sem querer; só quando adicionar dependência de propósito.
- Nunca commite `.env`, `data/estoque.db` nem arquivos de `src/public/uploads/`. O `.gitignore` já cobre, mas confira o `git status` antes do commit.
- Conta Git desta máquina: o clone usa o alias SSH `github.com-devpessoal` (chave da conta `alisson-pereira-dev`). Remote de push: `git@github.com-devpessoal:Francisco-Vian4/Sistema-de-estoque.git`.

## Checklist ao implementar mudanças

- **Novo campo de produto**: DDL Postgres + DDL SQLite + migração manual (`database.js`), `create`/`update`/`list` em `product.controller.js`, parser em `excel-import.service.js`, 3 relatórios em `report.controller.js`, formulário e tabela em `index.html`/`app.js`, formulário em `extension/popup.*`, e este arquivo.
- **Nova rota**: definir em `api.routes.js` com `authMiddleware` (+ `requireRole` se restrita), controller com `try/catch` e resposta `{ success, ... }`, e teste novo em `test_suite.js`.
- **Nova escrita que muda estoque**: recalcular `status`/`valor_total_estoque` com as funções de `excel-import.service.js` e chamar `notifyStockUpdate`.
- **Mexeu em UI de perfil**: lembre que esconder na tela não protege a API (ver "Autenticação").
- Antes do PR: subir o servidor, rodar `node test_suite.js` e testar a tela manualmente.

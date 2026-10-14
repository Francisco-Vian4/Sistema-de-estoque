<div align="center">

# 📦 Controle de Estoque Pro

### Sistema Completo de Gestão de Estoque em Tempo Real & Extensão de Navegador

[![Node.js Version](https://img.shields.io/badge/Node.js-v18%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-5.x-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![Socket.io](https://img.shields.io/badge/Socket.io-Real--Time-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](https://socket.io/)
[![Database](https://img.shields.io/badge/PostgreSQL%20%2F%20Supabase-Ready-336791?style=for-the-badge&logo=postgresql&logoColor=white)](https://supabase.com/)
[![Chrome Extension](https://img.shields.io/badge/Extension-Manifest%20V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](#-extens%C3%A3o-para-navegador-chrome--edge)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

<br/>

**Uma solução completa, moderna e responsiva para controle e monitoramento de estoque com foco em Assistência Técnica de Informática e Comércio.**
Inclui **Backend Node.js**, interface web em **azul vibrante**, **extensão para Google Chrome e Microsoft Edge (Manifest V3)**, sincronização instantânea em **tempo real via WebSockets (Socket.io)** e emissão de relatórios em **PDF**, **Excel (.xlsx)** e **Word (.docx)**.

[Funcionalidades](#-funcionalidades-principais) •
[Instalação](#-instalação-e-inicialização) •
[Extensão](#-extensão-para-navegador-chrome--edge) •
[Supabase / PostgreSQL](#-conexão-com-postgresql--supabase) •
[Relatórios](#-central-de-relatórios-pdf-excel-word) •
[API](#-documentação-da-api-rest) •
[Publicar no GitHub](#-passo-a-passo-para-publicar-no-github)

---

</div>

## 🌟 Funcionalidades Principais

- ⚡ **Tempo Real Bidirecional (Socket.io)**: Toda alteração de estoque, novo cadastro ou edição feita no sistema web ou na extensão reflete imediatamente em todas as telas conectadas sem recarregar a página (`F5`).
- 🧩 **Extensão para Navegador (Manifest V3)**: Monitore níveis de estoque, busque itens por prateleira, realize movimentações rápidas (`+1 Entrada` / `-1 Saída`), cadastre novos produtos e retire relatórios diretamente da barra de navegação.
- 🎨 **Interface Moderna em Azul Vibrante**: Design contemporâneo com cartões estilizados em glassmorphism, badges dinâmicos de situação e modo responsivo para desktop, tablets e celulares.
- 📊 **As 20 Colunas Especificadas & Carga Automática**:
  - `Código`, `Categoria`, `Produto / Peça`, `Marca`, `Modelo / Especificação`, `Descrição`, `Unidade`, `Qtd. em Estoque`, `Estoque Mínimo`, `Estoque Máximo`, `Preço de Custo (R$)`, `Preço de Venda (R$)`, `Margem (%)`, `Valor Total em Estoque (R$)`, `Fornecedor`, `Localização (Prateleira)`, `Data de Entrada`, `Status`, `Link da Imagem do Produto`, `Observações`.
  - Carga inicial automática de **35 produtos reais** a partir do arquivo Excel `controle_estoque_assistencia_tecnica.xlsx`.
- 🔐 **Autenticação e Perfis de Usuário (RBAC)**:
  - **Administrador**: Gestão financeira total (custo, venda, margem de lucro), alteração de valores/propriedades, movimentações, exclusão e gestão de usuários.
  - **Operador de Estoque**: Consulta de itens, busca rápida por código/localização e cadastro de novos produtos.
- 📈 **Relatórios em 3 Formatos Oficiais**:
  - **PDF**: Relatório executivo paisagem com cabeçalho institucional, indicadores consolidados e tabela formatada.
  - **Excel (.xlsx)**: Planilha com 2 abas (`Estoque Detalhado` com as 20 colunas e `Resumo Executivo`).
  - **Word (.docx)**: Documento formal estruturado para auditorias e reuniões.
- 🗄️ **Banco de Dados Flexível**:
  - **PostgreSQL / Supabase**: Conexão nativa e automática via `DATABASE_URL`.
  - **SQLite Local Automático**: Funciona imediatamente sem exigir banco externo configurado.

---

## 🏛️ Arquitetura do Sistema

```mermaid
graph TD
    subgraph Clientes
        WEB[💻 Aplicação Web SPA<br/>HTML5 + CSS3 + JS Vanilla]
        EXT[🧩 Extensão Chrome / Edge<br/>Manifest V3]
    end

    subgraph Servidor Node.js
        API[🚀 Express REST API<br/>Rotas, Controllers, JWT Auth]
        SOCK[⚡ Socket.io WebSocket Server<br/>Eventos de Estoque em Tempo Real]
        REP[📄 Report Engine<br/>PDFKit + ExcelJS/XLSX + Docx]
    end

    subgraph Camada de Dados
        DB_ROUTER[🔄 Database Adapter]
        SQLITE[(💾 SQLite Local<br/>estoque.db)]
        PG[(🐘 PostgreSQL / Supabase<br/>Cloud Database)]
    end

    WEB <-->|HTTP REST + WebSocket| API
    EXT <-->|HTTP REST + WebSocket| API
    API <--> SOCK
    API <--> REP
    API <--> DB_ROUTER
    DB_ROUTER -->|Fallback Zero-Config| SQLITE
    DB_ROUTER -->|Se DATABASE_URL configurado| PG
```

---

## 🚀 Instalação e Inicialização

### Pré-requisitos
- [Node.js](https://nodejs.org/) v18.0.0 ou superior
- [Git](https://git-scm.com/)

### 1. Clonar o Repositório
```bash
git clone https://github.com/SEU_USUARIO/sistema-estoque.git
cd sistema-estoque
```

### 2. Instalar as Dependências
```bash
npm install
```

### 3. Configurar as Variáveis de Ambiente
Copie o arquivo de exemplo:
```bash
cp .env.example .env
```
*(Por padrão, o arquivo `.env` já vem pré-configurado para inicialização imediata via SQLite local).*

### 4. Inicializar o Servidor
```bash
npm start
```

O sistema estará acessível em:
- **Interface Web**: [http://localhost:3000](http://localhost:3000)
- **API REST**: [http://localhost:3000/api](http://localhost:3000/api)
- **WebSocket em Tempo Real**: Ativo na porta `3000`

---

## 🔑 Credenciais Padrão de Acesso

O banco é inicializado com 2 usuários pré-cadastrados para teste rápido:

| Perfil | E-mail | Senha | Nível de Acesso |
|---|---|---|---|
| **Administrador** | `admin@estoque.com` | `admin123` | Acesso completo (Relatórios financeiros, margens, movimentações, edição e usuários) |
| **Operador** | `usuario@estoque.com` | `user123` | Consulta de catálogo, prateleiras e cadastro de novos produtos |

> 💡 *A tela de login possui botões de 1 clique para preencher automaticamente as credenciais de teste.*

---

## 🧩 Extensão para Navegador (Chrome & Edge)

A extensão está localizada no diretório `/extension` do projeto e utiliza o padrão moderno **Manifest V3**.

### Como Instalar:
1. Abra o navegador e acesse a página de extensões:
   - **Google Chrome**: `chrome://extensions`
   - **Microsoft Edge**: `edge://extensions`
2. No canto superior direito, ative a opção **"Modo do desenvolvedor"** (Developer mode).
3. Clique no botão **"Carregar sem compactação"** (Load unpacked).
4. Selecione a pasta `extension` dentro do projeto:
   ```
   sistema-estoque/extension
   ```
5. Fixe o ícone da caixa 📦 na barra de extensões do navegador.
6. Clique no ícone, informe a URL do servidor (`http://localhost:3000`) e faça login com suas credenciais.

### Recursos da Extensão:
- 🟢 **Indicador de Conexão em Tempo Real**: Sinalizador luminoso que indica o status da conexão WebSocket.
- 📋 **Lista Rápida com Busca**: Encontre peças por código, modelo, marca ou prateleira sem abrir nova aba.
- ⚡ **Movimentação Express**: Botões rápidos `+` e `-` para registrar entrada e saída de estoque em 1 clique.
- ➕ **Cadastrar Produto**: Formulário com cálculo de margem em tempo real.
- 📥 **Baixar Relatórios**: Botões diretos para download de relatórios em **PDF**, **Excel** e **Word**.

---

## 🗄️ Conexão com PostgreSQL / Supabase

O sistema possui uma camada de abstração em `src/config/database.js` com auto-detecção:

### 1. SQLite Local (Padrão)
Se nenhuma string de banco de dados externa for fornecida, o sistema inicia com banco SQLite persistido em `data/estoque.db`.

### 2. Supabase / PostgreSQL Remoto
Para conectar à sua nuvem no Supabase:
1. Acesse o painel do **Supabase** &rarr; *Project Settings* &rarr; *Database* &rarr; *Connection string* &rarr; *URI*.
2. Abra seu arquivo `.env` e configure:
   ```env
   PORT=3000
   JWT_SECRET=sua_chave_secreta_jwt_aqui
   DATABASE_URL=postgresql://postgres:[SUA_SENHA]@db.[SEU_REF].supabase.co:5432/postgres
   DB_SSL=true
   ```
3. Reinicie a aplicação:
   ```bash
   npm start
   ```
4. As tabelas `produtos`, `usuarios` e `movimentacoes_estoque` serão criadas e os 35 produtos da planilha serão carregados automaticamente!

---

## 📑 As 20 Colunas da Tabela de Produtos

| Nº | Coluna | Tipo | Descrição / Regra |
|:---:|---|---|---|
| 1 | `Código` | VARCHAR(50) | Identificador único (ex: `EST-001`, `EST-035`) |
| 2 | `Categoria` | VARCHAR(100) | Armazenamento, Memória RAM, Fontes, etc. |
| 3 | `Produto / Peça` | VARCHAR(255) | Nome descritivo da peça ou componente |
| 4 | `Marca` | VARCHAR(100) | Kingston, WD, Corsair, Crucial, Seagate, etc. |
| 5 | `Modelo / Especificação` | VARCHAR(255) | Part number ou modelo técnico |
| 6 | `Descrição` | TEXT | Especificações técnicas completas |
| 7 | `Unidade` | VARCHAR(20) | `UN`, `CX`, `PCT`, `KIT`, etc. |
| 8 | `Qtd. em Estoque` | INTEGER | Saldo físico atual |
| 9 | `Estoque Mínimo` | INTEGER | Ponto de reposição |
| 10 | `Estoque Máximo` | INTEGER | Limite operacional |
| 11 | `Preço de Custo (R$)` | NUMERIC(10,2) | Valor de compra / nota |
| 12 | `Preço de Venda (R$)` | NUMERIC(10,2) | Preço praticado ao cliente |
| 13 | `Margem (%)` | NUMERIC(6,2) | Calculada: `((Venda - Custo) / Custo) * 100` |
| 14 | `Valor Total em Estoque`| NUMERIC(12,2) | Calculado: `Qtd * Custo` |
| 15 | `Fornecedor` | VARCHAR(200) | Fornecedor ou distribuidor |
| 16 | `Localização (Prateleira)`| VARCHAR(100) | Posição física na oficina (ex: `A1-01`, `A2-05`) |
| 17 | `Data de Entrada` | VARCHAR(50) | Data de cadastro ou lote |
| 18 | `Status` | VARCHAR(50) | `OK`, `ESTOQUE BAIXO`, `SEM ESTOQUE`, `EXCESSO` |
| 19 | `Link da Imagem` | TEXT | URL direta da foto com visualizador interativo |
| 20 | `Observações` | TEXT | Notas operacionais de garantia ou saída |

---

## 📊 Central de Relatórios (PDF, Excel, Word)

Os relatórios podem ser gerados tanto na página web quanto na extensão com filtros por categoria e status:

| Formato | Biblioteca | Destaques |
|---|---|---|
| **PDF** | `pdfkit-table` | Orientação paisagem, cabeçalho institucional em azul vibrante, indicadores gerenciais e paginação automática. |
| **Excel (.xlsx)** | `xlsx` | Arquivo idêntico à planilha oficial de assistência técnica com 2 abas: `Estoque` (20 colunas) e `Resumo` (métricas consolidadas). |
| **Word (.docx)** | `docx` | Documento formal estruturado para relatórios gerenciais, auditorias e impressão. |

---

## 📡 Documentação da API REST

Todas as rotas (exceto login) exigem o cabeçalho `Authorization: Bearer <TOKEN>` ou o parâmetro `?token=<TOKEN>` (utilizado para downloads de relatórios).

### Autenticação
- `POST /api/auth/login` — Autenticação de usuário e retorno do JWT.
- `GET /api/auth/me` — Retorna os dados do usuário autenticado.
- `GET /api/auth/users` — *(Admin)* Lista usuários do sistema.
- `POST /api/auth/users` — *(Admin)* Cadastra novo usuário.

### Produtos
- `GET /api/products` — Lista produtos com busca (`?q=`), filtros de categoria (`?categoria=`) e status (`?status=`).
- `GET /api/products/stats` — Retorna os KPIs do Dashboard (totais, margens médias, distribuição).
- `GET /api/products/categories` — Lista categorias únicas cadastradas.
- `GET /api/products/:id` — Retorna os detalhes de um produto.
- `POST /api/products` — Cadastra novo produto *(Admin e Operador)* com cálculo automático de margem e status.
- `PUT /api/products/:id` — *(Admin)* Edita propriedades e valores do produto.
- `DELETE /api/products/:id` — *(Admin)* Exclui um produto do catálogo.

### Movimentações de Estoque
- `POST /api/movements` — *(Admin)* Registra movimentação (`ENTRADA`, `SAIDA`, `AJUSTE`), recalcula saldo e emite evento WebSocket.
- `GET /api/movements` — Histórico detalhado de movimentações com auditoria e usuário responsável.

### Relatórios
- `GET /api/reports/pdf` — Emite e baixa relatório em PDF.
- `GET /api/reports/excel` — Emite e baixa relatório em Excel (.xlsx).
- `GET /api/reports/word` — Emite e baixa relatório em Word (.docx).

### Importação & Uploads
- `POST /api/import/excel` — *(Admin)* Importa arquivo de planilha Excel atualizando o banco de dados.
- `POST /api/upload/image` — Upload de foto de produto.

---

## 🧪 Testes de Integração e Qualidade

O projeto inclui uma bateria de testes automatizados de ponta a ponta que valida autenticação, CRUD, cálculos financeiros, emissão de relatórios e recepção de eventos via WebSockets:

```bash
node test_suite.js
```

**Resultado dos Testes:**
```
=======================================================
📊 RESULTADOS: 29 PASSARAM, 0 FALHARAM (100% SUCESSO)
=======================================================
```

---

## 🚀 Passo a Passo para Publicar no GitHub

Siga os comandos abaixo no terminal dentro da pasta do projeto para publicar no seu perfil do GitHub:

```bash
# 1. Navegue até a pasta do projeto
cd C:\Users\franc\.gemini\antigravity\scratch\sistema-estoque

# 2. Inicialize o repositório Git local
git init

# 3. Adicione todos os arquivos (o .gitignore protegerá node_modules e segredos)
git add .

# 4. Crie o primeiro commit
git commit -m "feat: release initial - sistema de estoque pro com extensao e tempo real"

# 5. Defina a branch principal como main
git branch -M main

# 6. Conecte ao seu repositório no GitHub (substitua com o link do seu repo criado)
git remote add origin https://github.com/SEU_USUARIO/sistema-estoque.git

# 7. Envie os arquivos para o GitHub
git push -u origin main
```

---

## 📂 Estrutura de Pastas do Repositório

```
sistema-estoque/
├── .env.example              # Modelo de variáveis de ambiente
├── .gitignore                # Arquivos ignorados pelo Git (node_modules, .env, etc.)
├── LICENSE                   # Licença MIT
├── package.json              # Metadados e dependências do projeto
├── README.md                 # Documentação oficial do projeto
├── test_suite.js             # Bateria de testes de integração automatizados
├── data/
│   └── controle_estoque_assistencia_tecnica.xlsx # Planilha base com os 35 produtos
├── extension/                # Extensão para Google Chrome e Microsoft Edge (Manifest V3)
│   ├── manifest.json         # Manifesto V3 da extensão
│   ├── popup.html            # Interface popup da extensão
│   ├── popup.css             # Estilização azul da extensão
│   ├── popup.js              # Lógica da extensão (API + Socket.io em tempo real)
│   ├── socket.io.min.js      # Biblioteca Socket.io empacotada
│   └── icons/                # Ícones da extensão (16x16, 48x48, 128x128)
└── src/
    ├── server.js             # Servidor HTTP + Express + Socket.io
    ├── seed.js               # Script de carga inicial automática
    ├── config/
    │   ├── database.js       # Camada de banco (PostgreSQL/Supabase + SQLite local)
    │   └── auth.js           # Middleware JWT e controle de permissões (RBAC)
    ├── controllers/
    │   ├── auth.controller.js     # Login, perfis e usuários
    │   ├── product.controller.js  # CRUD de produtos e KPIs
    │   ├── movement.controller.js # Entradas, saídas e histórico
    │   └── report.controller.js   # Geradores PDF, Excel (.xlsx) e Word (.docx)
    ├── routes/
    │   └── api.routes.js     # Definição de endpoints da API
    ├── services/
    │   ├── excel-import.service.js # Leitura e parsing da planilha Excel
    │   └── realtime.service.js     # Transmissão de eventos WebSocket
    └── public/               # Frontend Web SPA (Azul Vibrante)
        ├── index.html        # Página principal com Dashboard, Tabela e Modais
        ├── css/
        │   └── styles.css    # Estilização com paleta em azul elétrico
        └── js/
            ├── app.js        # Lógica do painel web e interatividade
            ├── auth.js       # Controle de sessão web
            └── socket-client.js # Cliente WebSocket em tempo real
```

---

## 📄 Licença

Este projeto é distribuído sob a licença **MIT**. Consulte o arquivo [LICENSE](LICENSE) para mais detalhes.

<div align="center">
Desenvolvido com excelência técnica para controle eficiente de estoque em tempo real.
</div>

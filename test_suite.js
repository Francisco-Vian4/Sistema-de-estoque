const http = require('http');
const io = require('socket.io-client');

// Porta do servidor sob teste (padrão 3000). Ex.: TEST_PORT=3100 node test_suite.js
const TEST_PORT = Number(process.env.TEST_PORT) || 3000;

async function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      'Content-Type': 'application/json'
    };
    if (options.token) {
      defaultHeaders['Authorization'] = `Bearer ${options.token}`;
    }

    const reqOptions = {
      hostname: 'localhost',
      port: TEST_PORT,
      path,
      method: options.method || 'GET',
      headers: { ...defaultHeaders, ...(options.headers || {}) }
    };

    const req = http.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const bodyBuffer = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || '';
        let json = null;
        if (contentType.includes('application/json')) {
          try {
            json = JSON.parse(bodyBuffer.toString());
          } catch (e) {}
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json || bodyBuffer,
          rawBuffer: bodyBuffer
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('🧪 INICIANDO BATERIA DE TESTES DE INTEGRAÇÃO...');
  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. Teste de Login Admin
  console.log('\n--- 1. Autenticação Admin ---');
  const adminLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@estoque.com', password: 'admin123' }
  });
  assert(adminLogin.statusCode === 200 && adminLogin.body.success, 'Login Admin com sucesso');
  const adminToken = adminLogin.body.token;
  assert(adminLogin.body.user.role === 'admin', 'Perfil de usuário retornado é admin');

  // 2. Teste de Login Usuário Operador
  console.log('\n--- 2. Autenticação Operador ---');
  const userLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'usuario@estoque.com', password: 'user123' }
  });
  assert(userLogin.statusCode === 200 && userLogin.body.success, 'Login Operador com sucesso');
  const userToken = userLogin.body.token;
  assert(userLogin.body.user.role === 'user', 'Perfil de usuário retornado é user');

  // 3. Teste de Listagem de Produtos
  console.log('\n--- 3. Catálogo de Produtos e Colunas ---');
  const prods = await request('/api/products', { token: adminToken });
  assert(prods.statusCode === 200 && prods.body.count >= 35, `Carregou 35+ produtos (encontrados: ${prods.body.count})`);

  const sample = prods.body.data[0];
  const requiredCols = [
    'codigo', 'categoria', 'produto', 'marca', 'modelo', 'descricao', 'unidade',
    'qtd_estoque', 'estoque_minimo', 'estoque_maximo', 'preco_custo', 'preco_venda',
    'margem_percent', 'valor_total_estoque', 'fornecedor', 'localizacao', 'data_entrada',
    'status', 'imagem_url', 'observacoes'
  ];
  const hasAllCols = requiredCols.every(col => col in sample);
  assert(hasAllCols, 'Todas as 20 colunas da planilha estão presentes no banco');

  // 4. Teste de Estatísticas / KPIs
  console.log('\n--- 4. Métricas e KPIs do Dashboard ---');
  const statsRes = await request('/api/products/stats', { token: adminToken });
  assert(statsRes.statusCode === 200 && statsRes.body.success, 'Estatísticas obtidas com sucesso');
  const stats = statsRes.body.stats;
  assert(stats.total_itens >= 35, `Total de itens cadastrados: ${stats.total_itens}`);
  assert(stats.total_quantidade >= 400, `Quantidade física total: ${stats.total_quantidade}`);
  assert(stats.valor_total_custo > 30000, `Valor de custo consolidado: R$ ${stats.valor_total_custo}`);
  assert(stats.categorias.length >= 10, `Categorias identificadas: ${stats.categorias.length}`);

  // 4.1 Painel Geral (/api/dashboard)
  console.log('\n--- 4.1 Painel Geral: cards, gráfico e rankings ---');
  const dashAdmin = await request('/api/dashboard?period=30&months=6', { token: adminToken });
  assert(dashAdmin.statusCode === 200 && dashAdmin.body.success, 'Painel carregado para o Admin');
  const dash = dashAdmin.body.data;
  assert(dash.cards.total_itens >= 35, `Painel conta os itens cadastrados: ${dash.cards.total_itens}`);
  assert(dash.cards.valor_estoque && dash.cards.valor_estoque.valor > 30000, 'Admin recebe o valor total do estoque');
  assert(dash.cards.margem_media && typeof dash.cards.margem_media.valor === 'number', 'Admin recebe a margem média');
  assert(typeof dash.cards.itens_sem_saida.valor === 'number' && typeof dash.cards.estoque_baixo.valor === 'number', 'Cards de itens sem saída e estoque baixo presentes');
  const risco = dash.cards.risco_ruptura;
  assert(risco && typeof risco.valor === 'number' && risco.limiar_dias === 15 && risco.consumo_dias === 30, 'Card Risco de ruptura traz valor, limiar (15 dias) e janela de consumo (30 dias)');
  assert(Array.isArray(risco.itens) && risco.itens.length === Math.min(risco.valor, 50), 'Lista de itens em risco coerente com a contagem do card');
  assert(risco.itens.every(i => i.zerado || i.dias <= risco.limiar_dias), 'Todo item em risco está zerado ou esgota em até 15 dias');
  assert(risco.itens.every((i, k, a) => k === 0 || a[k - 1].dias <= i.dias), 'Itens em risco ordenados do mais urgente para o menos urgente');
  assert(risco.itens.every(i => i.sugestao >= 0 && i.consumo_diario > 0), 'Cada item em risco tem consumo diário e reposição sugerida válidos');
  assert(risco.valor === 0 ? risco.menor_prazo_dias === null && risco.zerados === 0 : (risco.menor_prazo_dias === null) === (risco.zerados === risco.valor),
    'Menor prazo só é nulo quando todos os itens em risco já estão zerados');
  assert(typeof dash.cards.itens_sem_saida.valor_parado === 'number' && dash.cards.itens_sem_saida.valor_parado >= 0, 'Admin recebe o valor parado dos itens sem saída');
  assert(Array.isArray(dash.serie) && dash.serie.length === 6, `Série do gráfico com 6 meses (recebidos: ${dash.serie.length})`);
  assert(Array.isArray(dash.ranking) && dash.ranking.length <= 5, 'Ranking limitado a 5 itens');
  assert(Array.isArray(dash.sem_saida) && dash.sem_saida.length <= 5, 'Lista de itens sem saída limitada a 5');
  assert(Array.isArray(dash.ultimas) && dash.ultimas.length <= 5, 'Últimas movimentações limitadas a 5');

  const dashUser = await request('/api/dashboard', { token: userToken });
  assert(dashUser.statusCode === 200 && !('valor_estoque' in dashUser.body.data.cards) && !('margem_media' in dashUser.body.data.cards),
    'Operador NÃO recebe valores financeiros do painel');
  assert(dashUser.body.data.cards.itens_sem_saida.valor_parado === undefined && dashUser.body.data.cards.risco_ruptura.valor >= 0,
    'Operador NÃO recebe o valor parado, mas vê o Risco de ruptura');

  const dashBadParams = await request('/api/dashboard?period=abc&months=999', { token: adminToken });
  assert(dashBadParams.statusCode === 200 && dashBadParams.body.data.periodo_dias === 30 && dashBadParams.body.data.meses === 6,
    'Parâmetros inválidos caem nos valores padrão (30 dias / 6 meses)');

  const dashNoToken = await request('/api/dashboard');
  assert(dashNoToken.statusCode === 401, 'Painel exige autenticação');

  // 4.2 Vendas de um mês (clique no gráfico)
  console.log('\n--- 4.2 Detalhe das vendas do mês ---');
  assert(/^\d{4}-\d{2}$/.test(dash.serie[0].chave), `Cada ponto da série traz a chave do mês (${dash.serie[0].chave})`);
  const monthKey = dash.serie[dash.serie.length - 1].chave;
  const salesAdmin = await request(`/api/dashboard/sales?month=${monthKey}`, { token: adminToken });
  assert(salesAdmin.statusCode === 200 && salesAdmin.body.success && Array.isArray(salesAdmin.body.data.itens), 'Admin recebe a lista de itens vendidos no mês');
  const salesData = salesAdmin.body.data;
  assert(salesData.total.valor !== undefined, 'Admin recebe o valor total vendido');
  assert(salesData.itens.every(i => i.valor !== undefined), 'Admin recebe o valor vendido por item');
  assert(salesData.total.quantidade === salesData.itens.reduce((s, i) => s + i.quantidade, 0), 'Total de unidades confere com a soma dos itens');
  const sumValues = Number(salesData.itens.reduce((s, i) => s + i.valor, 0).toFixed(2));
  assert(salesData.total.valor === sumValues, 'Valor total confere com a soma dos itens');
  assert(salesData.itens.every((item, i, arr) => i === 0 || arr[i - 1].quantidade >= item.quantidade), 'Itens ordenados por quantidade vendida (maior primeiro)');

  const lastPoint = dash.serie[dash.serie.length - 1];
  assert(typeof lastPoint.entradas === 'number' && lastPoint.entradas >= 0, 'Série mensal traz as entradas (reposição)');
  assert(typeof lastPoint.faturamento === 'number' && lastPoint.faturamento >= 0, 'Admin recebe o faturamento mensal na série');
  assert(lastPoint.valor === salesData.total.quantidade && Math.abs(lastPoint.faturamento - salesData.total.valor) < 0.01,
    'Ponto do gráfico (unidades e faturamento) bate com o detalhe de vendas do mês');
  assert(dashUser.body.data.serie.every(p => p.faturamento === undefined && typeof p.entradas === 'number'),
    'Operador NÃO recebe faturamento na série (mas vê entradas e saídas)');

  const salesUser = await request(`/api/dashboard/sales?month=${monthKey}`, { token: userToken });
  assert(salesUser.statusCode === 200 && salesUser.body.data.total.valor === undefined && salesUser.body.data.itens.every(i => i.valor === undefined),
    'Operador NÃO recebe valores em R$ do detalhe de vendas');
  const salesBad = await request('/api/dashboard/sales?month=2026-13', { token: adminToken });
  assert(salesBad.statusCode === 400, 'Mês inválido retorna 400');
  const salesNoToken = await request(`/api/dashboard/sales?month=${monthKey}`);
  assert(salesNoToken.statusCode === 401, 'Detalhe de vendas exige autenticação');

  // 5. Teste de WebSocket Tempo Real
  console.log('\n--- 5. Conexão em Tempo Real (Socket.io) ---');
  let socketReceivedUpdate = false;
  const socket = io(`http://localhost:${TEST_PORT}`);
  await new Promise((resolve) => {
    socket.on('connect', () => {
      assert(true, 'Cliente Socket.io conectado com sucesso');
      resolve();
    });
  });

  socket.on('stock_updated', (event) => {
    socketReceivedUpdate = true;
    console.log(`    ⚡ Evento WebSocket recebido: [${event.type}]`);
  });

  // 6. Teste de Cadastro de Novo Produto
  console.log('\n--- 6. Cadastro de Novo Produto (EST-TEST-01) ---');
  const newProdRes = await request('/api/products', {
    method: 'POST',
    token: userToken, // Operador pode cadastrar!
    body: {
      codigo: 'EST-TEST-01',
      categoria: 'Armazenamento',
      produto: 'SSD NVMe Teste 2TB',
      marca: 'Crucial',
      modelo: 'P3 Plus 2TB',
      descricao: 'SSD NVMe para teste automatizado',
      unidade: 'UN',
      qtd_estoque: 10,
      estoque_minimo: 2,
      estoque_maximo: 20,
      preco_custo: 350.00,
      preco_venda: 599.90,
      fornecedor: 'Distribuidor Teste',
      localizacao: 'B1-02'
    }
  });
  assert(newProdRes.statusCode === 201 && newProdRes.body.success, 'Produto novo cadastrado pelo Operador com sucesso');
  const createdProd = newProdRes.body.data;
  assert(createdProd.status === 'OK', `Status calculado automaticamente: ${createdProd.status}`);
  assert(createdProd.margem_percent > 70, `Margem calculada automaticamente: ${createdProd.margem_percent}%`);
  assert(createdProd.valor_total_estoque === 3500, `Valor total calculado: R$ ${createdProd.valor_total_estoque}`);

  // Aguarda evento Socket
  await new Promise(r => setTimeout(r, 600));
  assert(socketReceivedUpdate, 'Evento em tempo real (PRODUCT_CREATED) recebido via WebSocket');

  // 7. Teste de Movimentação de Estoque (Admin)
  console.log('\n--- 7. Movimentação de Estoque (Entrada de +5 unidades) ---');
  const movRes = await request('/api/movements', {
    method: 'POST',
    token: adminToken,
    body: {
      produto_id: createdProd.id,
      tipo: 'ENTRADA',
      quantidade: 5,
      motivo: 'Compra de lote suplementar teste'
    }
  });
  assert(movRes.statusCode === 201 && movRes.body.success, 'Movimentação registrada');
  assert(movRes.body.data.quantidade_nova === 15, `Novo saldo verificado: ${movRes.body.data.quantidade_nova} UN`);

  // 8. Teste de Bloqueio de Acesso Operador a funções Admin
  console.log('\n--- 8. Segurança de Permissões (Role-Based Access Control) ---');
  const blockedDelete = await request(`/api/products/${createdProd.id}`, {
    method: 'DELETE',
    token: userToken // Usuário operador NÃO pode excluir
  });
  assert(blockedDelete.statusCode === 403, 'Operador proibido de excluir produto (403 Forbidden esperado)');

  // 9. Teste de Emissão de Relatório PDF
  console.log('\n--- 9. Relatório PDF ---');
  const pdfRes = await request('/api/reports/pdf', { token: adminToken });
  assert(pdfRes.statusCode === 200, 'Relatório PDF gerado com código 200');
  assert(pdfRes.headers['content-type'].includes('application/pdf'), 'Content-Type é application/pdf');
  assert(pdfRes.rawBuffer.slice(0, 4).toString() === '%PDF', 'Cabeçalho binário do PDF (%PDF) válido');

  // 10. Teste de Emissão de Relatório Excel (.xlsx)
  console.log('\n--- 10. Relatório Excel (.xlsx) ---');
  const excelRes = await request('/api/reports/excel', { token: adminToken });
  assert(excelRes.statusCode === 200, 'Relatório Excel gerado com código 200');
  assert(excelRes.headers['content-type'].includes('spreadsheetml'), 'Content-Type é openxmlformats (Excel)');
  assert(excelRes.rawBuffer.length > 5000, `Arquivo Excel gerado com sucesso (${excelRes.rawBuffer.length} bytes)`);

  // 11. Teste de Emissão de Relatório Word (.docx)
  console.log('\n--- 11. Relatório Word (.docx) ---');
  const wordRes = await request('/api/reports/word', { token: adminToken });
  assert(wordRes.statusCode === 200, 'Relatório Word gerado com código 200');
  assert(wordRes.headers['content-type'].includes('wordprocessingml'), 'Content-Type é openxmlformats (Word)');
  assert(wordRes.rawBuffer.length > 3000, `Documento Word gerado com sucesso (${wordRes.rawBuffer.length} bytes)`);

  // Limpeza: Admin exclui o produto de teste
  await request(`/api/products/${createdProd.id}`, {
    method: 'DELETE',
    token: adminToken
  });

  socket.disconnect();

  console.log('\n=======================================================');
  console.log(`📊 RESULTADOS: ${passed} PASSARAM, ${failed} FALHARAM`);
  console.log('=======================================================');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});

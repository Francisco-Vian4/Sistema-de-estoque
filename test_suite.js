const http = require('http');
const io = require('socket.io-client');

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
      port: 3000,
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

  // 5. Teste de WebSocket Tempo Real
  console.log('\n--- 5. Conexão em Tempo Real (Socket.io) ---');
  let socketReceivedUpdate = false;
  const socket = io('http://localhost:3000');
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

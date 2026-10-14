let productsList = [];
let categoriesList = [];
let searchDebounceTimeout = null;

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initSocketClient();

  if (currentToken) {
    loadDashboard();
    loadProducts();
    loadCategories();
    loadMovements();
    if (currentUser && currentUser.role === 'admin') {
      loadUsers();
    }
  }
});

// Navegação entre abas
function switchTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.sidebar-menu .nav-item').forEach(el => el.classList.remove('active'));

  const targetPane = document.getElementById(`tab-${tabId}`);
  if (targetPane) targetPane.classList.add('active');

  const titles = {
    dashboard: 'Painel Geral & Indicadores',
    products: 'Catálogo de Produtos & Estoque',
    movements: 'Histórico de Movimentações',
    reports: 'Central de Relatórios & Exportações',
    users: 'Gestão de Usuários & Perfis',
    database: 'Banco de Dados & Conexão Supabase'
  };

  document.getElementById('topbarTitle').textContent = titles[tabId] || 'Estoque Pro';

  // Highlight active menu button
  const buttons = document.querySelectorAll('.sidebar-menu .nav-item');
  buttons.forEach(btn => {
    if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(tabId)) {
      btn.classList.add('active');
    }
  });

  if (tabId === 'movements') loadMovements();
  if (tabId === 'users') loadUsers();
}

// 1. CARREGAR DASHBOARD
async function loadDashboard(showLoading = true) {
  try {
    const res = await fetch('/api/products/stats', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const { stats } = await res.json();

    document.getElementById('kpiTotalItens').textContent = stats.total_itens;
    document.getElementById('kpiTotalQtd').textContent = stats.total_quantidade;
    document.getElementById('kpiValorCusto').textContent = `R$ ${stats.valor_total_custo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    document.getElementById('kpiValorVenda').textContent = `R$ ${stats.valor_total_venda.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    document.getElementById('kpiMargemSub').textContent = `Margem média estimada: ${stats.margem_media_percent}%`;
    document.getElementById('kpiEstoqueBaixo').textContent = stats.status.baixo;
    document.getElementById('kpiSemEstoque').textContent = stats.status.sem_estoque;

    document.getElementById('sidebarProdCount').textContent = stats.total_itens;

    // Renderiza barras de categorias
    const catContainer = document.getElementById('categoryBarsList');
    catContainer.innerHTML = '';
    const maxCat = stats.categorias.length > 0 ? stats.categorias[0].total_itens : 1;
    document.getElementById('catCountBadge').textContent = `${stats.categorias.length} categorias`;

    stats.categorias.forEach(c => {
      const pct = Math.round((c.total_itens / maxCat) * 100);
      const itemEl = document.createElement('div');
      itemEl.className = 'cat-bar-item';
      itemEl.innerHTML = `
        <div class="cat-bar-info">
          <span>${c.categoria}</span>
          <strong>${c.total_itens} itens</strong>
        </div>
        <div class="cat-bar-track">
          <div class="cat-bar-fill" style="width: ${pct}%"></div>
        </div>
      `;
      catContainer.appendChild(itemEl);
    });

    // Atualiza feed recente no painel
    loadRecentFeed();
  } catch (err) {
    console.error('Erro ao carregar dashboard:', err);
  }
}

// 2. CARREGAR FEED DE MOVIMENTAÇÕES RECENTES
async function loadRecentFeed() {
  try {
    const res = await fetch('/api/movements?limit=6', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const { data } = await res.json();
    const feedContainer = document.getElementById('recentMovementsFeed');
    feedContainer.innerHTML = '';

    if (!data || data.length === 0) {
      feedContainer.innerHTML = '<p class="text-muted" style="text-align:center; padding: 20px; font-size:12px; color: #94a3b8;">Nenhuma movimentação recente registrada.</p>';
      return;
    }

    data.forEach(m => {
      const item = document.createElement('div');
      item.className = 'mov-feed-item';
      const iconClass = m.tipo === 'ENTRADA' ? 'entrada' : m.tipo === 'SAIDA' ? 'saida' : 'ajuste';
      const icon = m.tipo === 'ENTRADA' ? 'fa-arrow-down' : m.tipo === 'SAIDA' ? 'fa-arrow-up' : 'fa-sliders';
      const formattedDate = new Date(m.data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

      item.innerHTML = `
        <div class="mov-item-left">
          <div class="mov-badge-icon ${iconClass}">
            <i class="fa-solid ${icon}"></i>
          </div>
          <div>
            <strong style="font-size: 13px; color: #1e293b;">${m.produto_codigo} &bull; ${m.produto_nome}</strong>
            <div style="font-size: 11px; color: #64748b;">${m.motivo || m.tipo} por <em>${m.usuario_nome || 'Sistema'}</em></div>
          </div>
        </div>
        <div style="text-align: right;">
          <strong style="font-size: 13px; color: ${m.tipo === 'ENTRADA' ? '#059669' : m.tipo === 'SAIDA' ? '#dc2626' : '#2563eb'};">
            ${m.tipo === 'ENTRADA' ? '+' : m.tipo === 'SAIDA' ? '-' : ''}${m.quantidade} ${m.unidade || 'UN'}
          </strong>
          <div style="font-size: 10px; color: #94a3b8;">${formattedDate}</div>
        </div>
      `;
      feedContainer.appendChild(item);
    });
  } catch (e) {}
}

// 3. CARREGAR PRODUTOS (COM AS 20 COLUNAS)
async function loadProducts(showToastOnDone = false) {
  try {
    const q = document.getElementById('prodSearchInput').value.trim();
    const categoria = document.getElementById('filterCategory').value;
    const status = document.getElementById('filterStatus').value;

    let url = `/api/products?categoria=${encodeURIComponent(categoria)}&status=${encodeURIComponent(status)}`;
    if (q) url += `&q=${encodeURIComponent(q)}`;

    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) return;
    const json = await res.json();
    productsList = json.data;

    renderProductsTable(productsList);
    document.getElementById('tableResultsCount').textContent = `Mostrando ${productsList.length} produto(s) cadastrado(s)`;
  } catch (err) {
    console.error('Erro ao buscar produtos:', err);
  }
}

function renderProductsTable(products) {
  const tbody = document.getElementById('productsTableBody');
  tbody.innerHTML = '';
  const isAdmin = currentUser && currentUser.role === 'admin';

  if (products.length === 0) {
    tbody.innerHTML = `<tr><td colspan="20" style="text-align:center; padding: 40px; color: #64748b; font-size:14px;"><i class="fa-solid fa-box-archive" style="font-size: 24px; margin-bottom: 8px; display:block;"></i> Nenhum produto encontrado com os filtros selecionados.</td></tr>`;
    return;
  }

  products.forEach(p => {
    const tr = document.createElement('tr');
    if (p.status === 'SEM ESTOQUE') tr.classList.add('row-danger');
    else if (p.status === 'ESTOQUE BAIXO') tr.classList.add('row-warning');

    const statusBadge = p.status === 'OK'
      ? '<span class="badge badge-success">OK</span>'
      : p.status === 'ESTOQUE BAIXO'
      ? '<span class="badge badge-warning">BAIXO</span>'
      : p.status === 'SEM ESTOQUE'
      ? '<span class="badge badge-danger">SEM ESTOQUE</span>'
      : `<span class="badge badge-primary">${p.status}</span>`;

    const imgThumb = p.imagem_url
      ? `<img src="${p.imagem_url}" class="prod-thumb" alt="${p.produto}" onclick="previewImageDirect('${p.imagem_url}', '${p.produto}')" onerror="this.src='https://via.placeholder.com/40x40?text=Sem+Foto'">`
      : `<div class="prod-thumb-placeholder"><i class="fa-solid fa-microchip"></i></div>`;

    const adminCostCol = isAdmin ? `<td>R$ ${p.preco_custo.toFixed(2)}</td>` : '';
    const adminMarginCol = isAdmin ? `<td><strong>${p.margem_percent.toFixed(1)}%</strong></td>` : '';
    const adminTotalCol = isAdmin ? `<td><strong>R$ ${p.valor_total_estoque.toFixed(2)}</strong></td>` : '';

    const actionsHtml = `
      <div style="display: flex; gap: 4px;">
        <button class="btn btn-xs btn-outline" title="Ver Detalhes" onclick="viewProductDetails(${p.id})">
          <i class="fa-solid fa-eye"></i>
        </button>
        ${isAdmin ? `
          <button class="btn btn-xs btn-outline" title="Movimentar Estoque" onclick="openNewMovementModal(${p.id})">
            <i class="fa-solid fa-dolly"></i>
          </button>
          <button class="btn btn-xs btn-outline" title="Editar Propriedades e Preços" onclick="openEditProductModal(${p.id})">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="btn btn-xs btn-danger" title="Excluir" onclick="handleDeleteProduct(${p.id}, '${p.codigo}')">
            <i class="fa-solid fa-trash"></i>
          </button>
        ` : ''}
      </div>
    `;

    tr.innerHTML = `
      <td>${actionsHtml}</td>
      <td>${imgThumb}</td>
      <td><strong style="color: #1e40af; font-family: 'JetBrains Mono', monospace;">${p.codigo}</strong></td>
      <td><strong style="color: #0f172a;">${p.produto}</strong></td>
      <td><span class="badge badge-light">${p.categoria || '-'}</span></td>
      <td>${p.marca || '-'}</td>
      <td><small style="color: #475569;">${p.modelo || '-'}</small></td>
      <td>${p.unidade || 'UN'}</td>
      <td><strong style="font-size: 14px; color: ${p.qtd_estoque <= p.estoque_minimo ? '#dc2626' : '#059669'};">${p.qtd_estoque}</strong></td>
      <td><small>${p.estoque_minimo}</small></td>
      <td><small>${p.estoque_maximo}</small></td>
      ${adminCostCol}
      <td><strong>R$ ${p.preco_venda.toFixed(2)}</strong></td>
      ${adminMarginCol}
      ${adminTotalCol}
      <td><span style="background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">${p.localizacao || '-'}</span></td>
      <td><small>${p.fornecedor || '-'}</small></td>
      <td><small>${p.data_entrada || '-'}</small></td>
      <td>${statusBadge}</td>
      <td><small style="color: #64748b;">${p.observacoes || '-'}</small></td>
    `;

    tbody.appendChild(tr);
  });
}

function onProdSearch() {
  clearTimeout(searchDebounceTimeout);
  searchDebounceTimeout = setTimeout(() => {
    loadProducts();
  }, 300);
}

function debounceGlobalSearch(e) {
  const query = e.target.value.trim();
  switchTab('products');
  document.getElementById('prodSearchInput').value = query;
  loadProducts();
}

// 4. CARREGAR CATEGORIAS
async function loadCategories() {
  try {
    const res = await fetch('/api/products/categories', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const { categories } = await res.json();
    categoriesList = categories;

    const selectFilter = document.getElementById('filterCategory');
    const selectReport = document.getElementById('reportCategory');
    const datalist = document.getElementById('categoryDatalist');

    selectFilter.innerHTML = '<option value="TODAS">Todas as Categorias</option>';
    selectReport.innerHTML = '<option value="TODAS">Todas as Categorias</option>';
    datalist.innerHTML = '';

    categories.forEach(cat => {
      const opt1 = document.createElement('option');
      opt1.value = cat;
      opt1.textContent = cat;
      selectFilter.appendChild(opt1);

      const opt2 = document.createElement('option');
      opt2.value = cat;
      opt2.textContent = cat;
      selectReport.appendChild(opt2);

      const dlOpt = document.createElement('option');
      dlOpt.value = cat;
      datalist.appendChild(dlOpt);
    });
  } catch (err) {}
}

// 5. CARREGAR HISTÓRICO DE MOVIMENTAÇÕES
async function loadMovements() {
  try {
    const res = await fetch('/api/movements?limit=100', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const { data } = await res.json();
    const tbody = document.getElementById('movementsTableBody');
    tbody.innerHTML = '';

    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 30px; color: #64748b;">Nenhuma movimentação registrada no sistema ainda.</td></tr>`;
      return;
    }

    data.forEach(m => {
      const tr = document.createElement('tr');
      const badgeClass = m.tipo === 'ENTRADA' ? 'badge-success' : m.tipo === 'SAIDA' ? 'badge-danger' : 'badge-primary';
      const formattedDate = new Date(m.data_hora).toLocaleString('pt-BR');

      tr.innerHTML = `
        <td><small>${formattedDate}</small></td>
        <td><strong style="color: #1e40af; font-family: 'JetBrains Mono', monospace;">${m.produto_codigo}</strong></td>
        <td><strong>${m.produto_nome}</strong></td>
        <td><span class="badge ${badgeClass}">${m.tipo}</span></td>
        <td><strong style="font-size: 13px;">${m.quantidade} ${m.unidade || 'UN'}</strong></td>
        <td>${m.quantidade_anterior}</td>
        <td><strong style="color: #1e40af;">${m.quantidade_nova}</strong></td>
        <td><small>${m.motivo || '-'}</small></td>
        <td><small><i class="fa-solid fa-user"></i> ${m.usuario_nome || 'Sistema'}</small></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {}
}

// 6. GESTÃO DE USUÁRIOS
async function loadUsers() {
  try {
    const res = await fetch('/api/auth/users', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const { users } = await res.json();
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';

    users.forEach(u => {
      const tr = document.createElement('tr');
      const isAdmin = u.role === 'admin';
      const roleBadge = isAdmin
        ? '<span class="badge badge-primary"><i class="fa-solid fa-shield-halved"></i> Administrador</span>'
        : '<span class="badge badge-light"><i class="fa-solid fa-user"></i> Operador</span>';

      const perms = isAdmin
        ? 'Acesso total: Visualização de relatórios, cadastro, movimentações, alteração de valores/propriedades e usuários'
        : 'Cadastro de produtos, consulta de peças e relatórios operacionais básicos';

      tr.innerHTML = `
        <td>#${u.id}</td>
        <td><strong>${u.nome}</strong></td>
        <td>${u.email}</td>
        <td>${roleBadge}</td>
        <td><small style="color: #475569;">${perms}</small></td>
        <td><small>${new Date(u.created_at).toLocaleDateString('pt-BR')}</small></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {}
}

// 7. FORMULÁRIO DE PRODUTO: NOVO / EDITAR
function openNewProductModal() {
  document.getElementById('prodFormId').value = '';
  document.getElementById('productForm').reset();
  document.getElementById('productModalTitle').innerHTML = '<i class="fa-solid fa-box-open"></i> Novo Produto';
  generateAutoCode();
  calculateFinancials();
  openModal('productModal');
}

async function openEditProductModal(id) {
  try {
    const res = await fetch(`/api/products/${id}`, { headers: getAuthHeaders() });
    if (!res.ok) return;
    const { data: p } = await res.json();

    document.getElementById('prodFormId').value = p.id;
    document.getElementById('prodCodigo').value = p.codigo;
    document.getElementById('prodCategoria').value = p.categoria;
    document.getElementById('prodNome').value = p.produto;
    document.getElementById('prodMarca').value = p.marca || '';
    document.getElementById('prodModelo').value = p.modelo || '';
    document.getElementById('prodDescricao').value = p.descricao || '';
    document.getElementById('prodUnidade').value = p.unidade || 'UN';
    document.getElementById('prodQtd').value = p.qtd_estoque;
    document.getElementById('prodMin').value = p.estoque_minimo;
    document.getElementById('prodMax').value = p.estoque_maximo;
    document.getElementById('prodCusto').value = p.preco_custo;
    document.getElementById('prodVenda').value = p.preco_venda;
    document.getElementById('prodFornecedor').value = p.fornecedor || '';
    document.getElementById('prodLocalizacao').value = p.localizacao || '';
    document.getElementById('prodDataEntrada').value = p.data_entrada || '';
    document.getElementById('prodImagemUrl').value = p.imagem_url || '';
    document.getElementById('prodObservacoes').value = p.observacoes || '';

    previewModalImage(p.imagem_url);
    calculateFinancials();

    document.getElementById('productModalTitle').innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Editar Produto: ${p.codigo}`;
    openModal('productModal');
  } catch (err) {
    showToast('Erro ao abrir produto para edição', 'danger');
  }
}

function generateAutoCode() {
  if (productsList.length === 0) {
    document.getElementById('prodCodigo').value = 'EST-001';
    return;
  }
  // Encontra o maior índice EST-XXX
  let maxNum = 0;
  productsList.forEach(p => {
    const match = String(p.codigo).match(/^EST-(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  });
  const nextNum = String(maxNum + 1).padStart(3, '0');
  document.getElementById('prodCodigo').value = `EST-${nextNum}`;
}

function calculateFinancials() {
  const qtd = parseFloat(document.getElementById('prodQtd').value) || 0;
  const custo = parseFloat(document.getElementById('prodCusto').value) || 0;
  const venda = parseFloat(document.getElementById('prodVenda').value) || 0;

  let margem = 0;
  if (custo > 0) {
    margem = (((venda - custo) / custo) * 100);
  }

  const totalEstoque = qtd * custo;

  document.getElementById('prodMargem').value = `${margem.toFixed(1)}%`;
  document.getElementById('prodValorTotal').value = `R$ ${totalEstoque.toFixed(2)}`;
}

function previewModalImage(url) {
  const preview = document.getElementById('modalImagePreview');
  if (url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/uploads/'))) {
    preview.innerHTML = `<img src="${url}" onerror="this.src='https://via.placeholder.com/50x50?text=Erro'">`;
  } else {
    preview.innerHTML = '<i class="fa-solid fa-image"></i>';
  }
}

async function handleSaveProduct(e) {
  e.preventDefault();
  const id = document.getElementById('prodFormId').value;
  const isEditing = Boolean(id);

  const bodyData = {
    codigo: document.getElementById('prodCodigo').value.trim(),
    categoria: document.getElementById('prodCategoria').value.trim(),
    produto: document.getElementById('prodNome').value.trim(),
    marca: document.getElementById('prodMarca').value.trim(),
    modelo: document.getElementById('prodModelo').value.trim(),
    descricao: document.getElementById('prodDescricao').value.trim(),
    unidade: document.getElementById('prodUnidade').value,
    qtd_estoque: parseInt(document.getElementById('prodQtd').value, 10) || 0,
    estoque_minimo: parseInt(document.getElementById('prodMin').value, 10) || 0,
    estoque_maximo: parseInt(document.getElementById('prodMax').value, 10) || 0,
    preco_custo: parseFloat(document.getElementById('prodCusto').value) || 0,
    preco_venda: parseFloat(document.getElementById('prodVenda').value) || 0,
    fornecedor: document.getElementById('prodFornecedor').value.trim(),
    localizacao: document.getElementById('prodLocalizacao').value.trim(),
    data_entrada: document.getElementById('prodDataEntrada').value.trim(),
    imagem_url: document.getElementById('prodImagemUrl').value.trim(),
    observacoes: document.getElementById('prodObservacoes').value.trim()
  };

  const url = isEditing ? `/api/products/${id}` : '/api/products';
  const method = isEditing ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: getAuthHeaders(),
      body: JSON.stringify(bodyData)
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erro ao salvar produto.');
    }

    showToast(isEditing ? 'Produto atualizado com sucesso!' : 'Novo produto cadastrado com sucesso!', 'success');
    closeModal('productModal');
    loadProducts();
    loadDashboard();
    loadCategories();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function handleDeleteProduct(id, codigo) {
  if (!confirm(`Tem certeza que deseja excluir o produto ${codigo}? Esta ação não pode ser desfeita.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/products/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erro ao excluir produto.');
    }

    showToast(`Produto ${codigo} excluído com sucesso.`, 'info');
    loadProducts();
    loadDashboard();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// 8. DETALHES DO PRODUTO (MODAL COMPLETO)
async function viewProductDetails(id) {
  try {
    const res = await fetch(`/api/products/${id}`, { headers: getAuthHeaders() });
    if (!res.ok) return;
    const { data: p } = await res.json();

    const isAdmin = currentUser && currentUser.role === 'admin';
    document.getElementById('viewModalTitle').innerHTML = `<i class="fa-solid fa-microchip"></i> Detalhes: ${p.codigo} - ${p.produto}`;

    const bodyEl = document.getElementById('viewModalBody');
    bodyEl.innerHTML = `
      <div style="display: flex; gap: 20px; align-items: flex-start; margin-bottom: 20px;">
        <div style="width: 140px; height: 140px; border-radius: 12px; border: 1px solid #bfdbfe; overflow: hidden; background: #eff6ff; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
          ${p.imagem_url 
            ? `<img src="${p.imagem_url}" style="width:100%; height:100%; object-fit:cover;" onerror="this.src='https://via.placeholder.com/140x140?text=Sem+Foto'">` 
            : '<i class="fa-solid fa-image" style="font-size: 40px; color: #93c5fd;"></i>'}
        </div>
        <div style="flex: 1;">
          <h2 style="font-size: 20px; color: #1e3a8a; margin-bottom: 4px;">${p.produto}</h2>
          <div style="display: flex; gap: 8px; margin-bottom: 10px;">
            <span class="badge badge-primary">${p.codigo}</span>
            <span class="badge badge-light">${p.categoria}</span>
            <span class="badge ${p.status === 'OK' ? 'badge-success' : p.status === 'ESTOQUE BAIXO' ? 'badge-warning' : 'badge-danger'}">${p.status}</span>
          </div>
          <p style="font-size: 13px; color: #475569; line-height: 1.5;">${p.descricao || 'Sem descrição cadastrada.'}</p>
        </div>
      </div>

      <div class="form-section-title"><i class="fa-solid fa-layer-group"></i> Informações do Estoque & Prateleira</div>
      <div class="form-grid-4" style="margin-bottom: 16px;">
        <div class="kpi-card" style="padding: 10px;">
          <div class="kpi-details"><span class="kpi-label">Saldo Atual</span><strong style="font-size: 18px; color: #1e3a8a;">${p.qtd_estoque} ${p.unidade}</strong></div>
        </div>
        <div class="kpi-card" style="padding: 10px;">
          <div class="kpi-details"><span class="kpi-label">Estoque Mínimo</span><strong>${p.estoque_minimo} ${p.unidade}</strong></div>
        </div>
        <div class="kpi-card" style="padding: 10px;">
          <div class="kpi-details"><span class="kpi-label">Estoque Máximo</span><strong>${p.estoque_maximo} ${p.unidade}</strong></div>
        </div>
        <div class="kpi-card" style="padding: 10px;">
          <div class="kpi-details"><span class="kpi-label">Localização</span><strong style="color: #0284c7;">${p.localizacao || '-'}</strong></div>
        </div>
      </div>

      ${isAdmin ? `
        <div class="form-section-title"><i class="fa-solid fa-brazilian-real-sign"></i> Dados Financeiros & Margem</div>
        <div class="form-grid-4" style="margin-bottom: 16px;">
          <div class="kpi-card" style="padding: 10px;">
            <div class="kpi-details"><span class="kpi-label">Preço de Custo</span><strong>R$ ${Number(p.preco_custo).toFixed(2)}</strong></div>
          </div>
          <div class="kpi-card" style="padding: 10px;">
            <div class="kpi-details"><span class="kpi-label">Preço de Venda</span><strong>R$ ${Number(p.preco_venda).toFixed(2)}</strong></div>
          </div>
          <div class="kpi-card" style="padding: 10px;">
            <div class="kpi-details"><span class="kpi-label">Margem Bruta</span><strong style="color: #059669;">${Number(p.margem_percent).toFixed(1)}%</strong></div>
          </div>
          <div class="kpi-card" style="padding: 10px;">
            <div class="kpi-details"><span class="kpi-label">Valor Total Estoque</span><strong style="color: #1d4ed8;">R$ ${Number(p.valor_total_estoque).toFixed(2)}</strong></div>
          </div>
        </div>
      ` : ''}

      <div class="form-section-title"><i class="fa-solid fa-circle-info"></i> Fornecedor & Observações</div>
      <p style="font-size: 13px; margin-bottom: 6px;"><strong>Fornecedor:</strong> ${p.fornecedor || 'Não informado'}</p>
      <p style="font-size: 13px; margin-bottom: 6px;"><strong>Data de Entrada:</strong> ${p.data_entrada || '-'}</p>
      <p style="font-size: 13px;"><strong>Observações:</strong> ${p.observacoes || 'Nenhuma observação interna.'}</p>
    `;

    const editBtn = document.getElementById('btnEditFromView');
    if (editBtn) {
      editBtn.onclick = () => {
        closeModal('viewProductModal');
        openEditProductModal(p.id);
      };
    }

    openModal('viewProductModal');
  } catch (err) {}
}

// 9. MOVIMENTAÇÃO DE ESTOQUE
function openNewMovementModal(produtoId = null) {
  const select = document.getElementById('movProdutoId');
  select.innerHTML = '<option value="">Selecione um produto...</option>';

  productsList.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.codigo} — ${p.produto} (Saldo: ${p.qtd_estoque} ${p.unidade})`;
    if (produtoId && String(p.id) === String(produtoId)) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });

  onMovementProductChange();
  openModal('movementModal');
}

function onMovementProductChange() {
  const prodId = document.getElementById('movProdutoId').value;
  const p = productsList.find(item => String(item.id) === String(prodId));
  const infoBox = document.getElementById('movProductInfoBox');

  if (p) {
    infoBox.style.display = 'flex';
    document.getElementById('movCurrentStock').textContent = `${p.qtd_estoque} ${p.unidade}`;
    document.getElementById('movLocation').textContent = p.localizacao || 'Geral';
  } else {
    infoBox.style.display = 'none';
  }

  updateMovPreview();
}

function updateMovPreview() {
  const prodId = document.getElementById('movProdutoId').value;
  const p = productsList.find(item => String(item.id) === String(prodId));
  const qtdMov = parseInt(document.getElementById('movQuantidade').value, 10) || 0;
  const tipo = document.querySelector('input[name="movTipo"]:checked').value;
  const previewStrong = document.getElementById('movNewStockPreview');

  if (!p) {
    previewStrong.textContent = '0';
    return;
  }

  let novo = p.qtd_estoque;
  if (tipo === 'ENTRADA') novo = p.qtd_estoque + qtdMov;
  else if (tipo === 'SAIDA') novo = Math.max(0, p.qtd_estoque - qtdMov);
  else if (tipo === 'AJUSTE') novo = qtdMov;

  previewStrong.textContent = `${novo} ${p.unidade}`;
}

async function handleSaveMovement(e) {
  e.preventDefault();
  const produto_id = document.getElementById('movProdutoId').value;
  const tipo = document.querySelector('input[name="movTipo"]:checked').value;
  const quantidade = parseInt(document.getElementById('movQuantidade').value, 10);
  const motivo = document.getElementById('movMotivo').value.trim();

  try {
    const res = await fetch('/api/movements', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ produto_id, tipo, quantidade, motivo })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erro ao registrar movimentação.');
    }

    showToast(data.message, 'success');
    closeModal('movementModal');
    loadProducts();
    loadDashboard();
    loadMovements();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// 10. RELATÓRIOS (PDF, EXCEL, WORD)
function toggleExportMenu() {
  document.getElementById('exportDropdown').classList.toggle('show');
}
window.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown')) {
    const menu = document.getElementById('exportDropdown');
    if (menu) menu.classList.remove('show');
  }
});

function downloadReport(format) {
  const q = document.getElementById('prodSearchInput').value.trim();
  const categoria = document.getElementById('filterCategory').value;
  const status = document.getElementById('filterStatus').value;

  const url = `/api/reports/${format}?categoria=${encodeURIComponent(categoria)}&status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}&token=${currentToken}`;
  window.open(url, '_blank');
}

function generateFilteredReport(format) {
  const categoria = document.getElementById('reportCategory').value;
  const status = document.getElementById('reportStatus').value;

  const url = `/api/reports/${format}?categoria=${encodeURIComponent(categoria)}&status=${encodeURIComponent(status)}&token=${currentToken}`;
  window.open(url, '_blank');
}

// 11. IMPORTAÇÃO DE PLANILHA EXCEL
async function handleExcelUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!confirm(`Deseja importar os dados da planilha "${file.name}" para o banco de dados?`)) {
    e.target.value = '';
    return;
  }

  const formData = new FormData();
  formData.append('excel', file);

  showToast('Enviando e processando planilha...', 'info');

  try {
    const res = await fetch('/api/import/excel', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${currentToken}`
      },
      body: formData
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Falha ao importar planilha.');
    }

    showToast(data.message, 'success');
    loadProducts();
    loadDashboard();
    loadCategories();
  } catch (err) {
    showToast(err.message, 'danger');
  } finally {
    e.target.value = '';
  }
}

// 12. MODAL NOVO USUÁRIO
function openNewUserModal() {
  document.getElementById('userForm').reset();
  openModal('userModal');
}

async function handleSaveUser(e) {
  e.preventDefault();
  const nome = document.getElementById('newUserName').value.trim();
  const email = document.getElementById('newUserEmail').value.trim();
  const password = document.getElementById('newUserPassword').value;
  const role = document.getElementById('newUserRole').value;

  try {
    const res = await fetch('/api/auth/users', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ nome, email, password, role })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erro ao criar usuário.');
    }

    showToast('Usuário cadastrado com sucesso!', 'success');
    closeModal('userModal');
    loadUsers();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// Modais Genéricos
function openModal(id) {
  document.getElementById(id).classList.add('show');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}
function openExtensionModal() {
  openModal('extensionModal');
}
function previewImageDirect(url, title) {
  window.open(url, '_blank');
}

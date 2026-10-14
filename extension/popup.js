let serverUrl = 'http://localhost:3000';
let authToken = null;
let authUser = null;
let extSocket = null;
let extProducts = [];
let extSearchTimeout = null;

// Helpers de storage compatíveis com Chrome Extension e Browser
async function getStorage(key) {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise(resolve => {
      chrome.storage.local.get([key], res => resolve(res[key]));
    });
  }
  return localStorage.getItem(key);
}

async function setStorage(key, val) {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise(resolve => {
      chrome.storage.local.set({ [key]: val }, resolve);
    });
  }
  localStorage.setItem(key, val);
}

async function removeStorage(key) {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise(resolve => {
      chrome.storage.local.remove([key], resolve);
    });
  }
  localStorage.removeItem(key);
}

document.addEventListener('DOMContentLoaded', async () => {
  const savedUrl = await getStorage('ext_server_url');
  if (savedUrl) {
    serverUrl = savedUrl;
    document.getElementById('extApiUrl').value = savedUrl;
    document.getElementById('extConfigServerUrl').value = savedUrl;
  }

  const token = await getStorage('ext_token');
  const userJson = await getStorage('ext_user');

  if (token && userJson) {
    authToken = token;
    authUser = JSON.parse(userJson);
    showExtMainView();
  } else {
    showExtLoginView();
  }

  initExtSocket();
});

// Socket.io Real-time connection
function initExtSocket() {
  if (typeof io === 'undefined') return;

  try {
    if (extSocket) extSocket.disconnect();
    extSocket = io(serverUrl, { reconnectionAttempts: 5 });

    const statusEl = document.getElementById('extSocketStatus');
    const dotEl = document.getElementById('extSocketDot');

    extSocket.on('connect', () => {
      if (statusEl) statusEl.textContent = 'Tempo Real Ativo';
      if (dotEl) dotEl.classList.remove('offline');
    });

    extSocket.on('disconnect', () => {
      if (statusEl) statusEl.textContent = 'Desconectado';
      if (dotEl) dotEl.classList.add('offline');
    });

    extSocket.on('stock_updated', (event) => {
      showExtToast(`⚡ Atualização em tempo real: ${event.type}`);
      if (authToken) {
        loadExtProducts();
        loadExtStats();
      }
    });
  } catch (err) {
    console.warn('Falha ao conectar socket:', err);
  }
}

function showExtLoginView() {
  document.getElementById('extLoginView').style.display = 'flex';
  document.getElementById('extMainView').style.display = 'none';
  document.getElementById('extUserTag').textContent = 'Visitante';
}

function showExtMainView() {
  document.getElementById('extLoginView').style.display = 'none';
  document.getElementById('extMainView').style.display = 'flex';
  document.getElementById('extUserTag').textContent = authUser ? authUser.nome.split(' ')[0] : 'Logado';
  document.getElementById('extActiveUser').textContent = authUser ? authUser.nome : '-';
  document.getElementById('extActiveRole').textContent = authUser && authUser.role === 'admin' ? 'Administrador' : 'Operador';

  loadExtProducts();
  loadExtStats();
}

function switchExtTab(tabName) {
  document.querySelectorAll('.ext-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.ext-tab-content').forEach(pane => pane.classList.remove('active'));

  const tabId = 'extTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1);
  const target = document.getElementById(tabId);
  if (target) target.classList.add('active');

  const buttons = document.querySelectorAll('.ext-tab-btn');
  buttons.forEach(b => {
    if (b.getAttribute('onclick') && b.getAttribute('onclick').includes(tabName)) {
      b.classList.add('active');
    }
  });

  if (tabName === 'stock') loadExtProducts();
}

function fillExtCredentials(email, pass) {
  document.getElementById('extLoginEmail').value = email;
  document.getElementById('extLoginPass').value = pass;
}

// LOGIN
async function handleExtLogin(e) {
  e.preventDefault();
  const url = document.getElementById('extApiUrl').value.trim().replace(/\/$/, '');
  const email = document.getElementById('extLoginEmail').value.trim();
  const password = document.getElementById('extLoginPass').value;
  const btn = document.getElementById('btnExtLogin');

  btn.disabled = true;
  btn.textContent = 'Conectando...';

  try {
    serverUrl = url;
    await setStorage('ext_server_url', serverUrl);

    const res = await fetch(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Credenciais inválidas.');
    }

    authToken = data.token;
    authUser = data.user;

    await setStorage('ext_token', authToken);
    await setStorage('ext_user', JSON.stringify(authUser));

    initExtSocket();
    showExtToast('Bem-vindo, ' + authUser.nome + '!');
    showExtMainView();
  } catch (err) {
    showExtToast('Erro: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar na Extensão';
  }
}

async function handleExtLogout() {
  await removeStorage('ext_token');
  await removeStorage('ext_user');
  authToken = null;
  authUser = null;
  showExtLoginView();
}

async function saveExtServerUrl() {
  const url = document.getElementById('extConfigServerUrl').value.trim().replace(/\/$/, '');
  serverUrl = url;
  await setStorage('ext_server_url', url);
  initExtSocket();
  showExtToast('URL do servidor atualizada!');
}

// PRODUTOS
async function loadExtProducts() {
  if (!authToken) return;
  try {
    const q = document.getElementById('extSearchInput').value.trim();
    let url = `${serverUrl}/api/products?sort=codigo&order=ASC`;
    if (q) url += `&q=${encodeURIComponent(q)}`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const json = await res.json();
    extProducts = json.data;
    renderExtProductList(extProducts);
  } catch (err) {
    console.error('Erro ao listar produtos na extensão:', err);
  }
}

async function loadExtStats() {
  if (!authToken) return;
  try {
    const res = await fetch(`${serverUrl}/api/products/stats`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const { stats } = await res.json();

    document.getElementById('extKpiTotal').textContent = stats.total_itens;
    document.getElementById('extKpiBaixo').textContent = stats.status.baixo;
    document.getElementById('extKpiZerado').textContent = stats.status.sem_estoque;
  } catch (e) {}
}

function renderExtProductList(products) {
  const container = document.getElementById('extProductList');
  container.innerHTML = '';

  if (products.length === 0) {
    container.innerHTML = '<p style="text-align:center; padding:20px; font-size:12px; color:#64748b;">Nenhum produto encontrado.</p>';
    return;
  }

  const isAdmin = authUser && authUser.role === 'admin';

  products.forEach(p => {
    const item = document.createElement('div');
    item.className = 'ext-prod-item';

    const badgeClass = p.status === 'OK' ? 'ext-stock-ok' : p.status === 'ESTOQUE BAIXO' ? 'ext-stock-low' : 'ext-stock-zero';

    item.innerHTML = `
      <div class="ext-prod-info">
        <span class="ext-prod-code">${p.codigo}</span>
        <span class="ext-prod-name" title="${p.produto}">${p.produto}</span>
        <div class="ext-prod-meta">${p.categoria} &bull; Prateleira: ${p.localizacao || '-'}</div>
      </div>
      <div style="display: flex; align-items: center;">
        <span class="ext-stock-badge ${badgeClass}">${p.qtd_estoque} ${p.unidade}</span>
        ${isAdmin ? `
          <div class="ext-quick-actions">
            <button class="ext-btn-quick" title="Adicionar 1 (+ Entrada)" onclick="quickStockAdjust(${p.id}, 'ENTRADA')">+</button>
            <button class="ext-btn-quick" title="Remover 1 (- Saída)" onclick="quickStockAdjust(${p.id}, 'SAIDA')">-</button>
          </div>
        ` : ''}
      </div>
    `;

    container.appendChild(item);
  });
}

function onExtSearch() {
  clearTimeout(extSearchTimeout);
  extSearchTimeout = setTimeout(() => {
    loadExtProducts();
  }, 300);
}

// MOVIMENTAÇÃO RÁPIDA (+ / -)
async function quickStockAdjust(prodId, tipo) {
  try {
    const res = await fetch(`${serverUrl}/api/movements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        produto_id: prodId,
        tipo: tipo,
        quantidade: 1,
        motivo: `Ajuste rápido via Extensão do Navegador (${tipo})`
      })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erro na movimentação.');
    }

    showExtToast(`${tipo === 'ENTRADA' ? '+1' : '-1'} registrado!`);
    loadExtProducts();
    loadExtStats();
  } catch (err) {
    showExtToast('Erro: ' + err.message);
  }
}

// CADASTRAR PRODUTO DIRETO DA EXTENSÃO
function calculateExtMargem() {
  const custo = parseFloat(document.getElementById('extNewCusto').value) || 0;
  const venda = parseFloat(document.getElementById('extNewVenda').value) || 0;
  let margem = 0;
  if (custo > 0) {
    margem = (((venda - custo) / custo) * 100);
  }
  document.getElementById('extMargemCalc').textContent = `${margem.toFixed(1)}%`;
}

async function handleExtCreateProduct(e) {
  e.preventDefault();
  const btn = document.getElementById('btnExtSaveProd');
  btn.disabled = true;
  btn.textContent = 'Cadastrando...';

  const bodyData = {
    codigo: document.getElementById('extNewCodigo').value.trim(),
    categoria: document.getElementById('extNewCategoria').value.trim(),
    produto: document.getElementById('extNewProduto').value.trim(),
    marca: document.getElementById('extNewMarca').value.trim(),
    localizacao: document.getElementById('extNewLocalizacao').value.trim(),
    unidade: document.getElementById('extNewUnidade').value,
    qtd_estoque: parseInt(document.getElementById('extNewQtd').value, 10) || 0,
    estoque_minimo: parseInt(document.getElementById('extNewMin').value, 10) || 0,
    preco_custo: parseFloat(document.getElementById('extNewCusto').value) || 0,
    preco_venda: parseFloat(document.getElementById('extNewVenda').value) || 0
  };

  try {
    const res = await fetch(`${serverUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(bodyData)
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erro ao cadastrar produto.');
    }

    showExtToast('Produto cadastrado com sucesso!');
    document.getElementById('extCreateForm').reset();
    calculateExtMargem();
    switchExtTab('stock');
    loadExtProducts();
    loadExtStats();
  } catch (err) {
    showExtToast('Erro: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Salvar Produto no Estoque';
  }
}

// BAIXAR RELATÓRIOS A PARTIR DA EXTENSÃO
function downloadExtReport(format) {
  if (!authToken) return;
  const downloadUrl = `${serverUrl}/api/reports/${format}?token=${authToken}`;

  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url: downloadUrl });
  } else {
    window.open(downloadUrl, '_blank');
  }

  showExtToast(`Gerando e baixando relatório ${format.toUpperCase()}...`);
}

function openWebAppTab() {
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url: serverUrl });
  } else {
    window.open(serverUrl, '_blank');
  }
}

function showExtToast(msg) {
  const toast = document.getElementById('extToast');
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3500);
}

let productsList = [];
let categoriesList = [];
let searchDebounceTimeout = null;

document.addEventListener('DOMContentLoaded', () => {
  initStatCards();
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
const TAB_META = {
  dashboard: { title: 'Painel Geral', subtitle: 'Visão principal do estoque' },
  products: { title: 'Produtos', subtitle: 'Catálogo de peças com as 20 colunas de controle' },
  movements: { title: 'Movimentações', subtitle: 'Entradas, saídas e ajustes com auditoria e usuário responsável' },
  reports: { title: 'Relatórios', subtitle: 'Gere relatórios em PDF, Excel e Word com filtros por categoria e situação' },
  users: { title: 'Usuários', subtitle: 'Acessos de administradores e operadores de estoque' },
  database: { title: 'Banco de Dados', subtitle: 'SQLite local ou PostgreSQL / Supabase na nuvem' }
};

function switchTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.sidebar-menu .nav-item').forEach(el => el.classList.remove('active'));

  const targetPane = document.getElementById(`tab-${tabId}`);
  if (targetPane) targetPane.classList.add('active');

  const meta = TAB_META[tabId] || { title: 'Estoque Pro', subtitle: '' };
  document.getElementById('pageTitle').textContent = meta.title;
  document.getElementById('pageSubtitle').textContent = meta.subtitle;
  // O seletor de período só faz sentido no painel
  document.getElementById('pageActions').style.display = tabId === 'dashboard' ? '' : 'none';

  // Highlight active menu button
  const buttons = document.querySelectorAll('.sidebar-menu .nav-item');
  buttons.forEach(btn => {
    if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(`'${tabId}'`)) {
      btn.classList.add('active');
    }
  });

  if (tabId === 'dashboard') renderSalesChart();
  if (tabId === 'movements') loadMovements();
  if (tabId === 'users') loadUsers();
}

// Sino do topo: leva direto para os itens com estoque baixo
function openLowStock() {
  switchTab('products');
  document.getElementById('prodSearchInput').value = '';
  document.getElementById('filterStatus').value = 'ESTOQUE BAIXO';
  loadProducts();
}

// ---------- Helpers de formatação (usados no painel) ----------
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function formatBRL(value, decimals = 2) {
  return `R$ ${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

// Variação em texto simples (para tooltips): "+1 vs. 30 dias atrás"
function deltaPlain(value, periodDays) {
  if (value === null || value === undefined) return 'Sem histórico para comparar';
  if (value === 0) return `Sem variação vs. ${periodDays} dias atrás`;
  return `${value > 0 ? '+' : '-'}${Math.abs(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} vs. ${periodDays} dias atrás`;
}

function formatDays(days) {
  if (days < 1) return 'menos de 1 dia';
  const n = Math.round(days);
  return `${n} ${n === 1 ? 'dia' : 'dias'}`;
}

// Subtexto do card Risco de ruptura: prazo do item mais urgente (pior caso)
function riskSubText(risk) {
  const zerados = risk.zerados > 0 ? `${risk.zerados} já zerado${risk.zerados > 1 ? 's' : ''}` : '';
  if (risk.valor === 0) return `Nenhum item esgota em ${risk.limiar_dias} dias`;
  if (risk.menor_prazo_dias === null) return zerados;
  const prazo = `<strong class="bad">esgota em ~${formatDays(risk.menor_prazo_dias)}</strong>`;
  return zerados ? `${prazo} · ${zerados}` : prazo;
}

function unitLabel(unit) {
  const u = String(unit || 'UN').toLowerCase();
  return u === 'un' ? 'un.' : u;
}

// "Hoje, 10:24" · "Ontem, 16:43" · "12/05/2024"
function formatWhen(iso) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const startOf = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(new Date()) - startOf(d)) / 86400000);
  if (diffDays === 0) return `Hoje, ${time}`;
  if (diffDays === 1) return `Ontem, ${time}`;
  return d.toLocaleDateString('pt-BR');
}

function thumbHtml(item) {
  const img = item.imagem_url
    ? `<img src="${escapeHtml(item.imagem_url)}" alt="" loading="lazy" onerror="this.remove()">`
    : '';
  return `<div class="thumb">${icon('package')}${img}</div>`;
}

function emptyStateHtml(title, text) {
  return `<div class="empty-state">${icon('package')}<strong>${escapeHtml(title)}</strong>${escapeHtml(text)}</div>`;
}

// Variação em relação ao período anterior: seta + valor, verde se melhorou e vermelho se piorou
function deltaHtml(value, { unit = '', higherIsBetter = true, periodDays = 30 } = {}) {
  if (value === null || value === undefined) {
    return '<span>Sem histórico para comparar</span>';
  }
  const label = `<span>vs. ${periodDays} dias atrás</span>`;
  if (value === 0) {
    return `<strong class="flat">${icon('minus')} 0${unit}</strong>${label}`;
  }
  const up = value > 0;
  const good = up === higherIsBetter;
  const text = `${up ? '+' : '-'}${Math.abs(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${unit}`;
  return `<strong class="${good ? 'good' : 'bad'}">${icon(up ? 'arrow-up-right' : 'arrow-down-right')} ${text}</strong>${label}`;
}

// ---------- Cards do topo: arrastar e soltar para reposicionar ----------
// A ordem fica salva no navegador, por usuário (localStorage). Teclado: Alt + setas move o card focado.
const STAT_CARD_DEFAULT_ORDER = ['valor', 'margem', 'itens', 'unidades', 'sem-saida', 'risco'];
let draggingCard = null;
let cardOrderAppliedFor = null;

function cardOrderKey() {
  return currentUser ? `estoque_cards_order_${currentUser.id}` : null;
}

function readCardOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(cardOrderKey()));
    return Array.isArray(saved) ? saved : null;
  } catch (e) {
    return null;
  }
}

function currentCardOrder() {
  return [...document.querySelectorAll('#statGrid .stat-card')].map(card => card.dataset.card);
}

function updateResetLayoutButton() {
  document.getElementById('resetLayoutBtn').hidden = currentCardOrder().join() === STAT_CARD_DEFAULT_ORDER.join();
}

function saveCardOrder() {
  try {
    localStorage.setItem(cardOrderKey(), JSON.stringify(currentCardOrder()));
  } catch (e) { /* armazenamento bloqueado: a ordem vale só até recarregar */ }
  updateResetLayoutButton();
}

// Reordena o DOM conforme a lista (ids desconhecidos ficam no fim, na ordem atual)
function applyCardOrder(order) {
  const grid = document.getElementById('statGrid');
  const cards = new Map([...grid.querySelectorAll('.stat-card')].map(card => [card.dataset.card, card]));
  const wanted = [...order.filter(id => cards.has(id)), ...[...cards.keys()].filter(id => !order.includes(id))];
  wanted.forEach(id => grid.appendChild(cards.get(id)));
  updateResetLayoutButton();
}

// Chamado a cada render do painel; só reaplica quando muda o usuário e nunca no meio de um arraste
function restoreCardOrder() {
  if (!currentUser || draggingCard || cardOrderAppliedFor === currentUser.id) return;
  applyCardOrder(readCardOrder() || STAT_CARD_DEFAULT_ORDER);
  cardOrderAppliedFor = currentUser.id;
}

function resetCardOrder() {
  try {
    localStorage.removeItem(cardOrderKey());
  } catch (e) { /* sem armazenamento: nada a limpar */ }
  moveWithAnimation(document.getElementById('statGrid'), () => applyCardOrder(STAT_CARD_DEFAULT_ORDER));
}

// Troca de lugar com animação (FLIP): os outros cards deslizam até a nova posição
function moveWithAnimation(grid, mutate) {
  const cards = [...grid.querySelectorAll('.stat-card')].filter(card => card.offsetParent !== null);
  const before = new Map(cards.map(card => [card, card.getBoundingClientRect()]));
  mutate();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  cards.forEach(card => {
    const from = before.get(card);
    const to = card.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (dx || dy) {
      card.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.16, 1, .3, 1)' });
    }
  });
}

// Arraste feito com eventos de ponteiro (e não com o drag-and-drop nativo do HTML5): o que acompanha o cursor é
// uma cópia opaca do próprio card, e não a "imagem fantasma" translúcida do navegador. Funciona com mouse e toque.
function initStatCards() {
  const grid = document.getElementById('statGrid');
  const DRAG_THRESHOLD = 5; // px de movimento antes de começar a arrastar (evita arrastar sem querer ao clicar)
  const TOUCH_CANCEL = 10;  // toque: se mexer antes do tempo de segurar, o usuário está rolando a página
  const LONG_PRESS_MS = 250; // toque: segurar o card por um instante para arrastar
  let pending = null; // pointerdown ainda sem arraste
  let drag = null;    // arraste em andamento
  const blockTouchScroll = e => e.preventDefault();

  grid.addEventListener('pointerdown', e => {
    const card = e.target.closest('.stat-card');
    if (!card || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target.closest('button, a, input, select, textarea')) return; // "Ver detalhes" continua clicável
    pending = { card, id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType, timer: null };
    if (e.pointerType !== 'mouse') {
      pending.timer = setTimeout(() => { if (pending) beginDrag(pending); }, LONG_PRESS_MS);
    }
  });

  function beginDrag(p) {
    clearTimeout(p.timer);
    const rect = p.card.getBoundingClientRect();
    const ghost = p.card.cloneNode(true);
    ghost.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    ['data-card', 'tabindex'].forEach(attr => ghost.removeAttribute(attr));
    ghost.setAttribute('aria-hidden', 'true');
    ghost.classList.add('drag-ghost');
    Object.assign(ghost.style, { width: `${rect.width}px`, height: `${rect.height}px`, left: `${rect.left}px`, top: `${rect.top}px` });
    document.body.appendChild(ghost);

    p.card.classList.add('drag-slot'); // o card original vira o "encaixe" que mostra onde vai cair
    document.body.classList.add('is-dragging-card');
    draggingCard = p.card;
    drag = { card: p.card, ghost, dx: p.x - rect.left, dy: p.y - rect.top };
    if (p.type !== 'mouse') document.addEventListener('touchmove', blockTouchScroll, { passive: false });
    pending = null;
  }

  window.addEventListener('pointermove', e => {
    if (pending && e.pointerId === pending.id) {
      const moved = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
      if (pending.type === 'mouse') {
        if (moved > DRAG_THRESHOLD) beginDrag(pending);
      } else if (moved > TOUCH_CANCEL) {
        clearTimeout(pending.timer);
        pending = null;
      }
    }
    if (!drag) return;

    drag.ghost.style.left = `${e.clientX - drag.dx}px`;
    drag.ghost.style.top = `${e.clientY - drag.dy}px`;

    // Reordena ao vivo conforme o cursor passa por cima dos outros cards
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const target = under && under.closest('.stat-card');
    if (!target || target === drag.card || target.offsetParent === null || !grid.contains(target)) return;
    const rect = target.getBoundingClientRect();
    const oneColumn = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length === 1;
    const after = oneColumn ? e.clientY > rect.top + rect.height / 2 : e.clientX > rect.left + rect.width / 2;
    const reference = after ? target.nextElementSibling : target;
    if (drag.card.nextElementSibling === reference) return; // já está nessa posição
    moveWithAnimation(grid, () => grid.insertBefore(drag.card, reference));
  });

  function endDrag(e) {
    if (pending && e.pointerId === pending.id) {
      clearTimeout(pending.timer);
      pending = null;
    }
    if (!drag) return;
    const { card, ghost } = drag;
    drag = null;
    document.removeEventListener('touchmove', blockTouchScroll);

    const finish = () => {
      ghost.remove();
      card.classList.remove('drag-slot');
      document.body.classList.remove('is-dragging-card');
      draggingCard = null;
      saveCardOrder();
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();

    // Solta "encaixando" o card na posição final
    const slot = card.getBoundingClientRect();
    ghost.style.transition = 'left 160ms var(--ease-out-expo), top 160ms var(--ease-out-expo), transform 160ms var(--ease-out-expo), box-shadow 160ms var(--ease-out-expo)';
    ghost.style.left = `${slot.left}px`;
    ghost.style.top = `${slot.top}px`;
    ghost.classList.add('dropping');
    setTimeout(finish, 180);
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  grid.addEventListener('keydown', e => {
    const card = e.target.closest('.stat-card');
    if (!card || !e.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const visible = [...grid.querySelectorAll('.stat-card')].filter(c => c.offsetParent !== null);
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const neighbor = visible[visible.indexOf(card) + (forward ? 1 : -1)];
    if (!neighbor) return;
    moveWithAnimation(grid, () => grid.insertBefore(card, forward ? neighbor.nextElementSibling : neighbor));
    card.focus();
    saveCardOrder();
  });
}

// 1. CARREGAR DASHBOARD
let dashboardData = null;
let riskData = null;
let chartAnimate = true;

function onDashboardFilterChange() {
  chartAnimate = true;
  loadDashboard();
}

async function loadDashboard() {
  try {
    const period = document.getElementById('periodSelect').value;
    const months = document.getElementById('monthsSelect').value;
    const res = await fetch(`/api/dashboard?period=${period}&months=${months}`, { headers: getAuthHeaders() });
    if (!res.ok) return;
    const { data } = await res.json();
    dashboardData = data;
    renderDashboard(data);
  } catch (err) {
    console.error('Erro ao carregar dashboard:', err);
  }
}

function renderDashboard(data) {
  restoreCardOrder();
  const c = data.cards;
  const periodDays = data.periodo_dias;

  document.getElementById('sidebarProdCount').textContent = c.total_itens;
  document.getElementById('kpiTotalItens').textContent = c.total_itens.toLocaleString('pt-BR');
  document.getElementById('kpiTotalQtd').textContent = c.total_unidades.toLocaleString('pt-BR');

  // Valores financeiros só chegam para administradores
  if (c.valor_estoque) {
    document.getElementById('kpiValorEstoque').textContent = formatBRL(c.valor_estoque.valor);
    document.getElementById('kpiValorEstoqueDelta').innerHTML = deltaHtml(c.valor_estoque.delta_percent, { unit: '%', periodDays });
  }
  if (c.margem_media) {
    document.getElementById('kpiMargem').textContent = `${c.margem_media.valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
    document.getElementById('kpiMargemDelta').innerHTML = deltaHtml(c.margem_media.delta_pp, { unit: ' p.p.', periodDays });
  }

  // Itens sem saída: quantidade + capital parado (a custo, só admin). A variação fica no tooltip.
  document.getElementById('kpiSemSaida').textContent = c.itens_sem_saida.valor.toLocaleString('pt-BR');
  const idleSub = document.getElementById('kpiSemSaidaSub');
  idleSub.innerHTML = c.itens_sem_saida.valor_parado !== undefined
    ? `<strong>${formatBRL(c.itens_sem_saida.valor_parado, 0)}</strong> parados`
    : `há ${periodDays}+ dias sem saída`;
  idleSub.title = deltaPlain(c.itens_sem_saida.delta, periodDays);

  // Risco de ruptura: quantidade + prazo do item mais urgente. A variação fica no tooltip e no modal.
  const risk = c.risco_ruptura;
  riskData = risk;
  document.getElementById('kpiRisco').textContent = risk.valor.toLocaleString('pt-BR');
  const riskSub = document.getElementById('kpiRiscoSub');
  riskSub.innerHTML = riskSubText(risk);
  riskSub.title = deltaPlain(risk.delta, periodDays);
  document.getElementById('alertsDot').style.display = c.estoque_baixo.valor > 0 ? '' : 'none';

  syncMetricOptions(data.serie.length > 0 && data.serie[0].faturamento !== undefined);
  renderSalesChart();
  chartAnimate = false;

  document.getElementById('rankingList').innerHTML = data.ranking.length
    ? data.ranking.map((r, i) => `
        <div class="list-row">
          <span class="rank-pos">${i + 1}</span>
          ${thumbHtml(r)}
          <div class="row-main"><div class="row-title">${escapeHtml(r.produto)}</div></div>
          <span class="row-value">${r.quantidade.toLocaleString('pt-BR')} ${escapeHtml(unitLabel(r.unidade))}</span>
        </div>`).join('')
    : emptyStateHtml('Nenhuma saída no período', 'Os itens mais vendidos aparecem aqui.');

  document.getElementById('idleList').innerHTML = data.sem_saida.length
    ? data.sem_saida.map(r => `
        <div class="list-row">
          ${thumbHtml(r)}
          <div class="row-main"><div class="row-title">${escapeHtml(r.produto)}</div></div>
          <span class="days-badge">${r.dias} dias</span>
        </div>`).join('')
    : emptyStateHtml('Nenhum item parado', `Todos os itens em estoque tiveram saída nos últimos ${periodDays} dias.`);

  renderRecentFeed(data.ultimas);
}

// Métricas do gráfico principal: mesmo espaço e mesmo seletor de período para qualquer visão
const CHART_BLUE = '#2563EB';
const CHART_GREEN = '#10B981';
const CHART_METRICS = {
  vendidos: {
    title: 'Itens mais vendidos ao longo do tempo',
    options: () => ({
      series: [{ key: 'valor', label: 'Unidades vendidas', color: CHART_BLUE }],
      formatValue: v => `${v.toLocaleString('pt-BR')} un.`,
      ariaLabel: 'Gráfico de unidades vendidas por mês',
      emptyText: 'Nenhuma venda registrada no período',
      onSelect: i => openMonthSales(dashboardData.serie[i])
    })
  },
  faturamento: {
    title: 'Faturamento ao longo do tempo',
    options: () => ({
      series: [{ key: 'faturamento', label: 'Faturamento', color: CHART_BLUE }],
      formatValue: v => formatBRL(v),
      formatAxis: v => (v === 0 ? '0' : v >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : `R$ ${v}`),
      ariaLabel: 'Gráfico de faturamento por mês',
      emptyText: 'Nenhum faturamento no período',
      onSelect: i => openMonthSales(dashboardData.serie[i])
    })
  },
  fluxo: {
    title: 'Entradas x Saídas ao longo do tempo',
    options: () => ({
      series: [
        { key: 'entradas', label: 'Entradas', color: CHART_GREEN },
        { key: 'valor', label: 'Saídas', color: CHART_BLUE }
      ],
      formatValue: v => `${v.toLocaleString('pt-BR')} un.`,
      ariaLabel: 'Gráfico de entradas e saídas por mês',
      emptyText: 'Nenhuma movimentação no período'
    })
  }
};

// Só admin recebe faturamento: sem o campo na resposta, a opção some do seletor
function syncMetricOptions(hasRevenue) {
  const select = document.getElementById('metricSelect');
  const option = select.querySelector('option[value="faturamento"]');
  if (!hasRevenue && option) {
    if (select.value === 'faturamento') select.value = 'vendidos';
    option.remove();
  } else if (hasRevenue && !option) {
    select.insertBefore(new Option('Faturamento (R$)', 'faturamento'), select.querySelector('option[value="fluxo"]'));
  }
}

function onMetricChange() {
  chartAnimate = true;
  renderSalesChart();
  chartAnimate = false;
}

function renderSalesChart() {
  if (!dashboardData) return;
  const metric = CHART_METRICS[document.getElementById('metricSelect').value] || CHART_METRICS.vendidos;
  document.getElementById('chartTitle').textContent = metric.title;
  renderAreaChart(document.getElementById('salesChart'), dashboardData.serie, { animate: chartAnimate, ...metric.options() });
}

// "Ver detalhes" do card Risco de ruptura: consumo, prazo, giro e reposição sugerida de cada item em risco
function openRiskDetails() {
  const body = document.getElementById('riskBody');
  const note = document.getElementById('riskNote');
  const risk = riskData;
  openModal('riskModal');
  if (!risk) {
    body.innerHTML = emptyStateHtml('Sem dados', 'Aguarde o painel carregar.');
    return;
  }

  const periodDays = dashboardData ? dashboardData.periodo_dias : 30;
  note.textContent = `Consumo médio dos últimos ${risk.consumo_dias} dias. Em risco: esgota em até ${risk.limiar_dias} dias ou já zerou e vendia. Reposição sugerida: cobre ${risk.consumo_dias} dias de consumo, respeitando mínimo e máximo.`;

  if (risk.itens.length === 0) {
    body.innerHTML = emptyStateHtml('Nenhum item em risco', `Nenhum produto com saída recente esgota em até ${risk.limiar_dias} dias.`);
    return;
  }

  const rows = risk.itens.map((item, i) => {
    const unit = escapeHtml(unitLabel(item.unidade));
    const prazo = item.zerado ? '<span class="badge badge-danger">Zerado</span>' : `~${formatDays(item.dias)}`;
    return `
      <tr>
        <td class="num-col">${i + 1}</td>
        <td><div class="row-title">${escapeHtml(item.produto)}</div><div class="row-sub">${escapeHtml(item.codigo)}</div></td>
        <td class="num">${item.saldo.toLocaleString('pt-BR')} ${unit}</td>
        <td class="num">${item.consumo_diario.toLocaleString('pt-BR')} ${unit}/dia</td>
        <td class="num">${prazo}</td>
        <td class="num">${item.giro === null ? '-' : item.giro.toLocaleString('pt-BR') + '×'}</td>
        <td class="num"><strong>${item.sugestao > 0 ? '+ ' + item.sugestao.toLocaleString('pt-BR') + ' ' + unit : '-'}</strong></td>
      </tr>`;
  }).join('');

  body.innerHTML = `
    <p class="modal-summary"><strong>${risk.valor}</strong> ${risk.valor === 1 ? 'item em risco' : 'itens em risco'} · ${escapeHtml(deltaPlain(risk.delta, periodDays))}</p>
    <div class="table-responsive month-sales">
      <table class="data-table">
        <thead>
          <tr>
            <th class="num-col">Nº</th>
            <th>Produto</th>
            <th class="num">Saldo</th>
            <th class="num">Consumo</th>
            <th class="num">Esgota em</th>
            <th class="num">Giro 30d</th>
            <th class="num">Reposição sugerida</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// Clique num ponto do gráfico: lista numerada de itens vendidos no mês, com total no final
async function openMonthSales(point) {
  const body = document.getElementById('monthSalesBody');
  document.getElementById('monthSalesTitle').textContent = `Vendas de ${point.label} ${point.ano}`;
  document.getElementById('monthSalesNote').textContent = '';
  body.innerHTML = '<p class="loading-note">Carregando...</p>';
  openModal('monthSalesModal');

  try {
    const res = await fetch(`/api/dashboard/sales?month=${encodeURIComponent(point.chave)}`, { headers: getAuthHeaders() });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Falha ao carregar as vendas do mês.');
    renderMonthSales(json.data);
  } catch (err) {
    body.innerHTML = emptyStateHtml('Não foi possível carregar', err.message);
  }
}

function renderMonthSales(data) {
  const body = document.getElementById('monthSalesBody');
  const hasValue = data.total.valor !== undefined;

  if (data.itens.length === 0) {
    body.innerHTML = emptyStateHtml('Nenhuma venda neste mês', 'As saídas registradas aparecem aqui.');
    return;
  }

  const rows = data.itens.map((item, i) => `
    <tr>
      <td class="num-col">${i + 1}</td>
      <td><div class="row-title">${escapeHtml(item.produto)}</div><div class="row-sub">${escapeHtml(item.codigo)}</div></td>
      <td class="num">${item.quantidade.toLocaleString('pt-BR')} ${escapeHtml(unitLabel(item.unidade))}</td>
      ${hasValue ? `<td class="num">${formatBRL(item.valor)}</td>` : ''}
    </tr>`).join('');

  body.innerHTML = `
    <div class="table-responsive month-sales">
      <table class="data-table">
        <thead>
          <tr>
            <th class="num-col">Nº</th>
            <th>Produto</th>
            <th class="num">Qtd. vendida</th>
            ${hasValue ? '<th class="num">Valor vendido</th>' : ''}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td></td>
            <td>Total (${data.itens.length} ${data.itens.length === 1 ? 'item' : 'itens'})</td>
            <td class="num">${data.total.quantidade.toLocaleString('pt-BR')} un.</td>
            ${hasValue ? `<td class="num">${formatBRL(data.total.valor)}</td>` : ''}
          </tr>
        </tfoot>
      </table>
    </div>`;

  document.getElementById('monthSalesNote').textContent = hasValue
    ? 'Valores calculados com o preço de venda atual de cada produto.'
    : '';
}

// O SVG usa a largura real do contêiner: redesenha ao redimensionar a janela
let chartResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(chartResizeTimer);
  chartResizeTimer = setTimeout(renderSalesChart, 150);
});

// 2. ÚLTIMAS MOVIMENTAÇÕES (vem junto com o painel)
function renderRecentFeed(movements) {
  const feed = document.getElementById('recentMovementsFeed');

  if (!movements || movements.length === 0) {
    feed.innerHTML = emptyStateHtml('Nenhuma movimentação registrada', 'Entradas, saídas e ajustes aparecem aqui em tempo real.');
    return;
  }

  const kinds = {
    ENTRADA: { cls: 'in', ic: 'arrow-up', title: 'Entrada de produtos' },
    SAIDA: { cls: 'out', ic: 'arrow-down', title: 'Saída de produtos' },
    AJUSTE: { cls: 'adj', ic: 'sliders-horizontal', title: 'Ajuste de estoque' }
  };

  feed.innerHTML = movements.map(m => {
    const k = kinds[m.tipo] || kinds.AJUSTE;
    const detail = m.tipo === 'ENTRADA' && m.fornecedor ? `Fornecedor: ${m.fornecedor}` : m.motivo;
    const sub = [m.produto, detail].filter(Boolean).join(' • ');
    const unit = unitLabel(m.unidade);
    const qty = m.tipo === 'ENTRADA' ? `+ ${m.quantidade} ${unit}`
      : m.tipo === 'SAIDA' ? `- ${m.quantidade} ${unit}`
      : `= ${m.saldo} ${unit}`;
    return `
      <div class="list-row">
        <div class="feed-ic ${k.cls}">${icon(k.ic)}</div>
        <div class="row-main">
          <div class="row-title">${k.title}</div>
          <div class="row-sub">${escapeHtml(sub)}</div>
        </div>
        <span class="row-time">${formatWhen(m.data_hora)}</span>
        <span class="row-qty ${k.cls}">${escapeHtml(qty)}</span>
      </div>`;
  }).join('');
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

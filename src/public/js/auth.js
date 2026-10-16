let currentUser = null;
let currentToken = null;

function initAuth() {
  const token = localStorage.getItem('estoque_token');
  const userJson = localStorage.getItem('estoque_user');

  if (token && userJson) {
    try {
      currentUser = JSON.parse(userJson);
      currentToken = token;
      applyUserPermissions();
      showApp();
    } catch (e) {
      showLogin();
    }
  } else {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appScreen').style.display = 'none';
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'flex';

  // Atualiza sidebar
  if (currentUser) {
    document.getElementById('sidebarUserName').textContent = currentUser.nome || 'Usuário';
    document.getElementById('sidebarUserRole').textContent = currentUser.role === 'admin' ? 'Administrador' : 'Operador';
    document.getElementById('sidebarAvatar').textContent = (currentUser.nome || 'U').charAt(0).toUpperCase();
  }
}

function applyUserPermissions() {
  const isAdmin = currentUser && currentUser.role === 'admin';
  const adminElements = document.querySelectorAll('.admin-only');

  adminElements.forEach(el => {
    if (isAdmin) {
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  });

  // Cards equivalentes para o operador (sem valores financeiros)
  document.querySelectorAll('.user-only').forEach(el => {
    el.style.display = isAdmin ? 'none' : '';
  });
}

function setLoginRole(role) {
  const btnAdmin = document.getElementById('btnRoleAdmin');
  const btnUser = document.getElementById('btnRoleUser');
  if (role === 'admin') {
    btnAdmin.classList.add('active');
    btnUser.classList.remove('active');
    fillCredentials('admin@estoque.com', 'admin123', 'admin');
  } else {
    btnUser.classList.add('active');
    btnAdmin.classList.remove('active');
    fillCredentials('usuario@estoque.com', 'user123', 'user');
  }
}

function fillCredentials(email, password, role) {
  document.getElementById('loginEmail').value = email;
  document.getElementById('loginPassword').value = password;
  if (role === 'admin') {
    document.getElementById('btnRoleAdmin').classList.add('active');
    document.getElementById('btnRoleUser').classList.remove('active');
  } else {
    document.getElementById('btnRoleUser').classList.add('active');
    document.getElementById('btnRoleAdmin').classList.remove('active');
  }
}

function togglePasswordVisibility(id) {
  const input = document.getElementById(id);
  input.type = input.type === 'password' ? 'text' : 'password';
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const submitBtn = document.getElementById('btnLoginSubmit');

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Autenticando...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Falha no login');
    }

    currentToken = data.token;
    currentUser = data.user;

    localStorage.setItem('estoque_token', currentToken);
    localStorage.setItem('estoque_user', JSON.stringify(currentUser));

    showToast('Login realizado com sucesso! Bem-vindo, ' + currentUser.nome, 'success');
    applyUserPermissions();
    showApp();

    if (window.loadDashboard) window.loadDashboard();
    if (window.loadProducts) window.loadProducts();
  } catch (err) {
    showToast(err.message, 'danger');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>Entrar no Sistema</span> <i class="fa-solid fa-arrow-right"></i>';
  }
}

function handleLogout() {
  if (confirm('Deseja realmente sair do sistema?')) {
    localStorage.removeItem('estoque_token');
    localStorage.removeItem('estoque_user');
    currentUser = null;
    currentToken = null;
    showToast('Sessão encerrada com sucesso.', 'info');
    showLogin();
  }
}

function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${currentToken}`
  };
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icon = type === 'success' ? 'circle-check' : type === 'danger' ? 'circle-exclamation' : 'circle-info';
  toast.innerHTML = `<i class="fa-solid fa-${icon}"></i> <span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

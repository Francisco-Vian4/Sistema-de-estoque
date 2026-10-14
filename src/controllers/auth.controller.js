const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { generateToken } = require('../config/auth');

async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'E-mail e senha são obrigatórios.' });
    }

    const result = await db.query('SELECT * FROM usuarios WHERE email = $1', [email.trim().toLowerCase()]);
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Credenciais inválidas. Verifique seu e-mail e senha.' });
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.senha_hash);

    if (!passwordMatch) {
      return res.status(401).json({ success: false, error: 'Credenciais inválidas. Verifique seu e-mail e senha.' });
    }

    const token = generateToken(user);

    return res.json({
      success: true,
      message: 'Login realizado com sucesso!',
      token,
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Erro no login:', err);
    return res.status(500).json({ success: false, error: 'Erro interno ao processar login.' });
  }
}

async function me(req, res) {
  try {
    const result = await db.query('SELECT id, nome, email, role, created_at FROM usuarios WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
    }
    return res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Erro ao obter dados do usuário.' });
  }
}

async function listUsers(req, res) {
  try {
    const result = await db.query('SELECT id, nome, email, role, created_at FROM usuarios ORDER BY id ASC');
    return res.json({ success: true, users: result.rows });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Erro ao listar usuários.' });
  }
}

async function createUser(req, res) {
  try {
    const { nome, email, password, role } = req.body;

    if (!nome || !email || !password) {
      return res.status(400).json({ success: false, error: 'Nome, e-mail e senha são obrigatórios.' });
    }

    const existing = await db.query('SELECT id FROM usuarios WHERE email = $1', [email.trim().toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Já existe um usuário com este e-mail.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    const assignedRole = role === 'admin' ? 'admin' : 'user';

    const result = await db.query(
      'INSERT INTO usuarios (nome, email, senha_hash, role) VALUES ($1, $2, $3, $4)',
      [nome.trim(), email.trim().toLowerCase(), hash, assignedRole]
    );

    return res.status(201).json({
      success: true,
      message: 'Usuário criado com sucesso!'
    });
  } catch (err) {
    console.error('Erro ao criar usuário:', err);
    return res.status(500).json({ success: false, error: 'Erro ao criar usuário.' });
  }
}

module.exports = {
  login,
  me,
  listUsers,
  createUser
};

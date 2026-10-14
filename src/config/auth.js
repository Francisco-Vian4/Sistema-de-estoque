const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'estoque-secret-super-key-2026-vibrant-blue';

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      nome: user.nome,
      email: user.email,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authMiddleware(req, res, next) {
  let token = null;

  // Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    // Permite token na query string para downloads diretos (PDF, Excel, Word)
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'Acesso não autorizado. Token não fornecido.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Sessão expirada ou token inválido.' });
  }
}

function requireRole(roles) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Usuário não autenticado.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `Acesso negado. Ação restrita para perfil: ${allowedRoles.join(', ')}.`
      });
    }
    next();
  };
}

module.exports = {
  JWT_SECRET,
  generateToken,
  authMiddleware,
  requireRole
};

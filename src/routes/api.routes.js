const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');

const authController = require('../controllers/auth.controller');
const productController = require('../controllers/product.controller');
const movementController = require('../controllers/movement.controller');
const reportController = require('../controllers/report.controller');
const { authMiddleware, requireRole } = require('../config/auth');
const { importExcelFile } = require('../services/excel-import.service');

// Configuração de upload de arquivos (imagens ou excel)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../public/uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
  }
});
const upload = multer({ storage });

// Rotas de Autenticação
router.post('/auth/login', authController.login);
router.get('/auth/me', authMiddleware, authController.me);
router.get('/auth/users', authMiddleware, requireRole('admin'), authController.listUsers);
router.post('/auth/users', authMiddleware, requireRole('admin'), authController.createUser);

// Rotas de Produtos
router.get('/products/stats', authMiddleware, productController.getStats);
router.get('/products/categories', authMiddleware, productController.getCategories);
router.get('/products', authMiddleware, productController.list);
router.get('/products/:id', authMiddleware, productController.getById);

// Usuário e Admin podem cadastrar novos produtos
router.post('/products', authMiddleware, productController.create);

// Apenas Admin pode alterar propriedades/valores e excluir produtos
router.put('/products/:id', authMiddleware, requireRole('admin'), productController.update);
router.delete('/products/:id', authMiddleware, requireRole('admin'), productController.remove);

// Rotas de Movimentação de Estoque (Admin)
router.post('/movements', authMiddleware, requireRole('admin'), movementController.createMovement);
router.get('/movements', authMiddleware, movementController.listMovements);

// Rotas de Relatórios (PDF, Excel, Word)
router.get('/reports/pdf', authMiddleware, reportController.exportPdf);
router.get('/reports/excel', authMiddleware, reportController.exportExcel);
router.get('/reports/word', authMiddleware, reportController.exportWord);

// Upload de imagem
router.post('/upload/image', authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado.' });
  }
  const imageUrl = `/uploads/${req.file.filename}`;
  return res.json({ success: true, url: imageUrl });
});

// Importação da Planilha Excel
router.post('/import/excel', authMiddleware, requireRole('admin'), upload.single('excel'), async (req, res) => {
  try {
    const filePath = req.file ? req.file.path : null;
    const result = await importExcelFile(filePath);
    return res.json({
      success: true,
      message: `Planilha importada com sucesso! ${result.inserted} novos, ${result.updated} atualizados.`,
      result
    });
  } catch (err) {
    console.error('Erro ao importar excel:', err);
    return res.status(500).json({ success: false, error: err.message || 'Erro ao importar planilha.' });
  }
});

module.exports = router;

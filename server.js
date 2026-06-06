require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const morgan = require('morgan');
const { randomUUID } = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = path.resolve(process.env.DATABASE_PATH || './data/evora_launch_os.sqlite');
const DATA_DIR = path.dirname(DB_PATH);
const SESSION_SECRET = process.env.SESSION_SECRET || 'evora-dev-secret-change-me';

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

function runSchema() {
  const schemaPath = path.join(__dirname, 'database', 'schema.sql');
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
}

function id(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

const PERMISSIONS = [
  ['system:admin', 'Administração geral', 'Acesso total ao sistema', 'Sistema'],
  ['user:view', 'Ver usuários', 'Visualizar usuários e corretores', 'Usuários'],
  ['user:manage', 'Gerenciar usuários', 'Criar, alterar, inativar e redefinir senhas', 'Usuários'],
  ['role:view', 'Ver papéis', 'Visualizar papéis e permissões', 'Permissões'],
  ['role:manage', 'Gerenciar papéis', 'Criar papéis e definir permissões', 'Permissões'],
  ['project:view', 'Ver empreendimentos', 'Visualizar empreendimentos', 'Empreendimentos'],
  ['project:manage', 'Gerenciar empreendimentos', 'Criar e alterar empreendimentos', 'Empreendimentos'],
  ['lead:view', 'Ver leads', 'Visualizar leads e dossiês', 'Leads'],
  ['lead:create', 'Criar leads', 'Cadastrar novos leads', 'Leads'],
  ['lead:update', 'Alterar leads', 'Editar leads, responsáveis e etapas', 'Leads'],
  ['lead:delete', 'Excluir leads', 'Excluir leads definitivamente ou logicamente', 'Leads'],
  ['lead:assign', 'Distribuir leads', 'Alterar SDR e corretor responsáveis', 'Leads'],
  ['broker:validate', 'Validar corretores', 'Validar CRECI e documentação de corretores', 'Corretores'],
  ['lot:view', 'Ver lotes', 'Visualizar mapa e disponibilidade de lotes', 'Lotes'],
  ['lot:update', 'Alterar lotes', 'Reservar, liberar e alterar status de lotes', 'Lotes'],
  ['proposal:create', 'Criar propostas', 'Criar propostas comerciais', 'Propostas'],
  ['proposal:approve', 'Aprovar propostas', 'Aprovar propostas e condições especiais', 'Propostas'],
  ['contract:manage', 'Gerenciar contratos', 'Gerar e acompanhar contratos', 'Contratos'],
  ['finance:view', 'Ver financeiro', 'Visualizar carteira e financeiro', 'Financeiro'],
  ['report:view', 'Ver relatórios', 'Visualizar e exportar relatórios', 'Relatórios'],
  ['audit:view', 'Ver logs', 'Visualizar logs e auditoria', 'Auditoria'],
  ['settings:manage', 'Configurações', 'Alterar parâmetros do sistema', 'Sistema']
];

const ROLE_MATRIX = {
  'Super Administrador': ['*'],
  'Administrador': ['user:view','user:manage','role:view','project:view','project:manage','lead:view','lead:create','lead:update','lead:delete','lead:assign','broker:validate','lot:view','lot:update','proposal:create','proposal:approve','contract:manage','finance:view','report:view','audit:view','settings:manage'],
  'Diretor Comercial': ['user:view','project:view','lead:view','lead:update','lead:assign','lot:view','lot:update','proposal:create','proposal:approve','contract:manage','finance:view','report:view','audit:view'],
  'Gestor Comercial': ['user:view','project:view','lead:view','lead:create','lead:update','lead:assign','lot:view','lot:update','proposal:create','proposal:approve','contract:manage','report:view'],
  'SDR': ['project:view','lead:view','lead:create','lead:update','lot:view','report:view'],
  'Corretor': ['project:view','lead:view','lead:update','lot:view','lot:update','proposal:create','contract:manage','report:view'],
  'Jurídico': ['project:view','lead:view','lead:update','proposal:approve','contract:manage','report:view'],
  'Financeiro': ['project:view','lead:view','contract:manage','finance:view','report:view'],
  'Pós-venda': ['project:view','lead:view','lead:update','report:view'],
  'Marketing': ['project:view','lead:view','lead:create','report:view'],
  'Leitura': ['project:view','lead:view','lot:view','report:view']
};

function seed() {
  const insertPerm = db.prepare('INSERT OR IGNORE INTO permissions (id, code, name, description, category) VALUES (?, ?, ?, ?, ?)');
  for (const p of PERMISSIONS) insertPerm.run(id('perm'), ...p);

  const insertRole = db.prepare('INSERT OR IGNORE INTO roles (id, name, description, is_system) VALUES (?, ?, ?, ?)');
  for (const roleName of Object.keys(ROLE_MATRIX)) {
    insertRole.run(id('role'), roleName, `Papel padrão: ${roleName}`, 1);
  }

  const getRole = db.prepare('SELECT * FROM roles WHERE name = ?');
  const getPerm = db.prepare('SELECT * FROM permissions WHERE code = ?');
  const addRolePerm = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)');
  for (const [roleName, codes] of Object.entries(ROLE_MATRIX)) {
    const role = getRole.get(roleName);
    const finalCodes = codes.includes('*') ? PERMISSIONS.map(p => p[0]) : codes;
    for (const code of finalCodes) {
      const perm = getPerm.get(code);
      if (role && perm) addRolePerm.run(role.id, perm.id);
    }
  }

  const projectCount = db.prepare('SELECT COUNT(*) AS n FROM projects').get().n;
  if (!projectCount) {
    db.prepare('INSERT INTO projects (id, name, city, uf, status) VALUES (?, ?, ?, ?, ?)').run(
      'proj_reserva_evora',
      'Reserva Évora',
      'Bauru',
      'SP',
      'Pré-lançamento'
    );
  }

  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL').get().n;
  if (!userCount) {
    const adminRole = getRole.get('Super Administrador');
    const email = process.env.ADMIN_EMAIL || 'admin@evora.local';
    const password = process.env.ADMIN_PASSWORD || 'Evora@2026!';
    const hash = bcrypt.hashSync(password, 12);
    const userId = 'usr_primary_admin';
    db.prepare(`INSERT INTO users (id, name, email, phone, password_hash, role_id, active, force_password_change, is_primary_admin)
                VALUES (?, ?, ?, ?, ?, ?, 1, 1, 1)`)
      .run(userId, 'Administrador Principal', email, '', hash, adminRole.id);
    db.prepare('INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)').run(userId, 'proj_reserva_evora');
  }
}

runSchema();
seed();

const SQLiteStore = SQLiteStoreFactory(session);

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA_DIR }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 10 }
}));

app.use(express.static(path.join(__dirname, 'public')));

function audit(req, action, entity, entityId, details = {}) {
  try {
    db.prepare(`INSERT INTO audit_logs (id, user_id, action, entity, entity_id, details, ip, user_agent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id('log'), req.user?.id || null, action, entity, entityId || null, JSON.stringify(details), req.ip, req.get('user-agent') || '');
  } catch (e) {
    console.error('audit error', e);
  }
}

function getUser(userId) {
  return db.prepare(`SELECT u.*, r.name AS role_name
                     FROM users u JOIN roles r ON r.id = u.role_id
                     WHERE u.id = ? AND u.deleted_at IS NULL`).get(userId);
}

function getPermissions(userId) {
  const user = getUser(userId);
  if (!user) return [];
  const rows = db.prepare(`
    SELECT p.code
    FROM permissions p
    JOIN role_permissions rp ON rp.permission_id = p.id
    WHERE rp.role_id = ?
  `).all(user.role_id);
  return rows.map(r => r.code);
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    roleId: u.role_id,
    roleName: u.role_name,
    active: !!u.active,
    forcePasswordChange: !!u.force_password_change,
    isPrimaryAdmin: !!u.is_primary_admin,
    creci: u.creci,
    hasCreciDocument: !!u.creci_document_data,
    creciDocumentName: u.creci_document_name,
    lastLoginAt: u.last_login_at,
    createdAt: u.created_at
  };
}

function attachUser(req, res, next) {
  if (!req.session.userId) return next();
  const user = getUser(req.session.userId);
  if (user && user.active) {
    req.user = user;
    req.permissions = getPermissions(user.id);
  }
  next();
}
app.use(attachUser);

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
  next();
}

function can(req, permission) {
  return !!req.user && (req.user.is_primary_admin || req.permissions.includes('system:admin') || req.permissions.includes(permission));
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
    if (!can(req, permission)) return res.status(403).json({ error: 'Acesso negado', permission });
    next();
  };
}

function getRoleByName(name) {
  return db.prepare('SELECT * FROM roles WHERE name = ?').get(name);
}

function roleName(roleId) {
  return db.prepare('SELECT name FROM roles WHERE id = ?').get(roleId)?.name;
}

function validateUserPayload(payload, existing = null) {
  if (!payload.name || !payload.email || !payload.roleId) {
    return 'Nome, e-mail e papel são obrigatórios.';
  }
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(payload.roleId);
  if (!role) return 'Papel inválido.';
  if (role.name === 'Corretor') {
    if (!payload.creci) return 'CRECI é obrigatório para corretores.';
    if (!payload.creciDocumentData && !existing?.creci_document_data) return 'Documento CRECI em PDF é obrigatório para corretores.';
    if (payload.creciDocumentMime && payload.creciDocumentMime !== 'application/pdf') return 'Documento CRECI deve ser PDF.';
  }
  return null;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: '5.0.0', database: DB_PATH });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare(`SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id
                           WHERE lower(u.email) = lower(?) AND u.deleted_at IS NULL`).get(email || '');
  if (!user || !user.active || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  }
  req.session.userId = user.id;
  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  req.user = user;
  audit(req, 'login', 'user', user.id, { email });
  res.json({ user: publicUser(user), permissions: getPermissions(user.id) });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  audit(req, 'logout', 'user', req.user.id);
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), permissions: req.permissions });
});

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'A nova senha precisa ter pelo menos 8 caracteres.' });
  const user = getUser(req.user.id);
  if (!user.force_password_change && !bcrypt.compareSync(currentPassword || '', user.password_hash)) {
    return res.status(400).json({ error: 'Senha atual inválida.' });
  }
  db.prepare('UPDATE users SET password_hash = ?, force_password_change = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 12), user.id);
  audit(req, 'change_password', 'user', user.id);
  res.json({ ok: true });
});

app.get('/api/bootstrap', requireAuth, (req, res) => {
  const roles = db.prepare('SELECT * FROM roles ORDER BY name').all();
  const permissions = db.prepare('SELECT * FROM permissions ORDER BY category, name').all();
  const projects = db.prepare('SELECT * FROM projects ORDER BY name').all();
  res.json({ user: publicUser(req.user), permissions: req.permissions, roles, allPermissions: permissions, projects });
});

app.get('/api/users', requireAuth, requirePermission('user:view'), (req, res) => {
  const rows = db.prepare(`SELECT u.*, r.name AS role_name
                           FROM users u JOIN roles r ON r.id = u.role_id
                           WHERE u.deleted_at IS NULL
                           ORDER BY u.created_at DESC`).all();
  res.json(rows.map(publicUser));
});

app.post('/api/users', requireAuth, requirePermission('user:manage'), (req, res) => {
  const payload = req.body;
  const err = validateUserPayload(payload);
  if (err) return res.status(400).json({ error: err });
  const tempPassword = payload.password || `Evora@${Math.floor(100000 + Math.random() * 899999)}`;
  const userId = id('usr');
  try {
    db.prepare(`INSERT INTO users (id, name, email, phone, password_hash, role_id, active, force_password_change, creci, creci_document_name, creci_document_mime, creci_document_data)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, payload.name, payload.email, payload.phone || '', bcrypt.hashSync(tempPassword, 12), payload.roleId, payload.active === false ? 0 : 1, 1,
        payload.creci || null, payload.creciDocumentName || null, payload.creciDocumentMime || null, payload.creciDocumentData || null);
    const projectIds = Array.isArray(payload.projectIds) && payload.projectIds.length ? payload.projectIds : [db.prepare('SELECT id FROM projects LIMIT 1').get().id];
    const addProject = db.prepare('INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)');
    projectIds.forEach(projectId => addProject.run(userId, projectId));
    audit(req, 'create', 'user', userId, { email: payload.email, roleId: payload.roleId });
    res.status(201).json({ user: publicUser(getUser(userId)), temporaryPassword: tempPassword });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: 'E-mail já cadastrado.' });
    throw e;
  }
});

app.put('/api/users/:id', requireAuth, requirePermission('user:manage'), (req, res) => {
  const user = getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const payload = req.body;
  const err = validateUserPayload(payload, user);
  if (err) return res.status(400).json({ error: err });

  db.prepare(`UPDATE users SET name=?, email=?, phone=?, role_id=?, active=?, creci=?, creci_document_name=?, creci_document_mime=?, creci_document_data=?, updated_at=CURRENT_TIMESTAMP
              WHERE id=?`)
    .run(
      payload.name,
      payload.email,
      payload.phone || '',
      payload.roleId,
      payload.active === false ? 0 : 1,
      payload.creci || null,
      payload.creciDocumentName || user.creci_document_name,
      payload.creciDocumentMime || user.creci_document_mime,
      payload.creciDocumentData || user.creci_document_data,
      req.params.id
    );
  if (Array.isArray(payload.projectIds)) {
    db.prepare('DELETE FROM user_projects WHERE user_id = ?').run(req.params.id);
    const addProject = db.prepare('INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)');
    payload.projectIds.forEach(projectId => addProject.run(req.params.id, projectId));
  }
  audit(req, 'update', 'user', req.params.id, { email: payload.email });
  res.json({ user: publicUser(getUser(req.params.id)) });
});

app.delete('/api/users/:id', requireAuth, requirePermission('user:manage'), (req, res) => {
  if (req.params.id === req.user.id && !req.user.is_primary_admin) return res.status(400).json({ error: 'Você não pode excluir seu próprio usuário.' });
  const user = getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (user.is_primary_admin && req.user.id !== user.id) return res.status(400).json({ error: 'O administrador principal só pode ser alterado por ele mesmo.' });
  db.prepare('UPDATE users SET deleted_at = CURRENT_TIMESTAMP, active = 0 WHERE id = ?').run(req.params.id);
  audit(req, 'delete', 'user', req.params.id, { email: user.email });
  res.json({ ok: true });
});

app.post('/api/users/:id/reset-password', requireAuth, requirePermission('user:manage'), (req, res) => {
  const user = getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const newPassword = req.body.newPassword || `Evora@${Math.floor(100000 + Math.random() * 899999)}`;
  if (newPassword.length < 8) return res.status(400).json({ error: 'Senha precisa ter pelo menos 8 caracteres.' });
  db.prepare('UPDATE users SET password_hash = ?, force_password_change = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 12), req.params.id);
  audit(req, 'reset_password', 'user', req.params.id);
  res.json({ ok: true, temporaryPassword: newPassword });
});

app.get('/api/roles', requireAuth, requirePermission('role:view'), (req, res) => {
  const roles = db.prepare('SELECT * FROM roles ORDER BY name').all();
  const perms = db.prepare(`SELECT rp.role_id, p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id`).all();
  res.json(roles.map(r => ({ ...r, permissions: perms.filter(p => p.role_id === r.id).map(p => p.code) })));
});

app.post('/api/roles', requireAuth, requirePermission('role:manage'), (req, res) => {
  const roleId = id('role');
  db.prepare('INSERT INTO roles (id, name, description, is_system, active) VALUES (?, ?, ?, 0, 1)')
    .run(roleId, req.body.name, req.body.description || '');
  updateRolePermissions(roleId, req.body.permissions || []);
  audit(req, 'create', 'role', roleId, { name: req.body.name });
  res.status(201).json({ id: roleId });
});

app.put('/api/roles/:id', requireAuth, requirePermission('role:manage'), (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'Papel não encontrado.' });
  db.prepare('UPDATE roles SET name=?, description=?, active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(req.body.name, req.body.description || '', req.body.active === false ? 0 : 1, req.params.id);
  updateRolePermissions(req.params.id, req.body.permissions || []);
  audit(req, 'update', 'role', req.params.id, { name: req.body.name });
  res.json({ ok: true });
});

function updateRolePermissions(roleId, codes) {
  db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
  const getPerm = db.prepare('SELECT id FROM permissions WHERE code = ?');
  const add = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)');
  codes.forEach(code => {
    const perm = getPerm.get(code);
    if (perm) add.run(roleId, perm.id);
  });
}

app.get('/api/leads', requireAuth, requirePermission('lead:view'), (req, res) => {
  const rows = db.prepare(`SELECT * FROM leads WHERE deleted_at IS NULL ORDER BY updated_at DESC`).all();
  res.json(rows);
});

app.post('/api/leads', requireAuth, requirePermission('lead:create'), (req, res) => {
  const p = req.body;
  const leadId = id('lead');
  db.prepare(`INSERT INTO leads (id, project_id, name, phone, email, city, uf, source, campaign, purpose, buyer_profile, stage, score, sdr_id, broker_id, address, address_number, district, complement, cep, cpf_cnpj, profession, marital_status, spouse_name, spouse_cpf, notes)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(leadId, p.projectId || 'proj_reserva_evora', p.name, p.phone || '', p.email || '', p.city || '', p.uf || 'SP', p.source || '', p.campaign || '', p.purpose || '', p.buyerProfile || '',
      p.stage || 'captado', Number(p.score || 0), p.sdrId || null, p.brokerId || null, p.address || '', p.addressNumber || '', p.district || '', p.complement || '', p.cep || '',
      p.cpfCnpj || '', p.profession || '', p.maritalStatus || '', p.spouseName || '', p.spouseCpf || '', p.notes || '');
  audit(req, 'create', 'lead', leadId, { name: p.name });
  res.status(201).json(db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId));
});

app.put('/api/leads/:id', requireAuth, requirePermission('lead:update'), (req, res) => {
  const current = db.prepare('SELECT * FROM leads WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Lead não encontrado.' });
  const p = req.body;
  db.prepare(`UPDATE leads SET name=?, phone=?, email=?, city=?, uf=?, source=?, campaign=?, purpose=?, buyer_profile=?, stage=?, score=?, sdr_id=?, broker_id=?, address=?, address_number=?, district=?, complement=?, cep=?, cpf_cnpj=?, profession=?, marital_status=?, spouse_name=?, spouse_cpf=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(p.name, p.phone || '', p.email || '', p.city || '', p.uf || 'SP', p.source || '', p.campaign || '', p.purpose || '', p.buyerProfile || '',
      p.stage || current.stage, Number(p.score || 0), p.sdrId || null, p.brokerId || null, p.address || '', p.addressNumber || '', p.district || '', p.complement || '', p.cep || '',
      p.cpfCnpj || '', p.profession || '', p.maritalStatus || '', p.spouseName || '', p.spouseCpf || '', p.notes || '', req.params.id);
  audit(req, 'update', 'lead', req.params.id, { name: p.name });
  res.json(db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id));
});

app.delete('/api/leads/:id', requireAuth, requirePermission('lead:delete'), (req, res) => {
  const current = db.prepare('SELECT * FROM leads WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Lead não encontrado.' });
  db.prepare('UPDATE leads SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  audit(req, 'delete', 'lead', req.params.id, { name: current.name });
  res.json({ ok: true });
});

app.get('/api/audit-logs', requireAuth, requirePermission('audit:view'), (req, res) => {
  const limit = Math.min(Number(req.query.limit || 200), 1000);
  const rows = db.prepare(`SELECT a.*, u.name AS user_name, u.email AS user_email
                           FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
                           ORDER BY a.created_at DESC LIMIT ?`).all(limit);
  res.json(rows);
});

app.get('/api/reports/summary', requireAuth, requirePermission('report:view'), (req, res) => {
  const totalLeads = db.prepare('SELECT COUNT(*) AS n FROM leads WHERE deleted_at IS NULL').get().n;
  const activeUsers = db.prepare('SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL AND active = 1').get().n;
  const brokers = db.prepare(`SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'Corretor' AND u.deleted_at IS NULL`).get().n;
  const logs = db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n;
  res.json({ totalLeads, activeUsers, brokers, logs });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Évora Launch OS v5.0 rodando em http://localhost:${PORT}`);
  console.log(`Banco SQLite: ${DB_PATH}`);
});

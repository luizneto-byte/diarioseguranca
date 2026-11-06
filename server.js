require('dotenv').config();
const express = require('express'), { Pool } = require('pg'), bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken'), cookieParser = require('cookie-parser');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const SEGREDO = process.env.JWT_SECRET;
const app = express();
app.use(express.json());
app.use(cookieParser());
const path = require('path'), fs = require('fs');
let PAGINA = '<h1>index.html não encontrado</h1>';
try { PAGINA = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'); } catch (e) { console.error(e.message); }
app.get('/', (req, res) => res.type('html').send(PAGINA));

const wrap = f => (q, s, n) => f(q, s, n).catch(e => { console.error(e); s.status(500).json({ erro: 'Erro interno' }); });
const auth = (req, res, next) => {
  try { req.u = jwt.verify(req.cookies.t, SEGREDO); next(); }
  catch { res.status(401).json({ erro: 'Faça login' }); }
};
const soAdmin = (req, res, next) => req.u.role === 'admin' ? next() : res.status(403).json({ erro: 'Apenas administrador' });

app.use('/api', (req, res, next) => preparar().then(() => next()).catch(e => {
  console.error(e); res.status(500).json({ erro: 'Falha ao conectar no banco: ' + e.message });
}));

// ---------- Login ----------
app.post('/api/login', wrap(async (req, res) => {
  const { email, senha } = req.body;
  const { rows } = await pool.query('SELECT * FROM usuarios WHERE email=$1 AND ativo', [String(email || '').toLowerCase().trim()]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(String(senha || ''), u.senha_hash))) return res.status(401).json({ erro: 'E-mail ou senha incorretos' });
  const dados = { id: u.id, nome: u.nome, role: u.role };
  res.cookie('t', jwt.sign(dados, SEGREDO, { expiresIn: '12h' }), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 12 * 3600e3,
  });
  res.json(dados);
}));
app.post('/api/logout', (req, res) => { res.clearCookie('t'); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json({ id: req.u.id, nome: req.u.nome, role: req.u.role }));

// ---------- Registros ----------
app.post('/api/registros', auth, wrap(async (req, res) => {
  const { atividade, local, data_hora, link } = req.body;
  if (!atividade?.trim() || !local?.trim()) return res.status(400).json({ erro: 'Informe o que foi feito e o local' });
  if (link && !/^https?:\/\//i.test(link)) return res.status(400).json({ erro: 'O link deve começar com http:// ou https://' });
  const r = await pool.query(
    'INSERT INTO registros(user_id,atividade,local,data_hora,link) VALUES($1,$2,$3,COALESCE($4::timestamptz,now()),$5) RETURNING id',
    [req.u.id, atividade.trim(), local.trim(), data_hora || null, link?.trim() || null]);
  res.json({ id: r.rows[0].id });
}));

// Privacidade: administradores veem toda a equipe; técnicos só acessam os próprios registros.
app.get('/api/registros', auth, wrap(async (req, res) => {
  const tecnico = req.u.role === 'admin' ? (req.query.tecnico || null) : req.u.id;
  const dia = req.query.dia || null;
  const { rows } = await pool.query(`
    SELECT r.id, r.user_id, r.atividade, r.local, r.data_hora, r.link, u.nome AS tecnico,
      (SELECT COUNT(*)::int FROM curtidas c WHERE c.registro_id=r.id) AS curtidas,
      (SELECT COUNT(*)::int FROM comentarios co WHERE co.registro_id=r.id) AS comentarios,
      EXISTS(SELECT 1 FROM curtidas c WHERE c.registro_id=r.id AND c.user_id=$3) AS curtido
    FROM registros r JOIN usuarios u ON u.id=r.user_id
    WHERE ($1::int IS NULL OR r.user_id=$1)
      AND ($2::date IS NULL OR (r.data_hora AT TIME ZONE 'America/Sao_Paulo')::date=$2::date)
    ORDER BY r.data_hora DESC LIMIT 500`, [tecnico, dia, req.u.id]);
  res.json(rows);
}));

// ---------- Interações do feed ----------
app.post('/api/registros/:id/curtir', auth, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ erro: 'Registro inválido' });
  const registro = await pool.query('SELECT user_id FROM registros WHERE id=$1 AND ($2::boolean OR user_id=$3)', [id, req.u.role === 'admin', req.u.id]);
  if (!registro.rows.length)
    return res.status(404).json({ erro: 'Registro não encontrado' });
  const curtiu = await pool.query('DELETE FROM curtidas WHERE registro_id=$1 AND user_id=$2 RETURNING registro_id', [id, req.u.id]);
  let curtido = false;
  if (!curtiu.rowCount) {
    await pool.query('INSERT INTO curtidas(registro_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [id, req.u.id]);
    curtido = true;
  }
  const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM curtidas WHERE registro_id=$1', [id]);
  res.json({ curtido, curtidas: rows[0].total });
}));
app.get('/api/registros/:id/comentarios', auth, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ erro: 'Registro inválido' });
  const registro = await pool.query('SELECT user_id FROM registros WHERE id=$1 AND ($2::boolean OR user_id=$3)', [id, req.u.role === 'admin', req.u.id]);
  if (!registro.rows.length)
    return res.status(404).json({ erro: 'Registro não encontrado' });
  const { rows } = await pool.query('SELECT c.id,c.texto,c.criado_em,u.nome FROM comentarios c JOIN usuarios u ON u.id=c.user_id WHERE c.registro_id=$1 ORDER BY c.criado_em ASC LIMIT 200', [id]);
  res.json(rows);
}));
app.post('/api/registros/:id/comentarios', auth, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const texto = String(req.body?.texto || '').trim();
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ erro: 'Registro inválido' });
  if (!texto || texto.length > 2000) return res.status(400).json({ erro: 'Comentário deve conter de 1 a 2000 caracteres' });
  const registro = await pool.query('SELECT user_id FROM registros WHERE id=$1 AND ($2::boolean OR user_id=$3)', [id, req.u.role === 'admin', req.u.id]);
  if (!registro.rows.length)
    return res.status(404).json({ erro: 'Registro não encontrado' });
  const { rows } = await pool.query('INSERT INTO comentarios(registro_id,user_id,texto) VALUES($1,$2,$3) RETURNING id', [id, req.u.id, texto]);
  res.json({ id: rows[0].id });
}));

// ---------- Usuários (admin) ----------
app.get('/api/usuarios', auth, soAdmin, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id,nome,email,role,ativo FROM usuarios ORDER BY nome');
  res.json(rows);
}));
app.post('/api/usuarios', auth, soAdmin, wrap(async (req, res) => {
  const { nome, email, senha, role } = req.body;
  if (!nome || !email || !senha || senha.length < 6) return res.status(400).json({ erro: 'Preencha nome, e-mail e senha (mín. 6 caracteres)' });
  try {
    await pool.query('INSERT INTO usuarios(nome,email,senha_hash,role) VALUES($1,$2,$3,$4)',
      [nome.trim(), email.toLowerCase().trim(), await bcrypt.hash(senha, 10), role === 'admin' ? 'admin' : 'tecnico']);
    res.json({ ok: true });
  } catch (e) { if (e.code === '23505') return res.status(400).json({ erro: 'E-mail já cadastrado' }); throw e; }
}));
app.patch('/api/usuarios/:id', auth, soAdmin, wrap(async (req, res) => {
  const { ativo, senha } = req.body;
  if (Number(req.params.id) === req.u.id && ativo === false) return res.status(400).json({ erro: 'Você não pode desativar a si mesmo' });
  if (typeof ativo === 'boolean') await pool.query('UPDATE usuarios SET ativo=$1 WHERE id=$2', [ativo, req.params.id]);
  if (senha) {
    if (senha.length < 6) return res.status(400).json({ erro: 'Senha com no mínimo 6 caracteres' });
    await pool.query('UPDATE usuarios SET senha_hash=$1 WHERE id=$2', [await bcrypt.hash(senha, 10), req.params.id]);
  }
  res.json({ ok: true });
}));

// ---------- Inicialização (preguiçosa: roda na primeira chamada à API) ----------
let pronto = null;
const preparar = () => pronto ||= (async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios(
      id SERIAL PRIMARY KEY, nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'tecnico' CHECK (role IN ('admin','tecnico')), ativo BOOLEAN NOT NULL DEFAULT true);
    CREATE TABLE IF NOT EXISTS registros(
      id SERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES usuarios(id),
      atividade TEXT NOT NULL, local TEXT NOT NULL, data_hora TIMESTAMPTZ NOT NULL DEFAULT now(), link TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS idx_reg_user_data ON registros(user_id, data_hora DESC);
    CREATE TABLE IF NOT EXISTS curtidas (
      registro_id INT NOT NULL REFERENCES registros(id) ON DELETE CASCADE,
      user_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(registro_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS comentarios (
      id SERIAL PRIMARY KEY,
      registro_id INT NOT NULL REFERENCES registros(id) ON DELETE CASCADE,
      user_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      texto TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_comentarios_registro ON comentarios(registro_id,criado_em);`);
  const { rows } = await pool.query("SELECT 1 FROM usuarios WHERE role='admin' LIMIT 1");
  if (!rows.length) {
    await pool.query("INSERT INTO usuarios(nome,email,senha_hash,role) VALUES('Administrador',$1,$2,'admin')",
      [process.env.ADMIN_EMAIL.toLowerCase(), await bcrypt.hash(process.env.ADMIN_SENHA, 10)]);
    console.log('Conta admin criada:', process.env.ADMIN_EMAIL);
  }
})().catch(e => { pronto = null; throw e; });

module.exports = app;
if (require.main === module) app.listen(process.env.PORT || 3000, () => console.log('Rodando em http://localhost:' + (process.env.PORT || 3000)));

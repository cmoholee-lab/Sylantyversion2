// ════════════════════════════════════════════════════════════════════
// Sylanty — Serveur back-end (Express + node:sqlite)
// API REST complète : auth, conformité, salariés, chantiers,
// sous-traitance, risques, DOE/passeports, partages, notifications.
// ════════════════════════════════════════════════════════════════════
import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { db, initSchema, seedDemo, hashPassword, verifyPassword } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SYLANTY_SECRET || 'sylanty-dev-secret-change-me';

initSchema();
seedDemo();

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// uploads
const upload = multer({ dest: path.join(__dirname, 'public', 'uploads') });

// ── Auth helpers (token HMAC stateless) ─────────────────────────────
function makeToken(userId) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, t: Date.now() })).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (sig !== expected) return null;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()); }
  catch { return null; }
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const data = readToken(token);
  if (!data) return res.status(401).json({ error: 'Non authentifié' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(data.uid);
  if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' });
  req.user = user;
  req.companyId = user.company_id;
  next();
}

const NAF_LABELS = {
  '43.21A': "Travaux d'installation électrique dans tous locaux",
  '43.99C': 'Maçonnerie / gros œuvre',
  '43.22A': 'Plomberie / chauffage',
  '41.20A': 'Entreprise générale bâtiment',
};

// ── Génère un PDF d'exemple en mémoire (pour les docs de démo sans fichier) ──
function sampleDocPdf(res, { title, subtitle, lines = [], watermark = "DOCUMENT D'EXEMPLE" }) {
  const doc = new PDFDocument({ size: 'A4', margin: 56 });
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);
  // bandeau
  doc.rect(0, 0, doc.page.width, 90).fill('#1f6feb');
  doc.fillColor('#fff').fontSize(22).font('Helvetica-Bold').text('Sylanty', 56, 30);
  doc.fontSize(10).font('Helvetica').text('Conformité BTP & DOE numérique', 56, 58);
  doc.fillColor('#0b1f3a').fontSize(18).font('Helvetica-Bold').text(title, 56, 120);
  if (subtitle) doc.moveDown(0.3).fontSize(11).font('Helvetica').fillColor('#5b6b85').text(subtitle);
  doc.moveDown(1.2);
  doc.fillColor('#0b1f3a').fontSize(11).font('Helvetica');
  for (const l of lines) { doc.text(l); doc.moveDown(0.4); }
  // filigrane
  doc.save().rotate(-30, { origin: [300, 480] }).fontSize(46).fillColor('#e2e8f5')
     .text(watermark, 80, 460, { width: 460, align: 'center' }).restore();
  doc.fontSize(8.5).fillColor('#8a98ad')
     .text('Document généré automatiquement par Sylanty à des fins de démonstration. '
         + 'Il ne possède aucune valeur légale.', 56, doc.page.height - 90, { width: doc.page.width - 112 });
  doc.end();
}

// ── Appel à l'API publique Recherche d'entreprises (gouv, sans clé) ──
async function lookupSiret(siretRaw) {
  const siret = (siretRaw || '').replace(/\D/g, '');
  if (siret.length < 9) return null;
  try {
    const url = 'https://recherche-entreprises.api.gouv.fr/search?q=' + encodeURIComponent(siret) + '&page=1&per_page=1';
    const r = await fetch(url, { headers: { 'accept': 'application/json' } });
    if (!r.ok) return null;
    const data = await r.json();
    const ent = data?.results?.[0];
    if (!ent) return null;
    const siege = ent.siege || {};
    const naf = (siege.activite_principale || ent.activite_principale || '').toUpperCase();
    return {
      name: ent.nom_raison_sociale || ent.nom_complet || '',
      siret: siege.siret || siret,
      naf,
      nafLabel: NAF_LABELS[naf] || ent.libelle_activite_principale || siege.libelle_activite_principale || '',
      director: (ent.dirigeants && ent.dirigeants[0])
        ? [ent.dirigeants[0].prenoms, ent.dirigeants[0].nom].filter(Boolean).join(' ') : '',
      address: siege.adresse || '',
      employees: ent.tranche_effectif_salarie || '',
    };
  } catch { return null; }
}

// ════════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════════

// Recherche SIRET → infos entreprise (API publique gouv, sans clé)
app.get('/api/siret/:siret', async (req, res) => {
  const info = await lookupSiret(req.params.siret);
  if (!info) return res.status(404).json({ error: 'Entreprise introuvable ou service indisponible' });
  res.json(info);
});

app.post('/api/auth/signup', async (req, res) => {
  const { email, password, name, companyName, siret, naf } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (existing) return res.status(409).json({ error: 'Cet email a déjà un compte' });

  // enrichissement via SIRET si possible
  let info = null;
  if (siret) info = await lookupSiret(siret);
  const companyId = randomUUID();
  const nafCode = (info && info.naf) || naf || '43.21A';
  db.prepare(`INSERT INTO companies (id,name,siret,naf,naf_label,director,address,employees,revenue)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    companyId, (info && info.name) || companyName || 'Mon entreprise', (info && info.siret) || siret || '',
    nafCode, (info && info.nafLabel) || NAF_LABELS[nafCode] || '',
    (info && info.director) || name || '', (info && info.address) || '', 0, '');

  const userId = randomUUID();
  const initials = (name || email).split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  db.prepare(`INSERT INTO users (id,company_id,email,password,name,initials,role,role_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    userId, companyId, email, hashPassword(password), name || email, initials,
    'Admin entreprise', 'admin_co', new Date().toISOString());

  db.prepare(`INSERT INTO notifications (id,company_id,type,text,time) VALUES (?,?,?,?,?)`)
    .run(randomUUID(), companyId, 'ok', 'Bienvenue sur Sylanty ! Complétez votre référentiel documentaire.', "À l'instant");

  res.json({ token: makeToken(userId) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || !verifyPassword(password, user.password))
    return res.status(401).json({ error: 'Identifiants incorrects' });
  res.json({ token: makeToken(user.id) });
});

app.get('/api/auth/me', auth, (req, res) => {
  const c = db.prepare('SELECT * FROM companies WHERE id=?').get(req.companyId);
  res.json({ user: publicUser(req.user), company: c });
});

function publicUser(u) {
  return {
    id: u.id, name: u.name, initials: u.initials, role: u.role, email: u.email,
    notifsEnabled: {
      email_critical: !!u.notif_email_critical, email_expiration: !!u.notif_email_expiration,
      email_chantier: !!u.notif_email_chantier, email_validation: !!u.notif_email_validation,
    },
  };
}

// ════════════════════════════════════════════════════════════════════
// BOOTSTRAP — toutes les données de l'entreprise en un appel
// ════════════════════════════════════════════════════════════════════
app.get('/api/bootstrap', auth, (req, res) => {
  const cid = req.companyId;
  const company = db.prepare('SELECT * FROM companies WHERE id=?').get(cid);

  // documents groupés par catégorie
  const docRows = db.prepare('SELECT * FROM documents WHERE company_id=?').all(cid);
  const catMap = new Map();
  for (const d of docRows) {
    if (!catMap.has(d.cat_id))
      catMap.set(d.cat_id, { id: d.cat_id, icon: d.cat_icon, color: d.cat_color, name: d.cat_name, docs: [] });
    catMap.get(d.cat_id).docs.push({
      id: d.id, key: d.doc_key, name: d.name, sub: d.sub, crit: d.crit, status: d.status,
      expiry: d.expiry, lastUpdate: d.last_update, weight: d.weight, missing: d.missing,
      daysLeft: d.expiry ? Math.floor((new Date(d.expiry) - new Date()) / 86400000) : null,
      hasFile: !!d.file_path,
    });
  }

  const employees = db.prepare('SELECT * FROM employees WHERE company_id=?').all(cid).map(e => ({
    id: e.id, name: e.name, role: e.role, conformity: e.conformity, missing: e.missing,
    alerts: e.alerts, contact: { email: e.email, phone: e.phone, birth: e.birth, start: e.start },
    chantiers: (e.chantiers || '').split(',').filter(Boolean),
    docs: db.prepare('SELECT * FROM employee_docs WHERE employee_id=?').all(e.id).map(d => ({
      id: d.id, name: d.name, cat: d.cat, status: d.status, expiry: d.expiry, lastUpdate: d.last_update,
      daysLeft: d.expiry ? Math.floor((new Date(d.expiry) - new Date()) / 86400000) : null,
    })),
  }));

  const chantiers = db.prepare('SELECT * FROM chantiers WHERE company_id=?').all(cid).map(c => ({
    id: c.id, name: c.name, client: c.client, status: c.status, montant: c.montant,
    start: c.start, end: c.end_date, rgDate: c.rg_date, rgAmount: c.rg_amount, progress: c.progress, address: c.address,
  }));

  const subcontractors = db.prepare('SELECT * FROM subcontractors WHERE company_id=?').all(cid).map(s => ({
    id: s.id, name: s.name, siret: s.siret, status: s.status, docs: s.docs, total: s.total, validDate: s.valid_date,
    contact: { email: s.email, phone: s.phone, address: s.address }, chantier: s.chantier, montant: s.montant,
    docList: db.prepare('SELECT * FROM subcontractor_docs WHERE st_id=?').all(s.id).map(d => ({
      id: d.id, name: d.name, status: d.status, date: d.date, alert: d.alert,
    })),
  }));

  const risks = db.prepare('SELECT * FROM risks WHERE company_id=?').all(cid).map(r => ({
    id: r.id, sev: r.sev, cat: r.cat, ref: r.ref, desc: r.descr, detail: r.detail,
    impact: r.impact, deadline: r.deadline, actions: (r.actions || '').split('|').filter(Boolean),
  }));

  const doe = db.prepare('SELECT * FROM doe_chantiers WHERE company_id=?').all(cid).map(c => ({
    id: c.id, chantierId: c.chantier_id, chantierName: c.chantier_name, moa: c.moa,
    reception: c.reception, statut: c.statut,
    produits: db.prepare('SELECT * FROM doe_produits WHERE doe_id=?').all(c.id).map(p => ({
      id: p.id, name: p.name, fabricant: p.fabricant, ref: p.ref, qte: p.qte, zone: p.zone,
      docs: { dpp: p.dpp, epd: p.epd, dop: p.dop, ce: p.ce, notice: p.notice },
    })),
  }));

  const shares = db.prepare('SELECT * FROM shares WHERE company_id=? ORDER BY created_at DESC').all(cid).map(s => ({
    id: s.id, recipient: s.recipient, type: s.recipient_type, chantier: s.chantier, status: s.status,
    token: s.token, createdAt: s.created_at, viewedAt: s.viewed_at,
  }));

  const notifications = db.prepare('SELECT * FROM notifications WHERE company_id=? ORDER BY rowid DESC').all(cid).map(n => ({
    id: n.id, type: n.type, text: n.text, time: n.time, read: !!n.read,
  }));

  res.json({
    user: publicUser(req.user), company,
    docCategories: [...catMap.values()],
    employees, chantiers, subcontractors, risks, doe, shares, notifications,
  });
});

// ════════════════════════════════════════════════════════════════════
// DOCUMENTS entreprise
// ════════════════════════════════════════════════════════════════════
app.post('/api/documents', auth, (req, res) => {
  const { catId, catName, catIcon, catColor, name, sub, crit, status, expiry, weight } = req.body || {};
  const id = randomUUID();
  db.prepare(`INSERT INTO documents (id,company_id,cat_id,cat_name,cat_icon,cat_color,doc_key,name,sub,crit,status,expiry,last_update,weight)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, req.companyId, catId || 'identite', catName || 'Documents', catIcon || '📄', catColor || '#1f6feb',
    randomUUID().slice(0, 8), name, sub || '', crit || 'obligatoire', status || 'ok',
    expiry || null, new Date().toISOString().slice(0, 10), weight || 2);
  res.json({ id });
});
app.patch('/api/documents/:id', auth, (req, res) => {
  const allowed = ['status', 'expiry', 'name', 'sub', 'crit'];
  const doc = db.prepare('SELECT * FROM documents WHERE id=? AND company_id=?').get(req.params.id, req.companyId);
  if (!doc) return res.status(404).json({ error: 'Document introuvable' });
  for (const k of allowed) if (k in req.body)
    db.prepare(`UPDATE documents SET ${k}=? WHERE id=?`).run(req.body[k], doc.id);
  if (req.body.status === 'ok')
    db.prepare('UPDATE documents SET last_update=? WHERE id=?').run(new Date().toISOString().slice(0, 10), doc.id);
  res.json({ ok: true });
});
app.delete('/api/documents/:id', auth, (req, res) => {
  db.prepare('DELETE FROM documents WHERE id=? AND company_id=?').run(req.params.id, req.companyId);
  res.json({ ok: true });
});
app.post('/api/documents/:id/file', auth, upload.single('file'), (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id=? AND company_id=?').get(req.params.id, req.companyId);
  if (!doc) return res.status(404).json({ error: 'Document introuvable' });
  const rel = req.file ? '/uploads/' + path.basename(req.file.path) : null;
  db.prepare('UPDATE documents SET file_path=?, status=?, last_update=? WHERE id=?')
    .run(rel, 'ok', new Date().toISOString().slice(0, 10), doc.id);
  res.json({ ok: true, file: rel });
});

// Visualiser / télécharger le PDF d'un document société.
// Vrai fichier si déposé, sinon PDF d'exemple généré à la volée.
// ?download=1 force le téléchargement ; sinon affichage inline (visualiser).
app.get('/api/documents/:id/view', auth, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id=? AND company_id=?').get(req.params.id, req.companyId);
  if (!doc) return res.status(404).send('Document introuvable');
  const download = req.query.download === '1';
  if (doc.file_path) {
    const abs = path.join(__dirname, 'public', doc.file_path.replace(/^\//, ''));
    if (fs.existsSync(abs)) {
      const fname = (doc.name || 'document').replace(/[^\w.\- ]+/g, '_') + path.extname(abs);
      res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${fname}"`);
      return res.sendFile(abs);
    }
  }
  // pas de fichier réel → PDF d'exemple
  const fname = (doc.name || 'document').replace(/[^\w.\- ]+/g, '_') + '.pdf';
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${fname}"`);
  const company = db.prepare('SELECT * FROM companies WHERE id=?').get(req.companyId);
  sampleDocPdf(res, {
    title: doc.name,
    subtitle: `${doc.cat_name} — ${company.name}`,
    lines: [
      `Entreprise : ${company.name}`,
      `SIRET : ${company.siret || '—'}`,
      `Catégorie : ${doc.cat_name}`,
      `Criticité : ${doc.crit}`,
      `Statut : ${doc.status}`,
      doc.expiry ? `Date d'expiration : ${doc.expiry}` : `Dernière mise à jour : ${doc.last_update || '—'}`,
      '',
      'Ce document est un exemple généré par Sylanty pour la démonstration.',
      'Déposez le vrai fichier pour le remplacer.',
    ],
  });
});

// ════════════════════════════════════════════════════════════════════
// SALARIÉS
// ════════════════════════════════════════════════════════════════════
app.post('/api/employees', auth, (req, res) => {
  const { name, role, email, phone, birth, start } = req.body || {};
  const id = randomUUID();
  db.prepare(`INSERT INTO employees (id,company_id,name,role,conformity,missing,alerts,email,phone,birth,start,chantiers)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, req.companyId, name, role || 'Collaborateur', 100, 0, '', email || '', phone || '', birth || '', start || '', '');
  res.json({ id });
});
app.patch('/api/employees/:id', auth, (req, res) => {
  const e = db.prepare('SELECT * FROM employees WHERE id=? AND company_id=?').get(req.params.id, req.companyId);
  if (!e) return res.status(404).json({ error: 'Salarié introuvable' });
  for (const k of ['name', 'role', 'email', 'phone', 'conformity', 'alerts'])
    if (k in req.body) db.prepare(`UPDATE employees SET ${k}=? WHERE id=?`).run(req.body[k], e.id);
  res.json({ ok: true });
});
app.delete('/api/employees/:id', auth, (req, res) => {
  db.prepare('DELETE FROM employee_docs WHERE employee_id=?').run(req.params.id);
  db.prepare('DELETE FROM employees WHERE id=? AND company_id=?').run(req.params.id, req.companyId);
  res.json({ ok: true });
});

// Helper : vérifie qu'un doc salarié appartient bien à l'entreprise
function getEmpDoc(docId, companyId) {
  return db.prepare(`SELECT ed.*, e.name AS emp_name, e.company_id AS cid
    FROM employee_docs ed JOIN employees e ON e.id = ed.employee_id
    WHERE ed.id=? AND e.company_id=?`).get(docId, companyId);
}
// Déposer un fichier pour un document salarié
app.post('/api/employee-docs/:id/file', auth, upload.single('file'), (req, res) => {
  const d = getEmpDoc(req.params.id, req.companyId);
  if (!d) return res.status(404).json({ error: 'Document introuvable' });
  const rel = req.file ? '/uploads/' + path.basename(req.file.path) : null;
  db.prepare('UPDATE employee_docs SET file_path=?, status=?, last_update=? WHERE id=?')
    .run(rel, 'ok', new Date().toISOString().slice(0, 10), d.id);
  res.json({ ok: true, file: rel });
});
// Visualiser / télécharger le PDF d'un document salarié
app.get('/api/employee-docs/:id/view', auth, (req, res) => {
  const d = getEmpDoc(req.params.id, req.companyId);
  if (!d) return res.status(404).send('Document introuvable');
  const download = req.query.download === '1';
  if (d.file_path) {
    const abs = path.join(__dirname, 'public', d.file_path.replace(/^\//, ''));
    if (fs.existsSync(abs)) {
      const fname = (d.name || 'document').replace(/[^\w.\- ]+/g, '_') + path.extname(abs);
      res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${fname}"`);
      return res.sendFile(abs);
    }
  }
  const fname = `${(d.emp_name || 'salarie')}_${(d.name || 'document')}`.replace(/[^\w.\- ]+/g, '_') + '.pdf';
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${fname}"`);
  sampleDocPdf(res, {
    title: d.name,
    subtitle: `Salarié : ${d.emp_name} — ${d.cat}`,
    lines: [
      `Salarié : ${d.emp_name}`,
      `Catégorie : ${d.cat}`,
      `Statut : ${d.status}`,
      d.expiry ? `Date d'expiration : ${d.expiry}` : `Dernière mise à jour : ${d.last_update || '—'}`,
      '',
      'Ce document est un exemple généré par Sylanty pour la démonstration.',
      'Déposez le vrai fichier pour le remplacer.',
    ],
  });
});

// ════════════════════════════════════════════════════════════════════
// CHANTIERS
// ════════════════════════════════════════════════════════════════════
app.post('/api/chantiers', auth, (req, res) => {
  const { name, client, status, montant, start, end, address } = req.body || {};
  const id = randomUUID();
  db.prepare(`INSERT INTO chantiers (id,company_id,name,client,status,montant,start,end_date,progress,address)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    id, req.companyId, name, client || '', status || 'appel_offres', montant || '', start || '', end || '', 0, address || '');
  res.json({ id });
});
app.patch('/api/chantiers/:id', auth, (req, res) => {
  const c = db.prepare('SELECT * FROM chantiers WHERE id=? AND company_id=?').get(req.params.id, req.companyId);
  if (!c) return res.status(404).json({ error: 'Chantier introuvable' });
  const map = { name: 'name', client: 'client', status: 'status', montant: 'montant', progress: 'progress', end: 'end_date', address: 'address' };
  for (const k in map) if (k in req.body) db.prepare(`UPDATE chantiers SET ${map[k]}=? WHERE id=?`).run(req.body[k], c.id);
  res.json({ ok: true });
});
app.delete('/api/chantiers/:id', auth, (req, res) => {
  db.prepare('DELETE FROM chantiers WHERE id=? AND company_id=?').run(req.params.id, req.companyId);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════
// SOUS-TRAITANTS
// ════════════════════════════════════════════════════════════════════
app.post('/api/subcontractors', auth, (req, res) => {
  const { name, siret, email, phone, address, chantier, montant } = req.body || {};
  const id = randomUUID();
  const standardDocs = ['Kbis (moins de 3 mois)', 'Attestation URSSAF', 'Attestation fiscale',
    'Assurance RC Pro', 'Assurance décennale', 'RIB', 'Contrat de sous-traitance'];
  db.prepare(`INSERT INTO subcontractors (id,company_id,name,siret,status,docs,total,email,phone,address,chantier,montant)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, req.companyId, name, siret || '', 'attente', 0, standardDocs.length, email || '', phone || '', address || '', chantier || '', montant || '');
  const insD = db.prepare(`INSERT INTO subcontractor_docs (id,st_id,name,status) VALUES (?,?,?,?)`);
  for (const d of standardDocs) insD.run(randomUUID(), id, d, 'manquant');
  res.json({ id });
});
app.patch('/api/subcontractor-docs/:id', auth, (req, res) => {
  const d = db.prepare('SELECT * FROM subcontractor_docs WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Document introuvable' });
  if ('status' in req.body) db.prepare('UPDATE subcontractor_docs SET status=?, date=? WHERE id=?')
    .run(req.body.status, new Date().toISOString().slice(0, 10), d.id);
  // recalcul du compteur + statut global
  recomputeST(d.st_id);
  res.json({ ok: true });
});
function recomputeST(stId) {
  const docs = db.prepare('SELECT * FROM subcontractor_docs WHERE st_id=?').all(stId);
  const ok = docs.filter(x => x.status === 'ok').length;
  let status = 'attente';
  if (ok === docs.length) status = 'valide';
  else if (ok >= Math.ceil(docs.length * 0.6)) status = 'a_verifier';
  db.prepare('UPDATE subcontractors SET docs=?, status=?, valid_date=? WHERE id=?')
    .run(ok, status, status === 'valide' ? new Date().toISOString().slice(0, 10) : null, stId);
}
app.delete('/api/subcontractors/:id', auth, (req, res) => {
  db.prepare('DELETE FROM subcontractor_docs WHERE st_id=?').run(req.params.id);
  db.prepare('DELETE FROM subcontractors WHERE id=? AND company_id=?').run(req.params.id, req.companyId);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════
// RISQUES
// ════════════════════════════════════════════════════════════════════
app.post('/api/risks', auth, (req, res) => {
  const { sev, cat, ref, desc, detail, impact, deadline, actions } = req.body || {};
  const id = randomUUID();
  db.prepare(`INSERT INTO risks (id,company_id,sev,cat,ref,descr,detail,impact,deadline,actions) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, req.companyId, sev || 'medium', cat || 'Autre', ref || '', desc || '', detail || '', impact || '', deadline || '', (actions || []).join('|'));
  res.json({ id });
});
app.delete('/api/risks/:id', auth, (req, res) => {
  db.prepare('DELETE FROM risks WHERE id=? AND company_id=?').run(req.params.id, req.companyId);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════
// DOE & PASSEPORTS PRODUITS
// ════════════════════════════════════════════════════════════════════
app.post('/api/doe/:doeId/produits', auth, (req, res) => {
  const doe = db.prepare('SELECT * FROM doe_chantiers WHERE id=? AND company_id=?').get(req.params.doeId, req.companyId);
  if (!doe) return res.status(404).json({ error: 'DOE introuvable' });
  const { name, fabricant, ref, qte, zone, docs } = req.body || {};
  const d = docs || {};
  const id = randomUUID();
  db.prepare(`INSERT INTO doe_produits (id,doe_id,name,fabricant,ref,qte,zone,dpp,epd,dop,ce,notice) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, doe.id, name, fabricant || '', ref || '', qte || '', zone || '',
      d.dpp || 'ok', d.epd || 'manquant', d.dop || 'manquant', d.ce || 'ok', d.notice || 'manquant');
  res.json({ id });
});
app.patch('/api/doe-produits/:id', auth, (req, res) => {
  const p = db.prepare('SELECT * FROM doe_produits WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Produit introuvable' });
  for (const k of ['dpp', 'epd', 'dop', 'ce', 'notice'])
    if (k in req.body) db.prepare(`UPDATE doe_produits SET ${k}=? WHERE id=?`).run(req.body[k], p.id);
  res.json({ ok: true });
});
app.post('/api/doe/:doeId/transmit', auth, (req, res) => {
  const doe = db.prepare('SELECT * FROM doe_chantiers WHERE id=? AND company_id=?').get(req.params.doeId, req.companyId);
  if (!doe) return res.status(404).json({ error: 'DOE introuvable' });
  db.prepare('UPDATE doe_chantiers SET statut=? WHERE id=?').run('transmis', doe.id);
  const shareId = randomUUID();
  db.prepare(`INSERT INTO shares (id,company_id,recipient,recipient_type,chantier,status,token,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(shareId, req.companyId, `MOA — ${doe.moa}`, 'Client', doe.chantier_name, 'envoye', randomUUID().slice(0, 8), new Date().toISOString());
  db.prepare(`INSERT INTO notifications (id,company_id,type,text,time) VALUES (?,?,?,?,?)`)
    .run(randomUUID(), req.companyId, 'ok', `DOE de "${doe.chantier_name}" transmis à ${doe.moa}`, "À l'instant");
  res.json({ ok: true, token: db.prepare('SELECT token FROM shares WHERE id=?').get(shareId).token });
});

// ════════════════════════════════════════════════════════════════════
// PARTAGES
// ════════════════════════════════════════════════════════════════════
app.post('/api/shares', auth, (req, res) => {
  const { recipient, type, chantier } = req.body || {};
  const id = randomUUID();
  const token = randomUUID().slice(0, 8);
  db.prepare(`INSERT INTO shares (id,company_id,recipient,recipient_type,chantier,status,token,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, req.companyId, recipient, type || 'Client', chantier || '', 'envoye', token, new Date().toISOString());
  res.json({ id, token, url: `/share/${token}` });
});
app.delete('/api/shares/:id', auth, (req, res) => {
  db.prepare('DELETE FROM shares WHERE id=? AND company_id=?').run(req.params.id, req.companyId);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════
// INVITATIONS UTILISATEURS
// ════════════════════════════════════════════════════════════════════
app.post('/api/invites', auth, (req, res) => {
  const { email, roleId } = req.body || {};
  const id = randomUUID();
  db.prepare(`INSERT INTO invited_users (id,company_id,email,role_id,status,created_at) VALUES (?,?,?,?,?,?)`)
    .run(id, req.companyId, email, roleId || 'collab', 'invité', new Date().toISOString());
  db.prepare(`INSERT INTO notifications (id,company_id,type,text,time) VALUES (?,?,?,?,?)`)
    .run(randomUUID(), req.companyId, 'obl', `Invitation envoyée à ${email}`, "À l'instant");
  res.json({ id });
});

// ════════════════════════════════════════════════════════════════════
// PROFIL & RÉGLAGES
// ════════════════════════════════════════════════════════════════════
app.patch('/api/profile', auth, (req, res) => {
  const { name, companyName, siret, address } = req.body || {};
  if (name) {
    const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    db.prepare('UPDATE users SET name=?, initials=? WHERE id=?').run(name, initials, req.user.id);
  }
  const c = {};
  if (companyName !== undefined) c.name = companyName;
  if (siret !== undefined) c.siret = siret;
  if (address !== undefined) c.address = address;
  for (const k in c) db.prepare(`UPDATE companies SET ${k}=? WHERE id=?`).run(c[k], req.companyId);
  res.json({ ok: true });
});
app.patch('/api/settings/notifs', auth, (req, res) => {
  const map = {
    email_critical: 'notif_email_critical', email_expiration: 'notif_email_expiration',
    email_chantier: 'notif_email_chantier', email_validation: 'notif_email_validation',
  };
  for (const k in map) if (k in req.body)
    db.prepare(`UPDATE users SET ${map[k]}=? WHERE id=?`).run(req.body[k] ? 1 : 0, req.user.id);
  res.json({ ok: true });
});
app.post('/api/notifications/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE company_id=?').run(req.companyId);
  res.json({ ok: true });
});

// fallback → SPA
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n🟢 Sylanty démarré → http://localhost:${PORT}`);
  console.log(`   Compte démo : demo@sylanty.fr / demo1234\n`);
});

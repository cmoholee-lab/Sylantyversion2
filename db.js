// ════════════════════════════════════════════════════════════════════
// Sylanty — Base de données (SQLite via node:sqlite, sans dépendance)
// Schéma + seed des données de démonstration (entreprise "Élec Pro Lyon")
// ════════════════════════════════════════════════════════════════════
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, scryptSync, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const db = new DatabaseSync(path.join(__dirname, 'sylanty.db'));

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// ── Hash mot de passe (scrypt, intégré à Node) ──────────────────────
export function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
export function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = scryptSync(pw, salt, 64).toString('hex');
  return test === hash;
}

// ════════════════════════════════════════════════════════════════════
// SCHÉMA
// ════════════════════════════════════════════════════════════════════
export function initSchema() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY, name TEXT, siret TEXT, naf TEXT, naf_label TEXT,
    director TEXT, address TEXT, employees INTEGER, revenue TEXT
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, company_id TEXT, email TEXT UNIQUE, password TEXT,
    name TEXT, initials TEXT, role TEXT, role_id TEXT,
    notif_email_critical INTEGER DEFAULT 1, notif_email_expiration INTEGER DEFAULT 1,
    notif_email_chantier INTEGER DEFAULT 0, notif_email_validation INTEGER DEFAULT 1,
    created_at TEXT, FOREIGN KEY(company_id) REFERENCES companies(id)
  );
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY, company_id TEXT, cat_id TEXT, cat_name TEXT, cat_icon TEXT, cat_color TEXT,
    doc_key TEXT, name TEXT, sub TEXT, crit TEXT, status TEXT, expiry TEXT,
    last_update TEXT, weight INTEGER, missing INTEGER, file_path TEXT,
    FOREIGN KEY(company_id) REFERENCES companies(id)
  );
  CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY, company_id TEXT, name TEXT, role TEXT, conformity INTEGER,
    missing INTEGER, alerts TEXT, email TEXT, phone TEXT, birth TEXT, start TEXT, chantiers TEXT,
    FOREIGN KEY(company_id) REFERENCES companies(id)
  );
  CREATE TABLE IF NOT EXISTS employee_docs (
    id TEXT PRIMARY KEY, employee_id TEXT, name TEXT, cat TEXT, status TEXT,
    expiry TEXT, last_update TEXT, file_path TEXT,
    FOREIGN KEY(employee_id) REFERENCES employees(id)
  );
  CREATE TABLE IF NOT EXISTS chantiers (
    id TEXT PRIMARY KEY, company_id TEXT, name TEXT, client TEXT, status TEXT,
    montant TEXT, start TEXT, end_date TEXT, rg_date TEXT, rg_amount TEXT, progress INTEGER, address TEXT,
    FOREIGN KEY(company_id) REFERENCES companies(id)
  );
  CREATE TABLE IF NOT EXISTS subcontractors (
    id TEXT PRIMARY KEY, company_id TEXT, name TEXT, siret TEXT, status TEXT,
    docs INTEGER, total INTEGER, valid_date TEXT, email TEXT, phone TEXT, address TEXT,
    chantier TEXT, montant TEXT,
    FOREIGN KEY(company_id) REFERENCES companies(id)
  );
  CREATE TABLE IF NOT EXISTS subcontractor_docs (
    id TEXT PRIMARY KEY, st_id TEXT, name TEXT, status TEXT, date TEXT, alert TEXT, file_path TEXT,
    FOREIGN KEY(st_id) REFERENCES subcontractors(id)
  );
  CREATE TABLE IF NOT EXISTS risks (
    id TEXT PRIMARY KEY, company_id TEXT, sev TEXT, cat TEXT, ref TEXT, descr TEXT,
    detail TEXT, impact TEXT, deadline TEXT, actions TEXT,
    FOREIGN KEY(company_id) REFERENCES companies(id)
  );
  CREATE TABLE IF NOT EXISTS doe_chantiers (
    id TEXT PRIMARY KEY, company_id TEXT, chantier_id TEXT, chantier_name TEXT,
    moa TEXT, reception TEXT, statut TEXT,
    FOREIGN KEY(company_id) REFERENCES companies(id)
  );
  CREATE TABLE IF NOT EXISTS doe_produits (
    id TEXT PRIMARY KEY, doe_id TEXT, name TEXT, fabricant TEXT, ref TEXT, qte TEXT, zone TEXT,
    dpp TEXT, epd TEXT, dop TEXT, ce TEXT, notice TEXT,
    FOREIGN KEY(doe_id) REFERENCES doe_chantiers(id)
  );
  CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY, company_id TEXT, recipient TEXT, recipient_type TEXT,
    chantier TEXT, status TEXT, token TEXT, created_at TEXT, viewed_at TEXT,
    FOREIGN KEY(company_id) REFERENCES companies(id)
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, company_id TEXT, type TEXT, text TEXT, time TEXT, read INTEGER DEFAULT 0,
    FOREIGN KEY(company_id) REFERENCES companies(id)
  );
  CREATE TABLE IF NOT EXISTS invited_users (
    id TEXT PRIMARY KEY, company_id TEXT, email TEXT, role_id TEXT, status TEXT, created_at TEXT,
    FOREIGN KEY(company_id) REFERENCES companies(id)
  );
  `);
}

// ════════════════════════════════════════════════════════════════════
// SEED — données de démo (reprend exactement le mock de l'app)
// ════════════════════════════════════════════════════════════════════
const DEMO_COMPANY_ID = 'demo-co';

export function seedDemo() {
  const exists = db.prepare('SELECT id FROM companies WHERE id=?').get(DEMO_COMPANY_ID);
  if (exists) return; // déjà seedé

  db.prepare(`INSERT INTO companies (id,name,siret,naf,naf_label,director,address,employees,revenue)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    DEMO_COMPANY_ID, 'Élec Pro Lyon SAS', '894 562 731 00012', '43.21A',
    "Travaux d'installation électrique dans tous locaux", 'Marc Dupont',
    "12 rue de l'Industrie, 69100 Villeurbanne", 14, '2.4M€');

  db.prepare(`INSERT INTO users (id,company_id,email,password,name,initials,role,role_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    'demo-user', DEMO_COMPANY_ID, 'demo@sylanty.fr', hashPassword('demo1234'),
    'Marc Dupont', 'MD', 'Admin entreprise', 'admin_co', new Date().toISOString());

  // ── Documents entreprise ──
  const cats = [
    { id:'identite', icon:'🏛️', color:'#7b74d9', name:"Identité de l'entreprise", docs:[
      { k:'kbis', name:'Extrait Kbis', sub:'Moins de 3 mois', crit:'critique', status:'expire', expiry:'2026-08-12', weight:3 },
      { k:'statuts', name:'Statuts de la société', sub:'À jour si modification', crit:'obligatoire', status:'ok', lastUpdate:'2024-03-15', weight:2 },
      { k:'insee', name:'Attestation INSEE (SIRET / APE)', sub:'', crit:'obligatoire', status:'ok', lastUpdate:'2025-01-08', weight:2 },
      { k:'cni_dir', name:"Pièce d'identité du dirigeant", sub:'', crit:'obligatoire', status:'ok', expiry:'2028-11-04', weight:2 },
    ]},
    { id:'social', icon:'👥', color:'#e09a42', name:'Obligations sociales (URSSAF & salariés)', docs:[
      { k:'urssaf', name:'Attestation de vigilance URSSAF', sub:'À renouveler tous les 6 mois', crit:'critique', status:'expire', expiry:'2026-06-15', weight:3 },
      { k:'dsn', name:'Déclarations sociales (DSN)', sub:'Mensuel', crit:'critique', status:'ok', expiry:'2026-06-05', weight:3 },
      { k:'rup', name:'Registre unique du personnel', sub:'Continu', crit:'critique', status:'ok', lastUpdate:'2026-05-10', weight:3 },
      { k:'contrats', name:'Contrats de travail', sub:'14 salariés', crit:'critique', status:'partial', missing:2, weight:3 },
      { k:'paie', name:'Bulletins de paie', sub:'Mensuel', crit:'critique', status:'ok', lastUpdate:'2026-05-31', weight:3 },
      { k:'dpae', name:'DPAE (Déclaration préalable embauche)', sub:'', crit:'critique', status:'ok', lastUpdate:'2026-04-12', weight:3 },
    ]},
    { id:'fiscal', icon:'💶', color:'#4dbe98', name:'Obligations fiscales', docs:[
      { k:'fiscal_att', name:'Attestation de régularité fiscale', sub:'Annuel', crit:'obligatoire', status:'ok', expiry:'2026-12-31', weight:2 },
      { k:'tva', name:'Déclarations TVA / IS', sub:'Mensuel/trimestriel', crit:'critique', status:'ok', lastUpdate:'2026-05-15', weight:3 },
      { k:'comptes', name:'Comptes annuels (bilan, résultat)', sub:'Exercice N-1', crit:'obligatoire', status:'ok', lastUpdate:'2025-09-30', weight:2 },
    ]},
    { id:'assur', icon:'🛡️', color:'#1f6feb', name:'Assurances obligatoires', docs:[
      { k:'rc_pro', name:'Assurance Responsabilité Civile Pro', sub:'', crit:'critique', status:'ok', expiry:'2027-01-31', weight:3 },
      { k:'decennale', name:'Assurance décennale', sub:'Critique BTP', crit:'critique', status:'expire', expiry:'2026-07-15', weight:3 },
      { k:'att_jour', name:'Attestations à jour (clients)', sub:'À fournir aux clients', crit:'obligatoire', status:'ok', weight:2 },
    ]},
    { id:'secu', icon:'🦺', color:'#d63b3b', name:'Sécurité & conformité chantier', docs:[
      { k:'duerp', name:'Document Unique (DUERP)', sub:'Annuel / màj', crit:'critique', status:'manquant', weight:3 },
      { k:'ppsps', name:'PPSPS', sub:'Si chantier concerné', crit:'obligatoire', status:'ok', lastUpdate:'2026-03-22', weight:2 },
      { k:'plan_prev', name:'Plan de prévention', sub:'Si 400h+ ou travaux dangereux', crit:'obligatoire', status:'ok', weight:2 },
      { k:'reg_secu', name:'Registre sécurité', sub:'Continu', crit:'obligatoire', status:'ok', weight:2 },
    ]},
    { id:'qual', icon:'🏅', color:'#0fb5a0', name:'Qualifications professionnelles', docs:[
      { k:'qualifelec', name:'Qualifelec', sub:'Spécifique électricien', crit:'recommande', status:'ok', expiry:'2027-04-12', weight:1 },
      { k:'rge', name:'Certificat RGE', sub:'Reconnu Garant Environnement', crit:'recommande', status:'manquant', weight:1 },
    ]},
  ];
  const insDoc = db.prepare(`INSERT INTO documents
    (id,company_id,cat_id,cat_name,cat_icon,cat_color,doc_key,name,sub,crit,status,expiry,last_update,weight,missing)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const c of cats) for (const d of c.docs)
    insDoc.run(randomUUID(), DEMO_COMPANY_ID, c.id, c.name, c.icon, c.color, d.k, d.name,
      d.sub||'', d.crit, d.status, d.expiry||null, d.lastUpdate||null, d.weight, d.missing||null);

  // ── Salariés ──
  const employees = [
    { id:'emp1', name:'Pierre Lefèvre', role:"Chef d'équipe", conformity:92, missing:1, alerts:'CACES expire dans 22j',
      email:'p.lefevre@elecpro-lyon.fr', phone:'+33 6 12 34 56 78', birth:'1978-04-12', start:'2019-03-01', chantiers:'ch1,ch3', docs:[
      { name:'Contrat de travail signé', cat:'Identité', status:'ok', lastUpdate:'2019-03-01' },
      { name:"Carte d'identité", cat:'Identité', status:'ok', expiry:'2029-08-15' },
      { name:'Carte Vitale', cat:'Identité', status:'ok', lastUpdate:'2024-01-12' },
      { name:'Carte BTP', cat:'BTP', status:'ok', expiry:'2028-04-10' },
      { name:'Visite médicale', cat:'BTP', status:'ok', expiry:'2026-11-22' },
      { name:'Affiliation CIBTP', cat:'BTP', status:'ok', lastUpdate:'2019-03-15' },
      { name:'CACES R486 (nacelle)', cat:'Formation', status:'expire', expiry:'2026-06-19' },
      { name:'Habilitation B1V/B2V/BR', cat:'Formation', status:'ok', expiry:'2027-02-08' },
      { name:'Travail en hauteur', cat:'Formation', status:'ok', expiry:'2026-12-05' },
      { name:'SST', cat:'Formation', status:'ok', expiry:'2027-09-14' },
      { name:'EPI signés', cat:'Suivi', status:'ok', lastUpdate:'2025-09-10' },
      { name:'Fiche de poste', cat:'Suivi', status:'ok', lastUpdate:'2024-06-15' },
    ]},
    { id:'emp2', name:'Sophie Martin', role:'Électricienne', conformity:78, missing:3,
      alerts:'Visite médicale expirée · Habilitation B1V à renouveler',
      email:'s.martin@elecpro-lyon.fr', phone:'+33 6 23 45 67 89', birth:'1990-09-22', start:'2021-09-06', chantiers:'ch1', docs:[
      { name:'Contrat de travail signé', cat:'Identité', status:'ok', lastUpdate:'2021-09-06' },
      { name:"Carte d'identité", cat:'Identité', status:'ok', expiry:'2030-05-18' },
      { name:'Carte Vitale', cat:'Identité', status:'ok', lastUpdate:'2023-04-02' },
      { name:'Carte BTP', cat:'BTP', status:'ok', expiry:'2027-09-15' },
      { name:'Visite médicale', cat:'BTP', status:'expire', expiry:'2026-04-30' },
      { name:'Affiliation CIBTP', cat:'BTP', status:'ok', lastUpdate:'2021-09-20' },
      { name:'CACES', cat:'Formation', status:'manquant' },
      { name:'Habilitation B1V/BR', cat:'Formation', status:'expire', expiry:'2026-07-12' },
      { name:'Travail en hauteur', cat:'Formation', status:'ok', expiry:'2027-01-22' },
      { name:'SST', cat:'Formation', status:'ok', expiry:'2027-06-30' },
      { name:'EPI signés', cat:'Suivi', status:'ok', lastUpdate:'2025-10-05' },
      { name:'Fiche de poste', cat:'Suivi', status:'manquant' },
    ]},
    { id:'emp3', name:'Karim Benzina', role:'Apprenti électrique', conformity:95, missing:0, alerts:'',
      email:'k.benzina@elecpro-lyon.fr', phone:'+33 6 34 56 78 90', birth:'2002-11-08', start:'2024-09-02', chantiers:'ch3', docs:[
      { name:"Contrat d'apprentissage", cat:'Identité', status:'ok', expiry:'2027-08-31', lastUpdate:'2024-09-02' },
      { name:"Carte d'identité", cat:'Identité', status:'ok', expiry:'2032-03-04' },
      { name:'Carte Vitale', cat:'Identité', status:'ok', lastUpdate:'2024-09-15' },
      { name:'Carte BTP', cat:'BTP', status:'ok', expiry:'2029-09-10' },
      { name:'Visite médicale', cat:'BTP', status:'ok', expiry:'2026-09-15' },
      { name:'Affiliation CIBTP', cat:'BTP', status:'ok', lastUpdate:'2024-09-20' },
      { name:'Habilitation B0', cat:'Formation', status:'ok', expiry:'2027-05-08' },
      { name:'SST', cat:'Formation', status:'ok', expiry:'2027-04-12' },
      { name:'EPI signés', cat:'Suivi', status:'ok', lastUpdate:'2024-09-12' },
    ]},
    { id:'emp4', name:'Julien Roy', role:'Électricien N2', conformity:100, missing:0, alerts:'',
      email:'j.roy@elecpro-lyon.fr', phone:'+33 6 45 67 89 01', birth:'1985-06-30', start:'2015-11-02', chantiers:'ch1,ch2', docs:[
      { name:'Contrat de travail signé', cat:'Identité', status:'ok', lastUpdate:'2015-11-02' },
      { name:"Carte d'identité", cat:'Identité', status:'ok', expiry:'2028-12-12' },
      { name:'Carte BTP', cat:'BTP', status:'ok', expiry:'2028-11-08' },
      { name:'Visite médicale', cat:'BTP', status:'ok', expiry:'2027-02-14' },
      { name:'Habilitation B1V/B2V/BR/BC', cat:'Formation', status:'ok', expiry:'2027-08-22' },
      { name:'Travail en hauteur', cat:'Formation', status:'ok', expiry:'2027-03-10' },
      { name:'SST', cat:'Formation', status:'ok', expiry:'2028-01-25' },
      { name:'EPI signés', cat:'Suivi', status:'ok', lastUpdate:'2026-01-08' },
    ]},
    { id:'emp5', name:'Aïcha Naïm', role:'Technicienne', conformity:88, missing:1, alerts:'Travail en hauteur à renouveler',
      email:'a.naim@elecpro-lyon.fr', phone:'+33 6 56 78 90 12', birth:'1992-02-17', start:'2022-04-04', chantiers:'ch3,ch4', docs:[
      { name:'Contrat de travail signé', cat:'Identité', status:'ok', lastUpdate:'2022-04-04' },
      { name:"Carte d'identité", cat:'Identité', status:'ok', expiry:'2031-07-05' },
      { name:'Carte BTP', cat:'BTP', status:'ok', expiry:'2027-04-11' },
      { name:'Visite médicale', cat:'BTP', status:'ok', expiry:'2026-08-20' },
      { name:'Habilitation B1V', cat:'Formation', status:'ok', expiry:'2027-01-15' },
      { name:'Travail en hauteur', cat:'Formation', status:'expire', expiry:'2026-07-02' },
      { name:'SST', cat:'Formation', status:'ok', expiry:'2027-11-04' },
      { name:'EPI signés', cat:'Suivi', status:'ok', lastUpdate:'2025-06-10' },
    ]},
  ];
  const insEmp = db.prepare(`INSERT INTO employees (id,company_id,name,role,conformity,missing,alerts,email,phone,birth,start,chantiers)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insEmpDoc = db.prepare(`INSERT INTO employee_docs (id,employee_id,name,cat,status,expiry,last_update) VALUES (?,?,?,?,?,?,?)`);
  for (const e of employees) {
    insEmp.run(e.id, DEMO_COMPANY_ID, e.name, e.role, e.conformity, e.missing, e.alerts, e.email, e.phone, e.birth, e.start, e.chantiers);
    for (const d of e.docs) insEmpDoc.run(randomUUID(), e.id, d.name, d.cat, d.status, d.expiry||null, d.lastUpdate||null);
  }

  // ── Chantiers ──
  const chantiers = [
    { id:'ch1', name:'Réhabilitation Hôpital Saint-Joseph', client:'AP-HP Lyon', status:'en_cours', montant:'485 000 €', start:'2026-01-15', end:'2026-09-30', progress:42, address:'9 rue Professeur Grignard, 69007 Lyon' },
    { id:'ch2', name:'Datacenter Velocity', client:'Velocity Cloud', status:'appel_offres', montant:'1 200 000 €', start:'2026-07-01', end:'2027-03-15', progress:0, address:'ZAC du Biez, 69800 Saint-Priest' },
    { id:'ch3', name:'Mise aux normes Lycée Carnot', client:'Région AURA', status:'en_cours', montant:'215 000 €', start:'2026-03-01', end:'2026-07-31', progress:68, address:'1 place Carnot, 69002 Lyon' },
    { id:'ch4', name:'Rénovation Tour Oxygène', client:'Bouygues Immo', status:'termine', montant:'320 000 €', start:'2025-06-01', end:'2026-02-28', rgDate:'2026-08-28', rgAmount:'16 000 €', progress:100, address:'10-12 bd Vivier Merle, 69003 Lyon' },
  ];
  const insCh = db.prepare(`INSERT INTO chantiers (id,company_id,name,client,status,montant,start,end_date,rg_date,rg_amount,progress,address)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const c of chantiers)
    insCh.run(c.id, DEMO_COMPANY_ID, c.name, c.client, c.status, c.montant, c.start, c.end, c.rgDate||null, c.rgAmount||null, c.progress, c.address);

  // ── Sous-traitants ──
  const sts = [
    { id:'st1', name:'Élec Pro Services', siret:'512 345 678 00021', status:'valide', docs:7, total:7, validDate:'2026-05-12',
      email:'contact@elec-pro-services.fr', phone:'+33 4 78 12 34 56', address:'45 av. des Frères Lumière, 69008 Lyon',
      chantier:'Hôpital Saint-Joseph', montant:'85 000 €', docList:[
      { name:'Kbis (moins de 3 mois)', status:'ok', date:'2026-04-22' },
      { name:'Attestation URSSAF', status:'ok', date:'2026-03-18' },
      { name:'Attestation fiscale', status:'ok', date:'2026-04-05' },
      { name:'Assurance RC Pro', status:'ok', date:'2026-12-31' },
      { name:'Assurance décennale', status:'ok', date:'2027-01-15' },
      { name:'RIB', status:'ok', date:'2025-09-01' },
      { name:'Contrat de sous-traitance', status:'ok', date:'2026-05-12' },
    ]},
    { id:'st2', name:'Câblage Express', siret:'623 456 789 00015', status:'a_verifier', docs:5, total:7, validDate:null,
      email:'admin@cablage-express.com', phone:'+33 4 72 45 67 89', address:'12 rue du Commerce, 69100 Villeurbanne',
      chantier:'Lycée Carnot', montant:'42 000 €', docList:[
      { name:'Kbis (moins de 3 mois)', status:'ok', date:'2026-03-15' },
      { name:'Attestation URSSAF', status:'expire', date:'2026-05-30', alert:'Expire dans 2 jours' },
      { name:'Attestation fiscale', status:'ok', date:'2026-04-12' },
      { name:'Assurance RC Pro', status:'ok', date:'2026-11-08' },
      { name:'Assurance décennale', status:'manquant', date:null },
      { name:'RIB', status:'ok', date:'2025-11-20' },
      { name:'Contrat de sous-traitance', status:'manquant', date:null },
    ]},
    { id:'st3', name:'TechniBat', siret:'734 567 890 00008', status:'attente', docs:3, total:7, validDate:null,
      email:'contact@technibat.fr', phone:'+33 4 78 90 12 34', address:'8 chemin de la Plaine, 69500 Bron',
      chantier:'Datacenter Velocity', montant:'28 000 €', docList:[
      { name:'Kbis (moins de 3 mois)', status:'ok', date:'2026-05-02' },
      { name:'Attestation URSSAF', status:'manquant', date:null },
      { name:'Attestation fiscale', status:'manquant', date:null },
      { name:'Assurance RC Pro', status:'ok', date:'2027-03-15' },
      { name:'Assurance décennale', status:'manquant', date:null },
      { name:'RIB', status:'ok', date:'2025-08-12' },
      { name:'Contrat de sous-traitance', status:'manquant', date:null },
    ]},
  ];
  const insST = db.prepare(`INSERT INTO subcontractors (id,company_id,name,siret,status,docs,total,valid_date,email,phone,address,chantier,montant)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insSTDoc = db.prepare(`INSERT INTO subcontractor_docs (id,st_id,name,status,date,alert) VALUES (?,?,?,?,?,?)`);
  for (const s of sts) {
    insST.run(s.id, DEMO_COMPANY_ID, s.name, s.siret, s.status, s.docs, s.total, s.validDate, s.email, s.phone, s.address, s.chantier, s.montant);
    for (const d of s.docList) insSTDoc.run(randomUUID(), s.id, d.name, d.status, d.date||null, d.alert||null);
  }

  // ── Risques ──
  const risks = [
    { id:'r1', sev:'high', cat:'Pénalité retard', ref:'CCAP §7.2', desc:'Pénalité de 1/3000 du marché par jour de retard',
      detail:'Plafonnée à 5% du montant HT. Le délai contractuel est de 198 jours calendaires. À 1/3000 par jour ouvré, le calcul donne 161,67 € par jour de retard sur un marché de 485 000 €.',
      impact:'Jusqu\'à 24 250 € de pénalités cumulées', deadline:'Réception au 30/09/2026', actions:'Créer rappel J-30|Alerter chef de chantier' },
    { id:'r2', sev:'high', cat:'Documents', ref:'CCAP §4.5', desc:'Remise du DOE sous 30 jours après réception',
      detail:'Tout retard entraîne une retenue de 2 000 € par semaine de retard. Le DOE doit comporter : plans d\'exécution, notices techniques, attestations de conformité, et procès-verbaux d\'essais.',
      impact:'Retenue de 2 000 €/semaine', deadline:'30 jours après PV de réception', actions:'Bloquer clôture sans DOE' },
    { id:'r3', sev:'medium', cat:'Réunions', ref:'CCAP §9.1', desc:'Amende de 500 € par absence aux réunions de chantier',
      detail:'Présence obligatoire du chef de chantier + responsable QSE. Réunion hebdo le mercredi 14h. Convocation envoyée 48h avant. Procès-verbal signé en fin de réunion.',
      impact:'500 € par absence', deadline:'Tous les mercredis 14h', actions:'Planifier dans calendrier' },
    { id:'r4', sev:'medium', cat:'Sécurité', ref:'CCTP §12.3', desc:'Présence permanente d\'un SST sur site',
      detail:'Au moins un Sauveteur Secouriste du Travail doit être présent toute la durée des travaux. Vérification possible à tout moment par le CSPS. Sanction : arrêt de chantier immédiat.',
      impact:'Arrêt de chantier possible', deadline:'Tous les jours travaillés', actions:'Vérifier formations équipe' },
    { id:'r5', sev:'low', cat:'Environnement', ref:'CCTP §15', desc:'Tri obligatoire des déchets sur 5 flux',
      detail:'BSD à transmettre mensuellement au maître d\'ouvrage. Flux : bois, métaux, plâtre, plastiques, mélange. Charte chantier propre à signer en début de chantier.',
      impact:'Pénalités libératoires possibles', deadline:'BSD mensuel', actions:'Activer suivi BSD' },
  ];
  const insRisk = db.prepare(`INSERT INTO risks (id,company_id,sev,cat,ref,descr,detail,impact,deadline,actions) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  for (const r of risks) insRisk.run(r.id, DEMO_COMPANY_ID, r.sev, r.cat, r.ref, r.desc, r.detail, r.impact, r.deadline, r.actions);

  // ── DOE & passeports produits ──
  const doe = [
    { id:'doe1', chantierId:'ch1', chantierName:'Réhabilitation Hôpital Saint-Joseph', moa:'AP-HP Lyon', reception:'2026-09-30', statut:'en_cours', produits:[
      { name:'Tableau électrique Prisma G', fab:'Schneider Electric', ref:'LVSPGX42', qte:'6 u.', zone:'Niveau 2 — local TGBT', d:{dpp:'ok',epd:'ok',dop:'ok',ce:'ok',notice:'ok'} },
      { name:'Câble U-1000 R2V 5G6', fab:'Nexans', ref:'R2V5G6', qte:'1 200 m', zone:'Distribution générale', d:{dpp:'ok',epd:'manquant',dop:'ok',ce:'ok',notice:'ok'} },
      { name:'Luminaire LED étanche', fab:'Trilux', ref:'OLEVEON-1500', qte:'85 u.', zone:'Circulations & locaux techniques', d:{dpp:'manquant',epd:'manquant',dop:'manquant',ce:'ok',notice:'ok'} },
      { name:'Disjoncteur différentiel iID', fab:'Schneider Electric', ref:'A9R61440', qte:'24 u.', zone:'Tableaux divisionnaires', d:{dpp:'ok',epd:'ok',dop:'ok',ce:'ok',notice:'manquant'} },
    ]},
    { id:'doe2', chantierId:'ch3', chantierName:'Mise aux normes Lycée Carnot', moa:'Région AURA', reception:'2026-07-31', statut:'en_cours', produits:[
      { name:'Chemin de câbles galva', fab:'Cablofil', ref:'CF54-300', qte:'340 m', zone:'Combles & gaines techniques', d:{dpp:'ok',epd:'ok',dop:'ok',ce:'ok',notice:'ok'} },
      { name:'Bloc autonome BAES', fab:'Legrand', ref:'062521', qte:'42 u.', zone:'Évacuation / sécurité', d:{dpp:'ok',epd:'manquant',dop:'ok',ce:'ok',notice:'ok'} },
    ]},
    { id:'doe3', chantierId:'ch4', chantierName:'Rénovation Tour Oxygène', moa:'Bouygues Immo', reception:'2026-02-28', statut:'a_transmettre', produits:[
      { name:'Coffret de comptage Resi9', fab:'Schneider Electric', ref:'R9H13407', qte:'18 u.', zone:'Paliers logements', d:{dpp:'ok',epd:'ok',dop:'ok',ce:'ok',notice:'ok'} },
      { name:'Prise RJ45 cat.6', fab:'Legrand', ref:'076563', qte:'210 u.', zone:'VDI tous niveaux', d:{dpp:'ok',epd:'ok',dop:'ok',ce:'ok',notice:'ok'} },
      { name:'Interrupteur Mosaic', fab:'Legrand', ref:'077010', qte:'310 u.', zone:'Logements', d:{dpp:'ok',epd:'ok',dop:'ok',ce:'ok',notice:'ok'} },
    ]},
  ];
  const insDoe = db.prepare(`INSERT INTO doe_chantiers (id,company_id,chantier_id,chantier_name,moa,reception,statut) VALUES (?,?,?,?,?,?,?)`);
  const insDoeP = db.prepare(`INSERT INTO doe_produits (id,doe_id,name,fabricant,ref,qte,zone,dpp,epd,dop,ce,notice) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const c of doe) {
    insDoe.run(c.id, DEMO_COMPANY_ID, c.chantierId, c.chantierName, c.moa, c.reception, c.statut);
    for (const p of c.produits) insDoeP.run(randomUUID(), c.id, p.name, p.fab, p.ref, p.qte, p.zone, p.d.dpp, p.d.epd, p.d.dop, p.d.ce, p.d.notice);
  }

  // ── Partages ──
  const shares = [
    { recipient:'CSPS — Bureau Veritas', type:'CSPS', chantier:'Hôpital Saint-Joseph', status:'valide' },
    { recipient:'MOE — Atelier Architecture Lyon', type:'MOE', chantier:'Lycée Carnot', status:'vu' },
    { recipient:'Client — AP-HP Lyon', type:'Client', chantier:'Hôpital Saint-Joseph', status:'envoye' },
  ];
  const insShare = db.prepare(`INSERT INTO shares (id,company_id,recipient,recipient_type,chantier,status,token,created_at) VALUES (?,?,?,?,?,?,?,?)`);
  for (const s of shares)
    insShare.run(randomUUID(), DEMO_COMPANY_ID, s.recipient, s.type, s.chantier, s.status, randomUUID().slice(0,8), new Date().toISOString());

  // ── Notifications ──
  const notifs = [
    { type:'crit', text:'Décennale expire dans 48 jours', time:'Il y a 2h' },
    { type:'crit', text:'DUERP manquant — mise à jour requise', time:'Il y a 5h' },
    { type:'warn', text:'CACES de Pierre Lefèvre expire dans 22 jours', time:'Hier' },
    { type:'obl', text:'Câblage Express : 2 documents manquants', time:'Hier' },
    { type:'ok', text:'Validation reçue du CSPS pour Hôpital St-Joseph', time:'Il y a 2 jours' },
  ];
  const insNotif = db.prepare(`INSERT INTO notifications (id,company_id,type,text,time) VALUES (?,?,?,?,?)`);
  for (const n of notifs) insNotif.run(randomUUID(), DEMO_COMPANY_ID, n.type, n.text, n.time);

  console.log('✓ Données de démo insérées (entreprise Élec Pro Lyon, login demo@sylanty.fr / demo1234)');
}

// CLI: node db.js --seed
if (process.argv.includes('--seed')) {
  initSchema();
  seedDemo();
  console.log('✓ Base initialisée');
}

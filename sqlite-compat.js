// ════════════════════════════════════════════════════════════════════
// Couche de compatibilité : expose l'API de `node:sqlite` (DatabaseSync)
// au-dessus de `sql.js` (SQLite compilé en WebAssembly, pur JS).
// Aucune compilation native requise → se déploie partout (Render, etc.).
//
// API fournie (suffisante pour Sylanty) :
//   db.exec(sql)
//   db.prepare(sql).run(...params) → { changes, lastInsertRowid }
//   db.prepare(sql).get(...params) → ligne unique | undefined
//   db.prepare(sql).all(...params) → tableau de lignes
// Sauvegarde automatique sur disque après chaque écriture.
// ════════════════════════════════════════════════════════════════════
import initSqlJs from 'sql.js';
import fs from 'node:fs';

export async function openDatabase(filePath) {
  const SQL = await initSqlJs();
  let database;
  if (fs.existsSync(filePath)) {
    database = new SQL.Database(fs.readFileSync(filePath));
  } else {
    database = new SQL.Database();
  }

  let saveTimer = null;
  function persist() {
    // écriture différée (regroupe les écritures rapprochées)
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try { fs.writeFileSync(filePath, Buffer.from(database.export())); }
      catch (e) { console.error('Erreur de sauvegarde DB:', e.message); }
    }, 50);
  }
  function persistNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try { fs.writeFileSync(filePath, Buffer.from(database.export())); }
    catch (e) { console.error('Erreur de sauvegarde DB:', e.message); }
  }

  const isWrite = (sql) => /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE)/i.test(sql);

  const wrapper = {
    _db: database,
    exec(sql) {
      database.exec(sql);
      if (isWrite(sql)) persist();
    },
    prepare(sql) {
      const write = isWrite(sql);
      return {
        run(...params) {
          const stmt = database.prepare(sql);
          try {
            stmt.bind(normalize(params));
            stmt.step();
          } finally { stmt.free(); }
          if (write) persist();
          // node:sqlite renvoie { changes, lastInsertRowid }
          let lastId = 0, changes = 0;
          try {
            const r = database.exec('SELECT last_insert_rowid() AS id, changes() AS c');
            if (r[0]) { lastId = r[0].values[0][0]; changes = r[0].values[0][1]; }
          } catch {}
          return { changes, lastInsertRowid: lastId };
        },
        get(...params) {
          const stmt = database.prepare(sql);
          let row;
          try {
            stmt.bind(normalize(params));
            if (stmt.step()) row = stmt.getAsObject();
          } finally { stmt.free(); }
          return row;
        },
        all(...params) {
          const stmt = database.prepare(sql);
          const rows = [];
          try {
            stmt.bind(normalize(params));
            while (stmt.step()) rows.push(stmt.getAsObject());
          } finally { stmt.free(); }
          return rows;
        },
      };
    },
    saveNow: persistNow,
  };
  return wrapper;
}

// sql.js n'accepte pas `undefined` comme paramètre lié → convertir en null
function normalize(params) {
  return params.map(p => (p === undefined ? null : p));
}

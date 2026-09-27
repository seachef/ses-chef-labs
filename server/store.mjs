import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
export class Store {
  constructor(path) {this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,json TEXT NOT NULL);CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,status TEXT NOT NULL,created INTEGER NOT NULL);`);}
  save(s){const id=createHash('sha256').update(s.endpoint).digest('hex');if(!this.db.prepare('SELECT id FROM devices WHERE id=?').get(id)&&this.devices().length>=5)throw Error('Device limit reached');this.db.prepare('INSERT OR REPLACE INTO devices VALUES(?,?)').run(id,JSON.stringify(s));return id;}
  devices(){return this.db.prepare('SELECT id,json FROM devices').all().map(r=>({id:r.id,subscription:JSON.parse(r.json)}));}
  remove(id){this.db.prepare('DELETE FROM devices WHERE id=?').run(id);}
  claim(id,now){return this.db.prepare("INSERT OR IGNORE INTO events VALUES(?,'PENDING',?)").run(id,now).changes===1;}
  finish(id,status){this.db.prepare('UPDATE events SET status=? WHERE id=?').run(status,id);}
  close(){this.db.close();}
}

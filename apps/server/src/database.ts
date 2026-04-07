import Database from 'better-sqlite3';
import { SampledMessage, Flag, UserHistory } from './types';
import * as fs from 'fs';
import * as path from 'path';

export class DatabaseService {
  private db: Database.Database;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        username TEXT NOT NULL,
        message_text TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        sampled_reason TEXT NOT NULL,
        metadata_json TEXT
      );

      CREATE TABLE IF NOT EXISTS flags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        violation_type TEXT NOT NULL,
        confidence REAL NOT NULL,
        reasoning TEXT NOT NULL,
        recommended_action TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        reviewed_at INTEGER,
        FOREIGN KEY (message_id) REFERENCES messages(id)
      );

      CREATE TABLE IF NOT EXISTS user_history (
        channel TEXT NOT NULL,
        username TEXT NOT NULL,
        total_flags INTEGER DEFAULT 0,
        total_actions INTEGER DEFAULT 0,
        last_violation_at INTEGER,
        risk_score REAL DEFAULT 0.0,
        PRIMARY KEY (channel, username)
      );

      CREATE INDEX IF NOT EXISTS idx_flags_status ON flags(status);
      CREATE INDEX IF NOT EXISTS idx_flags_created ON flags(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_username ON messages(username);
      CREATE INDEX IF NOT EXISTS idx_user_history_risk ON user_history(risk_score DESC);
    `);
  }

  insertMessage(message: SampledMessage): void {
    const stmt = this.db.prepare(`
      INSERT INTO messages (id, channel, username, message_text, received_at, sampled_reason, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      message.id,
      message.channel,
      message.username,
      message.message_text,
      message.received_at,
      message.sampled_reason,
      message.metadata_json || null
    );
  }

  insertFlag(flag: Flag): number {
    const stmt = this.db.prepare(`
      INSERT INTO flags (message_id, violation_type, confidence, reasoning, recommended_action, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      flag.message_id,
      flag.violation_type,
      flag.confidence,
      flag.reasoning,
      flag.recommended_action,
      flag.status,
      flag.created_at
    );

    return result.lastInsertRowid as number;
  }

  getFlags(status?: string, limit = 50): Array<Flag & SampledMessage> {
    let query = `
      SELECT f.*, m.channel, m.username, m.message_text, m.received_at, m.sampled_reason
      FROM flags f
      JOIN messages m ON f.message_id = m.id
    `;

    const params: any[] = [];

    if (status) {
      query += ' WHERE f.status = ?';
      params.push(status);
    }

    query += ' ORDER BY f.created_at DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as Array<Flag & SampledMessage>;
  }

  updateFlagStatus(id: number, status: string, reviewed_at: number): void {
    const stmt = this.db.prepare(`
      UPDATE flags SET status = ?, reviewed_at = ? WHERE id = ?
    `);
    stmt.run(status, reviewed_at, id);
  }

  dismissAllPendingFlags(reviewed_at: number): number {
    const stmt = this.db.prepare(`
      UPDATE flags SET status = 'dismissed', reviewed_at = ? WHERE status = 'pending'
    `);
    const result = stmt.run(reviewed_at);
    return result.changes;
  }

  getUserHistory(channel: string, username: string): UserHistory | null {
    const stmt = this.db.prepare(`
      SELECT * FROM user_history WHERE channel = ? AND username = ?
    `);
    return stmt.get(channel, username) as UserHistory | null;
  }

  upsertUserHistory(history: UserHistory): void {
    const stmt = this.db.prepare(`
      INSERT INTO user_history (channel, username, total_flags, total_actions, last_violation_at, risk_score)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel, username) DO UPDATE SET
        total_flags = excluded.total_flags,
        total_actions = excluded.total_actions,
        last_violation_at = excluded.last_violation_at,
        risk_score = excluded.risk_score
    `);

    stmt.run(
      history.channel,
      history.username,
      history.total_flags,
      history.total_actions,
      history.last_violation_at || null,
      history.risk_score
    );
  }

  incrementUserFlags(channel: string, username: string, timestamp: number): void {
    const existing = this.getUserHistory(channel, username);

    if (existing) {
      const newTotal = existing.total_flags + 1;
      const newRisk = Math.min(1.0, existing.risk_score + 0.1);

      this.upsertUserHistory({
        channel,
        username,
        total_flags: newTotal,
        total_actions: existing.total_actions,
        last_violation_at: timestamp,
        risk_score: newRisk,
      });
    } else {
      this.upsertUserHistory({
        channel,
        username,
        total_flags: 1,
        total_actions: 0,
        last_violation_at: timestamp,
        risk_score: 0.1,
      });
    }
  }

  incrementUserActions(channel: string, username: string): void {
    const existing = this.getUserHistory(channel, username);

    if (existing) {
      this.upsertUserHistory({
        ...existing,
        total_actions: existing.total_actions + 1,
        risk_score: Math.min(1.0, existing.risk_score + 0.15),
      });
    }
  }

  getFlagWithMessage(flagId: number): (Flag & SampledMessage) | null {
    const stmt = this.db.prepare(`
      SELECT f.*, m.channel, m.username, m.message_text, m.received_at, m.sampled_reason
      FROM flags f
      JOIN messages m ON f.message_id = m.id
      WHERE f.id = ?
    `);
    return stmt.get(flagId) as (Flag & SampledMessage) | null;
  }

  hasRecentFlag(messageHash: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM messages WHERE id = ? LIMIT 1');
    return stmt.get(messageHash) !== undefined;
  }

  close(): void {
    this.db.close();
  }
}

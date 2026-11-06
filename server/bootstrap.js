import { hashPassword } from './auth.js';
export const MIN_PASSWORD_LENGTH = 12;
export async function bootstrapOwner(db, username, password) {
  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) throw new Error('Invalid owner credentials');
  if (Array.from(password).length < MIN_PASSWORD_LENGTH) throw new Error(`Owner password must contain at least ${MIN_PASSWORD_LENGTH} characters`);
  const encoded = await hashPassword(password);
  const { rows } = await db.query('INSERT INTO owners (username, password_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING username', [username, encoded]);
  return rows.length === 1;
}

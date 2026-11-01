import { randomUUID } from 'node:crypto';
import { ConfigurationError } from './config.js';
export async function ensureInstancePolicy(db, config) {
  return db.withTransaction(async client => {
    await client.query('INSERT INTO instance (singleton, instance_id, reporting_timezone, page_characters) VALUES (TRUE, $1, $2, $3) ON CONFLICT (singleton) DO NOTHING', [randomUUID(), config.reportingTimezone, config.pageCharacters]);
    const { rows: [row] } = await client.query('SELECT instance_id, reporting_timezone, page_characters, reset_generation FROM instance WHERE singleton = TRUE');
    if (row.reporting_timezone !== config.reportingTimezone) throw new ConfigurationError('REPORT_TIMEZONE does not match initialized policy');
    if (Number(row.page_characters) !== config.pageCharacters) throw new ConfigurationError('PAGE_CHARACTERS does not match initialized policy');
    return { instanceId: row.instance_id, resetGeneration: Number(row.reset_generation) };
  });
}

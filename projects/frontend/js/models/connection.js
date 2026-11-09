// View model for #/connection: what the server knows about the device, and the yearly goal.
// The server has no telemetry about the Kindle's local queue, so nothing about it is shown.
import { formatInstant } from '../lib/format.js';

// A goal target is a whole number from zero (the API takes safe integers).
export function parseTarget(text) {
  if (typeof text !== 'string' || !/^\s*\d{1,16}\s*$/.test(text)) return null;
  const value = Number(text.trim());
  return Number.isSafeInteger(value) ? value : null;
}

export function buildConnection({ device, goal }) {
  return {
    device: { linked: device.device_id !== null, id: device.device_id, lastSync: device.last_sync_at ? formatInstant(device.last_sync_at) : null, generation: device.reset_generation },
    goal: { year: goal.year, target: goal.target, completed: goal.completed_unique_books },
  };
}

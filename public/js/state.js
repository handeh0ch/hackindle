// Resource states for every view: loading, ready, unauthorized or error. Empty and
// unavailable are decided by each view model from the loaded data.
import { ApiError } from './api.js';

export async function load(work, onChange = () => {}) {
  onChange({ status: 'loading' });
  let result;
  try { result = { status: 'ready', data: await work() }; }
  catch (error) {
    if (error instanceof ApiError) result = error.status === 401 ? { status: 'unauthorized' } : { status: 'error', error: error.code };
    else result = { status: 'error', error: 'unexpected' };
  }
  onChange(result);
  return result;
}

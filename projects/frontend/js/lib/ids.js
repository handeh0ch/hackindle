// Identifier checks for values that come from the address bar or a form. Only a value that passes
// may be placed in an API path.
export const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const isSourceId = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

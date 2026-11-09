// First statement of a read-only request: a consistent snapshot without taking
// the instance row lock that device sync and resets use.
export const READ_SNAPSHOT = 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY';

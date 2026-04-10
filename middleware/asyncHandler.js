/**
 * Wraps an async route handler so that any thrown error or rejected promise
 * is forwarded to Express's next(err) — allowing the global error handler
 * to catch it instead of producing an unhandled promise rejection.
 *
 * Usage:
 *   router.get('/path', asyncHandler(async (req, res) => { ... }));
 */
module.exports = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

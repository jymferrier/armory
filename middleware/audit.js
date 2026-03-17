// Structured security audit log to stdout.
// In Docker, these lines are captured by the container log driver and can be
// forwarded to any SIEM or log aggregator. Each line is a JSON object.
function audit(req, action, detail) {
  const user = req.session && req.session.user ? req.session.user.username : 'anonymous';
  const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    type: 'AUDIT',
    user,
    ip,
    action,
    detail: detail || ''
  }));
}

module.exports = { audit };

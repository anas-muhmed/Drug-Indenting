// Single shared structured logger. Plain JSON output (pino's default) --
// machine-parseable for whatever log aggregation this eventually feeds
// into, rather than optimized for a human staring at a raw terminal.
// LOG_LEVEL defaults to 'info' (skips pino's verbose 'debug'/'trace'),
// except under Jest (JEST_WORKER_ID is set automatically in every worker),
// where it defaults to 'silent' so per-request logs don't drown out test
// output -- LOG_LEVEL still overrides this if explicitly set.

import pino from 'pino';

const defaultLevel = process.env.JEST_WORKER_ID !== undefined ? 'silent' : 'info';

export const logger = pino({
  level: process.env.LOG_LEVEL || defaultLevel,
  // Never write a bearer token or cookie to a log line -- these are live
  // credentials for up to the token's full lifetime, and logs routinely
  // end up somewhere less trusted than the request itself (aggregators,
  // shared terminals, screen shares).
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    censor: '[REDACTED]',
  },
});

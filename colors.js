'use strict';

/*
 * Tiny ANSI color helper. Disabled when stdout is not a TTY or NO_COLOR is set.
 *
 * Usage:
 *   const c = require('./colors');
 *   console.log(c.green('OK') + ' ' + c.dim('details'));
 */

const enabled =
  !process.env.NO_COLOR &&
  process.stdout &&
  typeof process.stdout.isTTY === 'boolean' &&
  process.stdout.isTTY;

const RAW = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function wrap(code) {
  return (s) => (enabled ? `${code}${s}${RAW.reset}` : String(s));
}

const c = {
  enabled,
  raw: RAW,
  bold: wrap(RAW.bold),
  dim: wrap(RAW.dim),
  red: wrap(RAW.red),
  green: wrap(RAW.green),
  yellow: wrap(RAW.yellow),
  blue: wrap(RAW.blue),
  cyan: wrap(RAW.cyan),
  gray: wrap(RAW.gray),
  ok: (m) => `${enabled ? RAW.green : ''}✔${enabled ? RAW.reset : ''} ${m}`,
  bad: (m) => `${enabled ? RAW.red : ''}✘${enabled ? RAW.reset : ''} ${m}`,
  warn: (m) => `${enabled ? RAW.yellow : ''}!${enabled ? RAW.reset : ''} ${m}`,
};

module.exports = c;

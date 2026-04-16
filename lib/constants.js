'use strict';

const NFA_TYPES = new Set([
  'Suppressor/Silencer',
  'Short Barrel Rifle (SBR)',
  'Short Barrel Shotgun (SBS)',
  'Machine Gun',
  'Destructive Device (DD)',
  'Any Other Weapon (AOW)',
]);

// Cap a string field to max characters; non-strings pass through as-is.
const cap = (val, max) => (val && typeof val === 'string') ? val.slice(0, max) : val;

module.exports = { NFA_TYPES, cap };

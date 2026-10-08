'use strict';
// Runs the game's browser scripts in a fresh VM context (standing in for the
// page's window) and returns its window.GOR namespace.
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const JS_DIR = path.join(__dirname, '..', '..', 'public', 'js');

// `globals` itself becomes the page's window, so stubs can reach what the scripts set on it.
function load(files, globals) {
  const ctx = vm.createContext(Object.assign(globals || {}, { console, setTimeout, clearTimeout, setInterval, clearInterval }));
  ctx.window = ctx;
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), ctx, { filename: f });
  return ctx.GOR;
}

// Objects made inside the VM have their own prototypes; compare plain copies.
const plain = (x) => JSON.parse(JSON.stringify(x));

module.exports = { load, plain };

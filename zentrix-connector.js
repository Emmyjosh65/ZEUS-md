/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         ZENTRIX MD — Pterodactyl ↔ Render Connector         ║
 * ║  Source code → /tmp (hidden)  |  node_modules → panel dir  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * HOW TO USE:
 *  1. Upload ONLY this single file to your Pterodactyl egg
 *  2. Set startup command to: node zentrix-connector.js
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { execSync, spawn } from 'child_process';
import https from 'https';
import http from 'http';
import os from 'os';

// ── CONFIG ────────────────────────────────────────────────────────────────────

const RENDER_BASE_URL = process.env.RENDER_URL || 'https://zentrix-md-j85v.onrender.com';

// Source code → /tmp (hidden from Pterodactyl file manager)
const RUN_DIR = path.join(os.tmpdir(), 'zx1-runtime');

// Panel dir → has allocated disk space, used for node_modules + persistent data
const PANEL_DIR    = process.cwd();
const NODE_MOD_DIR = path.join(PANEL_DIR, 'node_modules');
const SESSION_DIR  = path.join(PANEL_DIR, 'sessions');
const AUTH_DIR     = path.join(PANEL_DIR, 'auth_info_baileys');
const ENV_FILE     = path.join(PANEL_DIR, '.env');

const BOT_ENTRY = path.join(RUN_DIR, 'src', 'index.js');

const SKIP_IN_TMP = new Set([
  '.env', 'sessions', 'auth_info', 'auth_info_baileys',
  'logs', 'node_modules', '.git',
]);

// ── LOGGER ────────────────────────────────────────────────────────────────────

function log(level, msg) {
  const icons = { info: '⚡', ok: '✅', warn: '⚠️ ', error: '❌', step: '🔧' };
  console.log(`${icons[level] || '•'} [CONNECTOR] ${msg}`);
}

// ── FETCH ─────────────────────────────────────────────────────────────────────

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    let raw = '';
    const req = mod.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode !== 200)
        return reject(new Error(`HTTP ${res.statusCode}`));
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('Bad JSON from /fetch-core')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function fetchCoreFiles() {
  const url = `${RENDER_BASE_URL}/fetch-core`;
  log('step', `Fetching source from Render: ${url}`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const files = await fetchJson(url);
      log('ok', `Received ${Object.keys(files).length} files`);
      return files;
    } catch (e) {
      log('warn', `Attempt ${attempt}/3: ${e.message}`);
      if (attempt === 1) {
        log('info', 'Render may be cold-starting — waiting 35s...');
        await new Promise((r) => setTimeout(r, 35000));
      } else if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 15000));
      } else {
        throw new Error('Failed to fetch source after 3 attempts');
      }
    }
  }
}

// ── WRITE SOURCE TO /tmp ──────────────────────────────────────────────────────

async function writeToTemp(files) {
  log('step', `Writing source to /tmp: ${RUN_DIR}`);

  if (fs.existsSync(RUN_DIR)) {
    fs.rmSync(RUN_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(RUN_DIR, { recursive: true });

  let written = 0;
  for (const [relativePath, content] of Object.entries(files)) {
    const topLevel = relativePath.split(/[\\/]/)[0];
    if (SKIP_IN_TMP.has(topLevel) || SKIP_IN_TMP.has(relativePath)) continue;
    const dest = path.join(RUN_DIR, relativePath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, content, 'utf8');
    written++;
  }

  log('ok', `${written} source files written to /tmp — 0 visible in panel`);

  // Symlink node_modules from panel dir into /tmp so Node can resolve them
  const tmpModules = path.join(RUN_DIR, 'node_modules');
  if (!fs.existsSync(tmpModules)) {
    fs.symlinkSync(NODE_MOD_DIR, tmpModules);
    log('info', 'Symlinked node_modules: panel → /tmp');
  }

  // Symlink persistent data (sessions, auth, .env) from panel into /tmp
  const links = [
    [SESSION_DIR, path.join(RUN_DIR, 'sessions')],
    [AUTH_DIR,    path.join(RUN_DIR, 'auth_info_baileys')],
    [ENV_FILE,    path.join(RUN_DIR, '.env')],
  ];
  for (const [target, link] of links) {
    if (fs.existsSync(link)) continue;
    if (fs.existsSync(target)) {
      fs.symlinkSync(target, link);
      log('info', `Linked ${path.basename(target)} → /tmp`);
    }
  }
}

// ── INSTALL DEPS INTO PANEL DIR ───────────────────────────────────────────────

function installDeps(packageJson) {
  const pkgPath = path.join(PANEL_DIR, 'package.json');

  const incoming = JSON.stringify(packageJson, null, 2);
  const existing = fs.existsSync(pkgPath)
    ? fs.readFileSync(pkgPath, 'utf8')
    : '';

  if (incoming === existing && fs.existsSync(NODE_MOD_DIR)) {
    log('ok', 'Dependencies already up to date — skipping install');
    return;
  }

  log('step', `Installing node_modules into panel dir: ${PANEL_DIR}`);
  fs.writeFileSync(pkgPath, incoming);

  try {
    execSync('npm install --omit=dev --prefer-offline', {
      cwd: PANEL_DIR,
      stdio: 'inherit',
    });
    log('ok', 'Dependencies installed in panel dir');
  } catch {
    log('warn', 'Retrying with --legacy-peer-deps...');
    execSync('npm install --omit=dev --legacy-peer-deps', {
      cwd: PANEL_DIR,
      stdio: 'inherit',
    });
    log('ok', 'Dependencies installed (legacy mode)');
  }
}

// ── LAUNCH ────────────────────────────────────────────────────────────────────

function launchBot() {
  if (!fs.existsSync(BOT_ENTRY)) {
    throw new Error(`Entry file not found: ${BOT_ENTRY}`);
  }

  log('ok', 'Launching bot...');
  console.log('\n' + '═'.repeat(60));
  console.log('  ᴢᴇɴᴛʀɪx ᴍᴅ — RUNNING  (source hidden from panel)');
  console.log('═'.repeat(60) + '\n');

  const child = spawn('node', [BOT_ENTRY], {
    cwd: RUN_DIR,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  });

  child.on('error', (err) => {
    log('error', `Launch failed: ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    log('warn', `Bot exited (code=${code} signal=${signal}) — restarting in 10s...`);
    setTimeout(launchBot, 10000);
  });

  process.on('SIGTERM', () => child.kill('SIGTERM'));
  process.on('SIGINT',  () => child.kill('SIGINT'));
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  ZENTRIX MD — Pterodactyl Connector');
  console.log(`  Render : ${RENDER_BASE_URL}`);
  console.log(`  Source : ${RUN_DIR}  ← hidden from panel`);
  console.log(`  Modules: ${PANEL_DIR}/node_modules  ← uses panel disk`);
  console.log('═'.repeat(60) + '\n');

  try {
    const files = await fetchCoreFiles();

    const pkgRaw = files['package.json'];
    if (!pkgRaw) throw new Error('package.json not found in /fetch-core response');
    const packageJson = JSON.parse(pkgRaw);

    installDeps(packageJson);
    await writeToTemp(files);
    launchBot();
  } catch (err) {
    log('error', err.message);
    console.error(err);
    process.exit(1);
  }
}

main();

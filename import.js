#!/usr/bin/env node
/*
 * 9router – ChatGPT/Codex Bulk Importer (CLI)
 * -------------------------------------------
 * Import hàng loạt file JSON OAuth của ChatGPT/Codex (mỗi file 1 tài khoản,
 * có id_token / access_token / refresh_token / account_id / email / expired)
 * thẳng vào db.json hoặc data.sqlite của 9router.
 *
 * Khác với Kiro importer: 9router KHÔNG có HTTP API cho codex, nên tool này
 * ghi trực tiếp vào database 9router: %APPDATA%\9router\db\data.sqlite trên
 * Windows, ~/.9router/db/data.sqlite trên macOS/Linux (hoặc db.json cũ).
 * Vì DB được nạp vào memory, 9router phải tắt trước khi ghi — dùng
 * --force-stop để tự động xử lý.
 *
 * Không cần npm install — chỉ dùng module core của Node (≥ 18).
 *
 * USAGE
 *   node import.js                                # quét ./tokens/*.{json,zip} (đệ quy)
 *   node import.js file1.json file2.json          # các file cụ thể
 *   node import.js ./folder                        # quét đệ quy folder (json + zip)
 *   node import.js bundle.zip                     # extract & import mọi *.json bên trong
 *   node import.js --list                         # dry-run, in preview, KHÔNG ghi
 *   node import.js --force-stop                   # dừng + khởi động lại 9router
 *   node import.js --no-restart                   # ghi nhưng không restart
 *   node import.js --no-configure-codex           # KHÔNG tự config Codex CLI
 *   node import.js --db /path/to/db.json           # chỉ định db.json/sqlite khác
 *
 * Mặc định, sau khi import xong tool sẽ:
 *   - đảm bảo 9router có ít nhất 1 API key (tạo mới nếu cần)
 *   - ghi ~/.codex/config.toml (model_provider = "9router")
 *   - ghi ~/.codex/auth.json (auth_mode=apikey, OPENAI_API_KEY=<key>)
 * → Codex CLI dùng được ngay, không bị 401.
 *
 * EXIT CODES
 *   0  OK
 *   1  Không có file đầu vào hợp lệ
 *   3  Hoàn tất nhưng có ≥ 1 file không parse được
 *   4  9router đang chạy và không có --force-stop
 *   99 Lỗi không mong đợi
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_BASE_URL,
  DEFAULT_DB_PATH,
  expandInputs,
  readPathAsUploads,
  parseUploads,
  bulkImport,
  is9routerRunning,
} = require('./importer-core');
const c = require('./colors');

// ---------- CLI args ----------
function parseArgs(argv) {
  const opts = {
    inputs: [],
    dry: false,
    forceStop: false,
    noRestart: false,
    configureCodex: true,
    dbPath: DEFAULT_DB_PATH,
    baseUrl: DEFAULT_BASE_URL,
    help: false,
    error: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list' || a === '--dry' || a === '--dry-run') opts.dry = true;
    else if (a === '--force-stop') opts.forceStop = true;
    else if (a === '--no-restart') opts.noRestart = true;
    else if (a === '--no-configure-codex' || a === '--no-codex-config')
      opts.configureCodex = false;
    else if (a === '--db' || a === '--url') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        opts.error = `Thiếu giá trị cho ${a}`;
      } else {
        if (a === '--db') opts.dbPath = value;
        else opts.baseUrl = value;
        i++;
      }
    }
    else if (a === '-h' || a === '--help') opts.help = true;
    else opts.inputs.push(a);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

if (opts.error) {
  console.error(`Lỗi: ${opts.error}. Dùng --help để xem cách dùng.`);
  process.exit(1);
}

if (opts.help) {
  process.stdout.write(
    fs.readFileSync(__filename, 'utf8').split('*/')[0] + '*/\n'
  );
  process.exit(0);
}

if (opts.inputs.length === 0) {
  const def = path.join(__dirname, 'tokens');
  if (fs.existsSync(def)) opts.inputs.push(def);
}

const log = (...m) => console.log(...m);

function fmtSource(s) {
  if (!s) return '';
  const parts = [];
  if (s.email) parts.push(s.email);
  if (s.expiresAt) parts.push(`expires=${s.expiresAt}`);
  if (s.refreshTail) parts.push(`refresh…${s.refreshTail}`);
  return parts.join(' · ');
}

// ---------- main ----------
(async () => {
  log(c.bold(c.cyan('9router – ChatGPT/Codex Bulk Importer')));
  log(`${c.dim('DB:')} ${opts.dbPath}`);
  log(`${c.dim('9router URL:')} ${opts.baseUrl}`);

  // Pre-list parsed files even outside dryRun so user sees something useful.
  const files = expandInputs(opts.inputs);
  if (files.length === 0) {
    log(c.bad('Không tìm thấy file .json hoặc .zip nào để xử lý.'));
    log(
      `${c.dim('Đặt file vào:')} ${path.join(__dirname, 'tokens')} ` +
        c.dim('hoặc truyền đường dẫn ở dòng lệnh.')
    );
    process.exit(1);
  }

  log(c.dim(`Tìm thấy ${files.length} file:`));

  // Build the upload list using the shared core helper so CLI and GUI
  // behave identically (ZIP expansion, BOM handling, etc).
  const uploads = [];
  const fileLabels = new Map(); // upload.name -> human-friendly label
  let parseFails = 0;
  for (const f of files) {
    let us;
    try {
      us = readPathAsUploads(f);
    } catch (e) {
      log(`  ${c.bad(path.basename(f))} – ${c.red('đọc file lỗi: ' + e.message)}`);
      parseFails++;
      continue;
    }
    if (us.length === 0) {
      log(`  ${c.bad(path.basename(f))} – ${c.red('ZIP không có entry .json')}`);
      parseFails++;
      continue;
    }
    for (const u of us) {
      const label = us.length === 1 ? path.basename(f) : `${path.basename(f)} → ${u.name.split('!').pop()}`;
      fileLabels.set(u.name, label);
      uploads.push(u);
    }
  }

  // Run the shared parse pipeline so CLI and GUI behave identically.
  const rows = await parseUploads(uploads);

  for (const row of rows) {
    const label = fileLabels.get(row.name) || row.name;
    if (row.error) {
      log(`  ${c.bad(label)} – ${c.red(row.error)}`);
      parseFails++;
    } else {
      log(`  ${c.ok(label)} – ${c.dim(fmtSource(row.source))}`);
    }
  }

  if (opts.dry) {
    log('');
    log(c.yellow('[--list] Dry-run, không ghi DB.'));
    const running = await is9routerRunning(opts.baseUrl);
    log(
      `${c.dim('Trạng thái 9router:')} ${running ? c.green('đang chạy') : c.gray('không chạy')}`
    );
    process.exit(parseFails > 0 ? 3 : 0);
  }

  // Real import.
  log('');
  let result;
  try {
    result = await bulkImport({
      inputs: opts.inputs,
      dbPath: opts.dbPath,
      baseUrl: opts.baseUrl,
      forceStop: opts.forceStop,
      noRestart: opts.noRestart,
      configureCodex: opts.configureCodex,
      dryRun: false,
      log: (m) => log(`${c.dim('·')} ${m}`),
    });
  } catch (e) {
    log(c.bad('Lỗi không mong đợi: ' + (e.stack || e.message)));
    process.exit(99);
  }

  if (!result.ok) {
    log(c.bad(result.message || 'Thất bại'));
    if (result.code === 4) {
      log(
        `${c.dim('Mẹo: thêm')} ${c.bold('--force-stop')} ${c.dim('để tool tự dừng & khởi động lại 9router.')}`
      );
    }
    process.exit(result.code || 99);
  }

  log('');
  log(
    c.bold('Hoàn tất:') + ' ' +
      c.green(`+${result.added} thêm mới`) + ', ' +
      c.cyan(`↻${result.refreshed || 0} cập nhật`) + ', ' +
      c.yellow(`${result.skippedOnly || 0} bỏ qua`) +
      (result.backup ? `\n${c.dim('Backup:')} ${result.backup}` : '') +
      (result.wasRunning
        ? `\n${c.dim('9router restart:')} ${result.restarted ? c.green('OK') : c.red('FAIL')}`
        : `\n${c.dim('9router:')} ${c.gray('không chạy lúc import')}`)
  );
  if (result.addedEmails && result.addedEmails.length) {
    log(`${c.dim('Thêm:')} ${result.addedEmails.join(', ')}`);
  }
  if (result.refreshedEmails && result.refreshedEmails.length) {
    log(`${c.dim('Cập nhật:')} ${result.refreshedEmails.join(', ')}`);
  }
  if (result.skippedEmails && result.skippedEmails.length) {
    log(`${c.dim('Bỏ qua:')} ${result.skippedEmails.join(', ')}`);
  }
  if (result.codexCliConfig) {
    const cc = result.codexCliConfig;
    log(
      `${c.dim('Codex CLI:')} ${c.green('đã cấu hình')} ` +
        `(API key sk-…${cc.apiKey.slice(-6)}${cc.createdKey ? ' [mới tạo]' : ''})`
    );
    log(`${c.dim('  ' + cc.configPath)}`);
    log(`${c.dim('  ' + cc.authPath)}`);
  }
  process.exit(result.code || 0);
})().catch((e) => {
  console.error(c.red('✘ Lỗi không mong đợi: ') + (e.stack || e.message));
  process.exit(99);
});

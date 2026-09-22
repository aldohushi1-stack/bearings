import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build, isStale, packageVersion, DEFAULT_BUDGET, DEFAULT_OUT } from './build.mjs';
import { installHook, uninstallHook, hookOutput } from './hook.mjs';
import { watch } from './watch.mjs';

const HELP = `bearings — get your bearings. A small orientation map of any folder, handed to your coding agent at session start.

Usage
  bearings                        build BEARINGS.md for the current folder
  bearings build [DIR] [--budget N] [--out FILE] [--json] [--print] [--quiet] [--force]
  bearings print [DIR]            print the map (rebuilds first if stale)
  bearings check [DIR]            exit 1 if the map is stale (CI gate)
  bearings init [DIR]             build + install the Claude Code hook for this project
  bearings hook install [--global] [--command CMD] [--budget N]
  bearings hook uninstall [--global]
  bearings emit                   hook entry point: stdin JSON in, hook JSON out (never fails)
  bearings watch [DIR] [--budget N]
  bearings --version | --help

Options
  --budget N     token budget for the map (default ${DEFAULT_BUDGET}; 0 = unlimited)
  --out FILE     where to write the map (default ${DEFAULT_OUT})
  --global       install/uninstall the hook in ~/.claude/settings.json instead of ./.claude/settings.json
  --command CMD  hook command to run instead of "npx -y get-bearings" (e.g. "bearings" for a global install)
`;

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { args._.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
      let val = eq > 0 ? a.slice(eq + 1) : true;
      if (val === true && ['budget', 'out', 'command'].includes(key) && i + 1 < argv.length) val = argv[++i];
      args.flags[key] = val;
    } else args._.push(a);
  }
  return args;
}

async function readStdin(opts) {
  if (opts.stdin) return opts.stdin();
  if (process.stdin.isTTY) return '';
  return new Promise((resolve) => {
    let data = '';
    const done = () => resolve(data);
    const timer = setTimeout(done, 2000);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => { clearTimeout(timer); done(); });
    process.stdin.on('error', () => { clearTimeout(timer); done(); });
  });
}

/** Append a line to an existing .gitignore when it is missing. Never creates one. Returns true when it wrote. */
async function ensureGitignore(root, line) {
  const p = path.join(root, '.gitignore');
  let text;
  try { text = await fs.readFile(p, 'utf8'); } catch { return false; }
  if (text.split(/\r?\n/).some((l) => l.trim() === line || l.trim() === line.replace(/\/$/, ''))) return false;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  await fs.writeFile(p, text + (text.endsWith('\n') || !text ? '' : eol) + line + eol, 'utf8');
  return true;
}

/**
 * Run the CLI. `opts`: `{ stdout, stderr, stdin, cwd, home }` — all optional, for tests.
 * Returns the exit code.
 */
export async function main(argv, opts = {}) {
  const out = opts.stdout || ((s) => process.stdout.write(s));
  const err = opts.stderr || ((s) => process.stderr.write(s));
  const cwd = opts.cwd || process.cwd();
  const home = opts.home || os.homedir();
  const args = parseArgs(argv);
  const cmd = args._[0] || 'build';
  const budget = args.flags.budget !== undefined ? Number(args.flags.budget) : DEFAULT_BUDGET;
  const outFile = typeof args.flags.out === 'string' ? args.flags.out : DEFAULT_OUT;
  const dirArg = (i) => path.resolve(cwd, args._[i] || '.');

  if (args.flags.version || cmd === '--version' || cmd === '-v' || cmd === 'version') { out((await packageVersion()) + '\n'); return 0; }
  if (args.flags.help || cmd === '--help' || cmd === '-h' || cmd === 'help') { out(HELP); return 0; }
  if (Number.isNaN(budget) || budget < 0) { err('--budget must be a number ≥ 0\n'); return 2; }

  try {
    switch (cmd) {
      case 'build': {
        const root = dirArg(1);
        const r = await build(root, { budget, out: outFile, json: !!args.flags.json, force: !!args.flags.force });
        if (args.flags.print) out(r.markdown);
        if (!args.flags.quiet) out(r.changed ? `${path.relative(cwd, r.outPath) || outFile} written · est. ${r.estimate} tokens${r.dropped.length ? ` · trimmed: ${r.dropped.join(', ')}` : ''}\n` : `${outFile} unchanged\n`);
        return 0;
      }
      case 'print': {
        const r = await build(dirArg(1), { budget, out: outFile });
        out(r.markdown);
        return 0;
      }
      case 'check': {
        const root = dirArg(1);
        const stale = await isStale(root, { outFile });
        if (stale) { err(`${outFile} is stale — run \`bearings build\`\n`); return 1; }
        out(`${outFile} is fresh\n`);
        return 0;
      }
      case 'init': {
        const root = dirArg(1);
        const r = await build(root, { budget, out: outFile, force: true });
        const settingsPath = path.join(root, '.claude', 'settings.json');
        const h = await installHook({ settingsPath, command: args.flags.command, budget: args.flags.budget !== undefined ? budget : undefined });
        out(`${path.relative(cwd, r.outPath) || outFile} written · est. ${r.estimate} tokens\n`);
        out(`${h.changed ? 'hook installed' : 'hook already installed'} in ${path.relative(cwd, settingsPath)} → ${h.command}\n`);
        if (await ensureGitignore(root, '.bearings/')) out('.bearings/ added to .gitignore\n');
        out(`Next Claude Code session in this folder starts with the map in context. Commit ${outFile} or add it to .gitignore — either is fine.\n`);
        return 0;
      }
      case 'hook': {
        const sub = args._[1];
        const settingsPath = args.flags.global ? path.join(home, '.claude', 'settings.json') : path.join(cwd, '.claude', 'settings.json');
        if (sub === 'install') {
          const h = await installHook({ settingsPath, command: args.flags.command, budget: args.flags.budget !== undefined ? budget : undefined });
          out(`${h.changed ? 'hook installed' : 'hook already installed'} in ${settingsPath} → ${h.command}\n`);
          return 0;
        }
        if (sub === 'uninstall') {
          const h = await uninstallHook({ settingsPath });
          out(`${h.changed ? 'hook removed' : 'no bearings hook'} in ${settingsPath}\n`);
          return 0;
        }
        err('usage: bearings hook install|uninstall [--global]\n');
        return 2;
      }
      case 'emit': {
        // Never fail a session: any problem → exit 0 with no output.
        try {
          let root = cwd;
          try {
            const input = JSON.parse(await readStdin(opts));
            if (input && typeof input.cwd === 'string' && input.cwd) root = input.cwd;
          } catch {}
          const r = await build(root, { budget, out: outFile });
          out(hookOutput(r.markdown, outFile));
        } catch {}
        return 0;
      }
      case 'watch': {
        const root = dirArg(1);
        await watch(root, { budget, out: outFile, log: (s) => out(s + '\n') });
        return 0;
      }
      default:
        err(`Unknown command: ${cmd}\n\n${HELP}`);
        return 2;
    }
  } catch (e) {
    err(`bearings: ${e.message}\n`);
    return 1;
  }
}

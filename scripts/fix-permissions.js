// Hostinger's build pipeline sometimes strips the execute bit off directories
// during checkout (git clone leaves them as 644 instead of 755), which makes
// them un-traversable and crashes `next build` with EACCES on a effectively
// random directory each time. Self-heal before every build. No-op on
// platforms without POSIX permission bits (e.g. Windows outside WSL).
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const targets = ['src', 'public', 'prisma', 'deploy'];

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    try {
      fs.chmodSync(full, 0o755);
    } catch {
      // best-effort; not fatal on platforms without POSIX chmod semantics
    }
    walk(full);
  }
}

for (const target of targets) {
  const full = path.join(projectRoot, target);
  try {
    fs.chmodSync(full, 0o755);
  } catch {
    continue;
  }
  walk(full);
}

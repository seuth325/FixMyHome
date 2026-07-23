import fs from "node:fs";

const envFile =
  "/home/u853098024/domains/fixmyhome.pro/public_html/.builds/config/.env";

for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  if (!line || line.trim().startsWith("#")) continue;
  const index = line.indexOf("=");
  if (index === -1) continue;
  const key = line.slice(0, index).trim();
  let value = line.slice(index + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (key) process.env[key] = value;
}

const response = await fetch("https://fixmyhome.pro/api/cron/support-agent", {
  headers: {
    authorization: `Bearer ${process.env.CRON_SECRET}`,
  },
});

const body = await response.text();
console.log(body);

if (!response.ok) {
  process.exitCode = 1;
}

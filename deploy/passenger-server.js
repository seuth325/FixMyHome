const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, ".builds", "config", ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
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
}

process.env.NODE_ENV = process.env.NODE_ENV || "production";
process.env.HOSTNAME = process.env.HOSTNAME || "127.0.0.1";
process.env.PORT = process.env.PORT || "3000";

require("./.next/standalone/server.js");
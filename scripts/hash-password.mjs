#!/usr/bin/env node
// Generate a scrypt password hash for auth/users.json.
//
// Usage:
//   node scripts/hash-password.mjs               # prompts for the password
//   node scripts/hash-password.mjs "mypassword"  # one-shot (don't do this on a shared shell)
//
// Output:  scrypt$<saltHex>$<hashHex>
// Paste that into auth/users.json as the `passwordHash` for a user.

import { randomBytes, scryptSync } from "node:crypto";
import readline from "node:readline";

const KEY_LEN = 64;
const SALT_LEN = 16;

function hash(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Password must be a non-empty string");
  }
  const salt = randomBytes(SALT_LEN);
  const derived = scryptSync(password, salt, KEY_LEN);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function promptHidden(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const stdout = process.stdout;
    stdout.write(query);
    // mute echo
    const onData = (char) => {
      const c = char.toString();
      if (c === "\n" || c === "\r" || c === "") {
        process.stdin.removeListener("data", onData);
      } else {
        stdout.clearLine?.(0);
        stdout.cursorTo?.(0);
        stdout.write(query);
      }
    };
    process.stdin.on("data", onData);
    rl.question("", (answer) => {
      rl.close();
      stdout.write("\n");
      resolve(answer);
    });
  });
}

const argv = process.argv.slice(2);
const password = argv[0] ?? (await promptHidden("Password: "));
process.stdout.write(hash(password) + "\n");

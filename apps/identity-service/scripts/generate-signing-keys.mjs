// Generates an Ed25519 key pair for signing access tokens and writes it into .env
// (creating .env from .env.example if needed). Development only: deployed environments load
// the keys from a secret store.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';

const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true });
const escape = (pem) => pem.trim().replace(/\n/g, '\\n');
const lines = {
  JWT_PRIVATE_KEY: `"${escape(await exportPKCS8(privateKey))}"`,
  JWT_PUBLIC_KEY: `"${escape(await exportSPKI(publicKey))}"`,
};

const envPath = new URL('../.env', import.meta.url);
const examplePath = new URL('../.env.example', import.meta.url);
let env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : readFileSync(examplePath, 'utf8');

for (const [key, value] of Object.entries(lines)) {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  env = pattern.test(env)
    ? env.replace(pattern, `${key}=${value}`)
    : `${env.trimEnd()}\n${key}=${value}\n`;
}
writeFileSync(envPath, env);
process.stdout.write('Wrote a new Ed25519 signing key pair to apps/identity-service/.env\n');

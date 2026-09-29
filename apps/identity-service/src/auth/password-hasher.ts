import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id (the library default) with OWASP's baseline parameters: 19 MiB memory, 2 iterations,
 * 1 lane. Memory-hard hashing makes offline cracking of a stolen hash table expensive.
 */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const DUMMY_PASSWORD = 'timing-equaliser-not-a-real-password';

@Injectable()
export class PasswordHasher {
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /**
   * Called when no account matches the email, so an unknown email takes as long as a wrong
   * password. Without it, response time alone reveals which emails have accounts.
   */
  async verifyAgainstDummy(password: string): Promise<false> {
    this.dummyHash ??= hash(DUMMY_PASSWORD, ARGON2_OPTIONS);
    await this.verify(await this.dummyHash, password);
    return false;
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppConfig } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM for Spotify tokens at rest. Output: base64(iv | auth tag | ciphertext). */
@Injectable()
export class TokenCipher {
  readonly #key: Buffer;

  constructor(@Inject(AppConfig) config: Pick<AppConfig, 'tokenEncryptionKey'>) {
    this.#key = config.tokenEncryptionKey;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.#key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }

  /** Throws when the value was encrypted with another key or has been tampered with. */
  decrypt(encoded: string): string {
    const raw = Buffer.from(encoded, 'base64');
    const decipher = createDecipheriv(ALGORITHM, this.#key, raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
  }
}

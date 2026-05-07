import { describe, it, expect } from 'vitest';
import type { ApiKeyType } from '../../src/services/apiKeyManager';

describe('gemini api key type', () => {
  it('includes gemini in ApiKeyType', () => {
    const key: ApiKeyType = 'gemini';
    expect(key).toBe('gemini');
  });
});

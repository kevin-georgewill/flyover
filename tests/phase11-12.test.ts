import { beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';

let integrations: typeof import('../src/services/integrations');

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/flyover_test';
  process.env.JWT_ACCESS_SECRET = 'test-secret-that-is-at-least-thirty-two-characters-long';
  process.env.IP_HASH_SALT = 'test-ip-hash-salt-that-is-long-enough';
  process.env.INTEGRATION_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.API_PUBLIC_URL = 'http://localhost:4000';
  integrations = await import('../src/services/integrations');
});

describe('Phase 11/12 integration primitives', () => {
  it('verifies generic HMAC webhook signatures using timing-safe comparison', () => {
    const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'payment.succeeded' }));
    const secret = 'provider-webhook-secret';
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');

    expect(integrations.verifyWebhookSignature('GENERIC_HMAC' as never, body, secret, signature)).toBe(true);
    expect(integrations.verifyWebhookSignature('GENERIC_HMAC' as never, body, secret, `${signature}00`)).toBe(false);
    expect(integrations.verifyWebhookSignature('GENERIC_HMAC' as never, body, secret, undefined)).toBe(false);
  });

  it('normalizes generic payment success events to a safe canonical payload', () => {
    const normalized = integrations.normalizeWebhook('GENERIC_HMAC' as never, {
      id: 'evt_123',
      type: 'payment.succeeded',
      data: {
        id: 'order_123',
        externalReference: 'ORDER-123',
        amount: '25000.00',
        currency: 'ngn',
        campaignId: 'campaign_1',
        couponCode: 'SAVE10',
        customer: { email: 'private@example.com' },
      },
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.externalEventId).toBe('evt_123');
    expect(normalized?.externalReference).toBe('ORDER-123');
    expect(normalized?.currency).toBe('NGN');
    expect(JSON.stringify(normalized?.raw)).not.toContain('private@example.com');
  });

  it('ignores non-payment generic events', () => {
    expect(integrations.normalizeWebhook('GENERIC_HMAC' as never, {
      id: 'evt_124',
      type: 'customer.updated',
      data: { id: 'customer_1', amount: 500 },
    })).toBeNull();
  });

  it('encrypts integration credentials and decrypts them without storing plaintext', () => {
    const encrypted = integrations.encryptCredentials({ webhookSecret: 'top-secret-webhook-key' });
    expect(encrypted).not.toContain('top-secret-webhook-key');
    expect(integrations.decryptCredentials(encrypted).webhookSecret).toBe('top-secret-webhook-key');
  });

  it('compares API key hashes without accepting malformed hex', () => {
    const hash = integrations.sha256('flyover-api-key');
    expect(integrations.secureEqualHex(hash, hash)).toBe(true);
    expect(integrations.secureEqualHex(hash, 'not-hex')).toBe(false);
  });
});

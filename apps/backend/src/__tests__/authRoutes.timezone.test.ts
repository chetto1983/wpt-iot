import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('../auth/authService.js', () => ({
  AuthService: {
    login: vi.fn(async () => ({
      id: 1,
      username: 'admin',
      role: 'SUPER_ADMIN',
      avatar: null,
    })),
  },
}));

vi.mock('../services/applicationConfigService.js', () => ({
  ApplicationConfigService: {
    getTimezone: vi.fn(() => 'Asia/Tokyo'),
  },
}));

import { authRoutes } from '../routes/auth.js';

describe('auth routes application timezone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the active application timezone at login', async () => {
    const app = Fastify({ logger: false });
    app.decorateRequest('session', null);
    app.addHook('onRequest', async (request) => {
      request.session = {
        userId: undefined,
        username: undefined,
        role: undefined,
        language: undefined,
        destroy: async () => undefined,
      } as typeof request.session;
    });
    await app.register(authRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'admin', password: 'secret', language: 'it' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ timezone: 'Asia/Tokyo' });
    await app.close();
  });
});

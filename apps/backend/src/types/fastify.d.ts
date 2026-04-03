import 'fastify';

declare module 'fastify' {
  interface Session {
    userId: number;
    username: string;
    role: string;
    language: 'it' | 'en';
  }
}

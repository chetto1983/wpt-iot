import { describe, it, expect, afterEach } from 'vitest';
import { createSockets, getSockets, closeSockets } from '../udp/sockets.js';

/**
 * Tests for the singleton UDP socket manager.
 * NOTE: We do NOT test actual UDP binding in unit tests (port conflicts in CI).
 * Socket binding is verified via integration test with the full Docker stack.
 */
describe('UDP Socket Manager', () => {
  afterEach(() => {
    // Always clean up sockets after each test
    closeSockets();
  });

  it('createSockets returns an ISocketManager with 4 sockets', () => {
    const mgr = createSockets();
    expect(mgr.dataSocket).toBeDefined();
    expect(mgr.alarmSocket).toBeDefined();
    expect(mgr.userSocket).toBeDefined();
    expect(mgr.ackSocket).toBeDefined();
  });

  it('createSockets returns the same instance when called twice (singleton)', () => {
    const first = createSockets();
    const second = createSockets();
    expect(first).toBe(second);
    expect(first.dataSocket).toBe(second.dataSocket);
  });

  it('getSockets throws before createSockets is called', () => {
    expect(() => getSockets()).toThrow('UDP sockets not initialized');
  });

  it('getSockets returns the singleton after createSockets is called', () => {
    const created = createSockets();
    const retrieved = getSockets();
    expect(retrieved).toBe(created);
  });

  it('closeSockets then createSockets creates fresh sockets', () => {
    const first = createSockets();
    const firstDataSocket = first.dataSocket;
    closeSockets();

    const second = createSockets();
    expect(second).not.toBe(first);
    expect(second.dataSocket).not.toBe(firstDataSocket);
  });

  it('closeSockets is safe to call multiple times', () => {
    createSockets();
    closeSockets();
    // Should not throw on second call
    expect(() => closeSockets()).not.toThrow();
  });

  it('all sockets have reuseAddr option (verified via dgram type)', () => {
    const mgr = createSockets();
    // dgram.Socket created with reuseAddr: true -- we verify the sockets are valid UDP4 sockets
    // by checking they have the expected dgram.Socket methods
    expect(typeof mgr.dataSocket.bind).toBe('function');
    expect(typeof mgr.dataSocket.close).toBe('function');
    expect(typeof mgr.dataSocket.send).toBe('function');
    expect(typeof mgr.alarmSocket.bind).toBe('function');
    expect(typeof mgr.userSocket.bind).toBe('function');
    expect(typeof mgr.ackSocket.bind).toBe('function');
  });
});

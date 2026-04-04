import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IRfidUser } from '@wpt/types';
import { RfidUserGroup } from '@wpt/types';

// Mock the db module
vi.mock('../db/index.js', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockResolvedValue([]),
    }),
  },
}));

// Mock the hub to capture subscription handlers
vi.mock('../events/hub.js', () => ({
  dataHub: {
    onUserData: vi.fn(),
  },
}));

import { startUserStore } from '../persistence/userStore.js';
import { rfidUsers, rfidUserChanges } from '../db/schema/users.js';
import { db } from '../db/index.js';
import { dataHub } from '../events/hub.js';

const mockLog = {
  info: vi.fn(),
  error: vi.fn(),
};

/** Helper to extract the handler passed to onUserData */
function getUserHandler(): (users: IRfidUser[]) => Promise<void> {
  const calls = vi.mocked(dataHub.onUserData).mock.calls;
  return calls[calls.length - 1]![0] as unknown as (users: IRfidUser[]) => Promise<void>;
}

/** Generate N RFID users for testing */
function makeUsers(count: number, overrides?: Partial<IRfidUser>[]): IRfidUser[] {
  return Array.from({ length: count }, (_, i) => ({
    tagId: i + 1,
    name: `User${i + 1}`,
    group: RfidUserGroup.OPERATOR,
    enabled: true,
    ...overrides?.[i],
  }));
}

describe('userStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock: select returns empty (first event, no previous data)
    const mockFrom = vi.fn().mockResolvedValue([]);
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as never);
    // Default mock: insert chain
    const mockOnConflict = vi.fn().mockResolvedValue(undefined);
    const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict });
    vi.mocked(db.insert).mockReturnValue({ values: mockValues } as never);
  });

  it('subscribes to dataHub.onUserData', () => {
    startUserStore(mockLog);
    expect(dataHub.onUserData).toHaveBeenCalledOnce();
  });

  it('upserts 48 users on first event (no diff log since no previous data)', async () => {
    const mockOnConflict = vi.fn().mockResolvedValue(undefined);
    const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict });
    vi.mocked(db.insert).mockReturnValue({ values: mockValues } as never);

    startUserStore(mockLog);
    const handler = getUserHandler();

    const users = makeUsers(48);
    await handler(users);

    // 48 inserts for rfidUsers (upserts), 0 inserts for rfidUserChanges
    expect(db.insert).toHaveBeenCalledTimes(48);
    // All calls should be for rfidUsers (not rfidUserChanges)
    for (const call of vi.mocked(db.insert).mock.calls) {
      expect(call[0]).toBe(rfidUsers);
    }
  });

  it('inserts diff log entry when user data changes', async () => {
    // Setup: select returns one existing user with different name
    const existingUser = {
      id: 1, tagId: 1, name: 'OldName', group: 0, enabled: true,
      updatedAt: new Date(),
    };
    const mockFrom = vi.fn().mockResolvedValue([existingUser]);
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as never);

    // Track insert calls to distinguish rfidUsers vs rfidUserChanges
    const mockOnConflict = vi.fn().mockResolvedValue(undefined);
    const mockValuesUpsert = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict });
    const mockValuesChange = vi.fn().mockResolvedValue(undefined);

    vi.mocked(db.insert).mockImplementation((table: unknown) => {
      if (table === rfidUserChanges) {
        return { values: mockValuesChange } as never;
      }
      return { values: mockValuesUpsert } as never;
    });

    startUserStore(mockLog);
    const handler = getUserHandler();

    const users: IRfidUser[] = [{ tagId: 1, name: 'NewName', group: RfidUserGroup.OPERATOR, enabled: true }];
    await handler(users);

    // Should have inserted into rfidUserChanges (diff log) + rfidUsers (upsert)
    expect(mockValuesChange).toHaveBeenCalledWith(expect.objectContaining({
      tagId: 1,
      previousName: 'OldName',
      currentName: 'NewName',
    }));
  });

  it('does NOT insert diff log when data is identical', async () => {
    // Setup: select returns user with SAME data
    const existingUser = {
      id: 1, tagId: 1, name: 'SameName', group: 0, enabled: true,
      updatedAt: new Date(),
    };
    const mockFrom = vi.fn().mockResolvedValue([existingUser]);
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as never);

    const insertedTables: unknown[] = [];
    const mockOnConflict = vi.fn().mockResolvedValue(undefined);
    const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict });
    vi.mocked(db.insert).mockImplementation((table: unknown) => {
      insertedTables.push(table);
      return { values: mockValues } as never;
    });

    startUserStore(mockLog);
    const handler = getUserHandler();

    const users: IRfidUser[] = [{ tagId: 1, name: 'SameName', group: RfidUserGroup.OPERATOR, enabled: true }];
    await handler(users);

    // Should only insert into rfidUsers (upsert), NOT rfidUserChanges
    expect(insertedTables).not.toContain(rfidUserChanges);
    expect(insertedTables).toContain(rfidUsers);
  });

  it('logs error and does NOT throw on DB failure (D-12 resilience)', async () => {
    const mockFrom = vi.fn().mockRejectedValue(new Error('connection refused'));
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as never);

    startUserStore(mockLog);
    const handler = getUserHandler();

    const users = makeUsers(1);

    // Should not throw
    await handler(users);

    expect(mockLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'UserStore' }),
      expect.stringContaining('Failed to persist RFID users'),
    );
  });
});

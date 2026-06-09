import { useState, useCallback, useRef, useEffect } from 'react';

// ── Types ──────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  color: string;
  cursor?: { x: number; y: number } | null;
  lastSeen: number;
}

export interface UserInput {
  id: string;
  name: string;
  color: string;
  cursor?: { x: number; y: number } | null;
}

// ── Constants ──────────────────────────────────────────────────────

/** Users inactive longer than this are auto-cleaned (ms). */
const STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ── Hook ───────────────────────────────────────────────────────────

export function usePresence() {
  const [users, setUsers] = useState<User[]>([]);
  const cleanupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Remove stale users whose lastSeen is older than STALE_TIMEOUT_MS. */
  const cleanupStale = useCallback(() => {
    const now = Date.now();
    setUsers((prev) => prev.filter((u) => now - u.lastSeen < STALE_TIMEOUT_MS));
  }, []);

  // Auto-cleanup every 30 seconds
  useEffect(() => {
    cleanupTimerRef.current = setInterval(cleanupStale, 30_000);
    return () => {
      if (cleanupTimerRef.current) clearInterval(cleanupTimerRef.current);
    };
  }, [cleanupStale]);

  /** Add or update a user. Returns the user object. */
  const setUser = useCallback((input: UserInput): User => {
    if (!input.name || input.name.trim().length === 0) {
      throw new Error('User name must not be empty');
    }
    if (!input.color || !/^#[0-9a-fA-F]{6}$/.test(input.color)) {
      throw new Error('User color must be a valid hex color (e.g. #ff0000)');
    }
    const user: User = {
      id: input.id,
      name: input.name,
      color: input.color,
      cursor: input.cursor ?? null,
      lastSeen: Date.now(),
    };
    setUsers((prev) => {
      const idx = prev.findIndex((u) => u.id === input.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...user, lastSeen: Date.now() };
        return next;
      }
      return [...prev, user];
    });
    return user;
  }, []);

  /** Get all active (non-stale) users. */
  const getUsers = useCallback((): User[] => {
    const now = Date.now();
    return users.filter((u) => now - u.lastSeen < STALE_TIMEOUT_MS);
  }, [users]);

  /** Remove a user by id. Returns true if removed, false if not found. */
  const removeUser = useCallback((id: string): boolean => {
    let found = false;
    setUsers((prev) => {
      const next = prev.filter((u) => {
        if (u.id === id) {
          found = true;
          return false;
        }
        return true;
      });
      return next;
    });
    return found;
  }, []);

  /** Update cursor position for a user. */
  const updateCursor = useCallback(
    (userId: string, pos: { x: number; y: number }) => {
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? { ...u, cursor: pos, lastSeen: Date.now() }
            : u,
        ),
      );
    },
    [],
  );

  return {
    users,
    setUser,
    getUsers,
    removeUser,
    updateCursor,
    cleanupStale,
  };
}

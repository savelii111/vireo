import { useState, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────

export interface Comment {
  id: string;
  clipId?: string;
  timeSec: number;
  content: string;
  author: string;
  createdAt: number;
  resolved: boolean;
}

export interface CommentInput {
  clipId?: string;
  timeSec: number;
  content: string;
  author: string;
}

// ── Hook ───────────────────────────────────────────────────────────

export function useComments() {
  const [comments, setComments] = useState<Comment[]>([]);

  /** Add a new comment. Returns the created Comment. */
  const addComment = useCallback((input: CommentInput): Comment => {
    if (!input.content || input.content.trim().length === 0) {
      throw new Error('Comment content must not be empty');
    }
    const comment: Comment = {
      id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      clipId: input.clipId,
      timeSec: input.timeSec,
      content: input.content,
      author: input.author,
      createdAt: Date.now(),
      resolved: false,
    };
    setComments((prev) => [...prev, comment]);
    return comment;
  }, []);

  /** List all comments, optionally filtered by clipId. */
  const listComments = useCallback(
    (clipId?: string): Comment[] => {
      const filtered = clipId
        ? comments.filter((c) => c.clipId === clipId)
        : [...comments];
      // Sort by timeSec ascending
      return filtered.sort((a, b) => a.timeSec - b.timeSec);
    },
    [comments],
  );

  /** Delete a comment by id. Returns true if deleted, false if not found. */
  const deleteComment = useCallback((id: string): boolean => {
    let found = false;
    setComments((prev) => {
      const next = prev.filter((c) => {
        if (c.id === id) {
          found = true;
          return false;
        }
        return true;
      });
      return next;
    });
    return found;
  }, []);

  /** Mark a comment as resolved. Returns true if found and resolved. */
  const resolveComment = useCallback((id: string): boolean => {
    let found = false;
    setComments((prev) =>
      prev.map((c) => {
        if (c.id === id) {
          found = true;
          return { ...c, resolved: true };
        }
        return c;
      }),
    );
    return found;
  }, []);

  return {
    comments,
    addComment,
    listComments,
    deleteComment,
    resolveComment,
  };
}

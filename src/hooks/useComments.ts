'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getSupabaseClient } from '@/lib/supabase-browser';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { DEFAULT_PROFILE_IMAGE } from '@/types/userProfile';

// Database types
export interface DbComment {
  id: string;
  market_id: string | null;
  market_identifier: string | null;
  author_wallet: string;
  author_name: string | null;
  author_badge: 'creator' | 'moderator' | 'verified' | null;
  content: string;
  content_html: string | null;
  parent_id: string | null;
  root_id: string | null;
  reply_count: number;
  like_count: number;
  is_edited: boolean;
  is_deleted: boolean;
  is_hidden: boolean;
  is_flagged: boolean;
  flag_count: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface DbCommentImage {
  id: string;
  comment_id: string;
  url: string;
  thumbnail_url: string | null;
  storage_path: string | null;
  width: number | null;
  height: number | null;
  file_size: number | null;
  mime_type: string | null;
  alt_text: string | null;
  position: number;
  created_at: string;
}

export interface DbCommentLike {
  id: string;
  comment_id: string;
  user_wallet: string;
  created_at: string;
}

// Frontend types (matches CommentSection component)
export interface CommentImage {
  id: string;
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  alt?: string;
}

export interface Comment {
  id: string;
  author: {
    id: string;
    name: string;
    avatarUrl?: string;
    badge?: 'creator' | 'moderator' | 'verified';
  };
  text: string;
  images?: CommentImage[];
  timestamp: string;
  likes: number;
  isLiked?: boolean;
  isEdited?: boolean;
  replies?: Comment[];
}

interface UseCommentsOptions {
  marketId?: string;
  marketIdentifier?: string;
  userWallet?: string;
  userName?: string;
  sortBy?: 'newest' | 'oldest' | 'top';
  limit?: number;
}

interface UseCommentsReturn {
  comments: Comment[];
  totalCount: number;
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  submitComment: (text: string, images?: File[]) => Promise<{ success: boolean; error?: string }>;
  submitReply: (parentId: string, text: string) => Promise<{ success: boolean; error?: string }>;
  likeComment: (commentId: string) => Promise<void>;
  unlikeComment: (commentId: string) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  reportComment: (commentId: string, reason: string, description?: string) => Promise<void>;
  refetch: () => Promise<void>;
}

// User profile data for avatar display
interface UserProfile {
  wallet_address: string;
  display_name: string | null;
  username: string | null;
  profile_image_url: string | null;
}

// Transform database comment to frontend format
function transformComment(
  dbComment: DbComment,
  images: DbCommentImage[],
  userLikes: Set<string>,
  userProfiles: Map<string, UserProfile>,
  replies: Comment[] = []
): Comment {
  const profile = userProfiles.get(dbComment.author_wallet.toLowerCase());
  const displayName = profile?.display_name || profile?.username || dbComment.author_name;
  
  return {
    id: dbComment.id,
    author: {
      id: dbComment.author_wallet,
      name: displayName || `${dbComment.author_wallet.slice(0, 6)}...${dbComment.author_wallet.slice(-4)}`,
      avatarUrl: profile?.profile_image_url || DEFAULT_PROFILE_IMAGE,
      badge: dbComment.author_badge || undefined,
    },
    text: dbComment.content,
    images: images.map((img) => ({
      id: img.id,
      url: img.url,
      thumbnailUrl: img.thumbnail_url || undefined,
      width: img.width || undefined,
      height: img.height || undefined,
      alt: img.alt_text || undefined,
    })),
    timestamp: dbComment.created_at,
    likes: dbComment.like_count,
    isLiked: userLikes.has(dbComment.id),
    isEdited: dbComment.is_edited,
    replies: replies.length > 0 ? replies : undefined,
  };
}

export function useComments({
  marketId,
  marketIdentifier,
  userWallet,
  userName,
  sortBy = 'newest',
  limit = 20,
}: UseCommentsOptions): UseCommentsReturn {
  const [comments, setComments] = useState<Comment[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  
  const channelRef = useRef<RealtimeChannel | null>(null);
  const supabase = getSupabaseClient();

  // Fetch comments
  const fetchComments = useCallback(async (reset = false) => {
    if (!marketId && !marketIdentifier) {
      setComments([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const currentOffset = reset ? 0 : offset;

      // Build query for top-level comments
      let query = supabase
        .from('comments')
        .select('*', { count: 'exact' })
        .is('parent_id', null)
        .eq('is_deleted', false)
        .eq('is_hidden', false);

      if (marketId) {
        query = query.eq('market_id', marketId);
      } else if (marketIdentifier) {
        query = query.eq('market_identifier', marketIdentifier);
      }

      // Sorting
      switch (sortBy) {
        case 'oldest':
          query = query.order('created_at', { ascending: true });
          break;
        case 'top':
          query = query.order('like_count', { ascending: false });
          break;
        case 'newest':
        default:
          query = query.order('created_at', { ascending: false });
      }

      query = query.range(currentOffset, currentOffset + limit - 1);

      const { data: commentsData, error: commentsError, count } = await query;

      if (commentsError) throw commentsError;

      if (!commentsData || commentsData.length === 0) {
        if (reset) {
          setComments([]);
          setTotalCount(0);
        }
        setHasMore(false);
        setIsLoading(false);
        return;
      }

      // Get all comment IDs for fetching related data
      const commentIds = commentsData.map((c) => c.id);

      // Recursively fetch all reply descendants
      const allReplies: DbComment[] = [];
      let parentIds = commentIds;
      while (parentIds.length > 0) {
        const { data: repliesData } = await supabase
          .from('comments')
          .select('*')
          .in('parent_id', parentIds)
          .eq('is_deleted', false)
          .eq('is_hidden', false)
          .order('created_at', { ascending: true });

        if (!repliesData || repliesData.length === 0) break;
        allReplies.push(...repliesData);
        parentIds = repliesData.map((r) => r.id);
      }

      // Fetch images for all comments (including nested replies)
      const allCommentIds = [...commentIds, ...allReplies.map((r) => r.id)];
      const { data: imagesData } = await supabase
        .from('comment_images')
        .select('*')
        .in('comment_id', allCommentIds)
        .order('position', { ascending: true });

      // Fetch user likes if wallet connected
      let userLikes = new Set<string>();
      if (userWallet) {
        const { data: likesData } = await supabase
          .from('comment_likes')
          .select('comment_id')
          .eq('user_wallet', userWallet)
          .in('comment_id', allCommentIds);

        userLikes = new Set(likesData?.map((l) => l.comment_id) || []);
      }

      // Collect all unique author wallets
      const authorWallets = new Set<string>();
      commentsData.forEach((c) => authorWallets.add(c.author_wallet.toLowerCase()));
      allReplies.forEach((r) => authorWallets.add(r.author_wallet.toLowerCase()));

      // Fetch user profiles for all authors
      const userProfiles = new Map<string, UserProfile>();
      if (authorWallets.size > 0) {
        const { data: profilesData } = await supabase
          .from('user_profiles')
          .select('wallet_address, display_name, username, profile_image_url')
          .in('wallet_address', Array.from(authorWallets));

        profilesData?.forEach((profile) => {
          userProfiles.set(profile.wallet_address.toLowerCase(), profile);
        });
      }

      // Group images by comment
      const imagesByComment = new Map<string, DbCommentImage[]>();
      imagesData?.forEach((img) => {
        const existing = imagesByComment.get(img.comment_id) || [];
        existing.push(img);
        imagesByComment.set(img.comment_id, existing);
      });

      // Build reply tree: group all replies by parent_id
      const childrenMap = new Map<string, DbComment[]>();
      allReplies.forEach((reply) => {
        if (reply.parent_id) {
          const children = childrenMap.get(reply.parent_id) || [];
          children.push(reply);
          childrenMap.set(reply.parent_id, children);
        }
      });

      // Recursively build the comment tree
      function buildCommentTree(dbComment: DbComment): Comment {
        const commentImages = imagesByComment.get(dbComment.id) || [];
        const children = childrenMap.get(dbComment.id) || [];
        const transformedReplies = children.map((child) => buildCommentTree(child));
        return transformComment(dbComment, commentImages, userLikes, userProfiles, transformedReplies);
      }

      const transformedComments = commentsData.map((c) => buildCommentTree(c));

      if (reset) {
        setComments(transformedComments);
        setOffset(limit);
      } else {
        setComments((prev) => [...prev, ...transformedComments]);
        setOffset((prev) => prev + limit);
      }

      setTotalCount(count || 0);
      setHasMore((count || 0) > currentOffset + limit);
    } catch (err) {
      console.error('Error fetching comments:', err);
      setError(err instanceof Error ? err.message : 'Failed to load comments');
    } finally {
      setIsLoading(false);
    }
  }, [marketId, marketIdentifier, userWallet, sortBy, limit, offset, supabase]);

  // Load more
  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading) return;
    await fetchComments(false);
  }, [hasMore, isLoading, fetchComments]);

  // Refetch
  const refetch = useCallback(async () => {
    setOffset(0);
    await fetchComments(true);
  }, [fetchComments]);

  // Submit comment
  const submitComment = useCallback(
    async (text: string, images?: File[]): Promise<{ success: boolean; error?: string }> => {
      if (!userWallet) {
        return { success: false, error: 'Wallet not connected' };
      }

      if (!text.trim() && (!images || images.length === 0)) {
        return { success: false, error: 'Comment cannot be empty' };
      }

      try {
        // Insert comment
        const { data: newComment, error: insertError } = await supabase
          .from('comments')
          .insert({
            market_id: marketId || null,
            market_identifier: marketIdentifier || null,
            author_wallet: userWallet,
            author_name: userName || null,
            content: text.trim(),
          })
          .select()
          .single();

        if (insertError) throw insertError;

        // Upload images if any
        if (images && images.length > 0 && newComment) {
          for (let i = 0; i < images.length; i++) {
            const file = images[i];
            const fileExt = file.name.split('.').pop();
            const filePath = `${userWallet}/${newComment.id}/${i}.${fileExt}`;

            // Upload to storage
            const { error: uploadError } = await supabase.storage
              .from('comment-images')
              .upload(filePath, file);

            if (uploadError) {
              console.error('Image upload error:', uploadError);
              continue;
            }

            // Get public URL
            const { data: urlData } = supabase.storage
              .from('comment-images')
              .getPublicUrl(filePath);

            // Insert image record
            await supabase.from('comment_images').insert({
              comment_id: newComment.id,
              url: urlData.publicUrl,
              storage_path: filePath,
              mime_type: file.type,
              file_size: file.size,
              position: i,
            });
          }
        }

        // Refetch to get updated list
        await refetch();

        return { success: true };
      } catch (err) {
        console.error('Error submitting comment:', err);
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to submit comment',
        };
      }
    },
    [marketId, marketIdentifier, userWallet, userName, supabase, refetch]
  );

  // Submit reply
  const submitReply = useCallback(
    async (parentId: string, text: string): Promise<{ success: boolean; error?: string }> => {
      if (!userWallet) {
        return { success: false, error: 'Wallet not connected' };
      }

      if (!text.trim()) {
        return { success: false, error: 'Reply cannot be empty' };
      }

      try {
        // Determine root_id for proper thread tracking
        let rootId: string | null = null;
        const { data: parentComment } = await supabase
          .from('comments')
          .select('id, parent_id, root_id')
          .eq('id', parentId)
          .single();

        if (parentComment) {
          if (parentComment.parent_id === null) {
            rootId = parentComment.id;
          } else {
            rootId = parentComment.root_id || parentComment.parent_id;
          }
        }

        const { error: insertError } = await supabase.from('comments').insert({
          market_id: marketId || null,
          market_identifier: marketIdentifier || null,
          author_wallet: userWallet,
          author_name: userName || null,
          content: text.trim(),
          parent_id: parentId,
          root_id: rootId,
        });

        if (insertError) throw insertError;

        await refetch();
        return { success: true };
      } catch (err) {
        console.error('Error submitting reply:', err);
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to submit reply',
        };
      }
    },
    [marketId, marketIdentifier, userWallet, userName, supabase, refetch]
  );

  // Recursive helper to update a comment at any nesting depth
  function updateNestedComment(
    comments: Comment[],
    commentId: string,
    updater: (c: Comment) => Comment
  ): Comment[] {
    return comments.map((c) => {
      if (c.id === commentId) return updater(c);
      if (c.replies && c.replies.length > 0) {
        const updatedReplies = updateNestedComment(c.replies, commentId, updater);
        if (updatedReplies !== c.replies) {
          return { ...c, replies: updatedReplies };
        }
      }
      return c;
    });
  }

  // Recursive helper to remove a comment at any nesting depth
  function removeNestedComment(comments: Comment[], commentId: string): Comment[] {
    return comments
      .filter((c) => c.id !== commentId)
      .map((c) => ({
        ...c,
        replies: c.replies ? removeNestedComment(c.replies, commentId) : undefined,
      }));
  }

  // Like comment
  const likeComment = useCallback(
    async (commentId: string) => {
      if (!userWallet) return;

      try {
        await supabase.from('comment_likes').insert({
          comment_id: commentId,
          user_wallet: userWallet,
        });

        setComments((prev) =>
          updateNestedComment(prev, commentId, (c) => ({
            ...c,
            likes: c.likes + 1,
            isLiked: true,
          }))
        );
      } catch (err) {
        console.error('Error liking comment:', err);
      }
    },
    [userWallet, supabase]
  );

  // Unlike comment
  const unlikeComment = useCallback(
    async (commentId: string) => {
      if (!userWallet) return;

      try {
        await supabase
          .from('comment_likes')
          .delete()
          .eq('comment_id', commentId)
          .eq('user_wallet', userWallet);

        setComments((prev) =>
          updateNestedComment(prev, commentId, (c) => ({
            ...c,
            likes: Math.max(0, c.likes - 1),
            isLiked: false,
          }))
        );
      } catch (err) {
        console.error('Error unliking comment:', err);
      }
    },
    [userWallet, supabase]
  );

  // Delete comment (soft delete)
  const deleteComment = useCallback(
    async (commentId: string) => {
      if (!userWallet) {
        console.error('Cannot delete comment: no user wallet connected');
        return;
      }

      console.log('Attempting to delete comment:', { commentId, userWallet });

      try {
        // First, verify the comment exists and check ownership
        const { data: existingComment, error: fetchError } = await supabase
          .from('comments')
          .select('id, author_wallet, is_deleted')
          .eq('id', commentId)
          .single();

        if (fetchError) {
          console.error('Error fetching comment for deletion:', fetchError.message, fetchError.code, fetchError.details);
          return;
        }

        if (!existingComment) {
          console.error('Comment not found:', commentId);
          return;
        }

        console.log('Found comment:', existingComment);

        // Check ownership (case-insensitive)
        if (existingComment.author_wallet.toLowerCase() !== userWallet.toLowerCase()) {
          console.error('Cannot delete: not the author', {
            commentAuthor: existingComment.author_wallet,
            currentUser: userWallet,
          });
          return;
        }

        // Perform the soft delete - only match by ID since we've already verified ownership
        const { data, error, status, statusText } = await supabase
          .from('comments')
          .update({ is_deleted: true, deleted_at: new Date().toISOString() })
          .eq('id', commentId)
          .select();

        console.log('Delete response:', { data, error, status, statusText });

        if (error) {
          console.error('Supabase error deleting comment:', error.message, error.code, error.details, error.hint);
          throw error;
        }

        if (!data || data.length === 0) {
          console.error('No comment was updated - unexpected state');
          return;
        }

        console.log('Comment deleted successfully:', commentId);

        // Remove from local state and update count
        setComments((prev) => {
          const isTopLevel = prev.some((c) => c.id === commentId);
          const newComments = removeNestedComment(prev, commentId);
          
          if (isTopLevel) {
            setTotalCount((prevCount) => Math.max(0, prevCount - 1));
          }
          
          return newComments;
        });
      } catch (err) {
        console.error('Error deleting comment:', err);
      }
    },
    [userWallet, supabase]
  );

  // Report comment
  const reportComment = useCallback(
    async (commentId: string, reason: string, description?: string) => {
      if (!userWallet) return;

      try {
        await supabase.from('comment_reports').insert({
          comment_id: commentId,
          reporter_wallet: userWallet,
          reason,
          description,
        });
      } catch (err) {
        console.error('Error reporting comment:', err);
      }
    },
    [userWallet, supabase]
  );

  // Initial fetch
  useEffect(() => {
    setOffset(0);
    fetchComments(true);
  }, [marketId, marketIdentifier, sortBy]);

  // Real-time subscription
  useEffect(() => {
    if (!marketId && !marketIdentifier) return;

    const channelName = `comments:${marketId || marketIdentifier}`;

    channelRef.current = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'comments',
          filter: marketId
            ? `market_id=eq.${marketId}`
            : `market_identifier=eq.${marketIdentifier}`,
        },
        (payload) => {
          console.log('Comment realtime update:', payload);

          if (payload.eventType === 'INSERT') {
            // New comment - refetch to get full data
            refetch();
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as DbComment;
            setComments((prev) =>
              updateNestedComment(prev, updated.id, (c) => ({
                ...c,
                text: updated.content,
                likes: updated.like_count,
                isEdited: updated.is_edited,
              }))
            );
          } else if (payload.eventType === 'DELETE') {
            const deleted = payload.old as DbComment;
            setComments((prev) => removeNestedComment(prev, deleted.id));
          }
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [marketId, marketIdentifier, supabase, refetch]);

  return {
    comments,
    totalCount,
    isLoading,
    error,
    hasMore,
    loadMore,
    submitComment,
    submitReply,
    likeComment,
    unlikeComment,
    deleteComment,
    reportComment,
    refetch,
  };
}

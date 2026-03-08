'use client';

import React, { useState, useCallback, useRef } from 'react';
import styles from './CommentSection.module.css';

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

export interface CommentSectionProps {
  comments: Comment[];
  totalCount?: number;
  currentUser?: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
  sortBy?: 'newest' | 'oldest' | 'top';
  onSortChange?: (sort: 'newest' | 'oldest' | 'top') => void;
  onSubmitComment?: (text: string, images?: File[]) => void;
  onSubmitReply?: (commentId: string, text: string) => void;
  onLikeComment?: (commentId: string) => void;
  onDeleteComment?: (commentId: string) => void;
  onReportComment?: (commentId: string) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoading?: boolean;
}

function ThumbsUpIcon({ filled }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
    </svg>
  );
}

function ReplyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function MoreHorizontalIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="6" x2="16" y2="6" />
      <line x1="4" y1="12" x2="12" y2="12" />
      <line x1="4" y1="18" x2="8" y2="18" />
      <polyline points="15 15 18 18 21 15" />
      <line x1="18" y1="12" x2="18" y2="18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function CommentsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}


function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}


function EmojiIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ZoomIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hrs ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getBadgeLabel(badge: Comment['author']['badge']): string {
  switch (badge) {
    case 'creator': return 'Creator';
    case 'moderator': return 'Mod';
    case 'verified': return '';
    default: return '';
  }
}

function getBadgeClass(badge: Comment['author']['badge']): string {
  switch (badge) {
    case 'creator': return styles.authorBadgeCreator;
    case 'moderator': return styles.authorBadgeMod;
    default: return '';
  }
}

// Content moderation - banned words list
// Includes racial slurs, hate speech, and offensive terms
const BANNED_WORDS: string[] = [
  // Racial slurs
  'nigger', 'nigga', 'negro', 'coon', 'darkie', 'spic', 'wetback', 'beaner',
  'chink', 'gook', 'slant', 'zipperhead', 'jap', 'nip', 'raghead', 'towelhead',
  'camel jockey', 'sand nigger', 'cracker', 'honky', 'gringo', 'wop', 'dago',
  'guinea', 'polack', 'kraut', 'mick', 'paddy', 'redskin', 'injun', 'squaw',
  'paki', 'curry muncher', 'abo', 'chinaman', 'oriental', 'half-breed',
  'mulatto', 'octoroon', 'quadroon', 'niggers',
  
  // Antisemitic slurs
  'kike', 'yid', 'hymie', 'heeb', 'hebe', 'sheeny', 'shylock', 'zhid', 'zhydy',
  'christ killer', 'jewboy', 'jew boy', 'jewess', 'juden', 'judenrat', 'kapo',
  'hook nose', 'hooknose', 'hooked nose', 'big nose', 'long nose',
  'oven dodger', 'lampshade', 'gas chamber', 'auschwitz', 'holocaust denier',
  'happy merchant', 'merchant meme', 'echoes', 'triple parentheses',
  'goy', 'goyim', 'shiksa', 'shikse', 'shegetz',
  'rootless cosmopolitan', 'globalist', 'jewish question', 'jq',
  'zog', 'zionist occupied', 'jewish cabal', 'jewish mafia',
  'jewish media', 'jewish banker', 'jewish money', 'jew gold',
  'blood libel', 'protocols of zion', 'elders of zion',
  '6 million', 'six million', 'holohoax', 'hollowcost',
  
  // Homophobic/transphobic slurs
  'faggot', 'fag', 'dyke', 'homo', 'queer', 'tranny', 'shemale', 'ladyboy',
  'he-she', 'sodomite', 'fairy', 'pansy', 'sissy', 'fruitcake',
  
  // Misogynistic/sexist terms
  'cunt', 'bitch', 'whore', 'slut', 'skank', 'twat', 'hoe', 'thot',
  
  // Ableist slurs
  'retard', 'retarded', 'tard', 'spaz', 'spastic', 'cripple', 'midget',
  
  // Islamophobic slurs
  'sandnigger', 'sand monkey', 'muzzie', 'muzzy', 'muzz', 'goatfucker',
  'terrorist', 'jihadi', 'allahu akbar', 'kebab', 'remove kebab',
  
  // General hate speech / violent terms
  'kill yourself', 'kys', 'neck yourself', 'go die', 'hang yourself',
  
  // Extremely offensive general terms
  'motherfucker', 'cocksucker',
];

// Unicode confusables map - characters that look like ASCII letters
const UNICODE_CONFUSABLES: Record<string, string> = {
  // Cyrillic lookalikes
  'а': 'a', 'е': 'e', 'і': 'i', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x',
  'А': 'a', 'Е': 'e', 'І': 'i', 'О': 'o', 'Р': 'p', 'С': 'c', 'У': 'y', 'Х': 'x',
  'В': 'b', 'Н': 'h', 'К': 'k', 'М': 'm', 'Т': 't',
  // Greek lookalikes
  'α': 'a', 'ε': 'e', 'ι': 'i', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x',
  'Α': 'a', 'Ε': 'e', 'Ι': 'i', 'Ο': 'o', 'Ρ': 'p', 'Τ': 't', 'Υ': 'y', 'Χ': 'x',
  // Mathematical/special characters
  'ℓ': 'l', 'ℐ': 'i', 'ℑ': 'i', 'ℕ': 'n', 'ℝ': 'r', 'ℤ': 'z',
  'ａ': 'a', 'ｂ': 'b', 'ｃ': 'c', 'ｄ': 'd', 'ｅ': 'e', 'ｆ': 'f', 'ｇ': 'g', 'ｈ': 'h',
  'ｉ': 'i', 'ｊ': 'j', 'ｋ': 'k', 'ｌ': 'l', 'ｍ': 'm', 'ｎ': 'n', 'ｏ': 'o', 'ｐ': 'p',
  'ｑ': 'q', 'ｒ': 'r', 'ｓ': 's', 'ｔ': 't', 'ｕ': 'u', 'ｖ': 'v', 'ｗ': 'w', 'ｘ': 'x',
  'ｙ': 'y', 'ｚ': 'z',
  // Accented characters
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'æ': 'ae',
  'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e',
  'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i',
  'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o',
  'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u',
  'ñ': 'n', 'ç': 'c', 'ß': 'ss',
  // Zero-width and invisible characters (strip them)
  '\u200B': '', '\u200C': '', '\u200D': '', '\uFEFF': '', '\u00AD': '',
};

// Normalize text for comparison - comprehensive normalization
function normalizeText(text: string): string {
  let result = text.toLowerCase();
  
  // Replace Unicode confusables with ASCII equivalents
  for (const [unicode, ascii] of Object.entries(UNICODE_CONFUSABLES)) {
    result = result.split(unicode).join(ascii);
  }
  
  // Leetspeak number substitutions
  const leetMap: Record<string, string> = {
    '0': 'o', '1': 'i', '2': 'z', '3': 'e', '4': 'a', '5': 's', 
    '6': 'g', '7': 't', '8': 'b', '9': 'g',
  };
  result = result.replace(/[0-9]/g, (char) => leetMap[char] || char);
  
  // Symbol substitutions
  result = result
    .replace(/[@]/g, 'a')
    .replace(/[$]/g, 's')
    .replace(/[!|ı]/g, 'i')
    .replace(/\+/g, 't')
    .replace(/&/g, 'and')
    .replace(/\(/g, 'c')
    .replace(/\)/g, '')
    .replace(/</g, 'c')
    .replace(/>/g, '')
    .replace(/\{/g, 'c')
    .replace(/\}/g, '')
    .replace(/\[/g, 'c')
    .replace(/\]/g, '');
  
  // Remove separators and special chars used to break up words
  result = result.replace(/[*_.\-~`'^"'""''«»‹›„‚•·°¨´¸¯˘˙˚˝˛ˇ]/g, '');
  
  // Remove emojis and other non-letter characters that might be used as separators
  result = result.replace(/[\u{1F300}-\u{1F9FF}]/gu, '');
  
  return result;
}

// Remove ALL spaces and separators to catch spaced-out words like "n i g g e r"
function removeAllSpacing(text: string): string {
  return text.replace(/\s+/g, '');
}

// Collapse ALL repeated characters to single (niggggger -> niger)
function collapseAllRepeats(text: string): string {
  return text.replace(/(.)\1+/g, '$1');
}

// Collapse to max 2 of same char (niggggger -> nigger)  
function collapseToDouble(text: string): string {
  return text.replace(/(.)\1{2,}/g, '$1$1');
}

// Generate core variations of a word for matching
function generateCorePatterns(word: string): string[] {
  const patterns: Set<string> = new Set();
  
  // Original
  patterns.add(word);
  
  // Fully collapsed (all repeats to single)
  const fullyCollapsed = collapseAllRepeats(word);
  patterns.add(fullyCollapsed);
  
  // Collapsed to double
  const doubleCollapsed = collapseToDouble(word);
  patterns.add(doubleCollapsed);
  
  // Without final 's' (niggers -> nigger)
  if (word.endsWith('s')) {
    patterns.add(word.slice(0, -1));
    patterns.add(collapseAllRepeats(word.slice(0, -1)));
  }
  
  // Common suffix variations
  const suffixVariations: [string, string][] = [
    ['er', 'a'], ['a', 'er'], ['ers', 'as'], ['as', 'ers'],
    ['ing', 'in'], ['in', 'ing'], ['ed', ''], ['s', ''],
  ];
  for (const [from, to] of suffixVariations) {
    if (word.endsWith(from)) {
      patterns.add(word.slice(0, -from.length) + to);
    }
  }
  
  return Array.from(patterns);
}

// Common phonetic substitutions that evaders use
const PHONETIC_SUBS: [string, string][] = [
  ['ck', 'k'], ['k', 'ck'],
  ['ph', 'f'], ['f', 'ph'],
  ['gh', 'g'], ['wh', 'w'],
  ['ee', 'i'], ['i', 'ee'],
  ['oo', 'u'], ['u', 'oo'],
  ['x', 'ks'], ['ks', 'x'],
  ['qu', 'kw'], ['kw', 'qu'],
];

// Apply all phonetic variations
function getPhoneticVariations(text: string): string[] {
  const variations: Set<string> = new Set([text]);
  
  for (const [from, to] of PHONETIC_SUBS) {
    if (text.includes(from)) {
      variations.add(text.replace(new RegExp(from, 'g'), to));
    }
  }
  
  return Array.from(variations);
}

// Check if text contains banned words - comprehensive check
function containsBannedWord(text: string): { hasBannedWord: boolean; word?: string } {
  // Create multiple normalized versions of input
  const normalized = normalizeText(text);
  const noSpaces = removeAllSpacing(normalized);
  const collapsed = collapseAllRepeats(noSpaces);
  const doubleCollapsed = collapseToDouble(noSpaces);
  
  // All versions of the input to check
  const inputVersions = new Set([
    normalized,
    noSpaces,
    collapsed,
    doubleCollapsed,
    // Also check with spaces normalized but not removed
    normalized.replace(/\s+/g, ' ').trim(),
  ]);
  
  // Add phonetic variations of each input version
  for (const version of Array.from(inputVersions)) {
    for (const phoneticVar of getPhoneticVariations(version)) {
      inputVersions.add(phoneticVar);
      inputVersions.add(collapseAllRepeats(phoneticVar));
    }
  }
  
  for (const bannedWord of BANNED_WORDS) {
    // Get all patterns for this banned word
    const normalizedBanned = normalizeText(bannedWord).replace(/\s+/g, '');
    const bannedPatterns = generateCorePatterns(normalizedBanned);
    
    // Add phonetic variations of each pattern
    const allPatterns: Set<string> = new Set();
    for (const pattern of bannedPatterns) {
      allPatterns.add(pattern);
      for (const phoneticVar of getPhoneticVariations(pattern)) {
        allPatterns.add(phoneticVar);
        allPatterns.add(collapseAllRepeats(phoneticVar));
      }
    }
    
    // Check each input version against each banned pattern
    for (const inputVersion of inputVersions) {
      for (const pattern of allPatterns) {
        if (!pattern || pattern.length < 2) continue;
        
        // Direct substring match (catches embedded slurs)
        if (inputVersion.includes(pattern)) {
          return { hasBannedWord: true, word: bannedWord };
        }
      }
    }
  }
  
  return { hasBannedWord: false };
}

// Render comment text with market mentions as links
function renderCommentText(text: string): React.ReactNode {
  // Match @SYMBOL patterns (uppercase letters, numbers, underscores, hyphens)
  const mentionRegex = /@([A-Z0-9_-]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = mentionRegex.exec(text)) !== null) {
    // Add text before the mention
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    
    // Add the mention as a link
    const symbol = match[1];
    parts.push(
      <a
        key={match.index}
        href={`/token/${symbol}`}
        className={styles.mentionLink}
        onClick={(e) => e.stopPropagation()}
      >
        @{symbol}
      </a>
    );
    
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

interface CommentItemProps {
  comment: Comment;
  currentUserId?: string;
  onLike?: (id: string) => void;
  onReply?: (id: string, text: string) => void;
  onDelete?: (id: string) => void;
  onReport?: (id: string) => void;
  depth?: number;
  currentUserAvatar?: string;
  currentUserName?: string;
  hasThreadLine?: boolean;
}

function CommentItem({
  comment,
  currentUserId,
  onLike,
  onReply,
  onDelete,
  onReport,
  depth = 0,
  currentUserAvatar,
  currentUserName,
  hasThreadLine = false,
}: CommentItemProps) {
  const [showReplies, setShowReplies] = useState(true);
  const [showReplyInput, setShowReplyInput] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [showMenu, setShowMenu] = useState(false);

  const isOwnComment = currentUserId?.toLowerCase() === comment.author.id?.toLowerCase();
  const hasReplies = comment.replies && comment.replies.length > 0;
  const isVerified = comment.author.badge === 'verified';

  const handleLike = () => {
    onLike?.(comment.id);
  };

  const handleSubmitReply = () => {
    if (replyText.trim()) {
      onReply?.(comment.id, replyText.trim());
      setReplyText('');
      setShowReplyInput(false);
    }
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = () => {
    setShowMenu(false);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    setIsDeleting(true);
    await onDelete?.(comment.id);
    setShowDeleteConfirm(false);
    setIsDeleting(false);
  };

  const cancelDelete = () => {
    setShowDeleteConfirm(false);
  };

  const handleReport = () => {
    setShowMenu(false);
    onReport?.(comment.id);
  };

  return (
    <div className={depth === 0 ? styles.commentItem : styles.replyItem}>
      <div className={styles.commentWrapper}>
        <div className={styles.avatarWrapper}>
          <div className={styles.avatar}>
            {comment.author.avatarUrl ? (
              <img src={comment.author.avatarUrl} alt="" className={styles.avatarImg} />
            ) : (
              getInitials(comment.author.name)
            )}
          </div>
          {hasThreadLine && <div className={styles.threadLine} />}
        </div>
        <div className={styles.commentContent}>
          <div className={styles.commentHeader}>
            <span className={styles.authorName}>{comment.author.name}</span>
            {isVerified && (
              <span className={styles.verifiedBadge}>
                <CheckIcon />
              </span>
            )}
            {comment.author.badge && comment.author.badge !== 'verified' && (
              <span className={`${styles.authorBadge} ${getBadgeClass(comment.author.badge)}`}>
                {getBadgeLabel(comment.author.badge)}
              </span>
            )}
            <span className={styles.dot} />
            <span className={styles.timestamp}>{formatTimestamp(comment.timestamp)}</span>
            {comment.isEdited && (
              <>
                <span className={styles.dot} />
                <span className={styles.editedLabel}>Edited</span>
              </>
            )}
          </div>
          {comment.text && <div className={styles.commentText}>{renderCommentText(comment.text)}</div>}
          {comment.images && comment.images.length > 0 && (
            <div className={styles.commentImages}>
              {comment.images.map((image) => (
                <div key={image.id} className={styles.commentImageWrapper}>
                  <img 
                    src={image.thumbnailUrl || image.url} 
                    alt={image.alt || 'Comment image'} 
                    className={styles.commentImage}
                    loading="lazy"
                  />
                  <button className={styles.imageZoomBtn} aria-label="View full size">
                    <ZoomIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className={styles.commentActions}>
            <button
              className={`${styles.actionBtn} ${comment.isLiked ? styles.actionBtnActive : ''}`}
              onClick={handleLike}
            >
              <ThumbsUpIcon filled={comment.isLiked} />
              {comment.likes > 0 && (
                <span className={comment.isLiked ? styles.likeCount : ''}>
                  {comment.likes} {comment.likes === 1 ? 'Like' : 'Likes'}
                </span>
              )}
            </button>
            <button className={styles.actionBtn} onClick={() => setShowReplyInput(!showReplyInput)}>
              <ReplyIcon />
              Reply
            </button>
            <div className={styles.menuWrapper}>
              <button
                className={styles.moreBtn}
                onClick={() => setShowMenu(!showMenu)}
                aria-label="More options"
              >
                <MoreHorizontalIcon />
              </button>
              {showMenu && (
                <div className={styles.menuDropdown}>
                  {isOwnComment && (
                    <button className={`${styles.menuItem} ${styles.menuItemDanger}`} onClick={handleDelete}>
                      <TrashIcon />
                      Delete
                    </button>
                  )}
                  {!isOwnComment && (
                    <button className={styles.menuItem} onClick={handleReport}>
                      <FlagIcon />
                      Report
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Inline Delete Confirmation */}
      {showDeleteConfirm && (
        <div className={styles.inlineDeleteConfirm}>
          <span className={styles.inlineDeleteText}>Delete this comment?</span>
          <div className={styles.inlineDeleteActions}>
            <button 
              className={styles.inlineDeleteCancel} 
              onClick={cancelDelete}
              disabled={isDeleting}
            >
              Cancel
            </button>
            <button 
              className={styles.inlineDeleteBtn} 
              onClick={confirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      )}

      {showReplyInput && (
        <div className={styles.replyInputWrapper}>
          <div className={styles.composeAvatar}>
            {currentUserAvatar ? (
              <img src={currentUserAvatar} alt="" className={styles.composeAvatarImg} />
            ) : (
              currentUserName ? getInitials(currentUserName) : '?'
            )}
          </div>
          <div className={styles.replyInputInner}>
            <textarea
              className={styles.replyInput}
              placeholder={`Reply to ${comment.author.name}...`}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              rows={1}
            />
            <div className={styles.replyActions}>
              <button className={styles.cancelBtn} onClick={() => setShowReplyInput(false)}>
                Cancel
              </button>
              <button
                className={styles.replySubmitBtn}
                onClick={handleSubmitReply}
                disabled={!replyText.trim()}
              >
                Reply
              </button>
            </div>
          </div>
        </div>
      )}

      {hasReplies && !showReplies && (
        <button className={styles.showRepliesBtn} onClick={() => setShowReplies(true)}>
          <ChevronRightIcon />
          Show {comment.replies!.length} {comment.replies!.length === 1 ? 'reply' : 'replies'}
        </button>
      )}

      {hasReplies && showReplies && (
        <div className={styles.repliesContainer}>
          {comment.replies!.map((reply, index) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              currentUserId={currentUserId}
              onLike={onLike}
              onReply={onReply}
              onDelete={onDelete}
              onReport={onReport}
              depth={depth + 1}
              currentUserAvatar={currentUserAvatar}
              currentUserName={currentUserName}
              hasThreadLine={index < comment.replies!.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Emoji categories for the picker
const EMOJI_CATEGORIES = [
  {
    name: 'Smileys',
    emojis: ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😋', '😎', '🤩', '🥳', '😏', '😒', '🙄', '😬', '😮', '😯', '😲', '😳', '🥺', '😢', '😭', '😤', '😡', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺'],
  },
  {
    name: 'Gestures',
    emojis: ['👍', '👎', '👊', '✊', '🤛', '🤜', '🤝', '👏', '🙌', '👐', '🤲', '🙏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤏', '✍️', '🦾', '💪', '🦵', '🦶', '👀', '👁️', '👅', '👄', '💋', '🧠', '🫀'],
  },
  {
    name: 'Hearts',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️'],
  },
  {
    name: 'Objects',
    emojis: ['🔥', '⭐', '🌟', '✨', '💫', '🎉', '🎊', '🎁', '🏆', '🥇', '🥈', '🥉', '🎯', '💰', '💵', '💎', '📈', '📉', '💹', '🚀', '✅', '❌', '⚠️', '🔔', '🔕', '💡', '🔑', '🔒', '🔓', '⏰', '⏳', '📱', '💻', '🖥️', '🎮', '🕹️', '🎲', '🎰', '🎭', '🎬'],
  },
  {
    name: 'Animals',
    emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦗', '🕷️', '🦂', '🐢'],
  },
];

export default function CommentSection({
  comments,
  totalCount,
  currentUser,
  sortBy = 'newest',
  onSortChange,
  onSubmitComment,
  onSubmitReply,
  onLikeComment,
  onDeleteComment,
  onReportComment,
  onLoadMore,
  hasMore,
  isLoading,
}: CommentSectionProps) {
  const [newComment, setNewComment] = useState('');
  const [pendingImages, setPendingImages] = useState<{ file: File; preview: string }[]>([]);
  const [moderationError, setModerationError] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStartIndex, setMentionStartIndex] = useState<number | null>(null);
  const [mentionResults, setMentionResults] = useState<Array<{ symbol: string; name: string; market_identifier: string }>>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const mentionPickerRef = useRef<HTMLDivElement>(null);

  const displayCount = totalCount ?? comments.length;

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newImages: { file: File; preview: string }[] = [];
    Array.from(files).forEach((file) => {
      if (file.type.startsWith('image/')) {
        const preview = URL.createObjectURL(file);
        newImages.push({ file, preview });
      }
    });

    setPendingImages((prev) => [...prev, ...newImages].slice(0, 4));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleRemoveImage = useCallback((index: number) => {
    setPendingImages((prev) => {
      const newImages = [...prev];
      URL.revokeObjectURL(newImages[index].preview);
      newImages.splice(index, 1);
      return newImages;
    });
  }, []);

  const handleEmojiSelect = useCallback((emoji: string) => {
    setNewComment((prev) => prev + emoji);
    setShowEmojiPicker(false);
    textareaRef.current?.focus();
  }, []);

  // Close emoji picker when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmojiPicker]);

  // Close mention picker when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (mentionPickerRef.current && !mentionPickerRef.current.contains(e.target as Node)) {
        setShowMentionPicker(false);
        setMentionQuery('');
        setMentionStartIndex(null);
      }
    };
    if (showMentionPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMentionPicker]);

  // Search markets when mention query changes
  React.useEffect(() => {
    if (!mentionQuery || mentionQuery.length < 1) {
      setMentionResults([]);
      return;
    }

    const searchMarkets = async () => {
      setMentionLoading(true);
      try {
        const response = await fetch(`/api/markets?search=${encodeURIComponent(mentionQuery)}&limit=8&status=ACTIVE`);
        if (response.ok) {
          const data = await response.json();
          setMentionResults(
            (data.markets || []).map((m: any) => ({
              symbol: m.symbol,
              name: m.name,
              market_identifier: m.market_identifier,
            }))
          );
        }
      } catch (err) {
        console.error('Error searching markets:', err);
      } finally {
        setMentionLoading(false);
      }
    };

    const debounce = setTimeout(searchMarkets, 150);
    return () => clearTimeout(debounce);
  }, [mentionQuery]);

  // Handle mention selection
  const handleMentionSelect = useCallback((market: { symbol: string; name: string; market_identifier: string }) => {
    if (mentionStartIndex === null) return;

    const before = newComment.slice(0, mentionStartIndex);
    const after = newComment.slice(mentionStartIndex + mentionQuery.length + 1); // +1 for @
    const mentionText = `@${market.symbol}`;
    
    setNewComment(before + mentionText + ' ' + after);
    setShowMentionPicker(false);
    setMentionQuery('');
    setMentionStartIndex(null);
    setSelectedMentionIndex(0);
    textareaRef.current?.focus();
  }, [mentionStartIndex, mentionQuery, newComment]);

  const handleCommentChange = useCallback((text: string) => {
    setNewComment(text);
    // Clear moderation error when user edits
    if (moderationError) {
      setModerationError(null);
    }

    // Check for @ mention trigger
    const textarea = textareaRef.current;
    if (textarea) {
      const cursorPos = textarea.selectionStart;
      const textBeforeCursor = text.slice(0, cursorPos);
      
      // Find the last @ symbol before cursor
      const lastAtIndex = textBeforeCursor.lastIndexOf('@');
      
      if (lastAtIndex !== -1) {
        // Check if @ is at start or preceded by whitespace
        const charBefore = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
        if (charBefore === ' ' || charBefore === '\n' || lastAtIndex === 0) {
          const query = textBeforeCursor.slice(lastAtIndex + 1);
          // Only show picker if query doesn't contain spaces (single word)
          if (!query.includes(' ')) {
            setMentionStartIndex(lastAtIndex);
            setMentionQuery(query);
            setShowMentionPicker(true);
            setSelectedMentionIndex(0);
            return;
          }
        }
      }
    }
    
    // No valid mention context
    setShowMentionPicker(false);
    setMentionQuery('');
    setMentionStartIndex(null);
  }, [moderationError]);

  const handleSubmit = useCallback(() => {
    if (newComment.trim() || pendingImages.length > 0) {
      // Check for banned content
      const moderationResult = containsBannedWord(newComment);
      if (moderationResult.hasBannedWord) {
        setModerationError('Your comment contains inappropriate language and cannot be posted.');
        return;
      }

      onSubmitComment?.(newComment.trim(), pendingImages.map((img) => img.file));
      setNewComment('');
      setModerationError(null);
      pendingImages.forEach((img) => URL.revokeObjectURL(img.preview));
      setPendingImages([]);
    }
  }, [newComment, pendingImages, onSubmitComment]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Handle mention picker navigation
      if (showMentionPicker && mentionResults.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedMentionIndex((prev) => (prev + 1) % mentionResults.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedMentionIndex((prev) => (prev - 1 + mentionResults.length) % mentionResults.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          handleMentionSelect(mentionResults[selectedMentionIndex]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowMentionPicker(false);
          setMentionQuery('');
          setMentionStartIndex(null);
          return;
        }
      }

      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, showMentionPicker, mentionResults, selectedMentionIndex, handleMentionSelect]
  );

  return (
    <div className={styles.container}>
      {/* Compose Area */}
      <div className={styles.composeArea}>
        <div className={styles.composeInputWrapper}>
          <div className={styles.textareaWrapper}>
            <textarea
              ref={textareaRef}
              className={`${styles.composeInput} ${moderationError ? styles.composeInputError : ''}`}
              placeholder="Add comment — Use @ to mention markets"
              value={newComment}
              onChange={(e) => handleCommentChange(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {/* Market Mention Picker */}
            {showMentionPicker && (
              <div className={styles.mentionPicker} ref={mentionPickerRef}>
                <div className={styles.mentionPickerHeader}>
                  <span className={styles.mentionPickerTitle}>Markets</span>
                  {mentionQuery && (
                    <span className={styles.mentionPickerQuery}>@{mentionQuery}</span>
                  )}
                </div>
                <div className={styles.mentionPickerContent}>
                  {mentionLoading && (
                    <div className={styles.mentionLoading}>Searching...</div>
                  )}
                  {!mentionLoading && mentionResults.length === 0 && mentionQuery && (
                    <div className={styles.mentionEmpty}>No markets found</div>
                  )}
                  {!mentionLoading && mentionResults.length === 0 && !mentionQuery && (
                    <div className={styles.mentionHint}>Type to search markets...</div>
                  )}
                  {mentionResults.map((market, index) => (
                    <button
                      key={market.market_identifier}
                      className={`${styles.mentionItem} ${index === selectedMentionIndex ? styles.mentionItemSelected : ''}`}
                      onClick={() => handleMentionSelect(market)}
                      onMouseEnter={() => setSelectedMentionIndex(index)}
                    >
                      <span className={styles.mentionSymbol}>{market.symbol}</span>
                      <span className={styles.mentionName}>{market.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {/* Moderation Error */}
          {moderationError && (
            <div className={styles.moderationError}>
              <WarningIcon />
              <span>{moderationError}</span>
            </div>
          )}
          {/* Image Previews */}
          {pendingImages.length > 0 && (
            <div className={styles.imagePreviews}>
              {pendingImages.map((img, index) => (
                <div key={index} className={styles.imagePreviewWrapper}>
                  <img src={img.preview} alt="Preview" className={styles.imagePreview} />
                  <button
                    className={styles.imageRemoveBtn}
                    onClick={() => handleRemoveImage(index)}
                    aria-label="Remove image"
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
              {pendingImages.length < 4 && (
                <button
                  className={styles.addMoreImagesBtn}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Add more images"
                >
                  <ImageIcon />
                  <span>Add</span>
                </button>
              )}
            </div>
          )}
          <div className={styles.composeActions}>
            <div className={styles.composeTools}>
              <button 
                className={`${styles.toolBtn} ${pendingImages.length > 0 ? styles.toolBtnActive : ''}`} 
                aria-label="Add image"
                onClick={() => fileInputRef.current?.click()}
              >
                <ImageIcon />
              </button>
              <div className={styles.emojiPickerWrapper} ref={emojiPickerRef}>
                <button 
                  className={`${styles.toolBtn} ${showEmojiPicker ? styles.toolBtnActive : ''}`} 
                  aria-label="Add emoji"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                >
                  <EmojiIcon />
                </button>
                {showEmojiPicker && (
                  <div className={styles.emojiPicker}>
                    <div className={styles.emojiPickerHeader}>
                      <span className={styles.emojiPickerTitle}>Emoji</span>
                    </div>
                    <div className={styles.emojiPickerContent}>
                      {EMOJI_CATEGORIES.map((category) => (
                        <div key={category.name} className={styles.emojiCategory}>
                          <span className={styles.emojiCategoryName}>{category.name}</span>
                          <div className={styles.emojiGrid}>
                            {category.emojis.map((emoji) => (
                              <button
                                key={emoji}
                                className={styles.emojiBtn}
                                onClick={() => handleEmojiSelect(emoji)}
                                type="button"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <button
              className={styles.submitBtn}
              onClick={handleSubmit}
              disabled={(!newComment.trim() && pendingImages.length === 0) || isLoading}
            >
              Comment
            </button>
          </div>
        </div>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleImageSelect}
          className={styles.hiddenInput}
        />
      </div>

      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h2 className={styles.title}>Comments</h2>
          <span className={styles.commentCount}>{displayCount}</span>
        </div>
        <div className={styles.headerRight}>
          <button
            className={`${styles.filterOption} ${sortBy === 'top' ? '' : ''}`}
            onClick={() => onSortChange?.('top')}
          >
            All
          </button>
          <span className={styles.filterDivider}>|</span>
          <button
            className={`${styles.sortBtn}`}
            onClick={() => onSortChange?.(sortBy === 'newest' ? 'oldest' : 'newest')}
          >
            Most recent
            <SortIcon />
          </button>
        </div>
      </div>

      {/* Comments List */}
      <div className={styles.commentsList}>
        {comments.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <CommentsIcon />
            </div>
            <div className={styles.emptyTitle}>No comments yet</div>
            <div className={styles.emptyDescription}>Be the first to share your thoughts</div>
          </div>
        ) : (
          comments.map((comment, index) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              currentUserId={currentUser?.id}
              onLike={onLikeComment}
              onReply={onSubmitReply}
              onDelete={onDeleteComment}
              onReport={onReportComment}
              currentUserAvatar={currentUser?.avatarUrl}
              currentUserName={currentUser?.name}
              hasThreadLine={comment.replies && comment.replies.length > 0}
            />
          ))
        )}
      </div>

      {/* Load More */}
      {hasMore && (
        <div className={styles.loadMore}>
          <button className={styles.loadMoreBtn} onClick={onLoadMore} disabled={isLoading}>
            {isLoading ? 'Loading...' : 'Load more comments'}
          </button>
        </div>
      )}
    </div>
  );
}

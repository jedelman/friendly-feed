<script lang="ts">
  import type { PreviewPost } from '$lib/types'

  let {
    post,
    signal,
    onvote,
    compact = false,
  }: {
    post: PreviewPost
    signal?: 1 | -1
    onvote?: (sig: 1 | -1) => void
    compact?: boolean
  } = $props()

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60_000)
    if (mins < 1)  return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24)  return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'ArrowUp'   || e.key === 'j') onvote?.(1)
    if (e.key === 'ArrowDown' || e.key === 'k') onvote?.(-1)
  }
</script>

<div
  class="post-card"
  class:voted-up={signal === 1}
  class:voted-down={signal === -1}
  class:compact
  role="article"
  tabindex="0"
  onkeydown={handleKey}
>
  <div class="post-author">
    {#if post.authorAvatar}
      <img class="avatar" src={post.authorAvatar} alt={post.authorHandle} />
    {:else}
      <div class="avatar placeholder">{post.authorHandle[0]?.toUpperCase()}</div>
    {/if}
    <div>
      {#if post.authorDisplayName}
        <span class="display-name">{post.authorDisplayName}</span>
      {/if}
      <span class="handle text-dim">@{post.authorHandle}</span>
    </div>
    <span class="time text-dim ml-auto">{relativeTime(post.indexedAt)}</span>
  </div>

  <p class="post-text">{post.text}</p>

  {#if !compact && (post.likeCount !== undefined || post.replyCount !== undefined)}
    <div class="post-stats text-dim">
      {#if post.replyCount !== undefined}
        <span>↩ {post.replyCount}</span>
      {/if}
      {#if post.likeCount !== undefined}
        <span>♥ {post.likeCount}</span>
      {/if}
    </div>
  {/if}

  {#if onvote}
    <div class="vote-bar">
      <button
        class="vote-btn up"
        class:active={signal === 1}
        onclick={() => onvote(1)}
        aria-label="Thumbs up"
        title="Good match (J)"
      >
        👍
      </button>
      <button
        class="vote-btn down"
        class:active={signal === -1}
        onclick={() => onvote(-1)}
        aria-label="Thumbs down"
        title="Bad match (K)"
      >
        👎
      </button>
    </div>
  {/if}
</div>

<style>
  .post-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px 18px;
    transition: border-color 0.2s;
    outline: none;
  }

  .post-card:focus-visible { border-color: var(--accent); }
  .post-card.voted-up   { border-color: var(--green); background: rgba(34, 197, 94, 0.04); }
  .post-card.voted-down { border-color: var(--red);   background: rgba(239, 68, 68, 0.04); opacity: 0.65; }

  .post-author {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .avatar.placeholder {
    background: var(--surface2);
    border: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text2);
  }

  .display-name {
    font-size: 0.88rem;
    font-weight: 600;
    margin-right: 4px;
  }

  .handle { font-size: 0.82rem; }
  .time   { font-size: 0.78rem; }

  .post-text {
    font-size: 0.92rem;
    line-height: 1.55;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-word;
    margin-bottom: 0;
  }

  .post-stats {
    margin-top: 10px;
    display: flex;
    gap: 14px;
    font-size: 0.8rem;
  }

  .vote-bar {
    display: flex;
    gap: 8px;
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }

  .vote-btn {
    flex: 1;
    padding: 8px;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 1.1rem;
    transition: all 0.15s;
    opacity: 0.55;
  }

  .vote-btn:hover { opacity: 1; }
  .vote-btn.active { opacity: 1; }
  .vote-btn.up.active  { background: var(--green-dim); border-color: var(--green); }
  .vote-btn.down.active { background: var(--red-dim); border-color: var(--red); }
</style>

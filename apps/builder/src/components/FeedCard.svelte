<script lang="ts">
  import type { FeedConfig } from '$lib/types'

  let { feed, onclick }: { feed: FeedConfig; onclick?: () => void } = $props()

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
</script>

<button class="feed-card" {onclick}>
  <div class="feed-header">
    <div>
      <div class="feed-name">{feed.name}</div>
      {#if feed.description}
        <div class="feed-desc">{feed.description}</div>
      {/if}
    </div>
    <span class="badge {feed.active ? 'badge-green' : 'badge-muted'}">
      {feed.active ? 'Active' : 'Paused'}
    </span>
  </div>

  <div class="feed-meta">
    <span>{feed.terms.length} terms</span>
    {#if feed.seedAccounts.length > 0}
      <span>· {feed.seedAccounts.length} seed{feed.seedAccounts.length !== 1 ? 's' : ''}</span>
    {/if}
    <span class="ml-auto">Created {formatDate(feed.createdAt)}</span>
  </div>
</button>

<style>
  .feed-card {
    display: block;
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 18px 20px;
    cursor: pointer;
    text-align: left;
    font: inherit;
    color: inherit;
    transition: border-color 0.15s, background 0.15s;
  }

  .feed-card:hover {
    border-color: var(--border2);
    background: var(--surface2);
  }

  .feed-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .feed-name {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 3px;
  }

  .feed-desc {
    font-size: 0.85rem;
    color: var(--text2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 500px;
  }

  .feed-meta {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.8rem;
    color: var(--text3);
  }
</style>

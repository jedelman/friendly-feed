<script lang="ts">
  import { session } from '../stores/session'
  import { creation } from '../stores/creation'
  import { listFeeds, updateFeed, deleteFeed } from '$lib/api'
  import type { FeedConfig } from '$lib/types'
  import FeedCard from '../components/FeedCard.svelte'
  import TermPill from '../components/TermPill.svelte'
  import Spinner from '../components/Spinner.svelte'

  let feeds = $state<FeedConfig[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)
  let selectedFeed = $state<FeedConfig | null>(null)
  let deleting = $state(false)
  let toggling = $state(false)

  $effect(() => {
    if ($session) load()
  })

  async function load() {
    if (!$session) return
    loading = true
    error = null
    try {
      feeds = await listFeeds($session.did)
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load feeds.'
    } finally {
      loading = false
    }
  }

  function openFeed(feed: FeedConfig) {
    selectedFeed = { ...feed }
  }

  function closeFeed() {
    selectedFeed = null
  }

  async function toggleActive() {
    if (!selectedFeed) return
    toggling = true
    try {
      await updateFeed(selectedFeed.feedId, { active: !selectedFeed.active })
      const updated = { ...selectedFeed, active: !selectedFeed.active }
      selectedFeed = updated
      feeds = feeds.map(f => f.feedId === updated.feedId ? updated : f)
    } finally {
      toggling = false
    }
  }

  async function doDelete() {
    if (!selectedFeed || !confirm(`Delete "${selectedFeed.name}"? This cannot be undone.`)) return
    deleting = true
    try {
      await deleteFeed(selectedFeed.feedId)
      feeds = feeds.filter(f => f.feedId !== selectedFeed!.feedId)
      selectedFeed = null
    } finally {
      deleting = false
    }
  }

  function newFeed() {
    creation.reset()
    window.location.hash = '#/create'
  }

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  }

  const bskyFeedUrl = $derived(
    selectedFeed
      ? `https://bsky.app/profile/${$session?.did}/feed/${selectedFeed.feedId}`
      : null
  )
</script>

<div class="page">
  <div class="container">

    <div class="page-header">
      <div>
        <h1>My Feeds</h1>
        {#if $session}
          <p class="text-muted">Signed in as <span class="mono">@{$session.handle}</span></p>
        {/if}
      </div>
      <button class="btn btn-primary" onclick={newFeed}>+ New Feed</button>
    </div>

    {#if loading}
      <div class="loading-state">
        <Spinner size={24} />
        <span>Loading your feeds…</span>
      </div>
    {:else if error}
      <div class="card" style="text-align:center; padding:32px;">
        <p style="color:var(--red); margin-bottom:16px;">{error}</p>
        <button class="btn btn-secondary" onclick={load}>Retry</button>
      </div>
    {:else if feeds.length === 0}
      <div class="empty fade-in">
        <div class="empty-icon">◌</div>
        <p>No feeds yet.</p>
        <p style="margin-top:4px">Describe what you want to read and we'll build it.</p>
        <button class="btn btn-primary" style="margin-top:20px" onclick={newFeed}>
          Create your first feed
        </button>
      </div>
    {:else}
      <div class="feeds-list fade-in">
        {#each feeds as feed}
          <FeedCard {feed} onclick={() => openFeed(feed)} />
        {/each}
      </div>
    {/if}

  </div>
</div>

<!-- ── Feed detail drawer ── -->
{#if selectedFeed}
  <div class="overlay" role="presentation" onclick={closeFeed}></div>
  <aside class="drawer fade-in">
    <div class="drawer-header">
      <div>
        <h2>{selectedFeed.name}</h2>
        <span class="badge {selectedFeed.active ? 'badge-green' : 'badge-muted'}">
          {selectedFeed.active ? 'Active' : 'Paused'}
        </span>
      </div>
      <button class="btn-icon" onclick={closeFeed}>×</button>
    </div>

    <div class="drawer-body">
      {#if selectedFeed.intentText}
        <section>
          <div class="label">Original intent</div>
          <p class="intent-text">"{selectedFeed.intentText}"</p>
        </section>
      {/if}

      <div class="divider"></div>

      <section>
        <div class="label">Include terms</div>
        <div class="pills-row">
          {#each selectedFeed.terms as term}
            <TermPill {term} variant="include" />
          {/each}
        </div>
      </section>

      {#if selectedFeed.excludeTerms.length > 0}
        <section>
          <div class="label">Exclude terms</div>
          <div class="pills-row">
            {#each selectedFeed.excludeTerms as term}
              <TermPill {term} variant="exclude" />
            {/each}
          </div>
        </section>
      {/if}

      {#if selectedFeed.seedAccounts.length > 0}
        <section>
          <div class="label">Seed accounts</div>
          <p class="text-sm text-dim">{selectedFeed.seedAccounts.length} prioritized account{selectedFeed.seedAccounts.length !== 1 ? 's' : ''}</p>
        </section>
      {/if}

      <div class="divider"></div>

      <section class="meta-section">
        <div class="meta-row">
          <span class="text-dim text-sm">Created</span>
          <span class="text-sm">{formatDate(selectedFeed.createdAt)}</span>
        </div>
        <div class="meta-row">
          <span class="text-dim text-sm">Last updated</span>
          <span class="text-sm">{formatDate(selectedFeed.updatedAt)}</span>
        </div>
        <div class="meta-row">
          <span class="text-dim text-sm">Tier at creation</span>
          <span class="badge badge-{selectedFeed.tierAtCreation === 'free' ? 'muted' : selectedFeed.tierAtCreation === 'pro' ? 'accent' : 'amber'}">
            {selectedFeed.tierAtCreation}
          </span>
        </div>
      </section>

      {#if bskyFeedUrl}
        <a
          class="btn btn-secondary"
          style="display:flex; justify-content:center; margin-top:8px;"
          href={bskyFeedUrl}
          target="_blank"
          rel="noreferrer"
        >
          View on Bluesky ↗
        </a>
      {/if}
    </div>

    <div class="drawer-footer">
      <button
        class="btn btn-secondary"
        onclick={toggleActive}
        disabled={toggling}
      >
        {#if toggling}
          <Spinner size={14} />
        {:else}
          {selectedFeed.active ? 'Pause feed' : 'Resume feed'}
        {/if}
      </button>
      <button
        class="btn btn-danger"
        onclick={doDelete}
        disabled={deleting}
      >
        {#if deleting}<Spinner size={14} />{/if}
        Delete
      </button>
    </div>
  </aside>
{/if}

<style>
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 28px;
    gap: 16px;
  }

  .page-header h1 { margin-bottom: 4px; }

  .loading-state {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 48px 0;
    color: var(--text2);
    font-size: 0.95rem;
  }

  .feeds-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* Drawer */
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 200;
  }

  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(440px, 100vw);
    background: var(--surface);
    border-left: 1px solid var(--border);
    z-index: 300;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .drawer-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 20px 24px 16px;
    border-bottom: 1px solid var(--border);
    gap: 12px;
  }

  .drawer-header h2 { margin-bottom: 8px; }

  .drawer-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  section { display: flex; flex-direction: column; gap: 10px; }

  .intent-text {
    font-size: 0.9rem;
    font-style: italic;
    line-height: 1.6;
    color: var(--text2);
  }

  .pills-row {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }

  .meta-section { display: flex; flex-direction: column; gap: 10px; }

  .meta-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .drawer-footer {
    padding: 16px 24px;
    border-top: 1px solid var(--border);
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }
</style>

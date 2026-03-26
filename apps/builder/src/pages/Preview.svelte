<script lang="ts">
  import { session } from '../stores/session'
  import { creation } from '../stores/creation'
  import { previewFeed, createFeed, recordHitl } from '$lib/api'
  import PostCard from '../components/PostCard.svelte'
  import Spinner from '../components/Spinner.svelte'

  const MIN_VOTES_TO_PUBLISH = 8

  let loading = $state(true)
  let publishing = $state(false)
  let error = $state<string | null>(null)

  const state = $derived($creation)

  const votes = $derived(state.hitlVotes)
  const upCount   = $derived([...votes.values()].filter(v => v === 1).length)
  const downCount = $derived([...votes.values()].filter(v => v === -1).length)
  const totalVotes = $derived(upCount + downCount)
  const canPublish = $derived(totalVotes >= MIN_VOTES_TO_PUBLISH)

  // Load preview posts on mount
  $effect(() => {
    if (state.step === 'preview' && state.previewPosts.length > 0) {
      loading = false
      return
    }
    loadPosts()
  })

  async function loadPosts() {
    loading = true
    error = null
    try {
      const posts = await previewFeed({
        terms: state.editedTerms,
        excludeTerms: state.editedExcludeTerms,
        seedAccounts: state.editedSeedAccounts.map(s => s.did),
      })
      creation.setPreviewPosts(posts)
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load preview posts.'
    } finally {
      loading = false
    }
  }

  function vote(uri: string, signal: 1 | -1) {
    const current = votes.get(uri)
    if (current === signal) {
      creation.unvote(uri)    // toggle off
    } else {
      creation.vote(uri, signal)
    }
  }

  async function publish() {
    if (!$session || publishing) return
    publishing = true
    error = null

    try {
      // Flush all HITL votes to D1 (fire-and-forget, don't block publish)
      const hitlWrites = [...votes.entries()].map(([uri, signal]) =>
        recordHitl('pending', uri, signal, 'creation').catch(() => {})
      )

      // Create the feed config in D1
      const { feedId } = await createFeed({
        ownerDid: $session.did,
        name: state.feedName || 'My Feed',
        description: state.intentText.slice(0, 200),
        intentText: state.intentText,
        terms: state.editedTerms,
        excludeTerms: state.editedExcludeTerms,
        seedAccounts: state.editedSeedAccounts.map(s => s.did),
      })

      // Back-fill HITL with real feedId
      await Promise.allSettled([
        ...hitlWrites,
        ...[...votes.entries()].map(([uri, signal]) =>
          recordHitl(feedId, uri, signal, 'creation').catch(() => {})
        ),
      ])

      creation.setPublished(feedId)
    } catch (e) {
      error = e instanceof Error ? e.message : 'Publish failed. Please try again.'
    } finally {
      publishing = false
    }
  }

  // Keyboard shortcuts: J = thumbs up, K = thumbs down for focused card
  let focusedIndex = $state(0)

  function onKeydown(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest('input, textarea, button')) return
    const posts = state.previewPosts
    if (e.key === 'j' || e.key === 'J') {
      vote(posts[focusedIndex]?.uri, 1)
      focusedIndex = Math.min(focusedIndex + 1, posts.length - 1)
    }
    if (e.key === 'k' || e.key === 'K') {
      vote(posts[focusedIndex]?.uri, -1)
      focusedIndex = Math.min(focusedIndex + 1, posts.length - 1)
    }
    if (e.key === 'ArrowDown') focusedIndex = Math.min(focusedIndex + 1, posts.length - 1)
    if (e.key === 'ArrowUp')   focusedIndex = Math.max(focusedIndex - 1, 0)
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="page">
  <div class="container">

    {#if state.step === 'done'}
      <!-- ── Published! ── -->
      <div class="done-state fade-in">
        <div class="done-icon">✓</div>
        <h1>Your feed is live!</h1>
        <p>
          <strong>{state.feedName || 'Your feed'}</strong> is now indexing posts.
          It typically appears in Bluesky within a few minutes after you pin it to your home screen.
        </p>
        <div class="feed-id mono text-dim">{state.publishedFeedId}</div>
        <div class="done-actions">
          <button
            class="btn btn-primary btn-lg"
            onclick={() => { window.location.hash = '#/dashboard' }}
          >
            View my feeds →
          </button>
          <button
            class="btn btn-ghost"
            onclick={() => { creation.reset(); window.location.hash = '#/create' }}
          >
            Create another
          </button>
        </div>
      </div>

    {:else}
      <!-- ── HITL Preview ── -->
      <div class="preview-header">
        <div>
          <div class="step-badge">Step 3 of 3</div>
          <h1>Does this look right?</h1>
          <p>These are real recent posts that match your config. Rate them to tune the feed before publishing.</p>
        </div>

        <div class="vote-tally">
          <span class="tally-up">👍 {upCount}</span>
          <span class="tally-sep">/</span>
          <span class="tally-down">👎 {downCount}</span>
        </div>
      </div>

      <div class="keyboard-hint">
        <kbd>J</kbd> good match &nbsp;&nbsp;
        <kbd>K</kbd> bad match &nbsp;&nbsp;
        <kbd>↑↓</kbd> navigate
      </div>

      {#if loading}
        <div class="loading-state">
          <Spinner size={28} />
          <span>Loading sample posts from OpenSearch…</span>
        </div>
      {:else if error}
        <div class="card" style="text-align:center; padding:32px;">
          <p style="color:var(--red); margin-bottom:16px;">{error}</p>
          <button class="btn btn-secondary" onclick={loadPosts}>Try again</button>
        </div>
      {:else if state.previewPosts.length === 0}
        <div class="empty">
          <div class="empty-icon">◌</div>
          <p>No recent posts matched these terms.</p>
          <p style="margin-top:8px">
            <button class="btn btn-ghost btn-sm" onclick={() => { window.location.hash = '#/create' }}>
              ← Edit config
            </button>
          </p>
        </div>
      {:else}
        <div class="posts-list">
          {#each state.previewPosts as post, i}
            <div class:focused-card={i === focusedIndex}>
              <PostCard
                {post}
                signal={votes.get(post.uri)}
                onvote={(sig) => vote(post.uri, sig)}
              />
            </div>
          {/each}
        </div>
      {/if}

      <div class="publish-bar">
        <div class="publish-hint">
          {#if !canPublish}
            Rate {MIN_VOTES_TO_PUBLISH - totalVotes} more post{MIN_VOTES_TO_PUBLISH - totalVotes !== 1 ? 's' : ''} to unlock publish
          {:else}
            Ready to go! ({upCount} good, {downCount} filtered)
          {/if}
        </div>

        <div class="publish-actions">
          <button
            class="btn btn-ghost"
            onclick={() => { window.location.hash = '#/create' }}
            disabled={publishing}
          >
            ← Edit config
          </button>
          <button
            class="btn btn-primary btn-lg"
            onclick={publish}
            disabled={!canPublish || publishing}
          >
            {#if publishing}
              <Spinner size={16} color="#fff" /> Publishing…
            {:else}
              Publish feed
            {/if}
          </button>
        </div>

        {#if error}
          <p class="error-msg">{error}</p>
        {/if}
      </div>
    {/if}

  </div>
</div>

<style>
  .step-badge {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin-bottom: 6px;
  }

  .preview-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 24px;
    margin-bottom: 20px;
  }

  .preview-header h1 { margin: 8px 0 10px; }

  .vote-tally {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px 20px;
    font-size: 1.2rem;
    font-weight: 700;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .tally-up   { color: var(--green); }
  .tally-sep  { color: var(--text3); }
  .tally-down { color: var(--red); }

  .keyboard-hint {
    font-size: 0.78rem;
    color: var(--text3);
    margin-bottom: 18px;
  }

  kbd {
    display: inline-block;
    padding: 1px 6px;
    background: var(--surface2);
    border: 1px solid var(--border2);
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--text2);
  }

  .loading-state {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 48px 0;
    color: var(--text2);
    font-size: 0.95rem;
  }

  .posts-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 100px;
  }

  .focused-card :global(.post-card) { border-color: var(--border2); }

  .publish-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: rgba(13, 13, 13, 0.92);
    backdrop-filter: blur(12px);
    border-top: 1px solid var(--border);
    padding: 16px 20px;
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .publish-hint {
    font-size: 0.85rem;
    color: var(--text2);
    flex: 1;
  }

  .publish-actions {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .error-msg { font-size: 0.85rem; color: var(--red); }

  /* Done state */
  .done-state {
    max-width: 480px;
    margin: 80px auto;
    text-align: center;
  }

  .done-icon {
    width: 64px;
    height: 64px;
    background: var(--green-dim);
    border: 1px solid var(--green);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.8rem;
    color: var(--green);
    margin: 0 auto 24px;
  }

  .done-state h1 { margin-bottom: 14px; }

  .feed-id {
    margin: 16px 0 32px;
    font-size: 0.78rem;
    word-break: break-all;
  }

  .done-actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: center;
  }
</style>

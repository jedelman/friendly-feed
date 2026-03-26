<script lang="ts">
  import { getAdminStats, getReviewQueue, approveReview, rejectReview } from '$lib/api'
  import type { AdminStats, ReviewQueueItem } from '$lib/types'
  import Spinner from '../components/Spinner.svelte'

  const STORAGE_KEY = 'ff_admin_token'

  let token = $state(localStorage.getItem(STORAGE_KEY) ?? '')
  let tokenInput = $state('')
  let authenticated = $state(!!token)

  let stats = $state<AdminStats | null>(null)
  let queue = $state<ReviewQueueItem[]>([])
  let loading = $state(false)
  let authError = $state<string | null>(null)
  let lastRefresh = $state<Date | null>(null)

  async function authenticate() {
    const t = tokenInput.trim()
    if (!t) return
    authError = null
    loading = true
    try {
      const s = await getAdminStats(t)
      stats = s
      token = t
      localStorage.setItem(STORAGE_KEY, t)
      authenticated = true
      queue = await getReviewQueue(t)
      lastRefresh = new Date()
    } catch {
      authError = 'Invalid admin token.'
    } finally {
      loading = false
    }
  }

  async function refresh() {
    if (!token) return
    loading = true
    try {
      ;[stats, queue] = await Promise.all([getAdminStats(token), getReviewQueue(token)])
      lastRefresh = new Date()
    } finally {
      loading = false
    }
  }

  function signOut() {
    localStorage.removeItem(STORAGE_KEY)
    token = ''
    tokenInput = ''
    stats = null
    queue = []
    authenticated = false
  }

  async function approve(id: number) {
    await approveReview(id, token)
    queue = queue.filter(i => i.id !== id)
  }

  async function reject(id: number) {
    await rejectReview(id, token)
    queue = queue.filter(i => i.id !== id)
  }

  function onEnter(e: KeyboardEvent) {
    if (e.key === 'Enter') authenticate()
  }

  function formatNum(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K'
    return n.toString()
  }

  function formatDate(ts: number) {
    return new Date(ts).toLocaleString()
  }

  // Bar chart: normalize daily views
  const maxDailyViews = $derived(
    stats ? Math.max(...(stats.dailyViews?.map(d => d.views) ?? [1]), 1) : 1
  )

  $effect(() => {
    if (token && !stats) refresh()
  })
</script>

<div class="page">
  <div class="container">

    {#if !authenticated}
      <!-- ── Auth gate ── -->
      <div class="auth-gate fade-in">
        <div class="auth-icon">🔒</div>
        <h1>Admin Dashboard</h1>
        <p>Enter your admin token to access ecosystem metrics.</p>

        <div class="auth-form card">
          <div class="field">
            <label class="label" for="token-input">Admin token</label>
            <input
              id="token-input"
              class="input mono"
              type="password"
              placeholder="Bearer token"
              bind:value={tokenInput}
              onkeydown={onEnter}
            />
          </div>
          {#if authError}
            <p style="color:var(--red); font-size:0.85rem; margin-bottom:12px;">{authError}</p>
          {/if}
          <button
            class="btn btn-primary"
            onclick={authenticate}
            disabled={loading || !tokenInput.trim()}
          >
            {#if loading}<Spinner size={16} color="#fff" />{/if}
            Authenticate
          </button>
        </div>
      </div>

    {:else}
      <!-- ── Dashboard ── -->
      <div class="admin-header">
        <div>
          <h1>Admin Dashboard</h1>
          {#if lastRefresh}
            <p class="text-dim text-sm">Last updated {lastRefresh.toLocaleTimeString()}</p>
          {/if}
        </div>
        <div class="flex gap-8 items-center">
          <button class="btn btn-secondary btn-sm" onclick={refresh} disabled={loading}>
            {#if loading}<Spinner size={13} />{:else}↻{/if}
            Refresh
          </button>
          <button class="btn btn-ghost btn-sm" onclick={signOut}>Sign out</button>
        </div>
      </div>

      {#if stats}
        <!-- ── Stats grid ── -->
        <div class="stat-grid fade-in">
          <div class="stat-card">
            <div class="stat-value">{formatNum(stats.totalUsers)}</div>
            <div class="stat-label">Total Users</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{formatNum(stats.activeFeeds)}</div>
            <div class="stat-label">Active Feeds</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{formatNum(stats.postsIndexedToday)}</div>
            <div class="stat-label">Posts Today</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{formatNum(stats.postsIndexedWeek)}</div>
            <div class="stat-label">Posts This Week</div>
          </div>
          {#if stats.opensearchDocCount !== null}
            <div class="stat-card">
              <div class="stat-value">{formatNum(stats.opensearchDocCount)}</div>
              <div class="stat-label">OpenSearch Docs</div>
            </div>
          {/if}
          <div class="stat-card">
            <div class="stat-value">{stats.reviewQueueSize}</div>
            <div class="stat-label">Review Queue</div>
          </div>
        </div>

        <!-- ── Tier breakdown ── -->
        <div class="card fade-in" style="margin-top:24px">
          <h3 style="margin-bottom:16px">Users by Tier</h3>
          <div class="tier-bars">
            {#each [['Free', stats.usersByTier.free, 'var(--text3)'], ['Pro', stats.usersByTier.pro, 'var(--accent)'], ['Studio', stats.usersByTier.studio, 'var(--amber)']] as [label, count, color]}
              {@const pct = stats.totalUsers > 0 ? (count as number / stats.totalUsers) * 100 : 0}
              <div class="tier-row">
                <span class="tier-label">{label}</span>
                <div class="tier-bar-track">
                  <div
                    class="tier-bar-fill"
                    style:width="{pct}%"
                    style:background={color}
                  ></div>
                </div>
                <span class="tier-count">{count}</span>
              </div>
            {/each}
          </div>
        </div>

        <!-- ── Daily views chart ── -->
        {#if stats.dailyViews?.length > 0}
          <div class="card fade-in" style="margin-top:16px">
            <h3 style="margin-bottom:16px">Daily Views (last 7 days)</h3>
            <div class="bar-chart">
              {#each stats.dailyViews as day}
                <div class="bar-col">
                  <div class="bar-value">{formatNum(day.views)}</div>
                  <div
                    class="bar"
                    style:height="{Math.max(4, (day.views / maxDailyViews) * 120)}px"
                  ></div>
                  <div class="bar-label">{day.day.slice(5)}</div>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- ── Indexer health ── -->
        <div class="card fade-in" style="margin-top:16px">
          <h3 style="margin-bottom:12px">Indexer Health</h3>
          <div class="flex items-center gap-8">
            {#if stats.indexerLastSeen}
              {@const seenMs = Date.now() - new Date(stats.indexerLastSeen).getTime()}
              {@const healthy = seenMs < 5 * 60_000}
              <span class="indicator {healthy ? 'green' : 'red'}"></span>
              <span class="text-sm">
                {healthy ? 'Healthy' : 'Stale'} — last heartbeat {Math.floor(seenMs / 1000)}s ago
              </span>
            {:else}
              <span class="indicator red"></span>
              <span class="text-sm text-dim">No heartbeat received</span>
            {/if}
          </div>
        </div>
      {/if}

      <!-- ── Review queue ── -->
      {#if queue.length > 0}
        <div style="margin-top:24px" class="fade-in">
          <h2 style="margin-bottom:16px">Review Queue <span class="badge badge-amber">{queue.length}</span></h2>
          <div style="display:flex; flex-direction:column; gap:10px;">
            {#each queue as item}
              <div class="card review-item">
                <div class="review-header">
                  <div>
                    <span class="text-sm font-600">{item.feedName}</span>
                    <span class="text-dim text-sm"> by @{item.ownerHandle}</span>
                  </div>
                  <span class="badge badge-amber">{item.flagReason}</span>
                </div>
                <div class="flex gap-8 items-center" style="margin-top:12px">
                  <span class="text-xs text-dim">{formatDate(item.createdAt)}</span>
                  <span class="mono text-xs text-dim">{item.feedId}</span>
                  <div class="ml-auto flex gap-8">
                    <button
                      class="btn btn-sm btn-secondary"
                      onclick={() => approve(item.id)}
                    >
                      Approve
                    </button>
                    <button
                      class="btn btn-sm btn-danger"
                      onclick={() => reject(item.id)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {:else if stats}
        <div class="card" style="margin-top:24px; text-align:center; padding:32px;">
          <span style="color:var(--green);">✓</span>
          <span class="text-dim" style="margin-left:8px;">Review queue empty</span>
        </div>
      {/if}

    {/if}
  </div>
</div>

<style>
  .auth-gate {
    max-width: 400px;
    margin: 80px auto;
    text-align: center;
  }

  .auth-icon { font-size: 2rem; margin-bottom: 16px; }
  .auth-gate h1 { margin-bottom: 10px; }
  .auth-gate p  { margin-bottom: 28px; }

  .auth-form {
    text-align: left;
    padding: 24px;
  }

  .admin-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 28px;
    gap: 16px;
  }

  .admin-header h1 { margin-bottom: 4px; }

  /* Tier bars */
  .tier-bars { display: flex; flex-direction: column; gap: 12px; }

  .tier-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .tier-label {
    width: 50px;
    font-size: 0.82rem;
    color: var(--text2);
    font-weight: 500;
  }

  .tier-bar-track {
    flex: 1;
    height: 8px;
    background: var(--surface2);
    border-radius: 99px;
    overflow: hidden;
  }

  .tier-bar-fill {
    height: 100%;
    border-radius: 99px;
    transition: width 0.4s ease;
    min-width: 4px;
  }

  .tier-count {
    width: 36px;
    text-align: right;
    font-size: 0.82rem;
    color: var(--text2);
    font-variant-numeric: tabular-nums;
  }

  /* Daily views bar chart */
  .bar-chart {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    height: 160px;
    padding-bottom: 24px;
    position: relative;
  }

  .bar-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    height: 100%;
  }

  .bar-value {
    font-size: 0.65rem;
    color: var(--text3);
    text-align: center;
  }

  .bar {
    width: 100%;
    background: var(--accent);
    opacity: 0.7;
    border-radius: 3px 3px 0 0;
    transition: height 0.3s ease;
    min-height: 4px;
  }

  .bar-label {
    font-size: 0.68rem;
    color: var(--text3);
    text-align: center;
    position: absolute;
    bottom: 0;
  }

  /* Health indicator */
  .indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .indicator.green { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .indicator.red   { background: var(--red);   box-shadow: 0 0 6px var(--red); }

  /* Review items */
  .review-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .font-600 { font-weight: 600; }
</style>

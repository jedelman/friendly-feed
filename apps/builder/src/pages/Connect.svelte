<script lang="ts">
  import { session } from '../stores/session'
  import { resolveHandle } from '$lib/bsky'
  import { resolveUser } from '$lib/api'
  import Spinner from '../components/Spinner.svelte'

  let handle = $state('')
  let loading = $state(false)
  let error = $state<string | null>(null)

  async function connect() {
    const raw = handle.trim().replace(/^@/, '')
    if (!raw) return

    loading = true
    error = null

    try {
      // Resolve handle → DID via Bluesky public API
      const did = await resolveHandle(raw)

      // Upsert user in D1 via CF Worker
      const user = await resolveUser(raw)

      session.login({ ...user, did })
      window.location.hash = '#/dashboard'
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not connect. Check your handle and try again.'
    } finally {
      loading = false
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') connect()
  }
</script>

<div class="page">
  <div class="container">
    <div class="hero">
      <div class="logo-mark">⟡</div>
      <h1>Your Bluesky feed,<br>described in plain English.</h1>
      <p class="hero-sub">
        Tell us what you want to read. We'll generate a custom feed using AI, let you
        tune it with a quick thumbs up/down preview, and publish it to your Bluesky account —
        in about two minutes.
      </p>
    </div>

    <div class="connect-card card fade-in">
      <label class="label" for="handle-input">Your Bluesky handle</label>
      <div class="input-row">
        <span class="at-prefix">@</span>
        <input
          id="handle-input"
          class="input handle-input"
          type="text"
          placeholder="you.bsky.social"
          bind:value={handle}
          {onkeydown}
          disabled={loading}
          autocomplete="off"
          autocapitalize="none"
          spellcheck={false}
        />
        <button
          class="btn btn-primary"
          onclick={connect}
          disabled={loading || !handle.trim()}
        >
          {#if loading}
            <Spinner size={16} color="#fff" /> Connecting…
          {:else}
            Connect
          {/if}
        </button>
      </div>

      {#if error}
        <p class="error-msg">{error}</p>
      {/if}

      <p class="privacy-note">
        We only read your public profile. No passwords, no write access.
      </p>
    </div>

    <div class="features">
      <div class="feature">
        <div class="feature-icon">✦</div>
        <div>
          <strong>AI-generated rules</strong>
          <p>Describe your interests. Claude turns them into a precise set of matching terms.</p>
        </div>
      </div>
      <div class="feature">
        <div class="feature-icon">👍</div>
        <div>
          <strong>Preview before you publish</strong>
          <p>Thumbs up/down on 20 real posts. The feed adjusts before it goes live.</p>
        </div>
      </div>
      <div class="feature">
        <div class="feature-icon">⟳</div>
        <div>
          <strong>Gets better over time</strong>
          <p>Pro feeds get weekly AI-tuning suggestions based on what you've engaged with.</p>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .hero {
    text-align: center;
    padding: 64px 0 48px;
  }

  .logo-mark {
    font-size: 2.5rem;
    margin-bottom: 20px;
    opacity: 0.7;
  }

  h1 {
    font-size: clamp(1.8rem, 4vw, 2.5rem);
    margin-bottom: 16px;
    color: var(--text);
  }

  .hero-sub {
    max-width: 520px;
    margin: 0 auto;
    font-size: 1rem;
    line-height: 1.65;
    color: var(--text2);
  }

  .connect-card {
    max-width: 520px;
    margin: 0 auto 48px;
    padding: 28px;
  }

  .input-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .at-prefix {
    color: var(--text3);
    font-size: 1.1rem;
    flex-shrink: 0;
  }

  .handle-input { flex: 1; }

  .error-msg {
    margin-top: 10px;
    font-size: 0.85rem;
    color: var(--red);
  }

  .privacy-note {
    margin-top: 14px;
    font-size: 0.78rem;
    color: var(--text3);
    text-align: center;
  }

  .features {
    max-width: 520px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .feature {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }

  .feature-icon {
    font-size: 1.3rem;
    width: 36px;
    text-align: center;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .feature strong {
    display: block;
    font-size: 0.95rem;
    margin-bottom: 3px;
    color: var(--text);
  }

  .feature p {
    font-size: 0.88rem;
    line-height: 1.55;
  }
</style>

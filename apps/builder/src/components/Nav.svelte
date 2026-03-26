<script lang="ts">
  import { session, isLoggedIn } from '../stores/session'

  let { currentRoute = '' }: { currentRoute: string } = $props()

  function nav(hash: string) {
    window.location.hash = hash
  }
</script>

<header class="nav">
  <div class="container nav-inner">
    <button class="wordmark" onclick={() => nav($isLoggedIn ? '#/dashboard' : '#/')}>
      Friendly Feed
    </button>

    {#if $isLoggedIn && $session}
      <nav class="links">
        <button
          class="nav-link"
          class:active={currentRoute === '/dashboard'}
          onclick={() => nav('#/dashboard')}
        >
          My Feeds
        </button>
        <button
          class="nav-link"
          class:active={currentRoute === '/create'}
          onclick={() => nav('#/create')}
        >
          + New Feed
        </button>
      </nav>
      <div class="user-chip">
        <span class="handle">@{$session.handle}</span>
        <button class="btn btn-ghost btn-sm" onclick={() => session.logout()}>
          Sign out
        </button>
      </div>
    {/if}
  </div>
</header>

<style>
  .nav {
    position: sticky;
    top: 0;
    z-index: 100;
    background: rgba(13, 13, 13, 0.85);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
  }

  .nav-inner {
    display: flex;
    align-items: center;
    height: 54px;
    gap: 24px;
  }

  .wordmark {
    background: none;
    border: none;
    color: var(--text);
    font: inherit;
    font-size: 1rem;
    font-weight: 700;
    cursor: pointer;
    letter-spacing: -0.01em;
    padding: 0;
  }

  .links {
    display: flex;
    gap: 4px;
  }

  .nav-link {
    background: none;
    border: none;
    color: var(--text2);
    font: inherit;
    font-size: 0.88rem;
    font-weight: 500;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: color 0.15s, background 0.15s;
  }

  .nav-link:hover { color: var(--text); background: var(--surface2); }
  .nav-link.active { color: var(--text); }

  .user-chip {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .handle {
    font-size: 0.85rem;
    color: var(--text2);
    font-family: var(--font-mono);
  }
</style>

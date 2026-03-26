<script lang="ts">
  import { session, isLoggedIn } from './stores/session'
  import Nav from './components/Nav.svelte'
  import Connect from './pages/Connect.svelte'
  import Create from './pages/Create.svelte'
  import Preview from './pages/Preview.svelte'
  import Dashboard from './pages/Dashboard.svelte'
  import Admin from './pages/Admin.svelte'

  // Hash-based router
  function parseRoute(hash: string): string {
    return hash.replace(/^#/, '') || '/'
  }

  let route = $state(parseRoute(window.location.hash))

  $effect(() => {
    const handler = () => {
      route = parseRoute(window.location.hash)
    }
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  })

  // Redirect to dashboard if logged in and at root; to connect if not logged in
  $effect(() => {
    if (route === '/' && $isLoggedIn) {
      window.location.hash = '#/dashboard'
    } else if (route !== '/' && route !== '/admin' && !$isLoggedIn) {
      window.location.hash = '#/'
    }
  })
</script>

<Nav currentRoute={route} />

{#if route === '/'}
  <Connect />
{:else if route === '/create'}
  <Create />
{:else if route === '/preview'}
  <Preview />
{:else if route === '/dashboard'}
  <Dashboard />
{:else if route === '/admin'}
  <Admin />
{:else}
  <div class="page">
    <div class="container empty">
      <p>Page not found.</p>
      <button
        class="btn btn-ghost"
        style="margin-top:12px"
        onclick={() => { window.location.hash = $isLoggedIn ? '#/dashboard' : '#/' }}
      >
        ← Go home
      </button>
    </div>
  </div>
{/if}

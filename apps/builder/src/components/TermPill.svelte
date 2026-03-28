<script lang="ts">
  let {
    term,
    variant = 'include',
    onremove,
  }: {
    term: string
    variant?: 'include' | 'exclude'
    onremove?: () => void
  } = $props()
</script>

<span class="pill" class:exclude={variant === 'exclude'}>
  {#if variant === 'exclude'}<span class="minus">−</span>{/if}
  {term}
  {#if onremove}
    <button class="remove" onclick={onremove} aria-label="Remove {term}">×</button>
  {/if}
</span>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px 3px 8px;
    background: var(--accent-dim);
    color: var(--accent);
    border: 1px solid rgba(0, 133, 255, 0.25);
    border-radius: 99px;
    font-size: 0.82rem;
    font-weight: 500;
    line-height: 1.4;
  }

  .pill.exclude {
    background: var(--red-dim);
    color: var(--red);
    border-color: rgba(239, 68, 68, 0.25);
  }

  .minus { font-size: 1rem; line-height: 1; }

  .remove {
    background: none;
    border: none;
    color: inherit;
    opacity: 0.6;
    cursor: pointer;
    font-size: 1rem;
    padding: 0 0 0 2px;
    line-height: 1;
    transition: opacity 0.1s;
  }
  .remove:hover { opacity: 1; }
</style>

<script lang="ts">
  let { size = 20, color = 'var(--accent)' }: { size?: number; color?: string } = $props()
</script>

<span class="spinner" style:width="{size}px" style:height="{size}px" style:border-top-color={color}></span>

<style>
  .spinner {
    display: inline-block;
    border: 2px solid var(--border2);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }
</style>

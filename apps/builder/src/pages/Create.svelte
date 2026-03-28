<script lang="ts">
  import { session } from '../stores/session'
  import { creation } from '../stores/creation'
  import { generateFeedConfig } from '$lib/api'
  import TermPill from '../components/TermPill.svelte'
  import Spinner from '../components/Spinner.svelte'

  let intentText = $state('')
  let feedName = $state('')
  let generating = $state(false)
  let error = $state<string | null>(null)

  // Term editing
  let newTerm = $state('')
  let newExclude = $state('')

  const state = $derived($creation)

  async function generate() {
    if (!intentText.trim() || !$session) return
    generating = true
    error = null

    try {
      const proposal = await generateFeedConfig($session.did, intentText.trim())
      creation.setIntent(feedName || 'My Feed', intentText.trim())
      creation.setProposal(proposal)
    } catch (e) {
      error = e instanceof Error ? e.message : 'Generation failed. Please try again.'
    } finally {
      generating = false
    }
  }

  function addTerm() {
    const t = newTerm.trim().toLowerCase()
    if (t && !state.editedTerms.includes(t)) {
      creation.updateTerms([...state.editedTerms, t])
    }
    newTerm = ''
  }

  function removeTerm(term: string) {
    creation.updateTerms(state.editedTerms.filter(t => t !== term))
  }

  function addExclude() {
    const t = newExclude.trim().toLowerCase()
    if (t && !state.editedExcludeTerms.includes(t)) {
      creation.updateExcludeTerms([...state.editedExcludeTerms, t])
    }
    newExclude = ''
  }

  function removeExclude(term: string) {
    creation.updateExcludeTerms(state.editedExcludeTerms.filter(t => t !== term))
  }

  function removeSeed(did: string) {
    creation.updateSeedAccounts(state.editedSeedAccounts.filter(s => s.did !== did))
  }

  function goPreview() {
    window.location.hash = '#/preview'
  }

  function onTermKey(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); addTerm() }
  }

  function onExcludeKey(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); addExclude() }
  }
</script>

<div class="page">
  <div class="container">

    {#if state.step === 'intent'}
      <!-- ── Step 1: Describe your feed ── -->
      <div class="step-header fade-in">
        <div class="step-badge">Step 1 of 3</div>
        <h1>Describe your feed</h1>
        <p>What do you want to read? Write a sentence or two. Be specific about topics,
          perspectives, or communities you care about.</p>
      </div>

      <div class="card fade-in" style="margin-top: 24px;">
        <div class="field">
          <label class="label" for="feed-name">Feed name</label>
          <input
            id="feed-name"
            class="input"
            type="text"
            placeholder="e.g. Urban Planning & Housing Policy"
            bind:value={feedName}
            maxlength={60}
          />
        </div>

        <div class="field">
          <label class="label" for="intent">What should this feed be about?</label>
          <textarea
            id="intent"
            class="input"
            placeholder="e.g. Urban planning, housing policy, and zoning reform — especially around social equity. I want takes from urbanists, academics, and local advocates. Not think tanks or libertarian angles."
            bind:value={intentText}
            rows={5}
          ></textarea>
          <div class="char-hint">{intentText.length} / 500</div>
        </div>

        {#if error}
          <p class="error-msg">{error}</p>
        {/if}

        <div class="action-row">
          <button
            class="btn btn-primary btn-lg"
            onclick={generate}
            disabled={generating || !intentText.trim()}
          >
            {#if generating}
              <Spinner size={18} color="#fff" /> Generating your feed…
            {:else}
              Generate feed config →
            {/if}
          </button>
        </div>

        {#if generating}
          <p class="generating-hint">
            Claude is analyzing your intent and finding matching terms. This takes about 5–10 seconds.
          </p>
        {/if}
      </div>

    {:else if state.step === 'review'}
      <!-- ── Step 2: Review + edit the proposal ── -->
      <div class="step-header fade-in">
        <div class="step-badge">Step 2 of 3</div>
        <h1>Review your feed config</h1>
        <p>Here's what Claude generated. Remove anything that looks off, add terms you'd like, then preview real posts.</p>
      </div>

      {#if state.proposal?.rationale}
        <div class="rationale card fade-in">
          <div class="rationale-label">Claude's reasoning</div>
          <p>{state.proposal.rationale}</p>
        </div>
      {/if}

      <div class="card fade-in" style="margin-top: 16px;">
        <div class="section-head">
          <div>
            <h3>Include terms</h3>
            <p class="text-sm">Posts matching any of these will appear in your feed.</p>
          </div>
        </div>

        <div class="pills-row">
          {#each state.editedTerms as term}
            <TermPill {term} variant="include" onremove={() => removeTerm(term)} />
          {/each}
        </div>

        <div class="add-row">
          <input
            class="input"
            type="text"
            placeholder="Add a term…"
            bind:value={newTerm}
            onkeydown={onTermKey}
            style="flex:1"
          />
          <button class="btn btn-secondary" onclick={addTerm} disabled={!newTerm.trim()}>
            Add
          </button>
        </div>
      </div>

      <div class="card fade-in">
        <div class="section-head">
          <div>
            <h3>Exclude terms</h3>
            <p class="text-sm">Posts containing these will be filtered out.</p>
          </div>
        </div>

        <div class="pills-row">
          {#each state.editedExcludeTerms as term}
            <TermPill {term} variant="exclude" onremove={() => removeExclude(term)} />
          {/each}
          {#if state.editedExcludeTerms.length === 0}
            <span class="text-dim text-sm">None — add terms to exclude noisy posts.</span>
          {/if}
        </div>

        <div class="add-row">
          <input
            class="input"
            type="text"
            placeholder="Add an exclude term…"
            bind:value={newExclude}
            onkeydown={onExcludeKey}
            style="flex:1"
          />
          <button class="btn btn-secondary" onclick={addExclude} disabled={!newExclude.trim()}>
            Add
          </button>
        </div>
      </div>

      {#if state.editedSeedAccounts.length > 0}
        <div class="card fade-in">
          <h3 style="margin-bottom:14px">Seed accounts</h3>
          <p class="text-sm text-muted" style="margin-bottom:14px">
            Posts from these accounts always appear if they're not excluded.
          </p>
          <div class="seed-list">
            {#each state.editedSeedAccounts as seed}
              <div class="seed-row">
                <div>
                  <span class="mono text-sm">@{seed.handle}</span>
                  {#if seed.reason}
                    <span class="text-dim text-xs"> — {seed.reason}</span>
                  {/if}
                </div>
                <button class="btn btn-ghost btn-sm" onclick={() => removeSeed(seed.did)}>
                  Remove
                </button>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <div class="action-row fade-in">
        <button class="btn btn-ghost" onclick={() => creation.reset()}>
          ← Start over
        </button>
        <button
          class="btn btn-primary btn-lg"
          onclick={goPreview}
          disabled={state.editedTerms.length === 0}
        >
          Preview real posts →
        </button>
      </div>
    {/if}

  </div>
</div>

<style>
  .step-header {
    margin-bottom: 8px;
  }

  .step-header h1 { margin: 8px 0 10px; }
  .step-header p  { max-width: 560px; }

  .step-badge {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin-bottom: 6px;
  }

  .char-hint {
    text-align: right;
    font-size: 0.75rem;
    color: var(--text3);
    margin-top: 5px;
  }

  .action-row {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 24px;
  }

  .generating-hint {
    margin-top: 16px;
    font-size: 0.85rem;
    text-align: center;
  }

  .rationale {
    margin-top: 24px;
    border-left: 2px solid var(--accent);
    border-radius: 0 var(--radius) var(--radius) 0;
  }

  .rationale-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 8px;
  }

  .section-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 14px;
  }

  .section-head h3 { margin-bottom: 3px; }

  .pills-row {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-bottom: 14px;
    min-height: 30px;
  }

  .add-row {
    display: flex;
    gap: 8px;
  }

  .seed-list { display: flex; flex-direction: column; gap: 10px; }

  .seed-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .error-msg {
    font-size: 0.85rem;
    color: var(--red);
    margin-bottom: 12px;
  }
</style>

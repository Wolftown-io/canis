# Guild Discovery Default Prompt — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a discovery setup step to guild creation and a dismissible discovery banner in guild settings for existing guilds.

**Architecture:** Extend CreateGuildModal with a second step for discovery settings. Add a dismissible banner to GeneralTab. Persist dismissal in the database via a new column on guild_members.

**Tech Stack:** Rust/axum (backend), Solid.js/TypeScript (frontend), PostgreSQL (migration)

---

### Task 1: Database migration for dismissal persistence

**Files:**
- Create: `server/migrations/20260308000000_discovery_prompt_dismissed.sql`

**Step 1: Write the migration**

```sql
ALTER TABLE guild_members
    ADD COLUMN discovery_prompt_dismissed_at TIMESTAMPTZ;
```

**Step 2: Run migration**

Run: `DATABASE_URL="postgresql://voicechat:voicechat_dev@localhost:5433/voicechat" sqlx migrate run --source server/migrations`
Expected: Migration applied successfully.

**Step 3: Regenerate sqlx offline cache**

Run: `DATABASE_URL="postgresql://voicechat:voicechat_dev@localhost:5433/voicechat" cargo sqlx prepare --workspace`
Expected: New `.sqlx/*.json` files generated.

**Step 4: Commit**

```bash
git add server/migrations/20260308000000_discovery_prompt_dismissed.sql .sqlx/
git commit -m "feat(db): add discovery_prompt_dismissed_at to guild_members"
```

---

### Task 2: Backend API for dismissal

**Files:**
- Modify: `server/src/guild/handlers.rs` (add dismiss handler)
- Modify: `server/src/guild/types.rs` (add response type if needed)
- Modify: guild router to register new route

**Step 1: Add dismiss endpoint**

Add a handler in `server/src/guild/handlers.rs`:

```rust
#[utoipa::path(
    post,
    path = "/api/guilds/{guild_id}/dismiss-discovery-prompt",
    tag = "guilds",
    responses(
        (status = 204, description = "Prompt dismissed"),
        (status = 403, description = "Not a member")
    ),
    security(("bearer_auth" = []))
)]
#[tracing::instrument(skip(state))]
pub async fn dismiss_discovery_prompt(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(guild_id): Path<Uuid>,
) -> Result<StatusCode, GuildError> {
    sqlx::query!(
        "UPDATE guild_members SET discovery_prompt_dismissed_at = NOW() WHERE guild_id = $1 AND user_id = $2",
        guild_id,
        auth.user_id
    )
    .execute(&state.pool)
    .await
    .map_err(|_| GuildError::NotFound(guild_id))?;

    Ok(StatusCode::NO_CONTENT)
}
```

**Step 2: Add endpoint to check dismissal status**

Add a field to the existing guild member info or guild settings response. When fetching guild settings, include `discovery_prompt_dismissed: bool` based on whether `discovery_prompt_dismissed_at IS NOT NULL` for the current user.

**Step 3: Register route**

Add to the guild router:

```rust
.route("/api/guilds/:guild_id/dismiss-discovery-prompt", post(dismiss_discovery_prompt))
```

**Step 4: Run tests and clippy**

Run: `SQLX_OFFLINE=true cargo test -p vc-server -- guild`
Run: `SQLX_OFFLINE=true cargo clippy -p vc-server -- -D warnings`
Expected: All pass.

**Step 5: Commit**

```bash
git add server/src/guild/handlers.rs server/src/guild/types.rs server/src/guild/mod.rs
git commit -m "feat(api): add dismiss-discovery-prompt endpoint"
```

---

### Task 3: Extend guild creation to accept discovery fields

**Files:**
- Modify: `server/src/guild/types.rs:41-47` (CreateGuildRequest)
- Modify: `server/src/guild/handlers.rs:137-200` (create_guild handler)

**Step 1: Extend CreateGuildRequest**

```rust
#[derive(Debug, Deserialize, Validate, ToSchema)]
pub struct CreateGuildRequest {
    #[validate(length(min = 2, max = 100))]
    pub name: String,
    #[validate(length(max = 1000))]
    pub description: Option<String>,
    pub discoverable: Option<bool>,
    #[validate(length(max = 5))]
    pub tags: Option<Vec<String>>,
    #[validate(url)]
    pub banner_url: Option<String>,
}
```

**Step 2: Apply discovery fields in create_guild handler**

After guild insertion, if discovery fields are provided, update the guild:

```rust
// After inserting the guild, apply optional discovery settings
if request.discoverable.unwrap_or(false) || request.tags.is_some() || request.banner_url.is_some() {
    sqlx::query!(
        "UPDATE guilds SET discoverable = $1, tags = $2, banner_url = $3 WHERE id = $4",
        request.discoverable.unwrap_or(false),
        &request.tags.unwrap_or_default() as &[String],
        request.banner_url.as_deref(),
        guild_id
    )
    .execute(&mut *tx)
    .await?;
}
```

Alternatively, include these fields directly in the INSERT statement.

**Step 3: Validate tags**

Add tag validation matching existing pattern from `UpdateGuildSettingsRequest`:

```rust
// Validate tags: max 5, each 2-32 chars, alphanumeric + hyphens
if let Some(ref tags) = request.tags {
    if tags.len() > 5 {
        return Err(GuildError::ValidationError("Maximum 5 tags allowed".into()));
    }
    let tag_regex = regex::Regex::new(r"^[a-zA-Z0-9-]{2,32}$").unwrap();
    for tag in tags {
        if !tag_regex.is_match(tag) {
            return Err(GuildError::ValidationError(format!("Invalid tag: {}", tag)));
        }
    }
}
```

**Step 4: Validate banner_url is HTTPS**

```rust
if let Some(ref url) = request.banner_url {
    if !url.starts_with("https://") {
        return Err(GuildError::ValidationError("Banner URL must use HTTPS".into()));
    }
}
```

**Step 5: Run tests and clippy**

Run: `SQLX_OFFLINE=true cargo test -p vc-server -- guild`
Run: `SQLX_OFFLINE=true cargo clippy -p vc-server -- -D warnings`
Expected: All pass.

**Step 6: Commit**

```bash
git add server/src/guild/types.rs server/src/guild/handlers.rs
git commit -m "feat(api): accept discovery fields in guild creation"
```

---

### Task 4: Update client guild creation flow

**Files:**
- Modify: `client/src/components/guilds/CreateGuildModal.tsx`
- Modify: `client/src/stores/guilds.ts:215-222` (createGuild function)
- Modify: `client/src/lib/tauri.ts` (Tauri bridge)

**Step 1: Add step state to CreateGuildModal**

Convert the modal from a single form to a two-step flow:

```typescript
const [step, setStep] = createSignal<1 | 2>(1);
const [name, setName] = createSignal("");
const [description, setDescription] = createSignal("");
// Step 2: Discovery
const [discoverable, setDiscoverable] = createSignal(false);
const [tags, setTags] = createSignal<string[]>([]);
const [tagInput, setTagInput] = createSignal("");
const [bannerUrl, setBannerUrl] = createSignal("");
```

**Step 2: Render step 1 (existing name/description form)**

Keep the existing form but change the submit button to "Next":

```tsx
<Show when={step() === 1}>
  {/* existing name + description fields */}
  <button onClick={() => setStep(2)} disabled={name().length < 2}>
    Next
  </button>
</Show>
```

**Step 3: Render step 2 (discovery setup)**

```tsx
<Show when={step() === 2}>
  <div class="space-y-4">
    <p class="text-sm text-text-secondary">
      Make your server visible in the server browser so others can find and join it.
    </p>

    {/* Discoverable toggle */}
    <label class="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={discoverable()}
        onChange={(e) => setDiscoverable(e.currentTarget.checked)}
        class="accent-brand"
      />
      <span class="text-sm">Make this server visible in the server browser</span>
    </label>

    <Show when={discoverable()}>
      {/* Tags input — reuse pattern from GeneralTab */}
      <div>
        <label class="text-xs text-text-secondary">Tags (up to 5)</label>
        <div class="flex flex-wrap gap-1 mt-1">
          <For each={tags()}>
            {(tag) => (
              <span class="px-1.5 py-0.5 text-xs rounded bg-white/10 flex items-center gap-1">
                {tag}
                <button onClick={() => setTags(tags().filter(t => t !== tag))}>×</button>
              </span>
            )}
          </For>
        </div>
        <Show when={tags().length < 5}>
          <input
            type="text"
            value={tagInput()}
            onInput={(e) => setTagInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && tagInput().trim()) {
                e.preventDefault();
                const tag = tagInput().trim().toLowerCase();
                if (/^[a-zA-Z0-9-]{2,32}$/.test(tag) && !tags().includes(tag)) {
                  setTags([...tags(), tag]);
                  setTagInput("");
                }
              }
            }}
            placeholder="Type a tag and press Enter"
            class="mt-1 w-full bg-white/5 rounded px-2 py-1 text-sm"
          />
        </Show>
      </div>

      {/* Banner URL */}
      <div>
        <label class="text-xs text-text-secondary">Banner URL (optional)</label>
        <input
          type="url"
          value={bannerUrl()}
          onInput={(e) => setBannerUrl(e.currentTarget.value)}
          placeholder="https://example.com/banner.png"
          class="mt-1 w-full bg-white/5 rounded px-2 py-1 text-sm"
        />
      </div>

      {/* Mini preview */}
      <Show when={discoverable()}>
        <div class="p-3 rounded bg-white/5 border border-white/10">
          <p class="text-xs text-text-secondary mb-1">Preview</p>
          <Show when={bannerUrl()}>
            <img src={bannerUrl()} class="w-full h-16 object-cover rounded mb-2" />
          </Show>
          <p class="text-sm font-medium">{name()}</p>
          <Show when={tags().length > 0}>
            <div class="flex flex-wrap gap-1 mt-1">
              <For each={tags()}>
                {(tag) => <span class="px-1.5 py-0.5 text-[10px] rounded bg-white/5">{tag}</span>}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </Show>

    <p class="text-xs text-text-secondary">
      You can always set this up later in Server Settings.
    </p>

    <div class="flex gap-2 justify-end">
      <button onClick={() => setStep(1)} class="text-sm text-text-secondary hover:text-text-primary">
        Back
      </button>
      <button onClick={handleSubmit} disabled={isSubmitting()}>
        Create Server
      </button>
    </div>
  </div>
</Show>
```

**Step 4: Update submission to include discovery fields**

```typescript
const handleSubmit = async () => {
  setIsSubmitting(true);
  try {
    await createGuild(
      name(),
      description() || undefined,
      discoverable() ? {
        discoverable: true,
        tags: tags().length > 0 ? tags() : undefined,
        banner_url: bannerUrl() || undefined,
      } : undefined
    );
    props.onClose();
  } catch (err) {
    // error handling
  } finally {
    setIsSubmitting(false);
  }
};
```

**Step 5: Update guilds store and Tauri bridge**

In `client/src/stores/guilds.ts`, update `createGuild` to accept optional discovery params and pass them through.

**Step 6: Run client tests**

Run: `cd client && bun run test:run`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add client/src/components/guilds/CreateGuildModal.tsx client/src/stores/guilds.ts client/src/lib/tauri.ts
git commit -m "feat(client): add discovery step to guild creation flow"
```

---

### Task 5: Add dismissible discovery banner to GeneralTab

**Files:**
- Modify: `client/src/components/guilds/GeneralTab.tsx`
- Modify: `client/src/lib/tauri.ts` (add dismiss API call)

**Step 1: Fetch dismissal state**

Add to GeneralTab a check for whether the banner should be shown:

```typescript
const [showDiscoveryBanner, setShowDiscoveryBanner] = createSignal(false);

onMount(async () => {
  // Show banner if: user is owner/admin, guild is not discoverable, no tags, not dismissed
  if (guild().owner_id === currentUserId() && !guild().discoverable && guild().tags.length === 0) {
    const dismissed = await tauri.isDiscoveryPromptDismissed(guild().id);
    setShowDiscoveryBanner(!dismissed);
  }
});
```

**Step 2: Render banner**

At the top of GeneralTab, before existing content:

```tsx
<Show when={showDiscoveryBanner()}>
  <div class="mb-4 p-3 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-between">
    <div>
      <p class="text-sm font-medium">Make your server easier to find</p>
      <p class="text-xs text-text-secondary mt-0.5">
        Set up server discovery so others can find and join your server.
      </p>
    </div>
    <div class="flex gap-2 shrink-0">
      <button
        onClick={() => {
          // Scroll to discoverable toggle
          document.getElementById("discoverable-toggle")?.scrollIntoView({ behavior: "smooth" });
        }}
        class="px-3 py-1 text-xs rounded bg-brand text-white hover:bg-brand/80"
      >
        Set up
      </button>
      <button
        onClick={async () => {
          await tauri.dismissDiscoveryPrompt(guild().id);
          setShowDiscoveryBanner(false);
        }}
        class="px-2 py-1 text-xs rounded text-text-secondary hover:text-text-primary"
      >
        Dismiss
      </button>
    </div>
  </div>
</Show>
```

**Step 3: Add id to discoverable toggle**

Add `id="discoverable-toggle"` to the existing discoverable toggle element so the "Set up" button can scroll to it.

**Step 4: Add Tauri bridge functions**

In `client/src/lib/tauri.ts`:

```typescript
export async function dismissDiscoveryPrompt(guildId: string): Promise<void> {
  await invoke("dismiss_discovery_prompt", { guild_id: guildId });
}

export async function isDiscoveryPromptDismissed(guildId: string): Promise<boolean> {
  return await invoke("is_discovery_prompt_dismissed", { guild_id: guildId });
}
```

**Step 5: Run client tests**

Run: `cd client && bun run test:run`
Expected: All tests pass.

**Step 6: Manual test**

1. Create a guild without enabling discovery → go to Settings → General → see banner
2. Click "Set up" → scrolls to discoverable toggle
3. Click "Dismiss" → banner disappears, stays dismissed on reload
4. Create a guild with discovery enabled → go to Settings → no banner

**Step 7: Commit**

```bash
git add client/src/components/guilds/GeneralTab.tsx client/src/lib/tauri.ts
git commit -m "feat(client): add dismissible discovery banner in guild settings"
```

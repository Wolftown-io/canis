import { request, type APIRequestContext, type FullConfig } from "@playwright/test";

type TestUser = {
  username: string;
  password: string;
  display_name: string;
  email: string;
};

type LoginResponse = {
  access_token: string;
};

type GuildSummary = {
  id: string;
  name?: string;
};

type InviteSummary = {
  code: string;
};

type ChannelSummary = {
  id: string;
  name: string;
  channel_type: string;
};

type SetupStatusResponse = {
  setup_complete: boolean;
};

type PreferencesResponse = {
  preferences?: Record<string, unknown>;
};

type UpdatePreferencesRequest = {
  preferences: Record<string, unknown>;
};

const BACKEND_BASE_URL = process.env.KAIKU_E2E_BACKEND_URL ?? "http://localhost:8080";
const E2E_GUILD_NAME = "E2E Owner Guild";

const USERS: readonly TestUser[] = [
  {
    username: "admin",
    password: "admin123",
    display_name: "Admin User",
    email: "admin@example.com",
  },
  {
    username: "alice",
    password: "password123",
    display_name: "Alice Developer",
    email: "alice@example.com",
  },
  {
    username: "bob",
    password: "password123",
    display_name: "Bob Tester",
    email: "bob@example.com",
  },
  {
    username: "charlie",
    password: "password123",
    display_name: "Charlie QA",
    email: "charlie@example.com",
  },
];

async function waitForBackend(ctx: APIRequestContext): Promise<void> {
  const timeoutMs = 120_000;
  const intervalMs = 1_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const response = await ctx.get("/health");
    if (response.ok()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Backend did not become healthy within ${timeoutMs}ms`);
}

async function ensureUsers(ctx: APIRequestContext): Promise<void> {
  for (const user of USERS) {
    const response = await ctx.post("/auth/register", { data: user });
    const status = response.status();
    if (status !== 200 && status !== 201 && status !== 409) {
      const body = await response.text();
      throw new Error(`Failed to register ${user.username}: HTTP ${status} ${body}`);
    }
  }
}

async function login(ctx: APIRequestContext, username: string, password: string): Promise<string> {
  const response = await ctx.post("/auth/login", {
    data: { username, password },
  });

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`Login failed for ${username}: HTTP ${response.status()} ${body}`);
  }

  const payload = (await response.json()) as Partial<LoginResponse>;
  if (!payload.access_token) {
    throw new Error(`Login response for ${username} did not include access_token`);
  }

  return payload.access_token;
}

async function ensureGuild(ctx: APIRequestContext, adminToken: string): Promise<string> {
  const headers = { Authorization: `Bearer ${adminToken}` };
  const listResponse = await ctx.get("/api/guilds", { headers });

  if (!listResponse.ok()) {
    const body = await listResponse.text();
    throw new Error(`Failed to list guilds: HTTP ${listResponse.status()} ${body}`);
  }

  const guilds = (await listResponse.json()) as GuildSummary[];
  const existingGuild = guilds.find((guild) => guild.name === E2E_GUILD_NAME);
  if (existingGuild) {
    return existingGuild.id;
  }

  const createResponse = await ctx.post("/api/guilds", {
    headers,
    data: {
      name: E2E_GUILD_NAME,
      description: "Guild bootstrap for Playwright",
    },
  });

  if (!createResponse.ok()) {
    const body = await createResponse.text();
    throw new Error(`Failed to create guild: HTTP ${createResponse.status()} ${body}`);
  }

  const guild = (await createResponse.json()) as GuildSummary;
  return guild.id;
}

async function ensureSetupCompleted(
  ctx: APIRequestContext,
  candidateTokens: readonly string[],
): Promise<void> {
  const statusResponse = await ctx.get("/api/setup/status");
  if (!statusResponse.ok()) {
    const body = await statusResponse.text();
    throw new Error(
      `Failed to fetch setup status: HTTP ${statusResponse.status()} ${body}`,
    );
  }

  const status = (await statusResponse.json()) as SetupStatusResponse;
  if (status.setup_complete) {
    return;
  }

  for (const token of candidateTokens) {
    const completeResponse = await ctx.post("/api/setup/complete", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        server_name: "Kaiku Server",
        registration_policy: "open",
        terms_url: null,
        privacy_url: null,
      },
    });

    if (completeResponse.ok() || completeResponse.status() === 409) {
      break;
    }

    if (completeResponse.status() !== 403) {
      const body = await completeResponse.text();
      throw new Error(
        `Failed to complete setup: HTTP ${completeResponse.status()} ${body}`,
      );
    }
  }

  const verifyResponse = await ctx.get("/api/setup/status");
  if (!verifyResponse.ok()) {
    const body = await verifyResponse.text();
    throw new Error(
      `Failed to verify setup status: HTTP ${verifyResponse.status()} ${body}`,
    );
  }

  const verifyStatus = (await verifyResponse.json()) as SetupStatusResponse;
  if (!verifyStatus.setup_complete) {
    throw new Error("Setup completion verification failed");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function ensureOnboardingCompleted(
  ctx: APIRequestContext,
  accessToken: string,
): Promise<void> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const getResponse = await ctx.get("/api/me/preferences", { headers });

  if (!getResponse.ok()) {
    const body = await getResponse.text();
    throw new Error(`Failed to read preferences: HTTP ${getResponse.status()} ${body}`);
  }

  const payload = (await getResponse.json()) as PreferencesResponse;
  const existingPrefs = isRecord(payload.preferences) ? payload.preferences : {};

  if (existingPrefs.onboarding_completed === true) {
    return;
  }

  const updatedPreferences: UpdatePreferencesRequest = {
    preferences: {
      ...existingPrefs,
      onboarding_completed: true,
    },
  };

  const putResponse = await ctx.put("/api/me/preferences", {
    headers,
    data: updatedPreferences,
  });

  if (!putResponse.ok()) {
    const body = await putResponse.text();
    throw new Error(`Failed to update preferences: HTTP ${putResponse.status()} ${body}`);
  }
}

async function ensureInviteCode(
  ctx: APIRequestContext,
  adminToken: string,
  guildId: string,
): Promise<string> {
  const headers = { Authorization: `Bearer ${adminToken}` };

  const listResponse = await ctx.get(`/api/guilds/${guildId}/invites`, { headers });
  if (listResponse.ok()) {
    const invites = (await listResponse.json()) as InviteSummary[];
    if (invites.length > 0 && invites[0].code) {
      return invites[0].code;
    }
  }

  const createResponse = await ctx.post(`/api/guilds/${guildId}/invites`, {
    headers,
    data: { expires_in: "7d" },
  });

  if (!createResponse.ok()) {
    const body = await createResponse.text();
    throw new Error(`Failed to create invite: HTTP ${createResponse.status()} ${body}`);
  }

  const invite = (await createResponse.json()) as InviteSummary;
  if (!invite.code) {
    throw new Error("Invite creation response did not include code");
  }

  return invite.code;
}

async function ensureGuildTextChannel(
  ctx: APIRequestContext,
  adminToken: string,
  guildId: string,
): Promise<string> {
  const headers = { Authorization: `Bearer ${adminToken}` };
  const listResponse = await ctx.get(`/api/guilds/${guildId}/channels`, { headers });

  if (!listResponse.ok()) {
    const body = await listResponse.text();
    throw new Error(
      `Failed to list channels for guild ${guildId}: HTTP ${listResponse.status()} ${body}`,
    );
  }

  const channels = (await listResponse.json()) as ChannelSummary[];
  const existingTextChannel = channels.find((channel) => channel.channel_type === "text");
  if (existingTextChannel) {
    return existingTextChannel.id;
  }

  const createResponse = await ctx.post("/api/channels", {
    headers,
    data: {
      name: "general",
      channel_type: "text",
      guild_id: guildId,
    },
  });

  if (!createResponse.ok()) {
    const body = await createResponse.text();
    throw new Error(
      `Failed to create text channel in guild ${guildId}: HTTP ${createResponse.status()} ${body}`,
    );
  }

  const createdChannel = (await createResponse.json()) as ChannelSummary;
  return createdChannel.id;
}

async function ensureMemberJoinedGuild(
  ctx: APIRequestContext,
  username: string,
  password: string,
  inviteCode: string,
): Promise<void> {
  const accessToken = await login(ctx, username, password);
  const response = await ctx.post(`/api/invites/${inviteCode}/join`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(
      `Failed to add ${username} to guild via invite ${inviteCode}: HTTP ${response.status()} ${body}`,
    );
  }
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  if (process.env.KAIKU_E2E_SKIP_BACKEND === "1") {
    return;
  }

  const ctx = await request.newContext({
    baseURL: BACKEND_BASE_URL,
    extraHTTPHeaders: { "Content-Type": "application/json" },
  });

  await waitForBackend(ctx);
  await ensureUsers(ctx);

  const aliceToken = await login(ctx, "alice", "password123");
  const bobToken = await login(ctx, "bob", "password123");
  const charlieToken = await login(ctx, "charlie", "password123");

  const adminToken = await login(ctx, "admin", "admin123");
  await ensureSetupCompleted(ctx, [adminToken, aliceToken, bobToken, charlieToken]);

  await ensureOnboardingCompleted(ctx, adminToken);
  await ensureOnboardingCompleted(ctx, aliceToken);
  await ensureOnboardingCompleted(ctx, bobToken);
  await ensureOnboardingCompleted(ctx, charlieToken);

  const guildId = await ensureGuild(ctx, adminToken);
  await ensureGuildTextChannel(ctx, adminToken, guildId);
  const inviteCode = await ensureInviteCode(ctx, adminToken, guildId);

  await ensureMemberJoinedGuild(ctx, "alice", "password123", inviteCode);
  await ensureMemberJoinedGuild(ctx, "bob", "password123", inviteCode);

  await ctx.dispose();
}

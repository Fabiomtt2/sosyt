import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Config } from "./config.js";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeVideoId(input: string): string | null {
  let value = input.trim();
  // The contribution field accepts YouTube URLs, never a bare video identifier.
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;

  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] ?? null;
    if (["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else {
        const parts = url.pathname.split("/").filter(Boolean);
        if (["shorts", "embed", "live"].includes(parts[0] ?? "")) id = parts[1] ?? null;
      }
    }
    return id && VIDEO_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

export async function verifyYouTubeVideo(input: string, apiKey?: string): Promise<{ videoId: string; canonicalUrl: string }> {
  const videoId = parseYouTubeVideoId(input);
  if (!videoId) throw new Error("URL não aceita. Cole um link de vídeo do YouTube.");

  if (apiKey) {
    const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
    endpoint.search = new URLSearchParams({ part: "id,status", id: videoId, key: apiKey }).toString();
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Não foi possível validar o vídeo no YouTube.");
    const payload = (await response.json()) as { items?: Array<{ status?: { embeddable?: boolean } }> };
    if (!payload.items?.length) throw new Error("O vídeo não existe ou não está acessível.");
  }

  return { videoId, canonicalUrl: `https://www.youtube.com/watch?v=${videoId}` };
}

function encryptionKey(config: Config): Buffer {
  if (config.YOUTUBE_TOKEN_ENCRYPTION_KEY) {
    const key = Buffer.from(config.YOUTUBE_TOKEN_ENCRYPTION_KEY, "base64");
    if (key.length !== 32) throw new Error("YOUTUBE_TOKEN_ENCRYPTION_KEY deve conter 32 bytes em Base64.");
    return key;
  }
  if (config.NODE_ENV === "production") throw new Error("YOUTUBE_TOKEN_ENCRYPTION_KEY é obrigatório em produção.");
  return createHash("sha256").update(config.JWT_SECRET).digest();
}

export function encryptToken(token: string, config: Config): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(config), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptToken(payload: string, config: Config): string {
  const [ivRaw, tagRaw, encryptedRaw] = payload.split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error("Token cifrado inválido.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(config), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64url")), decipher.final()]).toString("utf8");
}

export function googleAuthorizationUrl(config: Config, state: string): string {
  if (!config.GOOGLE_CLIENT_ID) throw new Error("Integração Google ainda não configurada.");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID,
    redirect_uri: config.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/youtube",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state
  }).toString();
  return url.toString();
}

export async function exchangeGoogleCode(config: Config, code: string): Promise<{ refreshToken: string; scope: string }> {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) throw new Error("Integração Google ainda não configurada.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", signal: AbortSignal.timeout(15_000),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      redirect_uri: config.GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
      code
    })
  });
  const payload = (await response.json()) as { refresh_token?: string; scope?: string; error_description?: string };
  if (!response.ok || !payload.refresh_token) throw new Error(payload.error_description ?? "O Google não devolveu um refresh token.");
  return { refreshToken: payload.refresh_token, scope: payload.scope ?? "https://www.googleapis.com/auth/youtube" };
}

async function accessToken(config: Config, refreshToken: string): Promise<string> {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) throw new Error("Integração Google ainda não configurada.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", signal: AbortSignal.timeout(15_000),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  const payload = (await response.json()) as { access_token?: string; error_description?: string };
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description ?? "Falha ao renovar acesso ao YouTube.");
  return payload.access_token;
}

async function youtubeRequest<T>(path: string, token: string, body: unknown): Promise<T> {
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, {
    method: "POST", signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? "Falha na API do YouTube.");
  return payload;
}

async function youtubeGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, {
    signal: AbortSignal.timeout(15_000), headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("Não foi possível conferir a playlist no YouTube.");
  return await response.json() as T;
}

export async function createPrivatePlaylist(
  config: Config,
  refreshToken: string,
  title: string,
  videoIds: string[],
  existing?: { playlistId?: string; addedCount: number; exportId?: string },
  onProgress?: (playlistId: string, addedCount: number) => void
): Promise<string> {
  const token = await accessToken(config, refreshToken);
  let playlistId = existing?.playlistId;
  const marker = existing?.exportId ? `Referência Conexão: ${existing.exportId}` : undefined;
  // Recover a remotely created playlist if the process stopped before its ID was persisted.
  if (!playlistId && marker) {
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const params = new URLSearchParams({ part: "snippet", mine: "true", maxResults: "50" });
      if (pageToken) params.set("pageToken", pageToken);
      const result = await youtubeGet<{ items?: Array<{ id: string; snippet?: { description?: string } }>; nextPageToken?: string }>(`playlists?${params}`, token);
      const found = result.items?.find((item) => item.snippet?.description?.split("\n").includes(marker));
      if (found) { playlistId = found.id; break; }
      pageToken = result.nextPageToken;
      if (!pageToken) break;
      if (page === 9) throw new Error("Muitas playlists para conferir automaticamente. Nenhuma nova playlist foi criada.");
    }
  }
  let addedCount = 0;
  if (playlistId) {
    const params = new URLSearchParams({ part: "snippet", playlistId, maxResults: "50" });
    const result = await youtubeGet<{ items?: Array<{ snippet?: { position?: number; resourceId?: { videoId?: string } } }>; nextPageToken?: string }>(`playlistItems?${params}`, token);
    const items = [...(result.items ?? [])].sort((a, b) => (a.snippet?.position ?? 0) - (b.snippet?.position ?? 0));
    if (result.nextPageToken || items.length > videoIds.length || items.some((item, index) => item.snippet?.resourceId?.videoId !== videoIds[index])) {
      throw new Error("A playlist foi alterada no YouTube. Confira os vídeos antes de tentar novamente.");
    }
    addedCount = items.length;
    onProgress?.(playlistId, addedCount);
  } else {
    const playlist = await youtubeRequest<{ id: string }>("playlists?part=snippet,status", token, {
      snippet: { title, description: ["Curadoria colaborativa criada pelo Conexão Youtube.", marker].filter(Boolean).join("\n") },
      status: { privacyStatus: "private" }
    });
    playlistId = playlist.id;
    onProgress?.(playlistId, 0);
  }
  for (let index = addedCount; index < videoIds.length; index += 1) {
    await youtubeRequest("playlistItems?part=snippet", token, {
      snippet: { playlistId, position: index, resourceId: { kind: "youtube#video", videoId: videoIds[index] } }
    });
    onProgress?.(playlistId, index + 1);
  }
  return playlistId;
}

import {
  getRepoCommitCount,
  getRepoStars,
  getRepoTotalDownloads,
} from "./github";

interface DiscordInviteResponse {
  approximate_member_count?: number;
}

type FetchWithCfInit = RequestInit & {
  cf?: {
    cacheEverything?: boolean;
    cacheTtl?: number;
  };
};

export interface AppStats {
  totalDownloads: number | null;
  totalCommits: number | null;
  totalStars: number | null;
  discordMembers: number | null;
}

export async function getDiscordMemberCount(
  inviteApiUrl: string,
  cacheTtlSeconds: number,
): Promise<number | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), 3500);

    const requestInit: FetchWithCfInit = {
      signal: controller.signal,
      cf: {
        cacheEverything: true,
        cacheTtl: cacheTtlSeconds,
      },
    };

    const response = await fetch(inviteApiUrl, requestInit);
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as DiscordInviteResponse;
    return typeof data.approximate_member_count === "number"
      ? data.approximate_member_count
      : null;
  } catch {
    return null;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function getAppStats(
  owner: string,
  repo: string,
  discordInviteApiUrl: string,
  cacheTtlSeconds: number,
): Promise<AppStats> {
  const [totalDownloads, totalCommits, totalStars, discordMembers] =
    await Promise.all([
      getRepoTotalDownloads(owner, repo, cacheTtlSeconds),
      getRepoCommitCount(owner, repo, cacheTtlSeconds),
      getRepoStars(owner, repo, cacheTtlSeconds),
      getDiscordMemberCount(discordInviteApiUrl, cacheTtlSeconds),
    ]);

  return {
    totalDownloads,
    totalCommits,
    totalStars,
    discordMembers,
  };
}

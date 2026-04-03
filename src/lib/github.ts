const githubNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

type FetchWithCfInit = RequestInit & {
  cf?: {
    cacheEverything?: boolean;
    cacheTtl?: number;
  };
};

const DEFAULT_GITHUB_TIMEOUT_MS = 3500;
const DEFAULT_CACHE_TTL_SECONDS = 300;

interface GitHubRepoResponse {
  stargazers_count?: number;
}

interface GitHubContributorResponse {
  login?: string;
  avatar_url?: string;
  html_url?: string;
  contributions?: number;
}

interface GitHubReleaseAssetResponse {
  name?: string;
  browser_download_url?: string;
  size?: number;
  download_count?: number;
}

interface GitHubReleaseResponse {
  tag_name?: string;
  name?: string;
  html_url?: string;
  body?: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GitHubReleaseAssetResponse[];
}

export interface RepoReleaseAsset {
  name: string;
  url: string;
  sizeBytes: number;
}

export interface RepoRelease {
  version: string;
  name: string;
  notesUrl: string;
  notesMarkdown: string;
  publishedAt: string;
  assets: RepoReleaseAsset[];
  universalAsset: RepoReleaseAsset | null;
}

export interface RepoContributor {
  login: string;
  avatarUrl: string;
  profileUrl: string;
  contributions: number;
}

export function formatCompactNumber(value: number): string {
  return githubNumberFormatter.format(value);
}

function parseLastPageFromLinkHeader(linkHeader: string | null): number | null {
  if (!linkHeader) {
    return null;
  }

  const lastLinkMatch = linkHeader.match(/<([^>]+)>;\s*rel="last"/);
  if (!lastLinkMatch) {
    return null;
  }

  try {
    const url = new URL(lastLinkMatch[1]);
    const page = Number.parseInt(url.searchParams.get("page") ?? "", 10);
    return Number.isFinite(page) ? page : null;
  } catch {
    return null;
  }
}

async function fetchGitHubResponse(
  endpoint: string,
  timeoutMs = DEFAULT_GITHUB_TIMEOUT_MS,
  cacheTtlSeconds = DEFAULT_CACHE_TTL_SECONDS,
): Promise<Response | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const requestInit: FetchWithCfInit = {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "vega-site",
      },
      signal: controller.signal,
      cf: {
        cacheEverything: true,
        cacheTtl: cacheTtlSeconds,
      },
    };

    const response = await fetch(
      `https://api.github.com${endpoint}`,
      requestInit,
    );

    if (!response.ok) {
      return null;
    }

    return response;
  } catch {
    return null;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function fetchGitHubJson<T>(
  endpoint: string,
  timeoutMs = DEFAULT_GITHUB_TIMEOUT_MS,
  cacheTtlSeconds = DEFAULT_CACHE_TTL_SECONDS,
): Promise<T | null> {
  const response = await fetchGitHubResponse(
    endpoint,
    timeoutMs,
    cacheTtlSeconds,
  );
  if (!response) {
    return null;
  }

  return (await response.json()) as T;
}

export async function getRepoStars(
  owner: string,
  name: string,
  cacheTtlSeconds = DEFAULT_CACHE_TTL_SECONDS,
): Promise<number | null> {
  const data = await fetchGitHubJson<GitHubRepoResponse>(
    `/repos/${owner}/${name}`,
    2500,
    cacheTtlSeconds,
  );

  if (!data) {
    return null;
  }

  const stars = data.stargazers_count;
  return typeof stars === "number" ? stars : null;
}

function mapContributor(
  contributor: GitHubContributorResponse,
): RepoContributor | null {
  if (!contributor.login || !contributor.avatar_url || !contributor.html_url) {
    return null;
  }

  return {
    login: contributor.login,
    avatarUrl: contributor.avatar_url,
    profileUrl: contributor.html_url,
    contributions:
      typeof contributor.contributions === "number"
        ? contributor.contributions
        : 0,
  };
}

export async function getRepoContributors(
  owner: string,
  name: string,
  count = 20,
  cacheTtlSeconds = DEFAULT_CACHE_TTL_SECONDS,
): Promise<RepoContributor[]> {
  const perPage = Math.min(Math.max(count, 1), 100);
  const data = await fetchGitHubJson<GitHubContributorResponse[]>(
    `/repos/${owner}/${name}/contributors?per_page=${perPage}`,
    DEFAULT_GITHUB_TIMEOUT_MS,
    cacheTtlSeconds,
  );

  if (!data || !Array.isArray(data)) {
    return [];
  }

  return data
    .map((contributor) => mapContributor(contributor))
    .filter(
      (contributor): contributor is RepoContributor => contributor !== null,
    )
    .slice(0, count);
}

export async function getRepoCommitCount(
  owner: string,
  name: string,
  cacheTtlSeconds = DEFAULT_CACHE_TTL_SECONDS,
): Promise<number | null> {
  const response = await fetchGitHubResponse(
    `/repos/${owner}/${name}/commits?per_page=1`,
    DEFAULT_GITHUB_TIMEOUT_MS,
    cacheTtlSeconds,
  );

  if (!response) {
    return null;
  }

  const lastPage = parseLastPageFromLinkHeader(response.headers.get("link"));
  if (typeof lastPage === "number") {
    return lastPage;
  }

  const data = (await response.json()) as unknown;
  return Array.isArray(data) ? data.length : null;
}

function sumReleaseDownloads(releases: GitHubReleaseResponse[]): number {
  return releases.reduce((releaseTotal, release) => {
    if (release.draft) {
      return releaseTotal;
    }

    const assetDownloads = (release.assets ?? []).reduce(
      (assetTotal, asset) => {
        return (
          assetTotal +
          (typeof asset.download_count === "number" ? asset.download_count : 0)
        );
      },
      0,
    );

    return releaseTotal + assetDownloads;
  }, 0);
}

export async function getRepoTotalDownloads(
  owner: string,
  name: string,
  cacheTtlSeconds = DEFAULT_CACHE_TTL_SECONDS,
): Promise<number | null> {
  const perPage = 100;
  const firstResponse = await fetchGitHubResponse(
    `/repos/${owner}/${name}/releases?per_page=${perPage}&page=1`,
    DEFAULT_GITHUB_TIMEOUT_MS,
    cacheTtlSeconds,
  );

  if (!firstResponse) {
    return null;
  }

  const firstPageData = (await firstResponse.json()) as GitHubReleaseResponse[];
  if (!Array.isArray(firstPageData)) {
    return null;
  }

  let totalDownloads = sumReleaseDownloads(firstPageData);
  const lastPage =
    parseLastPageFromLinkHeader(firstResponse.headers.get("link")) ?? 1;

  if (lastPage <= 1) {
    return totalDownloads;
  }

  const maxPages = Math.min(lastPage, 10);
  const pageRequests: Promise<GitHubReleaseResponse[] | null>[] = [];

  for (let page = 2; page <= maxPages; page += 1) {
    pageRequests.push(
      fetchGitHubJson<GitHubReleaseResponse[]>(
        `/repos/${owner}/${name}/releases?per_page=${perPage}&page=${page}`,
        DEFAULT_GITHUB_TIMEOUT_MS,
        cacheTtlSeconds,
      ),
    );
  }

  const pages = await Promise.all(pageRequests);
  pages.forEach((pageData) => {
    if (Array.isArray(pageData)) {
      totalDownloads += sumReleaseDownloads(pageData);
    }
  });

  return totalDownloads;
}

function createNotesMarkdown(body: string | undefined): string {
  if (!body) {
    return "No release notes provided.";
  }

  const compactBody = body.replace(/\r\n/g, "\n").trim();
  if (!compactBody) {
    return "No release notes provided.";
  }

  return compactBody;
}

function mapReleaseAsset(
  asset: GitHubReleaseAssetResponse,
): RepoReleaseAsset | null {
  const assetName = asset.name;
  const assetUrl = asset.browser_download_url;

  if (!assetName || !assetUrl) {
    return null;
  }

  return {
    name: assetName,
    url: assetUrl,
    sizeBytes: typeof asset.size === "number" ? asset.size : 0,
  };
}

function isUniversalAsset(asset: RepoReleaseAsset): boolean {
  const normalized = asset.name.toLowerCase();
  return ["universal"].some((hint) => normalized.includes(hint));
}

function pickUniversalAsset(
  assets: RepoReleaseAsset[],
): RepoReleaseAsset | null {
  const explicitUniversal = assets.find((asset) => isUniversalAsset(asset));
  if (explicitUniversal) {
    return explicitUniversal;
  }

  return assets[0] ?? null;
}

function mapRelease(release: GitHubReleaseResponse): RepoRelease | null {
  const version = release.tag_name;
  const notesUrl = release.html_url;

  if (!version || !notesUrl) {
    return null;
  }

  const assets = (release.assets ?? [])
    .map((asset) => mapReleaseAsset(asset))
    .filter((asset): asset is RepoReleaseAsset => asset !== null);

  return {
    version,
    name: release.name ?? version,
    notesUrl,
    notesMarkdown: createNotesMarkdown(release.body),
    publishedAt: release.published_at ?? "",
    assets,
    universalAsset: pickUniversalAsset(assets),
  };
}

export async function getRepoReleases(
  owner: string,
  name: string,
  count = 6,
  cacheTtlSeconds = DEFAULT_CACHE_TTL_SECONDS,
): Promise<RepoRelease[]> {
  // Pull a wider window so prereleases at the top do not hide older stable tags.
  const pageSize = Math.min(Math.max(count * 4, 20), 100);
  const data = await fetchGitHubJson<GitHubReleaseResponse[]>(
    `/repos/${owner}/${name}/releases?per_page=${pageSize}`,
    DEFAULT_GITHUB_TIMEOUT_MS,
    cacheTtlSeconds,
  );

  if (!data || !Array.isArray(data)) {
    return [];
  }

  return data
    .filter((release) => !release.draft && !release.prerelease)
    .map((release) => mapRelease(release))
    .filter((release): release is RepoRelease => release !== null)
    .slice(0, count);
}

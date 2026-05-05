export type EntryExperience = 'editor' | 'landing';

interface EntryLocationLike {
  hostname: string;
  pathname: string;
  search?: string;
  protocol?: string;
  port?: string;
}

const LANDING_HOST = 'landing.localhost';
const LANDING_PATHS = ['/landing'];

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase();
}

function normalizePathname(pathname: string): string {
  if (!pathname) {
    return '/';
  }

  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized;
}

function matchesPathPrefix(pathname: string, basePath: string): boolean {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function hasEditorOverride(search = ''): boolean {
  const query = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  return params.has('test') || params.get('entry') === 'editor';
}

export function isLandingHost(hostname: string): boolean {
  return normalizeHostname(hostname) === LANDING_HOST;
}

export function isLandingPath(pathname: string): boolean {
  const normalizedPath = normalizePathname(pathname);
  return LANDING_PATHS.some((basePath) => matchesPathPrefix(normalizedPath, basePath));
}

export function resolveEntryExperience(locationLike: EntryLocationLike): EntryExperience {
  if (hasEditorOverride(locationLike.search)) {
    return 'editor';
  }

  if (isLandingHost(locationLike.hostname) || isLandingPath(locationLike.pathname)) {
    return 'landing';
  }

  return 'editor';
}

export function buildEditorHref(locationLike: EntryLocationLike): string {
  if (!isLandingHost(locationLike.hostname)) {
    return '/';
  }

  const protocol = locationLike.protocol ?? 'http:';
  const port = locationLike.port ? `:${locationLike.port}` : '';
  return `${protocol}//localhost${port}/`;
}

export function buildLandingHref(locationLike: EntryLocationLike): string {
  if (isLandingHost(locationLike.hostname)) {
    const protocol = locationLike.protocol ?? 'http:';
    const port = locationLike.port ? `:${locationLike.port}` : '';
    return `${protocol}//landing.localhost${port}/`;
  }

  return '/landing';
}

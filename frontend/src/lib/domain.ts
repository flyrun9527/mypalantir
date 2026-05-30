export function getDomainFromPath(): string | null {
  const match = window.location.pathname.match(/\/d\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function domainBase(domain: string | null): string {
  return domain ? `/d/${encodeURIComponent(domain)}` : "";
}

export function buildDomainPath(domain: string): string {
  return `/d/${encodeURIComponent(domain)}/`;
}

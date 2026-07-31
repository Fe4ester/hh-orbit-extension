const SENSITIVE_QUERY_PARAMS = ['resume', 'resumeHash'];

export function redactSensitiveUrl(url: string | null | undefined): string | null | undefined {
  if (!url) {
    return url;
  }

  try {
    const parsed = new URL(url);
    for (const param of SENSITIVE_QUERY_PARAMS) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '[redacted]');
      }
    }
    return parsed.toString();
  } catch {
    return url.replace(/([?&]resume(?:Hash)?=)[^&\s"'<>]+/gi, '$1[redacted]');
  }
}

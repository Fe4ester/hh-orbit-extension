const HH_URL = 'https://hh.ru';

export async function getXsrfCookie(): Promise<string | null> {
  const cookie = await chrome.cookies.get({ url: HH_URL, name: '_xsrf' });
  return cookie?.value ?? null;
}

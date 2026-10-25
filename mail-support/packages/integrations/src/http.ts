import { PermanentError, TransientError } from "@ms/shared";

export type FetchLike = typeof fetch;

/** fetch avec délai maximal et traduction des erreurs (5xx/429/réseau = passagères). */
export async function httpJson<T>(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ status: number; data: T; headers: Headers }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15_000);
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    throw new TransientError(`Réseau indisponible (${new URL(url).host}) : ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (res.status === 429 || res.status >= 500) throw new TransientError(`${new URL(url).host} a répondu ${res.status}`);
  if (res.status === 401 || res.status === 403) throw new PermanentError(`${new URL(url).host} : accès refusé (${res.status}), vérifiez les identifiants`);
  return { status: res.status, data: data as T, headers: res.headers };
}

import { useEffect, useState } from 'react';

const TOKEN_KEY = 'cc_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));
export const getCampusScope = () => localStorage.getItem('cc_selected_campus');

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

type Opts = { method?: string; body?: any; form?: FormData; auth?: boolean };

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const t = getToken();
  if (t && opts.auth !== false) {
    headers.authorization = `Bearer ${t}`;
    const campus = getCampusScope();
    if (campus) headers['x-campus-id'] = campus;
  }
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.body); }
  let res: Response;
  try { res = await fetch('/api/v1' + path, { method: opts.method || (body ? 'POST' : 'GET'), headers, body }); }
  catch { throw new ApiError('Cannot reach the server. Check your connection and try again.', 0); }
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && t && opts.auth !== false) { setToken(null); window.dispatchEvent(new Event('cc:logout')); }
    const fallbackMsg = res.status === 404
      ? 'API endpoint not found (404). Ensure the backend server is running on port 4000.'
      : `Request failed (${res.status})`;
    throw new ApiError(data?.error || fallbackMsg, res.status);
  }
  return data as T;
}

// Download a protected file (PDF, CSV, upload) with the login token and hand it to the browser.
export async function download(path: string, filename: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${getToken()}` };
  const campus = getCampusScope();
  if (campus) headers['x-campus-id'] = campus;
  const res = await fetch('/api/v1' + path, { headers });
  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* not json */ }
    throw new ApiError(msg, res.status);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function useApi<T = any>(path: string | null, deps: any[] = []) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: !!path });
  const [tick, setTick] = useState(0);
  const [campusVer, setCampusVer] = useState(0);

  useEffect(() => {
    const onCampus = () => setCampusVer((v) => v + 1);
    window.addEventListener('cc:campus_changed', onCampus);
    return () => window.removeEventListener('cc:campus_changed', onCampus);
  }, []);

  useEffect(() => {
    if (!path) { setState({ data: null, error: null, loading: false }); return; }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api<T>(path).then((d) => alive && setState({ data: d, error: null, loading: false }))
      .catch((e) => alive && setState({ data: null, error: e.message, loading: false }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, campusVer, ...deps]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

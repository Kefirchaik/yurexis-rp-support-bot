const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

function config() {
  if (!base || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return { base, key };
}

export async function db<T = any>(
  table: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  query = "",
  body?: unknown,
  prefer = "return=representation"
): Promise<T> {
  const { base, key } = config();
  const response = await fetch(`${base}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: prefer
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${method} ${table} failed (${response.status}): ${text}`);
  return (text ? JSON.parse(text) : []) as T;
}

export const enc = (value: string | number) => encodeURIComponent(String(value));

const baseUrl = (import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(/\/$/, "");

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Accept: "application/json" }, signal,
  });
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) throw new Error("API did not return JSON");
  return response.json() as Promise<T>;
}

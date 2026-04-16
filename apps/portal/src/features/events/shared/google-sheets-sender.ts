export async function sendToGoogleSheet(
  url: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error(
      'Google Sheet write failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

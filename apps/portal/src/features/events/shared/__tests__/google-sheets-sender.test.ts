import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendToGoogleSheet } from '../google-sheets-sender';

describe('sendToGoogleSheet', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs payload to the Google Sheet URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')));
    await sendToGoogleSheet('https://script.google.com/test', { registrationId: 'MD26-ABC1234' });
    expect(fetch).toHaveBeenCalledWith(
      'https://script.google.com/test',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('MD26-ABC1234'),
      }),
    );
  });

  it('swallows errors without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    await expect(sendToGoogleSheet('https://script.google.com/test', { id: '1' })).resolves.toBeUndefined();
  });

  it('does nothing when url is empty', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await sendToGoogleSheet('', { id: '1' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

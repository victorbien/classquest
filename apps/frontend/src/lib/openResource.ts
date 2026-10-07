import { useCallback, useState } from 'react';
import { api } from '../api';

/**
 * Opens a resource through the existing presigned-URL flow (GET /assets/:id).
 * The tab is opened synchronously inside the click so popup blockers allow
 * it, then pointed at the time-limited S3 URL. For students the same request
 * records the open server-side (My Progress).
 */
export function useOpenResource(onOpened?: (assetId: string) => void) {
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  const open = useCallback(
    async (assetId: string) => {
      setOpeningId(assetId);
      setErrorId(null);
      const tab = window.open('about:blank', '_blank');
      try {
        const { downloadUrl } = await api.getAsset(assetId);
        if (tab) {
          tab.opener = null;
          tab.location.href = downloadUrl;
        } else {
          window.location.assign(downloadUrl);
        }
        onOpened?.(assetId);
      } catch {
        tab?.close();
        setErrorId(assetId);
      } finally {
        setOpeningId(null);
      }
    },
    [onOpened],
  );

  return { open, openingId, errorId };
}

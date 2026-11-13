import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { API_URL, api, authHeader } from './api';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Download a file the API generates (such as the Excel report) and hand it to the user:
 * a normal download in a browser, the share sheet on a phone (save to Files, WhatsApp, email…).
 */
export async function downloadFromApi(path: string, fileName: string, mimeType = XLSX): Promise<void> {
  await api('/me'); // refreshes the session first if the access token has expired
  const headers = authHeader();
  if (Platform.OS === 'web') {
    const res = await fetch(API_URL + path, { headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? 'Download failed.');
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }
  const target = new File(Paths.cache, fileName);
  if (target.exists) target.delete();
  const file = await File.downloadFileAsync(API_URL + path, target, { headers });
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: fileName, UTI: 'org.openxmlformats.spreadsheetml.sheet' });
}

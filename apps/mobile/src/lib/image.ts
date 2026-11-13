import * as ImagePicker from 'expo-image-picker';

const MAX_CHARS = 1_400_000; // server limit for an embedded image

/**
 * Let the user choose a photo and return it as a data URI, or null if they cancel.
 * The system photo picker is used, so the app never gets access to the whole library.
 */
export async function pickImage(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.4, allowsEditing: false });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  if (!asset.base64) throw new Error('Could not read that image.');
  const uri = `data:${asset.mimeType ?? 'image/jpeg'};base64,${asset.base64}`;
  if (uri.length > MAX_CHARS) throw new Error('That image is too large. Choose a smaller one (under about 1 MB).');
  return uri;
}

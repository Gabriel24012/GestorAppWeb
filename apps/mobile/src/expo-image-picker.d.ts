declare module 'expo-image-picker' {
  export function requestMediaLibraryPermissionsAsync(): Promise<{ granted: boolean }>;
  export function launchImageLibraryAsync(options?: any): Promise<{ canceled: boolean; assets: Array<{ uri: string; mimeType?: string | null; fileName?: string | null }> }>;
}

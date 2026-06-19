export interface TusUploadOptions {
  projectId?: string;
  token?: string;
  onProgress?: (progress: number) => void;
}

export function createTusUpload(file: File, options: TusUploadOptions): Promise<{ id: string; body: unknown }>;
export function patchTusChunk(file: File, uploadId: string, offset: number, token?: string): Promise<number>;
export function getTusIngest(uploadId: string, token?: string): Promise<Record<string, unknown>>;
export function uploadMediaFile(file: File, options: TusUploadOptions): Promise<string>;

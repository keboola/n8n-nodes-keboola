import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';
import axios from 'axios';

vi.mock('axios');
const ax = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

vi.mock('../nodes/Keboola/types', () => ({
  assertNotErrorResponse: vi.fn(),
  validateJobStatus: vi.fn((x) => x),
  validateUploadResponse: vi.fn((x) => x),
  validateTableDetail: vi.fn((x) => x),
  validateBucketDetail: vi.fn((x) => x),
  validateFileMetadata: vi.fn((x) => x),
  validateManifest: vi.fn((x) => x),

  isJobSuccess: vi.fn((x) => x?.status === 'success'),
  isJobFailure: vi.fn((x) => x?.status === 'error'),
  hasFileResults: vi.fn((x) => Boolean(x?.results?.file?.id)),

  hasGcsCredentials: vi.fn((m) => Boolean((m as any)?.gcsCredentials)),
  hasAzureCredentials: vi.fn((m) => Boolean((m as any)?.azureCredentials)),
}));

beforeEach(() => {
  vi.resetAllMocks();

  (axios as any).isAxiosError = vi.fn((e) => Boolean(e && (e as any).response));

  sendMock.mockResolvedValue({ Body: Readable.from('s3-contents') });
});

const sendMock = vi.fn().mockResolvedValue({ Body: Readable.from('s3-contents') });
vi.mock('@aws-sdk/client-s3', () => {
  class FakeS3Client {
    constructor(_opts?: any) {}
    send = sendMock;
  }
  class FakeGetObjectCommand {
    constructor(public input: any) {
      Object.assign(this, input);
    }
  }
  return { S3Client: FakeS3Client, GetObjectCommand: FakeGetObjectCommand };
});

import {
  downloadSignedSlice,
  getAccessToken,
  extractAwsCredentials,
  downloadAwsSlice,
  downloadGcsSlice,
  downloadAzureSlice,
  downloadKeboolaSlices,
  checkTableExists,
  ensureBucketExists,
  uploadCsvToKeboola,
  downloadAllSlices,
} from '../nodes/Keboola/storageFunctions';

describe('storageFunctions.ts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sendMock.mockResolvedValue({ Body: Readable.from('s3-contents') });
  });

  it('downloadSignedSlice: returns body', async () => {
    ax.get = vi.fn().mockResolvedValue({ data: 'ok' });
    await expect(downloadSignedSlice('https://signed/url')).resolves.toBe('ok');
    expect(ax.get).toHaveBeenCalledWith('https://signed/url', { responseType: 'text' });
  });

  it('getAccessToken: prefers GCS creds then generic creds', () => {
    expect(getAccessToken({ provider: 'gcp', url: '', gcsCredentials: { access_token: 'aaa' } } as any)).toBe('aaa');
    expect(getAccessToken({ provider: 'aws', url: '', credentials: { access_token: 'bbb' } } as any)).toBe('bbb');
    expect(getAccessToken({ provider: 'aws', url: '' } as any)).toBeUndefined();
  });

  it('extractAwsCredentials: normalizes various shapes', () => {
    expect(
      extractAwsCredentials({
        provider: 'aws',
        url: '',
        awsCredentials: { AccessKeyId: 'A', SecretAccessKey: 'S', SessionToken: 'T' },
      } as any),
    ).toEqual({ accessKeyId: 'A', secretAccessKey: 'S', sessionToken: 'T' });

    expect(
      extractAwsCredentials({
        provider: 'aws',
        url: '',
        awsCredentials: { AccessKeyId: '', SecretAccessKey: '' },
      } as any),
    ).toBeUndefined();
  });

  it('downloadAwsSlice: uses signed URL first, then S3 client for s3:// fallback', async () => {
    ax.get = vi.fn().mockResolvedValue({ data: 'signed-data' });
    await expect(
      downloadAwsSlice('https://s3.amazonaws.com/x', {
        provider: 'aws',
        url: '',
        region: 'eu-central-1',
        credentials: { AccessKeyId: 'A', SecretAccessKey: 'S' },
      } as any),
    ).resolves.toBe('signed-data');

    ax.get = vi.fn().mockRejectedValue(new Error('bad signed url'));
    const data = await downloadAwsSlice('s3://bucket/path/key.csv', {
      provider: 'aws',
      url: '',
      region: 'eu-central-1',
      credentials: { AccessKeyId: 'A', SecretAccessKey: 'S' },
    } as any);
    expect(data).toBe('s3-contents');
    expect(sendMock).toHaveBeenCalled();
  });

  it('downloadGcsSlice: builds media URL and uses Bearer token', async () => {
    ax.get = vi.fn().mockResolvedValue({ data: 'gcs-data' });
    const metadata = { provider: 'gcp', url: '', gcsCredentials: { access_token: 'tok' } } as any;
    const out = await downloadGcsSlice('gs://my-bucket/folder/file.csv', metadata);
    expect(out).toBe('gcs-data');
    const [url, opts] = ax.get.mock.calls[0];
    expect(String(url)).toContain(
      'https://storage.googleapis.com/storage/v1/b/my-bucket/o/folder%2Ffile.csv?alt=media',
    );
    expect((opts as any).headers.Authorization).toBe('Bearer tok');
  });

  it('downloadAzureSlice: derives token/host from SAS connection string when manifest URL lacks token', async () => {
    ax.get = vi.fn().mockResolvedValue({ data: 'azure-data', status: 200 });
    const metadata = {
      provider: 'azure',
      url: 'https://account.blob.core.windows.net/container/manifest.json', // no query token
      azureCredentials: {
        SASConnectionString:
          'BlobEndpoint=https://account.blob.core.windows.net/;SharedAccessSignature=?sv=2024-01-01&sig=test',
      },
    } as any;

    const data = await downloadAzureSlice('azure://account/container/path/to/slice.csv', metadata);
    expect(data).toBe('azure-data');

    const [finalUrl] = ax.get.mock.calls[0];
    expect(String(finalUrl)).toContain(
      'https://account.blob.core.windows.net/container/path/to/slice.csv?sv=',
    );
  });

  it('downloadKeboolaSlices: dispatches by provider and preserves order (GCS)', async () => {
    ax.get = vi
      .fn()
      .mockResolvedValueOnce({ data: 'g1' })
      .mockResolvedValueOnce({ data: 'g2' });

    const out = await downloadKeboolaSlices(
      [{ url: 'gs://my-bucket/a.csv' }, { url: 'gs://my-bucket/b.csv' }],
      { provider: 'gcp', url: '', gcsCredentials: { access_token: 'x' } } as any,
    );

    expect(out).toEqual(['g1', 'g2']);
  });

  it('checkTableExists: true on 200, false on 404', async () => {
    ax.get = vi.fn().mockResolvedValueOnce({ data: { id: 'in.c-demo.t', rowsCount: 10 } });
    await expect(checkTableExists('in.c-demo.t', 'https://conn', { X: 'T' } as any)).resolves.toBe(true);

    const notFound = { response: { status: 404 } };
    ax.get = vi.fn().mockRejectedValueOnce(notFound);
    await expect(checkTableExists('in.c-demo.t', 'https://conn', { X: 'T' } as any)).resolves.toBe(false);
  });

  it('ensureBucketExists: 404 triggers createBucket POST', async () => {
    const notFound = { response: { status: 404 } };
    ax.get = vi.fn().mockRejectedValueOnce(notFound);
    ax.post = vi.fn().mockResolvedValueOnce({ data: { id: 'in.c-b', name: 'b' } });

    await expect(ensureBucketExists('in.c-b', 'https://conn', 'TOKEN')).resolves.toBeUndefined();

    expect(ax.post).toHaveBeenCalledWith(
      'https://conn/v2/storage/buckets',
      { name: 'b', stage: 'in' },
      { headers: { 'X-StorageApi-Token': 'TOKEN' } },
    );
  });

  it('uploadCsvToKeboola: success returns file id; error wraps as KeboolaUploadError', async () => {
    ax.post = vi.fn().mockResolvedValueOnce({ data: { id: 123, name: 'upload.csv' } });
    await expect(
      uploadCsvToKeboola('a,b\n1,2', 'https://connection.keboola.com', 'T'),
    ).resolves.toBe(123);

    ax.post = vi.fn().mockRejectedValueOnce({ response: { data: { message: 'nope' } } });
    await expect(
      uploadCsvToKeboola('a,b\n1,2', 'https://connection.keboola.com', 'T'),
    ).rejects.toThrow(/Upload failed:/);
  });

  it('downloadAllSlices: fetches manifest then both slices', async () => {
    ax.get = vi
      .fn()
      .mockResolvedValueOnce({ data: { entries: [{ url: 'gs://bkt/a.csv' }, { url: 'gs://bkt/b.csv' }] } })
      .mockResolvedValueOnce({ data: 'slice-a' })
      .mockResolvedValueOnce({ data: 'slice-b' });

    const meta = { provider: 'gcp', url: 'https://manifest', gcsCredentials: { access_token: 'x' } } as any;
    await expect(downloadAllSlices(meta)).resolves.toEqual(['slice-a', 'slice-b']);
  });
});

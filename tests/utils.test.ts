import { describe, it, expect, vi } from 'vitest';

// import from your source
import {
  buildCsvFromItems,
  detectCloudProvider,
  parseCsv,
  createTableIdentifiers,
  parsePrimaryKeys,
  extractColumnsFromItems,
  validateBucketId,
  createUploadUrl,
  formatUploadSuccessMessage,
  delay,
  extractAwsRegion,
  extractCredentials,
  extractExtractParams,
  extractUploadParams,
} from '../nodes/Keboola/utils';

// lightweight helper for INodeExecutionData-ish objects
const item = (json: Record<string, unknown>) => ({ json }) as { json: Record<string, unknown> };

describe('utils.ts', () => {
  it('buildCsvFromItems: quotes fields with commas/quotes and adds header', () => {
    const items = [item({ a: 'hello', b: 'x,y' }), item({ a: 'he"llo', b: 'z' })];
    const csv = buildCsvFromItems(items, ['a', 'b']);
    expect(csv).toBe('a,b\nhello,"x,y"\n"he""llo",z');
  });

  it('buildCsvFromItems: throws on empty items', () => {
    expect(() => buildCsvFromItems([], ['a'])).toThrow(/No items to convert to CSV/);
  });

  it('detectCloudProvider: detects gcp/aws/azure', () => {
    expect(detectCloudProvider('gs://bucket/path')).toBe('gcp');
    expect(detectCloudProvider('https://storage.googleapis.com/x')).toBe('gcp');
    expect(detectCloudProvider('s3://bucket/key')).toBe('aws');
    expect(detectCloudProvider('https://my-bucket.s3.amazonaws.com/key')).toBe('aws');
    expect(detectCloudProvider('azure://account/container/blob')).toBe('azure');
    expect(detectCloudProvider('https://account.blob.core.windows.net/container/blob')).toBe('azure');
  });

  it('parseCsv: maps columns for simple CSV (no quotes)', () => {
    const rows = parseCsv('a,b\n1,2', ['col1', 'col2']);
    expect(rows).toEqual([
      { col1: 'a', col2: 'b' },
      { col1: '1', col2: '2' },
    ]);
  });

  it('createTableIdentifiers: builds ids and incremental flag', () => {
    const id = createTableIdentifiers({
      bucketStage: 'in',
      bucketName: 'demo',
      tableName: 'orders',
      importMode: 'incremental',
      primaryKeys: [],
      uploadFilename: 'f.csv',
    });
    expect(id).toEqual({
      bucketId: 'in.c-demo',
      tableId: 'in.c-demo.orders',
      incremental: true,
    });
  });

  it('parsePrimaryKeys: supports string, array, undefined', () => {
    expect(parsePrimaryKeys('id,  sku ,')).toEqual(['id', 'sku']);
    expect(parsePrimaryKeys(['id', '', 'sku'])).toEqual(['id', 'sku']);
    expect(parsePrimaryKeys(undefined)).toEqual([]);
  });

  it('extractColumnsFromItems: returns first item keys', () => {
    expect(extractColumnsFromItems([item({ a: 1, b: 2 })])).toEqual(['a', 'b']);
  });

  it('validateBucketId: parses valid and rejects invalid', () => {
    expect(validateBucketId('in.c-bucket')).toEqual({ stage: 'in', name: 'bucket' });
    expect(() => validateBucketId('in.bucket')).toThrow(/Invalid bucket ID/);
  });

  it('createUploadUrl: rewrites connection.* to import.*', () => {
    expect(createUploadUrl('https://connection.keboola.com')).toBe(
      'https://import.keboola.com/upload-file',
    );
  });

  it('formatUploadSuccessMessage', () => {
    expect(formatUploadSuccessMessage(5, 'in.c-demo.orders')).toBe(
      'Uploaded 5 rows to in.c-demo.orders',
    );
  });

  it('delay: resolves after ms (fake timers)', async () => {
    vi.useFakeTimers();
    const p = delay(1000);
    vi.advanceTimersByTime(1000);
    await expect(p).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it('extractAwsRegion: parses region or falls back', () => {
    expect(extractAwsRegion('https://my-bucket.s3.us-west-2.amazonaws.com/key')).toBe('us-west-2');
    expect(extractAwsRegion('https://s3.amazonaws.com/my-bucket/key')).toBe('us-east-1');
    expect(extractAwsRegion('not-a-url')).toBe('us-east-1'); // logs warn, default
  });

  it('extractCredentials/extract*Params: pulls values from IExecuteFunctions-like object', async () => {
    const exec: any = {
      getCredentials: vi.fn().mockResolvedValue({ apiToken: 't', stack: 'https://connection.keboola.com' }),
      getNodeParameter: vi.fn().mockImplementation((name: string) => {
        const vals: Record<string, unknown> = {
          tableId: 'in.c-demo.orders',
          bucketStage: 'in',
          bucketName: 'demo',
          tableName: 'orders',
          primaryKeys: 'id,sku',
          importMode: 'full',
        };
        return vals[name];
      }),
    };

    await expect(extractCredentials(exec)).resolves.toEqual({
      apiToken: 't',
      stack: 'https://connection.keboola.com',
    });

    expect(extractExtractParams(exec)).toEqual({ tableId: 'in.c-demo.orders' });

    expect(extractUploadParams(exec)).toEqual({
      bucketStage: 'in',
      bucketName: 'demo',
      tableName: 'orders',
      primaryKeys: ['id', 'sku'],
      importMode: 'full',
      uploadFilename: 'upload.csv',
    });
  });
});

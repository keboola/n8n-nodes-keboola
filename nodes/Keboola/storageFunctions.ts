import { Buffer } from 'buffer';
import axios, { type AxiosError } from 'axios';
import FormData from 'form-data';
import type { INodeExecutionData } from 'n8n-workflow';
import { UnexpectedError } from 'n8n-workflow';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

import {
	JobStatus,
	FileMetadata,
	CreateBucketRequest,
	CreateTableRequest,
	ImportTableRequest,
	KeboolaTableIdentifiers,
	DownloadTableResult,
	KeboolaCredentials,
	ExtractParams,
	UploadParams,
	hasAzureCredentials,
} from './types';
import {
	validateJobStatus,
	validateUploadResponse,
	validateTableDetail,
	validateBucketDetail,
	validateFileMetadata,
	validateManifest,
	assertNotErrorResponse,
	isJobSuccess,
	isJobFailure,
	hasFileResults,
	hasGcsCredentials,
} from './types';
import {
	validateBucketId,
	createUploadUrl,
	delay,
	buildCsvFromItems,
	createTableIdentifiers,
	extractColumnsFromItems,
	formatUploadSuccessMessage,
} from './utils';

import { LoggerProxy } from 'n8n-workflow';

const MAX_JOB_ATTEMPTS = 30;
const POLLING_INTERVAL_MS = 2000;

export class KeboolaJobTimeoutError extends Error {
	constructor(message: string = 'Job did not complete within the timeout period') {
		super(message);
		this.name = 'KeboolaJobTimeoutError';
	}
}

export class KeboolaJobFailedError extends Error {
	readonly jobData: JobStatus;

	constructor(jobData: JobStatus) {
		super(
			`Job failed with status '${jobData.status}': ${jobData.error?.message || 'Unknown error'}`,
		);
		this.name = 'KeboolaJobFailedError';
		this.jobData = jobData;
	}
}

export class KeboolaUploadError extends Error {
	readonly response: unknown;

	constructor(response: unknown) {
		super(`Upload failed: ${JSON.stringify(response)}`);
		this.name = 'KeboolaUploadError';
		this.response = response;
	}
}

export class KeboolaValidationError extends Error {
	constructor(
		message: string,
		readonly originalError: Error,
	) {
		super(message);
		this.name = 'KeboolaValidationError';
	}
}

async function streamToString(stream: Readable): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString('utf-8');
}

export async function downloadSignedSlice(signedUrl: string): Promise<string> {
	const response = await axios.get(signedUrl, {
		responseType: 'text',
	});
	return response.data;
}

export function getAccessToken(metadata: FileMetadata): string | undefined {
	if (hasGcsCredentials(metadata)) {
		return metadata.gcsCredentials.access_token;
	}
	if (metadata.credentials?.access_token) {
		return metadata.credentials.access_token;
	}
	return undefined;
}

export function extractAwsCredentials(metadata: FileMetadata):
	| {
			accessKeyId: string;
			secretAccessKey: string;
			sessionToken?: string;
	  }
	| undefined {
	const creds = metadata.awsCredentials;

	if (!creds?.AccessKeyId || !creds.SecretAccessKey) {
		return undefined;
	}

	return {
		accessKeyId: creds.AccessKeyId,
		secretAccessKey: creds.SecretAccessKey,
		sessionToken: creds.SessionToken,
	};
}

export async function downloadAwsSlice(s3Url: string, metadata: FileMetadata): Promise<string> {
	// Try signed URL first if it's HTTPS
	if (s3Url.startsWith('https://')) {
		try {
			return await downloadSignedSlice(s3Url);
		} catch (error) {
			LoggerProxy.debug('[AWS] Signed download failed, trying S3 client');
		}
	}

	if (!s3Url.startsWith('s3://')) {
		throw new UnexpectedError(`Invalid S3 URL format: ${s3Url}`);
	}

	const [bucket, ...keyParts] = s3Url.slice(5).split('/');
	const key = keyParts.join('/');
	const region = metadata.region || 'eu-central-1';

	let awsCreds:
		| {
				accessKeyId: string;
				secretAccessKey: string;
				sessionToken?: string;
		  }
		| undefined;

	if (metadata.credentials) {
		const c = metadata.credentials as any;
		const accessKeyId = c.AccessKeyId || c.accessKeyId;
		const secretAccessKey = c.SecretAccessKey || c.secretAccessKey;
		const sessionToken = c.SessionToken || c.sessionToken;

		if (accessKeyId && secretAccessKey) {
			awsCreds = { accessKeyId, secretAccessKey, sessionToken };
		}
	}

	if (!awsCreds && metadata.awsCredentials) {
		awsCreds = extractAwsCredentials(metadata);
	}

	if (!awsCreds?.accessKeyId || !awsCreds?.secretAccessKey) {
		throw new UnexpectedError('Missing AWS credentials for S3 slice download.');
	}

	const s3Client = new S3Client({
		region,
		credentials: {
			accessKeyId: awsCreds.accessKeyId,
			secretAccessKey: awsCreds.secretAccessKey,
			...(awsCreds.sessionToken && { sessionToken: awsCreds.sessionToken }),
		},
	});

	try {
		const response = await s3Client.send(
			new GetObjectCommand({
				Bucket: bucket,
				Key: key,
			}),
		);

		if (!response.Body) {
			throw new UnexpectedError(`Empty response body from S3 for s3://${bucket}/${key}`);
		}

		return await streamToString(response.Body as Readable);
	} catch (error) {
		LoggerProxy.error('[AWS] S3 download error', {
			bucket,
			key,
			region,
			error: error instanceof Error ? error.message : String(error),
		});
		throw new UnexpectedError(
			`Failed to download S3 slice: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function downloadGcsSlice(gsUrl: string, metadata: FileMetadata): Promise<string> {
	if (!gsUrl.startsWith('gs://')) {
		throw new UnexpectedError(`Invalid GCS URL format: ${gsUrl}`);
	}

	const credentials = metadata.gcsCredentials;
	if (!credentials) {
		throw new UnexpectedError('No GCS credentials found in metadata');
	}

	try {
		const match = gsUrl.match(/^gs:\/\/([^\/]+)\/(.+)$/);
		if (!match) {
			throw new UnexpectedError(`Failed to parse GCS URL: ${gsUrl}`);
		}

		const [, bucket, path] = match;
		const quotedPath = encodeURIComponent(path);
		const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${quotedPath}?alt=media`;

		const headers = {
			Authorization: `Bearer ${credentials.access_token}`,
		};

		LoggerProxy.debug('[GCS] Downloading object', { url });

		const response = await axios.get(url, {
			headers,
			responseType: 'text',
		});

		return response.data;
	} catch (error) {
		LoggerProxy.error('[GCS] Download error', { error });
		throw new UnexpectedError(
			`Failed to download GCS slice: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function downloadAzureSlice(
	azureUrl: string,
	metadata: FileMetadata,
): Promise<string> {
	LoggerProxy.info('[Azure] Starting slice download', {
		azureUrl,
		manifestUrl: metadata.url,
	});

	const parsed = new URL(metadata.url);
	let storageHost = parsed.host;
	let sasToken = parsed.searchParams.toString();

	LoggerProxy.debug('[Azure] Parsed manifest URL', {
		storageHost,
		sasToken,
	});

	if (!sasToken && hasAzureCredentials(metadata)) {
		LoggerProxy.info('[Azure] Manifest URL has no token. Falling back to azureCredentials.');

		const connString = metadata.azureCredentials.SASConnectionString;
		LoggerProxy.debug('[Azure] Full SAS connection string', { connString });

		const tokenStart = connString.indexOf('?');
		if (tokenStart !== -1) {
			sasToken = connString.substring(tokenStart + 1);
		}

		const hostMatch = connString.match(/https:\/\/([^\/]+)/);
		if (hostMatch && hostMatch[1]) {
			storageHost = hostMatch[1];
		}

		LoggerProxy.debug('[Azure] Fallback token and host extracted', {
			sasToken,
			storageHost,
		});
	}

	if (!sasToken) {
		LoggerProxy.error('[Azure] No SAS token found after all attempts.');
		throw new UnexpectedError('No SAS token available for Azure slice download.');
	}

	if (!azureUrl.startsWith('azure://')) {
		throw new UnexpectedError(`Invalid Azure URL format: ${azureUrl}`);
	}

	const withoutPrefix = azureUrl.replace('azure://', '');
	const firstSlash = withoutPrefix.indexOf('/');
	if (firstSlash === -1) {
		throw new UnexpectedError(`Invalid Azure URL format: ${azureUrl}`);
	}

	const fullBlobPath = withoutPrefix.substring(firstSlash + 1);

	LoggerProxy.debug('[Azure] Slice URL parts', {
		hostFromSlice: withoutPrefix.substring(0, firstSlash),
		path: fullBlobPath,
		storageHost,
		sasToken,
	});

	const httpsUrl = `https://${storageHost}/${fullBlobPath}?${sasToken}`;

	LoggerProxy.info('[Azure] Final download URL', {
		httpsUrl,
	});

	try {
		const response = await axios.get(httpsUrl, {
			responseType: 'text',
		});

		LoggerProxy.info('[Azure] Slice downloaded successfully', {
			status: response.status,
			bytesDownloaded: response.data?.length,
		});

		return response.data;
	} catch (error) {
		if (axios.isAxiosError(error)) {
			LoggerProxy.error('[Azure] Axios error during slice download.', {
				status: error.response?.status,
				statusText: error.response?.statusText,
				headers: error.response?.headers,
				data: error.response?.data,
				requestUrl: error.config?.url,
			});
		} else {
			LoggerProxy.error('[Azure] Non-Axios error thrown.', {
				errorMessage: (error as Error).message,
				stack: (error as Error).stack,
			});
		}
		throw new UnexpectedError(`Failed to download Azure slice: ${(error as Error).message}`);
	}
}

export async function downloadKeboolaSlices(
	entries: Array<{ url: string; mandatory?: boolean }>,
	metadata: FileMetadata,
): Promise<string[]> {
	const provider = metadata.provider.toLowerCase();

	LoggerProxy.debug('[Slices] Using cloud provider', { provider });

	const slicePromises = entries.map(async (entry) => {
		try {
			const url = entry.url;
			LoggerProxy.debug('[Slice] Downloading', { url });

			if (provider === 'gcp') {
				return await downloadGcsSlice(url, metadata);
			} else if (provider === 'aws') {
				return await downloadAwsSlice(url, metadata);
			} else if (provider === 'azure') {
				return await downloadAzureSlice(url, metadata);
			} else {
				throw new UnexpectedError(`Unsupported cloud provider: ${provider}`);
			}
		} catch (error) {
			LoggerProxy.error('[Slice] Download failed: ', { url: entry.url, error });

			if (entry.mandatory !== false) {
				throw error;
			}

			return '';
		}
	});

	return await Promise.all(slicePromises);
}

export async function downloadAllSlices(metadata: FileMetadata): Promise<string[]> {
	const manifestUrl = metadata.url;
	LoggerProxy.debug('[Manifest] Downloading: ', { manifestUrl });
	const manifestResponse = await axios.get(manifestUrl);
	const manifest = validateManifest(manifestResponse.data);

	return await downloadKeboolaSlices(manifest.entries, metadata);
}

export async function startTableExport(
	tableId: string,
	apiUrl: string,
	headers: Record<string, string>,
): Promise<JobStatus> {
	const exportUrl = `${apiUrl}/v2/storage/tables/${tableId}/export-async`;
	const response = await axios.post(exportUrl, { format: 'rfc' }, { headers });

	assertNotErrorResponse(response.data);
	return validateJobStatus(response.data);
}

export async function waitForJobCompletion(
	jobUrl: string,
	headers: Record<string, string>,
	maxAttempts: number = MAX_JOB_ATTEMPTS,
): Promise<void> {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const { data } = await axios.get(jobUrl, { headers });

			assertNotErrorResponse(data);
			const jobStatus = validateJobStatus(data);

			if (isJobSuccess(jobStatus)) {
				return;
			}

			if (isJobFailure(jobStatus)) {
				throw new KeboolaJobFailedError(jobStatus);
			}

			await delay(POLLING_INTERVAL_MS);
		} catch (error) {
			if (error instanceof KeboolaJobFailedError) {
				throw error;
			}
			if (error instanceof KeboolaValidationError) {
				throw error;
			}

			if (attempt === maxAttempts) {
				throw error;
			}
			await delay(POLLING_INTERVAL_MS);
		}
	}

	throw new KeboolaJobTimeoutError();
}

export async function waitForExportAndGetMetadata(
	jobId: string,
	apiUrl: string,
	headers: Record<string, string>,
): Promise<FileMetadata> {
	const jobUrl = `${apiUrl}/v2/storage/jobs/${jobId}`;

	for (let attempt = 1; attempt <= MAX_JOB_ATTEMPTS; attempt++) {
		try {
			const { data } = await axios.get(jobUrl, { headers });
			assertNotErrorResponse(data);
			const jobStatus = validateJobStatus(data);

			LoggerProxy.debug('Job Attempt: ', { jobId, attempt, status: jobStatus.status });

			if (isJobSuccess(jobStatus)) {
				LoggerProxy.debug('Job Succeeded. Checking file results...', { jobId });

				if (!hasFileResults(jobStatus)) {
					throw new UnexpectedError('Job completed successfully but no file results found');
				}

				const fileId = jobStatus.results.file.id;
				LoggerProxy.debug('Job File ID Found. Checking file results...', { jobId, fileId });

				const metaUrl = `${apiUrl}/v2/storage/files/${fileId}?federationToken=1`;
				const metaResponse = await axios.get(metaUrl, { headers });

				assertNotErrorResponse(metaResponse.data);
				return validateFileMetadata(metaResponse.data);
			}

			if (isJobFailure(jobStatus)) {
				LoggerProxy.error('Job Failed: ', { jobId, error: jobStatus.error });
				throw new KeboolaJobFailedError(jobStatus);
			}

			await delay(POLLING_INTERVAL_MS);
		} catch (error) {
			LoggerProxy.error('Job Error: ', { jobId, error: error });

			if (error instanceof KeboolaJobFailedError || error instanceof KeboolaValidationError) {
				throw error;
			}

			if (attempt === MAX_JOB_ATTEMPTS) throw error;
			await delay(POLLING_INTERVAL_MS);
		}
	}

	throw new KeboolaJobTimeoutError('Export job did not complete in time');
}

function parseCSVLine(line: string): string[] {
	const result: string[] = [];
	let current = '';
	let inQuotes = false;
	let i = 0;

	while (i < line.length) {
		const char = line[i];

		if (char === '"') {
			if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
				current += '"';
				i += 2;
			} else {
				inQuotes = !inQuotes;
				i++;
			}
		} else if (char === ',' && !inQuotes) {
			result.push(current);
			current = '';
			i++;
		} else {
			current += char;
			i++;
		}
	}

	result.push(current);
	return result;
}

function improvedParseCsv(csv: string, columns: string[]): Array<Record<string, string>> {
	const lines = csv.trim().split('\n');
	const rows: Array<Record<string, string>> = [];

	for (const line of lines) {
		if (line.trim() === '') continue;

		const values = parseCSVLine(line);
		const row: Record<string, string> = {};

		for (let i = 0; i < columns.length; i++) {
			const value = values[i] || '';
			const cleanValue = value
				.replace(/^"(.*)"$/, '$1')
				.replace(/""/g, '"')
				.replace(/^""|""$/g, '')
				.trim();

			row[columns[i]] = cleanValue;
		}

		rows.push(row);
	}

	return rows;
}

export async function createBucket(
	bucketId: string,
	apiUrl: string,
	headers: Record<string, string>,
): Promise<void> {
	const { stage, name } = validateBucketId(bucketId);

	LoggerProxy.info('Creating Bucket: ', { name, stage });

	const requestData: CreateBucketRequest = {
		name,
		stage: stage as 'in' | 'out',
	};

	const response = await axios.post(`${apiUrl}/v2/storage/buckets`, requestData, { headers });
	assertNotErrorResponse(response.data);
	const bucketDetail = validateBucketDetail(response.data);

	LoggerProxy.info('Bucket created successfully: ', { id: bucketDetail.id });
}

export async function checkTableExists(
	tableId: string,
	apiUrl: string,
	headers: Record<string, string>,
): Promise<boolean> {
	try {
		const response = await axios.get(`${apiUrl}/v2/storage/tables/${tableId}`, { headers });
		assertNotErrorResponse(response.data);
		const tableDetail = validateTableDetail(response.data);
		LoggerProxy.info('Table Exists: ', { id: tableDetail.id, rowsCount: tableDetail.rowsCount });
		return true;
	} catch (error) {
		if (axios.isAxiosError(error) && error.response?.status === 404) {
			LoggerProxy.info('Table does not exist ', { tableId });
			return false;
		}
		LoggerProxy.error('Table check failed ', {
			error: (error as AxiosError).response?.data || (error as Error).message,
		});
		throw error;
	}
}

export async function createTable(
	bucketId: string,
	tableName: string,
	fileId: number,
	apiUrl: string,
	headers: Record<string, string>,
	primaryKeys?: string[],
	incremental: boolean = false,
): Promise<void> {
	const payload: CreateTableRequest = {
		name: tableName,
		dataFileId: fileId,
		delimiter: ',',
		enclosure: '"',
		incremental,
		...(primaryKeys && primaryKeys.length > 0 && { primaryKey: primaryKeys.join(',') }),
	};

	const createUrl = `${apiUrl}/v2/storage/buckets/${bucketId}/tables-async`;
	const response = await axios.post(createUrl, payload, { headers });

	assertNotErrorResponse(response.data);
	const job = validateJobStatus(response.data);

	await waitForJobCompletion(`${apiUrl}/v2/storage/jobs/${job.id}`, headers);
	LoggerProxy.info('Table created successfully ', {
		detail: `${bucketId}.${tableName}`,
	});
}

export async function importToExistingTable(
	tableId: string,
	fileId: number,
	apiUrl: string,
	headers: Record<string, string>,
): Promise<void> {
	const payload: ImportTableRequest = {
		dataFileId: fileId,
		delimiter: ',',
		enclosure: '"',
		incremental: false,
	};

	const importUrl = `${apiUrl}/v2/storage/tables/${tableId}/import-async`;
	const response = await axios.post(importUrl, payload, { headers });

	assertNotErrorResponse(response.data);
	const job = validateJobStatus(response.data);

	await waitForJobCompletion(`${apiUrl}/v2/storage/jobs/${job.id}`, headers);
	LoggerProxy.info('Table import completed ', {
		tableId,
	});
}

export async function uploadCsvToKeboola(
	csv: string,
	apiUrl: string,
	apiToken: string,
	uploadFilename: string = 'upload.csv',
): Promise<number> {
	const form = new FormData();
	form.append('name', uploadFilename);
	form.append('data', Buffer.from(csv), {
		filename: uploadFilename,
		contentType: 'text/csv',
	});
	form.append('notify', '0');
	form.append('isPermanent', '0');
	form.append('tags[]', 'n8n-upload');

	const uploadUrl = createUploadUrl(apiUrl);

	try {
		const response = await axios.post(uploadUrl, form, {
			headers: {
				...form.getHeaders(),
				'X-StorageApi-Token': apiToken,
			},
		});

		assertNotErrorResponse(response.data);
		const uploadResponse = validateUploadResponse(response.data);
		LoggerProxy.info('File uploaded successfully ', {
			id: uploadResponse.id,
			name: uploadResponse.name,
		});

		return uploadResponse.id;
	} catch (error) {
		if (axios.isAxiosError(error)) {
			const errorDetails = {
				status: error.response?.status,
				data: error.response?.data,
				message: error.message,
			};
			LoggerProxy.error('Upload request error: ', {
				errorDetails,
			});
		}

		if (error instanceof KeboolaValidationError) {
			throw error;
		}

		const errorData = axios.isAxiosError(error) ? error.response?.data : (error as Error).message;
		throw new KeboolaUploadError(errorData);
	}
}

export async function ensureBucketExists(
	bucketId: string,
	apiUrl: string,
	apiToken: string,
): Promise<void> {
	const headers = { 'X-StorageApi-Token': apiToken };

	try {
		const response = await axios.get(`${apiUrl}/v2/storage/buckets/${bucketId}`, { headers });
		assertNotErrorResponse(response.data);
		const bucketDetail = validateBucketDetail(response.data);
		LoggerProxy.info('Bucket Exist ', {
			id: bucketDetail.id,
			name: bucketDetail.name,
		});
	} catch (error) {
		if (axios.isAxiosError(error) && error.response?.status === 404) {
			await createBucket(bucketId, apiUrl, headers);
		} else {
			const errorData = axios.isAxiosError(error) ? error.response?.data : (error as Error).message;
			LoggerProxy.error('Bucket check error ', {
				error: errorData,
			});
			throw error;
		}
	}
}

export async function ensureTableAndImport(
	apiUrl: string,
	apiToken: string,
	{ bucketId, tableId, incremental }: KeboolaTableIdentifiers,
	tableName: string,
	fileId: number,
	primaryKeys?: string[],
): Promise<void> {
	const headers = { 'X-StorageApi-Token': apiToken };

	await ensureBucketExists(bucketId, apiUrl, apiToken);

	const tableExists = await checkTableExists(tableId, apiUrl, headers);

	if (!tableExists) {
		await createTable(bucketId, tableName, fileId, apiUrl, headers, primaryKeys, incremental);
	} else {
		await importToExistingTable(tableId, fileId, apiUrl, headers);
	}
}

export async function fetchTableColumns(
	tableId: string,
	apiUrl: string,
	apiToken: string,
): Promise<string[]> {
	const headers = { 'X-StorageApi-Token': apiToken };
	const response = await axios.get(`${apiUrl}/v2/storage/tables/${tableId}`, { headers });

	assertNotErrorResponse(response.data);
	const tableDetail = validateTableDetail(response.data);

	return tableDetail.columns;
}

export async function downloadKeboolaTable(
	tableId: string,
	apiUrl: string,
	apiToken: string,
): Promise<DownloadTableResult> {
	const headers = { 'X-StorageApi-Token': apiToken };
	const kbcApiUrl = apiUrl.replace(/\/$/, '');

	const columns = await fetchTableColumns(tableId, kbcApiUrl, apiToken);
	const exportJobData = await startTableExport(tableId, kbcApiUrl, headers);

	const fileMetadata = await waitForExportAndGetMetadata(exportJobData.id, kbcApiUrl, headers);

	const csvSlices = await downloadAllSlices(fileMetadata);
	const rows = csvSlices.flatMap((csv) => improvedParseCsv(csv, columns));

	LoggerProxy.info('Data downloaded', {
		tableId,
		noRows: rows.length,
	});
	return { rows };
}

export async function handleExtractOperation(
	params: ExtractParams,
	credentials: KeboolaCredentials,
): Promise<INodeExecutionData[]> {
	LoggerProxy.info('Extracting data from table', {
		tableId: params.tableId,
	});

	const { rows } = await downloadKeboolaTable(
		params.tableId,
		credentials.stack,
		credentials.apiToken,
	);

	LoggerProxy.info('Data extracted', {
		noRows: rows.length,
	});

	return rows.map((row) => ({ json: row }));
}

export async function handleUploadOperation(
	params: UploadParams,
	credentials: KeboolaCredentials,
	inputItems: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	if (inputItems.length === 0) {
		throw new UnexpectedError('No data items to upload');
	}

	LoggerProxy.info('Uploading data to Keboola Connection...', {
		noRows: inputItems.length,
	});

	const columns = extractColumnsFromItems(inputItems);
	const csv = buildCsvFromItems(inputItems, columns);

	const fileId = await uploadCsvToKeboola(
		csv,
		credentials.stack,
		credentials.apiToken,
		params.uploadFilename,
	);

	LoggerProxy.info('File uploaded successfully', {
		fileId,
	});

	const tableIdentifiers = createTableIdentifiers(params);

	await ensureTableAndImport(
		credentials.stack,
		credentials.apiToken,
		tableIdentifiers,
		params.tableName,
		fileId,
		params.primaryKeys.length > 0 ? params.primaryKeys : undefined,
	);

	const successMessage = formatUploadSuccessMessage(inputItems.length, tableIdentifiers.tableId);
	LoggerProxy.info(successMessage);
	return [{ json: { message: successMessage } }];
}

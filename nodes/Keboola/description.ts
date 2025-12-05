import { INodeProperties } from 'n8n-workflow';

export const keboolaNodeDescription: INodeProperties[] = [
	{
		displayName: 'Authentication',
		name: 'authentication',
		type: 'options',
		noDataExpression: true,
		default: 'keboolaStorageApi',
		options: [
			{
				name: 'API Token',
				value: 'keboolaStorageApi',
			},
		],
	},
	{
		displayName: 'Credentials',
		name: 'credentials',
		type: 'credentials',
		default: '',
		required: true,
		displayOptions: {
			show: {
				authentication: ['keboolaStorageApi'],
			},
		},
		credentialTypes: ['has:authenticate'],
	},
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		options: [{ name: 'Table', value: 'table' }],
		default: 'table',
		required: true,
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['table'],
			},
		},
		options: [
			{
				name: 'Extract',
				action: 'Data export',
				value: 'extract',
				description: 'Export data from a keboola project',
			},
			{
				name: 'Upload',
				action: 'Data import',
				value: 'upload',
				description: 'Import data to a keboola project',
			},
		],
		default: 'extract',
		required: true,
	},
	{
		displayName: 'Table ID',
		name: 'tableId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				operation: ['extract'],
			},
		},
	},
	{
		displayName: 'Bucket Stage',
		name: 'bucketStage',
		type: 'options',
		default: 'out',
		options: [
			{ name: 'Input (In)', value: 'in' },
			{ name: 'Output (Out)', value: 'out' },
		],
		displayOptions: {
			show: {
				operation: ['upload'],
			},
		},
		description: 'Stage of the bucket (in or out)',
	},
	{
		displayName: 'Bucket Name',
		name: 'bucketName',
		type: 'string',
		default: 'n8n',
		description: 'Keboola bucket name (without stage or "c-")',
		displayOptions: {
			show: {
				operation: ['upload'],
			},
		},
	},
	{
		displayName: 'Table Name',
		name: 'tableName',
		type: 'string',
		default: 'output',
		required: true,
		description: 'Keboola table name inside the bucket',
		displayOptions: {
			show: {
				operation: ['upload'],
			},
		},
	},
	{
		displayName: 'Primary Key(s)',
		name: 'primaryKeys',
		type: 'string',
		default: '',
		description: 'Comma-separated list of primary key columns (optional)',
		displayOptions: {
			show: {
				operation: ['upload'],
			},
		},
	},
	{
		displayName: 'Import Mode',
		name: 'importMode',
		type: 'options',
		default: 'full',
		options: [
			{ name: 'Full Load (Replace All Rows)', value: 'full' },
			{ name: 'Incremental Load (Append or Update by Primary Key)', value: 'incremental' },
		],
		description:
			'Full Load will replace all rows in the table. Incremental Load will append or update rows based on the primary key.',
		displayOptions: {
			show: {
				operation: ['upload'],
			},
		},
	},
];

import {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class KeboolaStorageApi implements ICredentialType {
	name = 'keboolaStorageApi';
	displayName = 'Keboola Storage API';
	documentationUrl = 'https://developers.keboola.com/integrate/storage/api/';

	icon = { light: 'file:keboola.svg', dark: 'file:keboola.svg' } as const;

	properties: INodeProperties[] = [
		{
			displayName: 'Stack Region',
			name: 'stack',
			type: 'options',
			options: [
				{
					name: 'connection.keboola.com (Stack: AWS, Region: us-east-1)',
					value: 'https://connection.keboola.com',
				},
				{
					name: 'connection.eu-central-1.keboola.com (Stack: AWS, Region: eu-central-1)',
					value: 'https://connection.eu-central-1.keboola.com',
				},
				{
					name: 'connection.north-europe.azure.keboola.com (Stack: Azure, Region: north-europe)',
					value: 'https://connection.north-europe.azure.keboola.com',
				},
				{
					name: 'connection.us-east4.gcp.keboola.com (Stack: GCP, Region: us-east4)',
					value: 'https://connection.us-east4.gcp.keboola.com',
				},
			],
			default: 'https://connection.keboola.com',
		},
		{
			displayName: 'API Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-StorageApi-Token': '={{$credentials.apiToken}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.stack}}',
			url: '/v2/storage/tokens',
		},
	};
}

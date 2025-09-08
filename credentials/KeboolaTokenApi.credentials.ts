import {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class KeboolaTokenApi implements ICredentialType {
	name = 'keboolaTokenApi';
	displayName = 'Keboola Token API';
	documentationUrl = 'https://developers.keboola.com/integrate/storage/api/';

	properties: INodeProperties[] = [
		{
			displayName: 'Stack Region',
			name: 'stack',
			type: 'options',
			options: [
				{ name: 'US (Default)', value: 'https://connection.keboola.com' },
				{ name: 'EU Central (AWS)', value: 'https://connection.eu-central-1.keboola.com' },
				{ name: 'EU North (Azure)', value: 'https://connection.north-europe.azure.keboola.com' },
				{ name: 'US East (GCP)', value: 'https://connection.us-east4.gcp.keboola.com' },
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

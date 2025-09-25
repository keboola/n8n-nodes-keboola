import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import { NodeConnectionType } from 'n8n-workflow';
import { keboolaNodeDescription } from './description';
import { keboolaNodeExecution } from './execution';

export class Keboola implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Keboola',
		name: 'keboola',
		icon: 'file:keboola.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with Keboola Storage API',
		defaults: {
			name: 'Keboola',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'keboolaStorageApi',
				required: true,
				displayOptions: {
					show: {
						authentication: ['keboolaStorageApi'],
					},
				},
			},
		],
		properties: keboolaNodeDescription,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await keboolaNodeExecution.apply(this, arguments as any);
	}
}

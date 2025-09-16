/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { IChannel, IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IQuickPickItem, IPickOptions, QuickPickInput } from './quickInput.js';

export interface IQuickInputDebugEvent {
	readonly timestamp: number;
	readonly operation: string;
	readonly picks?: QuickPickInput<IQuickPickItem>[];
	readonly options?: IPickOptions<IQuickPickItem>;
	readonly result?: IQuickPickItem | IQuickPickItem[] | undefined;
	readonly error?: string;
	readonly duration?: number;
}

export interface IQuickInputDebugService {
	readonly _serviceBrand: undefined;
	logPickOperation(event: IQuickInputDebugEvent): void;
	readonly onDidLogEvent: Event<IQuickInputDebugEvent>;
}

export const IQuickInputDebugService = Symbol('IQuickInputDebugService');

export class QuickInputDebugChannel implements IServerChannel {
	constructor(private readonly service: IQuickInputDebugService) { }

	listen(context: any, event: string): Event<any> {
		switch (event) {
			case 'onDidLogEvent': return this.service.onDidLogEvent;
		}
		throw new Error(`Invalid listen '${event}'`);
	}

	call(context: any, command: string, args?: any, token: CancellationToken = CancellationToken.None): Promise<any> {
		switch (command) {
			case 'logPickOperation': 
				this.service.logPickOperation(args[0]);
				return Promise.resolve();
		}
		throw new Error(`Invalid call '${command}'`);
	}
}

export class QuickInputDebugChannelClient implements IQuickInputDebugService {
	declare readonly _serviceBrand: undefined;

	constructor(private readonly channel: IChannel) { }

	logPickOperation(event: IQuickInputDebugEvent): void {
		this.channel.call('logPickOperation', [event]);
	}

	get onDidLogEvent(): Event<IQuickInputDebugEvent> {
		return this.channel.listen<IQuickInputDebugEvent>('onDidLogEvent');
	}
}
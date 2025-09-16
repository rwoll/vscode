/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { QuickInputDebugChannelClient } from '../common/quickInputDebugIpc.js';

/**
 * Example utility for connecting to QuickInput debug events via IPC.
 * This shows how external processes can monitor quickpick operations.
 */
export class QuickInputDebugMonitor extends Disposable {
	private debugClient: QuickInputDebugChannelClient;

	constructor(ipcChannel: IChannel) {
		super();
		
		this.debugClient = new QuickInputDebugChannelClient(ipcChannel);
		
		// Listen to all quickinput debug events
		this._register(this.debugClient.onDidLogEvent(event => {
			this.onDebugEvent(event);
		}));
	}

	private onDebugEvent(event: any): void {
		// Log to console or send to external debugging process
		console.log('QuickInput Debug Event:', {
			timestamp: new Date(event.timestamp).toISOString(),
			operation: event.operation,
			duration: event.duration ? `${event.duration}ms` : undefined,
			picks: this.sanitizePicks(event.picks),
			options: event.options,
			result: this.sanitizeResult(event.result),
			error: event.error
		});
	}

	private sanitizePicks(picks: any): any {
		if (!picks) return undefined;
		if (picks === '[Promise]') return picks;
		
		// Limit picks data to avoid huge logs
		if (Array.isArray(picks) && picks.length > 10) {
			return `[${picks.length} items]`;
		}
		
		return picks;
	}

	private sanitizeResult(result: any): any {
		if (!result) return result;
		
		// Sanitize result for logging
		if (Array.isArray(result)) {
			return result.map(item => ({
				label: item.label,
				description: item.description,
				id: item.id
			}));
		}
		
		if (typeof result === 'object' && result.label) {
			return {
				label: result.label,
				description: result.description,
				id: result.id
			};
		}
		
		return result;
	}
}
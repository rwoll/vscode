/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IQuickInputDebugEvent, IQuickInputDebugInterceptor } from '../common/quickInputDebug.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';

export class QuickInputDebugInterceptor extends Disposable implements IQuickInputDebugInterceptor {
	
	private readonly _onDidLogEvent = this._register(new Emitter<IQuickInputDebugEvent>());
	readonly onDidLogEvent = this._onDidLogEvent.event;
	
	private _enabled = false;

	constructor(@IConfigurationService private readonly configurationService: IConfigurationService) {
		super();
		
		// Check initial configuration
		this._enabled = this.configurationService.getValue<boolean>('debug.quickInput.enabled') || false;
		
		// Listen for configuration changes
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('debug.quickInput.enabled')) {
				this._enabled = this.configurationService.getValue<boolean>('debug.quickInput.enabled') || false;
			}
		}));
	}

	isEnabled(): boolean {
		return this._enabled;
	}

	setEnabled(enabled: boolean): void {
		this._enabled = enabled;
	}

	logOperation(operation: string, args: any[], extensionId?: string): number {
		if (!this._enabled) {
			return 0;
		}

		const startTime = Date.now();
		this._onDidLogEvent.fire({
			timestamp: startTime,
			operation: `${operation}.start`,
			extensionId,
			args
		});
		
		return startTime;
	}

	logResult(startTime: number, result: any): void {
		if (!this._enabled || !startTime) {
			return;
		}

		this._onDidLogEvent.fire({
			timestamp: Date.now(),
			operation: 'operation.success',
			result,
			duration: Date.now() - startTime
		});
	}

	logError(startTime: number, error: any): void {
		if (!this._enabled || !startTime) {
			return;
		}

		this._onDidLogEvent.fire({
			timestamp: Date.now(),
			operation: 'operation.error',
			error: error?.message || String(error),
			duration: Date.now() - startTime
		});
	}
}
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';

export interface IQuickInputDebugEvent {
	readonly timestamp: number;
	readonly operation: string;
	readonly extensionId?: string;
	readonly args?: any[];
	readonly result?: any;
	readonly error?: string;
	readonly duration?: number;
}

/**
 * Simple debug interceptor for QuickInput operations at the main thread level.
 * This intercepts calls between the extension host and main process.
 */
export interface IQuickInputDebugInterceptor {
	readonly onDidLogEvent: Event<IQuickInputDebugEvent>;
	isEnabled(): boolean;
	setEnabled(enabled: boolean): void;
	logOperation(operation: string, args: any[], extensionId?: string): number;
	logResult(startTime: number, result: any): void;
	logError(startTime: number, error: any): void;
}
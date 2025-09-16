/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IQuickInputDebugEvent, IQuickInputDebugService } from '../common/quickInputDebugIpc.js';

export class QuickInputDebugService extends Disposable implements IQuickInputDebugService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidLogEvent = this._register(new Emitter<IQuickInputDebugEvent>());
	readonly onDidLogEvent = this._onDidLogEvent.event;

	logPickOperation(event: IQuickInputDebugEvent): void {
		this._onDidLogEvent.fire(event);
	}
}
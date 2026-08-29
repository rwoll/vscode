/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
export interface IEvaluationSessionIdentity {
	readonly connectionAuthority: string;
	readonly backendSession: URI;
}
export const IEvaluationSessionAttachmentService = createDecorator<IEvaluationSessionAttachmentService>('evaluationSessionAttachmentService');

/**
 * Process-local immutable window attachment; only owner disposal clears it.
 * The isolated host is trusted to contain only the driver and this window.
 * This prevents window-initiated approval, not other host-level confirmation.
 */
export interface IEvaluationSessionAttachmentService {
	readonly _serviceBrand: undefined;
	attach(identity: IEvaluationSessionIdentity): IDisposable;
	isAttached(connectionAuthority: string, backendSession: URI): boolean;
}
export class EvaluationSessionAttachmentService implements IEvaluationSessionAttachmentService {
	declare readonly _serviceBrand: undefined;
	private _identity: IEvaluationSessionIdentity | undefined;

	attach(identity: IEvaluationSessionIdentity): IDisposable {
		if (this._identity) {
			throw new Error('An evaluation session is already attached to this window.');
		}

		this._identity = identity;
		return toDisposable(() => {
			if (this._identity === identity) {
				this._identity = undefined;
			}
		});
	}

	isAttached(connectionAuthority: string, backendSession: URI): boolean {
		return this._identity?.connectionAuthority === connectionAuthority
			&& this._identity.backendSession.toString() === backendSession.toString();
	}
}
registerSingleton(IEvaluationSessionAttachmentService, EvaluationSessionAttachmentService, InstantiationType.Delayed);

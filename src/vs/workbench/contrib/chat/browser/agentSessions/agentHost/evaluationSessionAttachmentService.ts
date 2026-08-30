/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { SessionInputRequestKind } from '../../../../../../platform/agentHost/common/state/protocol/channels-session/state.js';
import { ToolCallStatus } from '../../../../../../platform/agentHost/common/state/sessionState.js';
import { InstantiationType, registerSingleton } from '../../../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
export interface IEvaluationSessionIdentity {
	readonly connectionAuthority: string;
	readonly backendSession: URI;
}
export const IEvaluationSessionAttachmentService = createDecorator<IEvaluationSessionAttachmentService>('evaluationSessionAttachmentService');
export interface IEvaluationSessionAttachmentService {
	readonly _serviceBrand: undefined;
	attach(identity: IEvaluationSessionIdentity): IDisposable;
	isAttached(identity: IEvaluationSessionIdentity): boolean;
	shouldDeferConfirmation(identity: IEvaluationSessionIdentity & { readonly clientId: string }, request: { readonly kind: SessionInputRequestKind; readonly clientId: string; readonly toolCall: { readonly status: ToolCallStatus } }): boolean;
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
	isAttached(identity: IEvaluationSessionIdentity): boolean {
		return this._identity?.connectionAuthority === identity.connectionAuthority
			&& this._identity.backendSession.toString() === identity.backendSession.toString();
	}
	shouldDeferConfirmation(identity: IEvaluationSessionIdentity & { readonly clientId: string }, request: { readonly kind: SessionInputRequestKind; readonly clientId: string; readonly toolCall: { readonly status: ToolCallStatus } }): boolean {
		return this.isAttached(identity)
			&& request.kind === SessionInputRequestKind.ToolClientExecution
			&& request.clientId === identity.clientId
			&& request.toolCall.status === ToolCallStatus.PendingConfirmation;
	}
}

registerSingleton(IEvaluationSessionAttachmentService, EvaluationSessionAttachmentService, InstantiationType.Delayed);

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from '../../../base/common/event.js';
import { Disposable, toDisposable, type IDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IAgentHostEvaluationSessionAttachmentService = createDecorator<IAgentHostEvaluationSessionAttachmentService>('agentHostEvaluationSessionAttachmentService');

export interface IAgentHostEvaluationSessionIdentity {
	readonly connectionAuthority: string;
	readonly backendSession: URI;
}

/** Internal, process-local marker for an attached evaluation session. */
export interface IAgentHostEvaluationSessionAttachmentService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeAttachment: Event<IAgentHostEvaluationSessionIdentity>;
	register(session: IAgentHostEvaluationSessionIdentity): IDisposable;
	isAttached(session: IAgentHostEvaluationSessionIdentity): boolean;
}

export class AgentHostEvaluationSessionAttachmentService extends Disposable implements IAgentHostEvaluationSessionAttachmentService {
	declare readonly _serviceBrand: undefined;

	private readonly _sessions = new Map<string, number>();
	private readonly _onDidChangeAttachment = this._register(new Emitter<IAgentHostEvaluationSessionIdentity>());
	readonly onDidChangeAttachment = this._onDidChangeAttachment.event;

	register(session: IAgentHostEvaluationSessionIdentity): IDisposable {
		if (!session.connectionAuthority || !session.backendSession.scheme || !session.backendSession.path || session.backendSession.path === '/') {
			throw new Error('The evaluation session attachment requires a connection authority and backend session.');
		}
		const key = sessionKey(session);
		const count = this._sessions.get(key) ?? 0;
		this._sessions.set(key, count + 1);
		if (count === 0) {
			this._onDidChangeAttachment.fire(session);
		}
		return toDisposable(() => {
			const remaining = (this._sessions.get(key) ?? 1) - 1;
			if (remaining > 0) {
				this._sessions.set(key, remaining);
			} else {
				this._sessions.delete(key);
				this._onDidChangeAttachment.fire(session);
			}
		});
	}

	isAttached(session: IAgentHostEvaluationSessionIdentity): boolean {
		return this._sessions.has(sessionKey(session));
	}
}

function sessionKey(session: IAgentHostEvaluationSessionIdentity): string {
	return `${session.connectionAuthority}\0${session.backendSession.toString()}`;
}

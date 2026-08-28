/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { toDisposable, type IDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { AgentSession, type AgentProvider } from './agent.js';
import { parseRemoteAgentHostHarness } from './agentHostSessionType.js';

export const IAgentHostEvaluationSessionAttachmentService = createDecorator<IAgentHostEvaluationSessionAttachmentService>('agentHostEvaluationSessionAttachmentService');

/** Internal, process-local marker for an attached evaluation session. */
export interface IAgentHostEvaluationSessionAttachmentService {
	readonly _serviceBrand: undefined;
	register(session: URI): IDisposable;
	isAttached(session: URI): boolean;
}

export class AgentHostEvaluationSessionAttachmentService implements IAgentHostEvaluationSessionAttachmentService {
	declare readonly _serviceBrand: undefined;

	private readonly _sessions = new Map<string, number>();

	register(session: URI): IDisposable {
		const backendSession = toBackendSession(session);
		if (!backendSession) {
			throw new Error('The evaluation session attachment requires a remote Agent Host session resource.');
		}
		const key = backendSession.toString();
		this._sessions.set(key, (this._sessions.get(key) ?? 0) + 1);
		return toDisposable(() => {
			const remaining = (this._sessions.get(key) ?? 1) - 1;
			if (remaining > 0) {
				this._sessions.set(key, remaining);
			} else {
				this._sessions.delete(key);
			}
		});
	}

	isAttached(session: URI): boolean {
		return this._sessions.has(session.toString());
	}
}

function toBackendSession(sessionResource: URI): URI | undefined {
	const provider = parseRemoteAgentHostHarness(sessionResource.scheme) as AgentProvider | undefined;
	if (!provider || !sessionResource.path || sessionResource.path === '/') {
		return undefined;
	}
	return AgentSession.uri(provider, AgentSession.id(sessionResource));
}

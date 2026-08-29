/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout } from '../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { Event } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { observableFromEvent, waitForState } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { type AgentProvider } from '../../../../../platform/agentHost/common/agent.js';
import { IAgentHostEvaluationSessionAttachmentService, type IAgentHostEvaluationSessionIdentity } from '../../../../../platform/agentHost/common/agentHostEvaluationSessionAttachment.js';
import { parseRemoteAgentHostHarness, parseRemoteAgentHostSessionTypeAuthority } from '../../../../../platform/agentHost/common/agentHostSessionType.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { registerWorkbenchContribution2, WorkbenchPhase, type IWorkbenchContribution } from '../../../../../workbench/common/contributions.js';
import { INativeWorkbenchEnvironmentService } from '../../../../../workbench/services/environment/electron-browser/environmentService.js';
import { ISessionsService } from '../../../../services/sessions/browser/sessionsService.js';
import type { ISession, ISessionWorkspace } from '../../../../services/sessions/common/session.js';
import { ISessionsManagementService, WorkspaceNotTrustedError } from '../../../../services/sessions/common/sessionsManagement.js';

/** Private, unlisted launch argument naming one existing evaluation session to attach to. */
export const ATTACH_TO_EVALUATION_SESSION_ARG = 'attachToEvaluationSession';

/** Bounds the one wait below, which is otherwise event-driven. */
export const ATTACH_EVALUATION_SESSION_BUDGET_MS = 60_000;

/**
 * The session resource, when {@link value} is the canonical form of a URI that
 * names one. Nothing else is accepted: the provider is identified by the URI's
 * own scheme, so the directive needs no second field to agree with.
 */
export function parseAttachEvaluationSessionDirective(value: string | undefined): URI | undefined {
	if (typeof value !== 'string' || value.length === 0) {
		return undefined;
	}
	let resource: URI;
	try {
		resource = URI.parse(value);
	} catch {
		return undefined;
	}
	// Re-serializing to the same string is what makes this the session the
	// provider listed, rather than one that merely parses to it.
	if (resource.toString() !== value || resource.scheme !== resource.scheme.toLowerCase()) {
		return undefined;
	}
	const provider = parseRemoteAgentHostHarness(resource.scheme) as AgentProvider | undefined;
	return provider
		&& parseRemoteAgentHostSessionTypeAuthority(resource.scheme, provider)
		&& resource.path
		&& resource.path !== '/'
		? resource
		: undefined;
}

/**
 * Opens an *existing* remote session named on the command line, on the same
 * path a click in the sessions view takes.
 *
 * The window contributes nothing of its own: opening the session is what makes
 * the ordinary session lifecycle publish this window as an active client, so
 * the controller that owns the session sees its tools without the window
 * sending a prompt, a turn, or anything else.
 */
export class AttachEvaluationSessionContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'sessions.contrib.attachEvaluationSession';

	private readonly _evaluationSessionAttachment = this._register(new MutableDisposable<DisposableStore>());

	constructor(
		@INativeWorkbenchEnvironmentService environmentService: INativeWorkbenchEnvironmentService,
		@ILogService private readonly _logService: ILogService,
		@IAgentHostEvaluationSessionAttachmentService private readonly _evaluationSessionAttachmentService: IAgentHostEvaluationSessionAttachmentService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
		const resource = parseAttachEvaluationSessionDirective(environmentService.args[ATTACH_TO_EVALUATION_SESSION_ARG]);
		if (!resource) {
			return;
		}
		const budget = new CancellationTokenSource();
		// `dispose(true)` rather than `_register(budget)`: disposing a source does
		// not cancel it, and cancelling is what ends the wait below.
		this._register(toDisposable(() => budget.dispose(true)));
		this._register(disposableTimeout(() => budget.cancel(), ATTACH_EVALUATION_SESSION_BUDGET_MS));
		this._attach(resource, budget.token).then(
			() => this._logService.info('[AttachEvaluationSession] Attached to the evaluation session'),
			error => this._logService.error(`[AttachEvaluationSession] ${error}`));
	}

	/**
	 * `openSession` throws for a resource no provider has listed yet, and a
	 * remote provider lists its sessions only once it has connected, so the
	 * exact resource is awaited first. Waiting on the listing is also what makes
	 * the directive provider-agnostic: only the provider owning that scheme can
	 * list it.
	 *
	 * The services are resolved on use rather than injected, so a window without
	 * the directive does not pull the sessions view up with this contribution.
	 */
	private _attach(resource: URI, token: CancellationToken): Promise<void> {
		return this._instantiationService.invokeFunction(async accessor => {
			const managementService = accessor.get(ISessionsManagementService);
			const sessionsService = accessor.get(ISessionsService);
			const listedSession = await whenSessionListed(managementService, resource, token);
			const session = await whenRemoteSessionWorkspaceHydrated(managementService, resource, listedSession, token);
			if (!await sessionsService.canOpenSession(session, { forceTrustCheck: true })) {
				throw new WorkspaceNotTrustedError();
			}

			const lifetime = new DisposableStore();
			lifetime.add(this._evaluationSessionAttachmentService.register(toEvaluationSessionIdentity(resource, session)));
			lifetime.add(managementService.onDidDeleteSession(deleted => {
				if (deleted.sessionId === session.sessionId && deleted.resource.toString() === resource.toString()) {
					this._evaluationSessionAttachment.clear();
				}
			}));
			this._evaluationSessionAttachment.value = lifetime;
			try {
				let completed = false;
				await sessionsService.openSession(resource, {
					preserveFocus: false,
					onDidCompleteOpen: value => completed = value,
				});
				if (!completed) {
					throw new Error('The requested evaluation session was superseded before it opened.');
				}
			} catch (error) {
				this._evaluationSessionAttachment.clear();
				throw error;
			}
		});
	}
}

function toEvaluationSessionIdentity(resource: URI, session: ISession): IAgentHostEvaluationSessionIdentity {
	const provider = parseRemoteAgentHostHarness(resource.scheme) as AgentProvider;
	const connectionAuthority = parseRemoteAgentHostSessionTypeAuthority(resource.scheme, provider);
	const backendSession = (session as ISession & { readonly backendUri?: unknown }).backendUri;
	if (!connectionAuthority
		|| !URI.isUri(backendSession)
		|| !backendSession.scheme
		|| backendSession.path !== resource.path) {
		throw new Error('The evaluation session attachment requires a remote Agent Host session resource.');
	}
	return {
		connectionAuthority,
		backendSession,
	};
}

/**
 * Resolves once {@link resource} is one of the sessions the providers list,
 * driven purely by `onDidChangeSessions`: it schedules nothing and polls
 * nothing. The caller supplies its deadline through {@link token}.
 */
function whenSessionListed(managementService: ISessionsManagementService, resource: URI, token: CancellationToken): Promise<ISession> {
	const listed = managementService.getSession(resource);
	if (listed) {
		return Promise.resolve(listed);
	}
	return new Promise((resolve, reject) => {
		const store = new DisposableStore();
		const settle = (settled: () => void) => { store.dispose(); settled(); };
		store.add(managementService.onDidChangeSessions(() => {
			const session = managementService.getSession(resource);
			if (session) {
				settle(() => resolve(session));
			}
		}));
		store.add(token.onCancellationRequested(() => settle(() => reject(new CancellationError()))));
		if (token.isCancellationRequested) {
			settle(() => reject(new CancellationError()));
		}
	});
}

interface IWorkspaceHydrationState {
	readonly session: ISession | undefined;
	readonly workspace: ISessionWorkspace | undefined;
}

async function whenRemoteSessionWorkspaceHydrated(
	managementService: ISessionsManagementService,
	resource: URI,
	listedSession: ISession,
	token: CancellationToken,
): Promise<ISession> {
	const sessionObservable = observableFromEvent(
		Event.any(managementService.onDidChangeSessions, managementService.onDidDeleteSession),
		() => managementService.getSession(resource),
	);
	const workspaceState = sessionObservable.map((session, reader): IWorkspaceHydrationState => {
		if (!session || session.sessionId !== listedSession.sessionId) {
			return { session: undefined, workspace: undefined };
		}
		return { session, workspace: session.workspace.read(reader) };
	});
	const hydrated = await waitForState(
		workspaceState,
		(state): state is IWorkspaceHydrationState & { readonly session: ISession; readonly workspace: ISessionWorkspace } =>
			state.session !== undefined && state.workspace !== undefined,
		state => state.session === undefined ? new Error('The requested evaluation session disappeared before its workspace metadata was available.') : false,
		token,
	);
	return hydrated.session;
}

registerWorkbenchContribution2(AttachEvaluationSessionContribution.ID, AttachEvaluationSessionContribution, WorkbenchPhase.AfterRestored);

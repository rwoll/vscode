/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise, raceCancellationError, raceTimeout } from '../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { CancellationError, isCancellationError } from '../../../../../base/common/errors.js';
import { Event } from '../../../../../base/common/event.js';
import { Disposable, IDisposable, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { autorun, IObservable, waitForState } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { IAgentHostConnectionsService } from '../../../../../platform/agentHost/common/agentHostConnectionsService.js';
import { findRemoteAgentHostSessionTypeAuthority, isRemoteAgentHostSessionType } from '../../../../../platform/agentHost/common/agentHostSessionType.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { IInstantiationService, ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../workbench/common/contributions.js';
import { IEvaluationSessionAttachmentService, IEvaluationSessionIdentity } from '../../../../../workbench/contrib/chat/browser/agentSessions/agentHost/evaluationSessionAttachmentService.js';
import { ISession } from '../../../../services/sessions/common/session.js';
import { ISessionsManagementService } from '../../../../services/sessions/common/sessionsManagement.js';
import { ISessionsService } from '../../../../services/sessions/browser/sessionsService.js';

export interface IEvaluationSessionAttachmentStartupServices {
	readonly sessionsManagementService: Pick<ISessionsManagementService, 'getSession' | 'onDidChangeSessions'>;
	readonly sessionsService: Pick<ISessionsService, 'canOpenSession' | 'openSession'> & {
		readonly activeSession: IObservable<ISession | undefined>;
		readonly initialRestoreComplete: IObservable<boolean>;
	};
	readonly connectionsService: Pick<IAgentHostConnectionsService, 'connections' | 'resolveSessionResource'>;
	readonly attachmentService: IEvaluationSessionAttachmentService;
}

export function parseEvaluationSessionResource(value: string): URI {
	const resource = URI.parse(value, true);
	const rawId = resource.path.substring(1);
	if (!isRemoteAgentHostSessionType(resource.scheme) || resource.authority
		|| resource.path !== `/${rawId}` || !rawId || rawId.includes('/')
		|| resource.query || resource.fragment
		|| resource.toString() !== value) {
		throw new Error('The evaluation session URI must be a canonical remote session URI.');
	}
	return resource;
}

export async function startEvaluationSessionAttachment(
	value: string | undefined,
	getServices: () => IEvaluationSessionAttachmentStartupServices,
	token: CancellationToken,
	timeoutMs = 30_000,
): Promise<IDisposable | undefined> {
	if (value === undefined) {
		return undefined;
	}

	const resource = parseEvaluationSessionResource(value);
	const timeoutSource = new CancellationTokenSource(token);
	try {
		const result = await raceTimeout(
			attachToEvaluationSession(resource, getServices(), timeoutSource.token),
			timeoutMs,
			() => timeoutSource.cancel(),
		);
		if (!result) {
			throw new Error('Timed out waiting to attach the evaluation session.');
		}
		return result;
	} finally {
		timeoutSource.dispose(true);
	}
}

async function attachToEvaluationSession(resource: URI, services: IEvaluationSessionAttachmentStartupServices, token: CancellationToken): Promise<IDisposable> {
	const target = resource.toString();
	const activeViolation = new DeferredPromise<Error>();
	let listingViolation: DeferredPromise<Error> | undefined;
	let listingListener: IDisposable | undefined;
	let startupGeneration = 0;
	let openingTarget = false;
	const activeListener = autorun(reader => {
		const active = services.sessionsService.activeSession.read(reader);
		if (active && !(openingTarget && active.resource.toString() === target)) {
			startupGeneration++;
			activeViolation.complete(new Error(openingTarget
				? 'Opening the evaluation session activated a different session.'
				: 'Evaluation attachment requires a fresh Agents window without an intervening active session.'));
		}
	});
	const guarded = <T>(promise: Promise<T>): Promise<T> => {
		const violation = listingViolation
			? Promise.race([activeViolation.p, listingViolation.p])
			: activeViolation.p;
		return raceCancellationError(Promise.race([
			promise,
			violation.then(error => { throw error; }),
		]), token);
	};
	let attachment: IDisposable | undefined;
	try {
		await guarded(waitForState(services.sessionsService.initialRestoreComplete, complete => complete, undefined, token));
		if (services.sessionsService.activeSession.get()) {
			throw new Error('Evaluation attachment requires a fresh Agents window without a pre-existing active session.');
		}
		if (startupGeneration !== 0) {
			throw new Error('Evaluation attachment requires a fresh Agents window without an intervening active session.');
		}

		const session = await guarded(waitForExactSession(services.sessionsManagementService, resource, token));
		listingViolation = new DeferredPromise<Error>();
		listingListener = services.sessionsManagementService.onDidChangeSessions(() => {
			if (services.sessionsManagementService.getSession(resource) !== session) {
				listingViolation?.complete(new Error('The evaluation session listing was superseded during startup.'));
			}
		});
		await guarded(waitForState(session.workspace, workspace => workspace !== undefined, undefined, token));
		if (services.sessionsManagementService.getSession(resource) !== session) {
			throw new Error('The evaluation session listing changed before attachment.');
		}
		if (!await guarded(services.sessionsService.canOpenSession(session))) {
			throw new Error('The evaluation session workspace is not trusted.');
		}

		const identity = resolveEvaluationSessionIdentity(resource, session, services.connectionsService);
		if (services.sessionsManagementService.getSession(resource) !== session) {
			throw new Error('The evaluation session listing changed before attachment.');
		}
		if (startupGeneration !== 0 || services.sessionsService.activeSession.get()) {
			throw new Error('Evaluation attachment requires a fresh Agents window without an intervening active session.');
		}

		attachment = services.attachmentService.attach(identity);
		openingTarget = true;
		await guarded(services.sessionsService.openSession(resource));
		await guarded(waitForState(
			services.sessionsService.activeSession,
			active => active?.resource.toString() === target,
			active => active && active.resource.toString() !== target
				? new Error('Opening the evaluation session activated a different session.')
				: false,
			token,
		));
		if (startupGeneration !== 0
			|| services.sessionsManagementService.getSession(resource) !== session
			|| services.sessionsService.activeSession.get()?.resource.toString() !== target) {
			throw new Error('Opening the evaluation session was superseded before attachment completed.');
		}
		const retained = attachment;
		attachment = undefined;
		return retained;
	} finally {
		openingTarget = false;
		listingListener?.dispose();
		activeListener.dispose();
		attachment?.dispose();
	}
}

function waitForExactSession(service: Pick<ISessionsManagementService, 'getSession' | 'onDidChangeSessions'>, resource: URI, token: CancellationToken): Promise<ISession> {
	const exact = (session: ISession | undefined) => session?.resource.toString() === resource.toString() ? session : undefined;
	const existing = exact(service.getSession(resource));
	if (existing) {
		return Promise.resolve(existing);
	}
	if (token.isCancellationRequested) {
		return Promise.reject(new CancellationError());
	}
	return new Promise<ISession>((resolve, reject) => {
		const listener = Event.any(
			Event.map(service.onDidChangeSessions, event =>
				[...event.added, ...event.changed].find(session => session.resource.toString() === resource.toString())),
			Event.map<void, ISession | undefined>(token.onCancellationRequested as Event<void>, () => undefined),
		)(session => {
			if (session) {
				listener.dispose();
				resolve(session);
			} else if (token.isCancellationRequested) {
				listener.dispose();
				reject(new CancellationError());
			}
		});
	});
}

export function resolveEvaluationSessionIdentity(
	resource: URI,
	session: ISession,
	connectionsService: Pick<IAgentHostConnectionsService, 'connections' | 'resolveSessionResource'>,
): IEvaluationSessionIdentity {
	const remotes = connectionsService.connections.filter(connection => !connection.isAmbient);
	const connectionAuthority = findRemoteAgentHostSessionTypeAuthority(resource.scheme, remotes.map(connection => connection.authority));
	const connection = connectionAuthority ? remotes.find(candidate => candidate.authority === connectionAuthority) : undefined;
	const resolution = connectionsService.resolveSessionResource(resource);
	const backendSession = (session as ISession & { readonly backendUri?: URI }).backendUri;
	if (!connectionAuthority || !connection?.connection || !resolution
		|| resolution.connection !== connection.connection
		|| session.resource.toString() !== resource.toString()
		|| !URI.isUri(backendSession)
		|| backendSession.authority
		|| backendSession.path !== resource.path
		|| backendSession.query
		|| backendSession.fragment) {
		throw new Error('The evaluation session is not backed by the exact connected remote agent host.');
	}
	return { connectionAuthority, backendSession };
}

export class EvaluationSessionAttachmentContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.evaluationSessionAttachment';

	private readonly _attachment = this._register(new MutableDisposable<IDisposable>());

	constructor(
		@IEnvironmentService environmentService: IEnvironmentService,
		@IInstantiationService instantiationService: IInstantiationService,
		@INotificationService notificationService: INotificationService,
	) {
		super();
		const value = (environmentService as IEnvironmentService & {
			readonly args: { readonly 'attach-to-evaluation-session'?: string };
		}).args['attach-to-evaluation-session'];
		if (value === undefined) {
			return;
		}

		const cancellation = this._register(new CancellationTokenSource());
		void startEvaluationSessionAttachment(value, () => getStartupServices(instantiationService), cancellation.token).then(attachment => {
			if (cancellation.token.isCancellationRequested) {
				attachment?.dispose();
			} else {
				this._attachment.value = attachment;
			}
		}).catch(error => {
			if (!isCancellationError(error) && !cancellation.token.isCancellationRequested) {
				notificationService.error(error);
			}
		});
	}
}

function getStartupServices(instantiationService: IInstantiationService): IEvaluationSessionAttachmentStartupServices {
	return instantiationService.invokeFunction((accessor: ServicesAccessor) => ({
		sessionsManagementService: accessor.get(ISessionsManagementService),
		sessionsService: accessor.get(ISessionsService),
		connectionsService: accessor.get(IAgentHostConnectionsService),
		attachmentService: accessor.get(IEvaluationSessionAttachmentService),
	}));
}

registerWorkbenchContribution2(EvaluationSessionAttachmentContribution.ID, EvaluationSessionAttachmentContribution, WorkbenchPhase.AfterRestored);

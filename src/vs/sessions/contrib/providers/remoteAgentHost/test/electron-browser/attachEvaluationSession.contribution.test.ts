/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { observableValue, type ISettableObservable } from '../../../../../../base/common/observable.js';
import { URI } from '../../../../../../base/common/uri.js';
import { mock } from '../../../../../../base/test/common/mock.js';
import { runWithFakedTimers } from '../../../../../../base/test/common/timeTravelScheduler.js';
import type { RecordedTimerEvent } from '../../../../../../base/test/common/virtualScheduling/index.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { AgentSession } from '../../../../../../platform/agentHost/common/agentService.js';
import { AgentHostEvaluationSessionAttachmentService, IAgentHostEvaluationSessionAttachmentService, type IAgentHostEvaluationSessionIdentity } from '../../../../../../platform/agentHost/common/agentHostEvaluationSessionAttachment.js';
import type { NativeParsedArgs } from '../../../../../../platform/environment/common/argv.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../../../platform/log/common/log.js';
import { INativeWorkbenchEnvironmentService } from '../../../../../../workbench/services/environment/electron-browser/environmentService.js';
import type { ISession, ISessionWorkspace } from '../../../../../services/sessions/common/session.js';
import { ISessionsManagementService, type IActiveSession, type ISessionsChangeEvent } from '../../../../../services/sessions/common/sessionsManagement.js';
import { ISessionsService, type IOpenSessionOptions } from '../../../../../services/sessions/browser/sessionsService.js';
import {
	ATTACH_EVALUATION_SESSION_BUDGET_MS,
	ATTACH_TO_EVALUATION_SESSION_ARG,
	AttachEvaluationSessionContribution,
	parseAttachEvaluationSessionDirective,
} from '../../electron-browser/attachEvaluationSession.contribution.js';

const SESSION_RESOURCE = URI.from({ scheme: 'remote-local-copilot', path: '/session-abc' });
const DIRECTIVE = SESSION_RESOURCE.toString();
const BACKEND_SESSION = AgentSession.uri('copilot', 'session-abc');
const ALIAS_BACKEND_SESSION = AgentSession.uri('backend-alias', 'session-abc');
const ATTACHMENT_IDENTITY: IAgentHostEvaluationSessionIdentity = { connectionAuthority: 'local', backendSession: BACKEND_SESSION };
const ALIAS_ATTACHMENT_IDENTITY: IAgentHostEvaluationSessionIdentity = { connectionAuthority: 'local', backendSession: ALIAS_BACKEND_SESSION };
const HYDRATED_WORKSPACE = { requiresWorkspaceTrust: true } as ISessionWorkspace;

interface IRecordedOpen {
	readonly resource: string;
	readonly options: { preserveFocus?: boolean } | undefined;
}

suite('AttachEvaluationSessionContribution', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let openedSessions: IRecordedOpen[];
	let listedSessions: Set<string>;
	let listedSession: ISession & { readonly backendUri: URI };
	let sessionWorkspace: ISettableObservable<ISessionWorkspace | undefined>;
	let sessionsChanged: Emitter<ISessionsChangeEvent>;
	let sessionDeleted: Emitter<ISession>;
	let sessionsServiceReads: number;
	let canOpenSessions: ISession[];
	let canOpenOptions: ({ readonly forceTrustCheck?: boolean } | undefined)[];
	let canOpen: boolean;
	let activateOpenedSession: boolean;
	let openCompleted: boolean;
	let activeSession: ISettableObservable<IActiveSession | undefined>;
	let openError: Error | undefined;
	let logErrors: string[];
	let attachmentService: AgentHostEvaluationSessionAttachmentService;
	let attachmentRegistrations: number;
	let whenCanOpen: Promise<void>;
	let signalCanOpen: () => void;
	let whenLogError: Promise<void>;
	let signalLogError: () => void;
	let whenOpened: Promise<void>;
	let signalOpened: () => void;

	setup(() => {
		openedSessions = [];
		listedSessions = new Set([DIRECTIVE]);
		sessionWorkspace = observableValue<ISessionWorkspace | undefined>('sessionWorkspace', HYDRATED_WORKSPACE);
		listedSession = { sessionId: `remote:${DIRECTIVE}`, resource: SESSION_RESOURCE, backendUri: BACKEND_SESSION, workspace: sessionWorkspace } as unknown as ISession & { readonly backendUri: URI };
		sessionsChanged = store.add(new Emitter<ISessionsChangeEvent>());
		sessionDeleted = store.add(new Emitter<ISession>());
		sessionsServiceReads = 0;
		canOpenSessions = [];
		canOpenOptions = [];
		canOpen = true;
		activateOpenedSession = true;
		openCompleted = true;
		activeSession = observableValue<IActiveSession | undefined>('activeSession', undefined);
		openError = undefined;
		logErrors = [];
		attachmentRegistrations = 0;
		attachmentService = store.add(new class extends AgentHostEvaluationSessionAttachmentService {
			override register(session: IAgentHostEvaluationSessionIdentity) {
				attachmentRegistrations++;
				return super.register(session);
			}
		});
		whenCanOpen = new Promise<void>(resolve => { signalCanOpen = resolve; });
		whenLogError = new Promise<void>(resolve => { signalLogError = resolve; });
		whenOpened = new Promise<void>(resolve => { signalOpened = resolve; });
	});

	function createContribution(directive: string | undefined): DisposableStore {
		const disposables = store.add(new DisposableStore());
		const instantiationService = disposables.add(new TestInstantiationService());
		instantiationService.stub(ILogService, new class extends NullLogService {
			override error(message: string | Error, ..._args: unknown[]): void {
				logErrors.push(String(message));
				signalLogError();
			}
		});
		instantiationService.stub(IAgentHostEvaluationSessionAttachmentService, attachmentService);
		instantiationService.stub(INativeWorkbenchEnvironmentService, new class extends mock<INativeWorkbenchEnvironmentService>() {
			override readonly args = { [ATTACH_TO_EVALUATION_SESSION_ARG]: directive } as NativeParsedArgs;
		});
		instantiationService.stub(ISessionsService, new class extends mock<ISessionsService>() {
			override readonly activeSession = activeSession;
			override async canOpenSession(session: ISession, options?: { readonly forceTrustCheck?: boolean }): Promise<boolean> {
				canOpenSessions.push(session);
				canOpenOptions.push(options);
				signalCanOpen();
				return canOpen;
			}
			override async openSession(resource: URI, options?: IOpenSessionOptions): Promise<void> {
				sessionsServiceReads++;
				openedSessions.push({ resource: resource.toString(), options: options && { preserveFocus: options.preserveFocus } });
				if (activateOpenedSession) {
					activeSession.set(listedSession as unknown as IActiveSession, undefined);
				}
				signalOpened();
				if (openError) {
					throw openError;
				}
				options?.onDidCompleteOpen?.(openCompleted);
			}
		});
		instantiationService.stub(ISessionsManagementService, new class extends mock<ISessionsManagementService>() {
			override readonly onDidChangeSessions = sessionsChanged.event;
			override readonly onDidDeleteSession = sessionDeleted.event;
			override getSession(resource: URI): ISession | undefined {
				return listedSessions.has(resource.toString()) ? listedSession : undefined;
			}
		});
		disposables.add(instantiationService.createInstance(AttachEvaluationSessionContribution));
		return disposables;
	}

	suite('directive', () => {

		test('accepts only the canonical form of a remote Agent Host session URI', () => {
			assert.strictEqual(parseAttachEvaluationSessionDirective(DIRECTIVE)?.toString(), DIRECTIVE);
			assert.strictEqual(parseAttachEvaluationSessionDirective('REMOTE-local-copilot:/session-abc'), undefined);
			assert.strictEqual(parseAttachEvaluationSessionDirective('remote-local-copilot:/session abc'), undefined);
			assert.strictEqual(parseAttachEvaluationSessionDirective('agent:/session-abc'), undefined);
		});

		test('rejects missing or malformed values', () => {
			assert.strictEqual(parseAttachEvaluationSessionDirective(undefined), undefined);
			assert.strictEqual(parseAttachEvaluationSessionDirective(''), undefined);
			assert.strictEqual(parseAttachEvaluationSessionDirective(42 as unknown as string), undefined);
			assert.strictEqual(parseAttachEvaluationSessionDirective('remote-local-copilot:'), undefined);
			assert.strictEqual(parseAttachEvaluationSessionDirective('remote-local-copilot:/'), undefined);
			assert.strictEqual(parseAttachEvaluationSessionDirective('remote--copilot:/session-abc'), undefined);
			assert.strictEqual(parseAttachEvaluationSessionDirective('not a uri'), undefined);
		});
	});

	suite('startup', () => {

		test('registers and opens nothing without the launch argument', async () => {
			sessionWorkspace.set(undefined, undefined);
			createContribution(undefined);
			sessionWorkspace.set(HYDRATED_WORKSPACE, undefined);
			await Promise.resolve();
			assert.deepStrictEqual(openedSessions, []);
			assert.strictEqual(sessionsServiceReads, 0);
			assert.deepStrictEqual(canOpenSessions, []);
			assert.deepStrictEqual(canOpenOptions, []);
			assert.strictEqual(attachmentRegistrations, 0);
			assert.strictEqual(attachmentService.isAttached(ATTACHMENT_IDENTITY), false);
		});

		test('active remote session waits for workspace metadata and refuses when it hydrates untrusted', async () => {
			sessionWorkspace.set(undefined, undefined);
			activeSession.set(listedSession as unknown as IActiveSession, undefined);
			canOpen = false;
			createContribution(DIRECTIVE);
			await Promise.resolve();
			assert.deepStrictEqual(canOpenSessions, []);
			assert.strictEqual(attachmentRegistrations, 0);

			sessionWorkspace.set(HYDRATED_WORKSPACE, undefined);
			await whenCanOpen;
			await whenLogError;
			assert.deepStrictEqual(canOpenOptions, [{ forceTrustCheck: true }]);
			assert.deepStrictEqual(openedSessions, []);
			assert.strictEqual(attachmentRegistrations, 0);
		});

		test('active remote session waits for workspace metadata and proceeds when it hydrates trusted', async () => {
			sessionWorkspace.set(undefined, undefined);
			activeSession.set(listedSession as unknown as IActiveSession, undefined);
			createContribution(DIRECTIVE);
			await Promise.resolve();
			assert.deepStrictEqual(canOpenSessions, []);
			assert.strictEqual(attachmentRegistrations, 0);

			sessionWorkspace.set(HYDRATED_WORKSPACE, undefined);
			await whenOpened;
			assert.deepStrictEqual(canOpenSessions, [listedSession]);
			assert.deepStrictEqual(canOpenOptions, [{ forceTrustCheck: true }]);
			assert.strictEqual(attachmentRegistrations, 1);
		});

		test('workspace metadata timeout fails closed', async () => {
			await runWithFakedTimers({}, async () => {
				sessionWorkspace.set(undefined, undefined);
				createContribution(DIRECTIVE);
				await new Promise(resolve => setTimeout(resolve, ATTACH_EVALUATION_SESSION_BUDGET_MS + 1));
				await whenLogError;
				assert.deepStrictEqual(canOpenSessions, []);
				assert.deepStrictEqual(openedSessions, []);
				assert.strictEqual(attachmentRegistrations, 0);
			});
		});

		test('session disappearance while waiting for workspace metadata fails closed', async () => {
			sessionWorkspace.set(undefined, undefined);
			createContribution(DIRECTIVE);
			await Promise.resolve();
			listedSessions.delete(DIRECTIVE);
			sessionsChanged.fire({ added: [], removed: [listedSession], changed: [] });
			await whenLogError;
			assert.deepStrictEqual(canOpenSessions, []);
			assert.deepStrictEqual(openedSessions, []);
			assert.strictEqual(attachmentRegistrations, 0);
		});

		test('window cancellation while waiting for workspace metadata fails closed', async () => {
			sessionWorkspace.set(undefined, undefined);
			const disposables = createContribution(DIRECTIVE);
			await Promise.resolve();
			disposables.dispose();
			await whenLogError;
			sessionWorkspace.set(HYDRATED_WORKSPACE, undefined);
			await Promise.resolve();
			assert.deepStrictEqual(canOpenSessions, []);
			assert.deepStrictEqual(openedSessions, []);
			assert.strictEqual(attachmentRegistrations, 0);
		});

		test('non-active target keeps the established trust, open, and registration path', async () => {
			createContribution(DIRECTIVE);
			await whenOpened;
			assert.deepStrictEqual(openedSessions, [{ resource: DIRECTIVE, options: { preserveFocus: false } }]);
			assert.deepStrictEqual(canOpenSessions, [listedSession]);
			assert.deepStrictEqual(canOpenOptions, [{ forceTrustCheck: true }]);
			assert.strictEqual(attachmentRegistrations, 1);
			assert.strictEqual(attachmentService.isAttached(ATTACHMENT_IDENTITY), true);
			assert.strictEqual(attachmentService.isAttached({ ...ATTACHMENT_IDENTITY, backendSession: AgentSession.uri('copilot', 'session-other') }), false);
		});

		test('registers the exact provider-mapped backend scheme alias and authority', async () => {
			listedSession = { ...listedSession, backendUri: ALIAS_BACKEND_SESSION };
			createContribution(DIRECTIVE);
			await whenOpened;

			assert.strictEqual(attachmentService.isAttached(ALIAS_ATTACHMENT_IDENTITY), true);
			assert.strictEqual(attachmentService.isAttached(ATTACHMENT_IDENTITY), false);
			assert.strictEqual(attachmentService.isAttached({ ...ALIAS_ATTACHMENT_IDENTITY, connectionAuthority: 'other' }), false);
			assert.strictEqual(attachmentService.isAttached({ ...ALIAS_ATTACHMENT_IDENTITY, backendSession: AgentSession.uri('other', 'session-abc') }), false);
		});

		test('already-active untrusted restored session refuses without registration or open', async () => {
			activeSession.set(listedSession as unknown as IActiveSession, undefined);
			canOpen = false;
			createContribution(DIRECTIVE);
			await whenCanOpen;
			await whenLogError;
			assert.deepStrictEqual(canOpenSessions, [listedSession]);
			assert.deepStrictEqual(canOpenOptions, [{ forceTrustCheck: true }]);
			assert.deepStrictEqual(openedSessions, []);
			assert.strictEqual(attachmentRegistrations, 0);
			assert.strictEqual(attachmentService.isAttached(ATTACHMENT_IDENTITY), false);
			assert.strictEqual(logErrors.some(message => message.includes('Workspace not trusted')), true);
		});

		test('already-active trusted restored session registers and opens', async () => {
			activeSession.set(listedSession as unknown as IActiveSession, undefined);
			createContribution(DIRECTIVE);
			await whenOpened;

			assert.deepStrictEqual(canOpenSessions, [listedSession]);
			assert.deepStrictEqual(canOpenOptions, [{ forceTrustCheck: true }]);
			assert.deepStrictEqual(openedSessions, [{ resource: DIRECTIVE, options: { preserveFocus: false } }]);
			assert.strictEqual(attachmentRegistrations, 1);
			assert.strictEqual(attachmentService.isAttached(ATTACHMENT_IDENTITY), true);
		});

		test('failed open clears the registration', async () => {
			openError = new Error('open failed');
			createContribution(DIRECTIVE);
			await whenOpened;
			await Promise.resolve();
			assert.strictEqual(attachmentService.isAttached(ATTACHMENT_IDENTITY), false);
		});

		test('newer open supersedes this operation while its target remains active', async () => {
			openCompleted = false;
			activeSession.set(listedSession as unknown as IActiveSession, undefined);
			createContribution(DIRECTIVE);
			await whenOpened;
			await Promise.resolve();
			await Promise.resolve();
			assert.strictEqual(attachmentService.isAttached(ATTACHMENT_IDENTITY), false);
			assert.strictEqual(logErrors.some(message => message.includes('superseded')), true);
		});

		test('transient unpublish and exact republish retain the registration', async () => {
			createContribution(DIRECTIVE);
			await whenOpened;
			assert.strictEqual(attachmentService.isAttached(ATTACHMENT_IDENTITY), true);

			listedSessions.delete(DIRECTIVE);
			sessionsChanged.fire({} as ISessionsChangeEvent);
			assert.strictEqual(attachmentService.isAttached(ATTACHMENT_IDENTITY), true);

			listedSessions.add(DIRECTIVE);
			sessionsChanged.fire({} as ISessionsChangeEvent);
			assert.strictEqual(attachmentService.isAttached(ATTACHMENT_IDENTITY), true);
		});

		test('definitive session deletion clears the registration', async () => {
			createContribution(DIRECTIVE);
			await whenOpened;
			assert.strictEqual(attachmentService.isAttached(ATTACHMENT_IDENTITY), true);
			sessionDeleted.fire(listedSession);
			assert.strictEqual(attachmentService.isAttached(ATTACHMENT_IDENTITY), false);
		});

		test('window disposal clears the registration immediately', async () => {
			const disposables = createContribution(DIRECTIVE);
			await whenOpened;
			assert.strictEqual(attachmentService.isAttached(ATTACHMENT_IDENTITY), true);
			disposables.dispose();
			assert.strictEqual(attachmentService.isAttached(ATTACHMENT_IDENTITY), false);
		});

		test('waits for listing before opening without polling', async () => {
			let history: readonly RecordedTimerEvent[] = [];
			await runWithFakedTimers({ useFakeTimers: false, onHistory: recorded => { history = recorded; } }, async () => {
				listedSessions.clear();
				createContribution(DIRECTIVE);
				await Promise.resolve();
				assert.strictEqual(openedSessions.length, 0);

				listedSessions.add(DIRECTIVE);
				sessionsChanged.fire({} as ISessionsChangeEvent);
				await whenOpened;
				assert.deepStrictEqual(openedSessions.map(open => open.resource), [DIRECTIVE]);
			});
			assert.deepStrictEqual(history, []);
		});

		test('ignores unrelated listing changes', async () => {
			listedSessions.clear();
			const disposables = createContribution(DIRECTIVE);
			listedSessions.add('remote-local-copilot:/other-session');
			sessionsChanged.fire({} as ISessionsChangeEvent);
			await Promise.resolve();
			assert.strictEqual(openedSessions.length, 0);
			disposables.dispose();
		});

		test('cancellation abandons an unlisted session and leaves no registration', async () => {
			await runWithFakedTimers({}, async () => {
				listedSessions.clear();
				const disposables = createContribution(DIRECTIVE);
				await new Promise(resolve => setTimeout(resolve, ATTACH_EVALUATION_SESSION_BUDGET_MS + 1));
				assert.strictEqual(openedSessions.length, 0);
				assert.strictEqual(attachmentService.isAttached(ATTACHMENT_IDENTITY), false);
				disposables.dispose();
			});
		});

		test('disposing while waiting prevents a later listing from attaching', async () => {
			listedSessions.clear();
			const disposables = createContribution(DIRECTIVE);
			disposables.dispose();
			listedSessions.add(DIRECTIVE);
			sessionsChanged.fire({} as ISessionsChangeEvent);
			await Promise.resolve();
			assert.strictEqual(openedSessions.length, 0);
			assert.strictEqual(attachmentService.isAttached(ATTACHMENT_IDENTITY), false);
		});
	});

	suite('attachment service', () => {

		test('matches only the exact authority and backend session and clears after final disposal', () => {
			const first = attachmentService.register(ATTACHMENT_IDENTITY);
			const second = attachmentService.register(ATTACHMENT_IDENTITY);
			assert.strictEqual(attachmentService.isAttached(ATTACHMENT_IDENTITY), true);
			assert.strictEqual(attachmentService.isAttached({ connectionAuthority: 'other', backendSession: BACKEND_SESSION }), false);
			assert.strictEqual(attachmentService.isAttached({ ...ATTACHMENT_IDENTITY, backendSession: AgentSession.uri('copilot', 'session-other') }), false);
			assert.strictEqual(attachmentService.isAttached({ ...ATTACHMENT_IDENTITY, backendSession: AgentSession.uri('other', 'session-abc') }), false);

			first.dispose();
			assert.strictEqual(attachmentService.isAttached(ATTACHMENT_IDENTITY), true);
			second.dispose();
			assert.strictEqual(attachmentService.isAttached(ATTACHMENT_IDENTITY), false);
		});

		test('rejects incomplete identities', () => {
			assert.throws(() => attachmentService.register({ connectionAuthority: '', backendSession: BACKEND_SESSION }));
			assert.throws(() => attachmentService.register({ connectionAuthority: 'local', backendSession: URI.parse('copilot:/') }));
			assert.strictEqual(attachmentService.isAttached(ATTACHMENT_IDENTITY), false);
		});
	});
});

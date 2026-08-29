/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise, timeout } from '../../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../../../base/common/errors.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { ISettableObservable, observableValue } from '../../../../../../base/common/observable.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IAgentConnection } from '../../../../../../platform/agentHost/common/agentService.js';
import { IAgentHostConnectionInfo, IAgentHostSessionResolution } from '../../../../../../platform/agentHost/common/agentHostConnectionsService.js';
import { EvaluationSessionAttachmentService } from '../../../../../../workbench/contrib/chat/browser/agentSessions/agentHost/evaluationSessionAttachmentService.js';
import { ISession, ISessionWorkspace } from '../../../../../services/sessions/common/session.js';
import { ISessionsChangeEvent } from '../../../../../services/sessions/common/sessionsManagement.js';
import { IEvaluationSessionAttachmentStartupServices, parseEvaluationSessionResource, resolveEvaluationSessionIdentity, startEvaluationSessionAttachment } from '../../browser/evaluationSessionAttachment.contribution.js';

suite('EvaluationSessionAttachment', () => {
	const disposables = new DisposableStore();
	const resource = URI.parse('remote-eval_host-copilot:/session-1');
	const backendSession = URI.parse('ahp-session:/session-1');

	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	function createSession(workspace?: ISessionWorkspace): ISession {
		const initialWorkspace = arguments.length === 0 ? trustedWorkspace() : workspace;
		return {
			resource,
			backendUri: backendSession,
			workspace: observableValue<ISessionWorkspace | undefined>('workspace', initialWorkspace),
		} as unknown as ISession;
	}

	function trustedWorkspace(): ISessionWorkspace {
		return {
			uri: URI.file('/workspace'),
			label: 'workspace',
			icon: { id: 'folder' },
			folders: [],
			requiresWorkspaceTrust: true,
			isVirtualWorkspace: false,
		};
	}

	function createServices(options?: {
		session?: ISession;
		active?: ISession;
		restoreComplete?: boolean;
		trusted?: boolean;
		canOpen?: (session: ISession) => Promise<boolean>;
		open?: (session: ISession) => Promise<void>;
	}) {
		const sessionChanges = disposables.add(new Emitter<ISessionsChangeEvent>());
		const activeSession = observableValue<ISession | undefined>('activeSession', options?.active);
		const initialRestoreComplete = observableValue('initialRestoreComplete', options?.restoreComplete ?? true);
		const attachmentService = new EvaluationSessionAttachmentService();
		const connection = {} as IAgentConnection;
		let session = options?.session;
		let opened = 0;
		let trustChecks = 0;
		const services: IEvaluationSessionAttachmentStartupServices = {
			sessionsManagementService: {
				getSession: candidate => session?.resource.toString() === candidate.toString() ? session : undefined,
				onDidChangeSessions: sessionChanges.event,
			},
			sessionsService: {
				activeSession,
				initialRestoreComplete,
				canOpenSession: async candidate => {
					assert.strictEqual(candidate, session);
					trustChecks++;
					return options?.canOpen ? options.canOpen(candidate) : options?.trusted ?? true;
				},
				openSession: async candidate => {
					opened++;
					assert.strictEqual(candidate.toString(), resource.toString());
					if (session) {
						if (options?.open) {
							await options.open(session);
						} else {
							activeSession.set(session, undefined);
						}
					}
				},
			},
			connectionsService: {
				connections: [{
					authority: 'eval_host',
					address: 'eval-host',
					name: 'Evaluation host',
					isAmbient: false,
					connection,
				}] satisfies IAgentHostConnectionInfo[],
				resolveSessionResource: candidate => candidate.toString() === resource.toString()
					? { connection, backendSession: URI.parse('copilot:/session-1') } satisfies IAgentHostSessionResolution
					: undefined,
			},
			attachmentService,
		};
		return {
			services,
			attachmentService,
			activeSession,
			initialRestoreComplete,
			setSession(value: ISession) {
				session = value;
				sessionChanges.fire({ added: [value], removed: [], changed: [] });
			},
			get opened() { return opened; },
			get trustChecks() { return trustChecks; },
		};
	}

	test('no flag returns before accessing services and leaves attachment empty', async () => {
		const attachmentService = new EvaluationSessionAttachmentService();
		let accessed = false;
		const result = await startEvaluationSessionAttachment(undefined, () => {
			accessed = true;
			throw new Error('unreachable');
		}, CancellationToken.None);

		assert.strictEqual(result, undefined);
		assert.strictEqual(accessed, false);
		assert.strictEqual(attachmentService.isAttached('eval_host', backendSession), false);
	});

	test('rejects malformed and noncanonical URIs before accessing services', async () => {
		for (const value of [
			'not a uri',
			'copilot:/session-1',
			'remote-eval_host-copilot://authority/session-1',
			'remote-eval_host-copilot:/session-1/child',
			'remote-eval_host-copilot:/session-1?query',
			'REMOTE-eval_host-copilot:/session-1',
		]) {
			let accessed = false;
			await assert.rejects(
				() => startEvaluationSessionAttachment(value, () => {
					accessed = true;
					throw new Error('unreachable');
				}, CancellationToken.None),
			);
			assert.strictEqual(accessed, false, value);
		}
		assert.strictEqual(parseEvaluationSessionResource(resource.toString()).toString(), resource.toString());
	});

	test('uses exact remote authority and provider-mapped backend URI', () => {
		const harness = createServices({ session: createSession() });
		const identity = resolveEvaluationSessionIdentity(resource, createSession(), harness.services.connectionsService);
		assert.strictEqual(identity.connectionAuthority, 'eval_host');
		assert.strictEqual(identity.backendSession.toString(), 'ahp-session:/session-1');
		assert.throws(() => resolveEvaluationSessionIdentity(
			URI.parse('remote-other-copilot:/session-1'),
			createSession(),
			harness.services.connectionsService,
		));
	});

	test('waits for exact listing, workspace hydration, trust, open, and active observation before attaching', async () => {
		const session = createSession(undefined);
		let attachedDuringOpen = false;
		const harness = createServices({
			restoreComplete: false,
			open: async openedSession => {
				attachedDuringOpen = harness.attachmentService.isAttached('eval_host', backendSession);
				harness.activeSession.set(openedSession, undefined);
			},
		});
		const attachment = startEvaluationSessionAttachment(resource.toString(), () => harness.services, CancellationToken.None);

		harness.initialRestoreComplete.set(true, undefined);
		harness.setSession(session);
		assert.strictEqual(harness.opened, 0);
		assert.strictEqual(harness.attachmentService.isAttached('eval_host', backendSession), false);

		(session.workspace as ISettableObservable<ISessionWorkspace | undefined>).set(trustedWorkspace(), undefined);
		const registration = await attachment;
		assert.ok(registration);
		assert.strictEqual(harness.trustChecks, 1);
		assert.strictEqual(harness.opened, 1);
		assert.strictEqual(attachedDuringOpen, true);
		assert.strictEqual(harness.activeSession.get(), session);
		assert.strictEqual(harness.attachmentService.isAttached('eval_host', backendSession), true);

		registration.dispose();
		assert.strictEqual(harness.attachmentService.isAttached('eval_host', backendSession), false);
	});

	test('fails closed for untrusted, unknown-workspace timeout, and cancellation', async () => {
		const untrusted = createServices({ session: createSession(), trusted: false });
		await assert.rejects(
			startEvaluationSessionAttachment(resource.toString(), () => untrusted.services, CancellationToken.None),
			/ not trusted\./,
		);
		assert.strictEqual(untrusted.attachmentService.isAttached('eval_host', backendSession), false);

		const unknown = createServices({ session: createSession(undefined) });
		await assert.rejects(
			startEvaluationSessionAttachment(resource.toString(), () => unknown.services, CancellationToken.None, 1),
			/Timed out/,
		);
		assert.strictEqual(unknown.opened, 0);

		const cancelled = createServices();
		const source = disposables.add(new CancellationTokenSource());
		const pending = startEvaluationSessionAttachment(resource.toString(), () => cancelled.services, source.token);
		source.cancel();
		await assert.rejects(pending);
		assert.strictEqual(cancelled.attachmentService.isAttached('eval_host', backendSession), false);
	});

	test('rejects an unrelated restored session and open failure or active mismatch without registering', async () => {
		const unrelated = createServices({
			session: createSession(),
			active: { resource: URI.parse('remote-eval_host-copilot:/other') } as ISession,
		});
		await assert.rejects(
			startEvaluationSessionAttachment(resource.toString(), () => unrelated.services, CancellationToken.None),
			/fresh Agents window/,
		);

		const failed = createServices({
			session: createSession(),
			open: async () => { throw new Error('open failed'); },
		});
		await assert.rejects(
			startEvaluationSessionAttachment(resource.toString(), () => failed.services, CancellationToken.None),
			/open failed/,
		);
		assert.strictEqual(failed.attachmentService.isAttached('eval_host', backendSession), false);

		const mismatched = createServices({
			session: createSession(),
			open: async () => {
				mismatched.activeSession.set({ resource: URI.parse('remote-eval_host-copilot:/other') } as ISession, undefined);
			},
		});
		await assert.rejects(
			startEvaluationSessionAttachment(resource.toString(), () => mismatched.services, CancellationToken.None),
			/activated a different session/,
		);
		assert.strictEqual(mismatched.attachmentService.isAttached('eval_host', backendSession), false);
	});

	test('disposes the provisional attachment immediately when opening is cancelled', async () => {
		const open = new DeferredPromise<void>();
		const harness = createServices({
			session: createSession(),
			open: async () => open.p,
		});
		const source = disposables.add(new CancellationTokenSource());
		const pending = startEvaluationSessionAttachment(resource.toString(), () => harness.services, source.token);
		await timeout(0);

		assert.strictEqual(harness.opened, 1);
		assert.strictEqual(harness.attachmentService.isAttached('eval_host', backendSession), true);
		source.cancel();
		await assert.rejects(pending, error => error instanceof CancellationError);
		assert.strictEqual(harness.attachmentService.isAttached('eval_host', backendSession), false);
		open.complete();
	});

	test('rejects transient unrelated activation throughout startup without opening or attaching', async () => {
		const unrelated = { resource: URI.parse('remote-eval_host-copilot:/other') } as ISession;

		const listing = createServices();
		const listingPending = startEvaluationSessionAttachment(resource.toString(), () => listing.services, CancellationToken.None);
		listing.activeSession.set(unrelated, undefined);
		listing.activeSession.set(undefined, undefined);
		await assert.rejects(listingPending, /intervening active session/);
		assert.strictEqual(listing.opened, 0);
		assert.strictEqual(listing.attachmentService.isAttached('eval_host', backendSession), false);

		const workspace = createServices({ session: createSession(undefined) });
		const workspacePending = startEvaluationSessionAttachment(resource.toString(), () => workspace.services, CancellationToken.None);
		await timeout(0);
		workspace.activeSession.set(unrelated, undefined);
		workspace.activeSession.set(undefined, undefined);
		await assert.rejects(workspacePending, /intervening active session/);
		assert.strictEqual(workspace.opened, 0);
		assert.strictEqual(workspace.attachmentService.isAttached('eval_host', backendSession), false);

		const trust = new DeferredPromise<boolean>();
		const trusting = createServices({ session: createSession(), canOpen: async () => trust.p });
		const trustPending = startEvaluationSessionAttachment(resource.toString(), () => trusting.services, CancellationToken.None);
		await timeout(0);
		assert.strictEqual(trusting.trustChecks, 1);
		trusting.activeSession.set(unrelated, undefined);
		trusting.activeSession.set(undefined, undefined);
		await assert.rejects(trustPending, /intervening active session/);
		assert.strictEqual(trusting.opened, 0);
		assert.strictEqual(trusting.attachmentService.isAttached('eval_host', backendSession), false);
		trust.complete(true);
	});

	test('disposes provisional attachment when the exact listing is superseded during open', async () => {
		const original = createSession();
		const replacement = createSession();
		const harness = createServices({
			session: original,
			open: async openedSession => {
				harness.setSession(replacement);
				harness.activeSession.set(openedSession, undefined);
			},
		});
		await assert.rejects(
			startEvaluationSessionAttachment(resource.toString(), () => harness.services, CancellationToken.None),
			/superseded/,
		);
		assert.strictEqual(harness.opened, 1);
		assert.strictEqual(harness.attachmentService.isAttached('eval_host', backendSession), false);
	});

	test('times out when only a different session is listed', async () => {
		const harness = createServices();
		const pending = startEvaluationSessionAttachment(resource.toString(), () => harness.services, CancellationToken.None, 1);
		harness.setSession({ resource: URI.parse('remote-eval_host-copilot:/other') } as ISession);
		await timeout(0);
		await assert.rejects(pending, /Timed out/);
		assert.strictEqual(harness.trustChecks, 0);
		assert.strictEqual(harness.opened, 0);
	});
});

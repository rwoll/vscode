/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAgentHostConnectionsService } from '../../../../../platform/agentHost/common/agentHostConnectionsService.js';
import { IInstantiationService, ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../workbench/common/contributions.js';
import { IEvaluationSessionAttachmentService } from '../../../../../workbench/contrib/chat/browser/agentSessions/agentHost/evaluationSessionAttachmentService.js';
import { INativeWorkbenchEnvironmentService } from '../../../../../workbench/services/environment/electron-browser/environmentService.js';
import { ISessionsService } from '../../../../services/sessions/browser/sessionsService.js';
import { ISessionsManagementService } from '../../../../services/sessions/common/sessionsManagement.js';
import { EvaluationSessionAttachmentLifecycle, IEvaluationSessionAttachmentStartupServices } from '../browser/evaluationSessionAttachment.js';
export class EvaluationSessionAttachmentContribution extends EvaluationSessionAttachmentLifecycle implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.evaluationSessionAttachment';
	constructor(
		@INativeWorkbenchEnvironmentService environmentService: INativeWorkbenchEnvironmentService,
		@IInstantiationService instantiationService: IInstantiationService,
		@INotificationService notificationService: INotificationService,
	) {
		super(environmentService.args['attach-to-evaluation-session'], () => getStartupServices(instantiationService), error => notificationService.error(error));
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
registerWorkbenchContribution2(EvaluationSessionAttachmentContribution.ID, EvaluationSessionAttachmentContribution, WorkbenchPhase.BlockRestore);

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { QuickInputController } from '../../../../platform/quickinput/browser/quickInputController.js';
import { QuickInputService as BaseQuickInputService } from '../../../../platform/quickinput/browser/quickInputService.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { InQuickPickContextKey } from '../../../browser/quickaccess.js';
import { QuickInputDebugService } from '../../../../platform/quickinput/browser/quickInputDebugService.js';
import { IQuickInputDebugService } from '../../../../platform/quickinput/common/quickInputDebugIpc.js';
import { QuickInputProxyService, IQuickInputProxyService } from '../../../../platform/quickinput/browser/quickInputProxyService.js';

export class QuickInputService extends BaseQuickInputService {

	private readonly inQuickInputContext = InQuickPickContextKey.bindTo(this.contextKeyService);
	private _proxyService: QuickInputProxyService | undefined;
	private _debugService: QuickInputDebugService | undefined;

	constructor(
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@ILayoutService layoutService: ILayoutService,
	) {
		super(instantiationService, contextKeyService, themeService, layoutService, configurationService);

		this.registerListeners();
		this.setupDebugServices();
	}

	private setupDebugServices(): void {
		// Create debug service for logging
		this._debugService = this._register(new QuickInputDebugService());
		
		// Create proxy service that wraps this service
		this._proxyService = this._register(new QuickInputProxyService(this, this._debugService));
		
		// Check configuration for debug enablement
		const debugEnabled = this.configurationService.getValue<boolean>('workbench.quickInput.debug.enabled') || false;
		this._proxyService.setDebuggingEnabled(debugEnabled);
		
		// Listen for configuration changes
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('workbench.quickInput.debug.enabled')) {
				const enabled = this.configurationService.getValue<boolean>('workbench.quickInput.debug.enabled') || false;
				this._proxyService?.setDebuggingEnabled(enabled);
			}
		}));
	}

	/**
	 * Get the debug service for external IPC access
	 */
	getDebugService(): IQuickInputDebugService | undefined {
		return this._debugService;
	}

	/**
	 * Get the proxy service that provides debugging capabilities
	 */
	getProxyService(): IQuickInputProxyService | undefined {
		return this._proxyService;
	}

	private registerListeners(): void {
		this._register(this.onShow(() => this.inQuickInputContext.set(true)));
		this._register(this.onHide(() => this.inQuickInputContext.set(false)));
	}

	protected override createController(): QuickInputController {
		return super.createController(this.layoutService, {
			ignoreFocusOut: () => !this.configurationService.getValue('workbench.quickOpen.closeOnFocusLost'),
			backKeybindingLabel: () => this.keybindingService.lookupKeybinding('workbench.action.quickInputBack')?.getLabel() || undefined,
		});
	}
}

registerSingleton(IQuickInputService, QuickInputService, InstantiationType.Delayed);

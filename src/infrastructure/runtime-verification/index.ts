import type { BrowserVerificationRunnerPort } from '../../core/runtime-verification/ports';
import { NodeDevServerManager } from './node-dev-server-manager';
import { PlaywrightBrowserVerificationRunner } from './playwright-browser-verification-runner';
import { RuntimeBrowserVerificationService } from './runtime-browser-verification.service';

export function createRuntimeBrowserVerificationService(configuration: {
  readonly workflowDeadlineMs: number;
  readonly outputLimitBytes: number;
}): RuntimeBrowserVerificationService {
  const browserRunner: BrowserVerificationRunnerPort = new PlaywrightBrowserVerificationRunner();
  return new RuntimeBrowserVerificationService(
    () => new NodeDevServerManager(),
    browserRunner,
    configuration,
  );
}

export { NodeDevServerManager } from './node-dev-server-manager';
export { PlaywrightBrowserVerificationRunner } from './playwright-browser-verification-runner';
export { RuntimeBrowserVerificationService } from './runtime-browser-verification.service';
export {
  buildRuntimeVerificationPlan,
  createRuntimeServerDescriptor,
  discoverRuntimeScripts,
} from './runtime-script-discovery';
export {
  allocateLocalhostPort,
  buildLocalhostUrl,
  isPortAvailable,
} from './localhost-port-allocation';
export {
  createRuntimeVerificationArtifactStore,
  screenshotArtifactId,
} from './runtime-verification-artifacts';

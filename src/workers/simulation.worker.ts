import type { WorkerToUiMessage } from '../protocol';
import { createSimulationRuntime } from './simulation-runtime';

interface WorkerPort {
  postMessage(message: WorkerToUiMessage, transfer: readonly ArrayBuffer[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

const workerScope = self as unknown as WorkerPort;
const runtime = createSimulationRuntime(
  (message: WorkerToUiMessage, transfer: readonly ArrayBuffer[]) => {
    workerScope.postMessage(message, transfer);
  },
);

workerScope.addEventListener('message', (event: MessageEvent<unknown>) => {
  runtime.handleMessage(event.data);
});

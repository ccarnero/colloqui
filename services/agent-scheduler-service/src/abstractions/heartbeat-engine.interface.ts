export interface IHeartbeatEngine {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

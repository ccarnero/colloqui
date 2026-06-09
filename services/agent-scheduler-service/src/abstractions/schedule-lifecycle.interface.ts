export interface IScheduleLifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
  reconcileAllTenants(): Promise<void>;
}

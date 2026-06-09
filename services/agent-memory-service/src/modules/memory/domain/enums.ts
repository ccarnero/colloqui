export enum MemoryScope {
  SESSION = "SESSION",
  USER = "USER",
  TENANT = "TENANT",
}

export enum MemoryKind {
  PREFERENCE = "PREFERENCE",
  FACT = "FACT",
  NOTICE = "NOTICE",
  INCIDENT = "INCIDENT",
  PROMO = "PROMO",
}

export enum MemoryStatus {
  PROPOSED = "PROPOSED",
  ACTIVE = "ACTIVE",
  REJECTED = "REJECTED",
  ARCHIVED = "ARCHIVED",
}

export enum MergeStrategy {
  REPLACE = "REPLACE",
  KEEP_BOTH = "KEEP_BOTH",
}

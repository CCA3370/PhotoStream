import type { UserRole, UserView } from "@photostream/contracts";

export interface AuthUserRecord extends UserView {
  readonly normalizedUsername: string;
  readonly passwordHash: string;
  readonly isActive: boolean;
}

export interface AuthSessionRecord {
  readonly id: string;
  readonly tokenHash: string;
  readonly user: AuthUserRecord;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly revokedAt: Date | null;
}

export interface NewSessionRecord {
  readonly tokenHash: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export interface BootstrapUserInput {
  readonly username: string;
  readonly normalizedUsername: string;
  readonly displayName: string;
  readonly role: UserRole;
  readonly passwordHash: string;
  readonly requestId: string;
}

export interface AuthStore {
  ping(): Promise<void>;
  findUserByNormalizedUsername(normalizedUsername: string): Promise<AuthUserRecord | null>;
  findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null>;
  createSession(input: NewSessionRecord): Promise<string>;
  touchSession(id: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void>;
  revokeSession(id: string, revokedAt: Date): Promise<void>;
  updatePasswordAndRevokeSessions(
    userId: string,
    passwordHash: string,
    changedAt: Date,
    requestId: string,
  ): Promise<void>;
  createBootstrapAdmin(input: BootstrapUserInput): Promise<AuthUserRecord>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

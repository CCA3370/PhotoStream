import {
  type AuthSession,
  type LoginRequest,
  normalizeUsername,
  permissionsFor,
} from "@photostream/contracts";

import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { createCsrfToken, createSessionToken, hashSessionToken, safeEqual } from "./crypto.js";
import { assertPasswordPolicy } from "./password.js";
import type { AuthSessionRecord, AuthStore, AuthUserRecord, PasswordHasher } from "./types.js";

const idleDurationMs = 8 * 60 * 60 * 1000;
const absoluteDurationMs = 7 * 24 * 60 * 60 * 1000;
const touchIntervalMs = 5 * 60 * 1000;

export interface IssuedSession {
  readonly rawToken: string;
  readonly view: AuthSession;
  readonly absoluteExpiresAt: Date;
}

export interface AuthenticatedSession {
  readonly record: AuthSessionRecord;
  readonly rawToken: string;
  readonly view: AuthSession;
}

export class AuthService {
  readonly #store: AuthStore;
  readonly #hasher: PasswordHasher;
  readonly #csrfSecret: string;
  readonly #currentSessionSecret: string;
  readonly #sessionSecrets: readonly string[];
  readonly #dummyHash: Promise<string>;

  constructor(store: AuthStore, hasher: PasswordHasher, config: AppConfig) {
    this.#store = store;
    this.#hasher = hasher;
    this.#csrfSecret = config.CSRF_SECRET;
    this.#currentSessionSecret = config.SESSION_SECRET_CURRENT;
    this.#sessionSecrets = [
      config.SESSION_SECRET_CURRENT,
      ...(config.SESSION_SECRET_PREVIOUS === undefined ? [] : [config.SESSION_SECRET_PREVIOUS]),
    ];
    this.#dummyHash = hasher.hash("not-a-valid-photostream-password");
  }

  async login(input: LoginRequest, now = new Date()): Promise<IssuedSession> {
    const normalizedUsername = normalizeUsername(input.username);
    const user = await this.#store.findUserByNormalizedUsername(normalizedUsername);
    const passwordHash = user?.passwordHash ?? (await this.#dummyHash);
    const validPassword = await this.#hasher.verify(passwordHash, input.password);

    if (user === null || !validPassword) {
      throw new AppError({
        code: "AUTH_INVALID_CREDENTIALS",
        message: "用户名或密码错误",
        statusCode: 401,
      });
    }
    if (!user.isActive) {
      throw new AppError({
        code: "AUTH_ACCOUNT_DISABLED",
        message: "账号已停用，请联系管理员",
        statusCode: 403,
      });
    }

    return this.#issueSession(user, now);
  }

  async authenticate(
    rawToken: string | undefined,
    now = new Date(),
  ): Promise<AuthenticatedSession> {
    if (rawToken === undefined || rawToken.length === 0) {
      throw this.#authenticationRequired();
    }

    let record: AuthSessionRecord | null = null;
    for (const secret of this.#sessionSecrets) {
      record = await this.#store.findSessionByTokenHash(hashSessionToken(rawToken, secret));
      if (record !== null) {
        break;
      }
    }
    if (
      record === null ||
      record.revokedAt !== null ||
      record.idleExpiresAt <= now ||
      record.absoluteExpiresAt <= now
    ) {
      if (record !== null && record.revokedAt === null) {
        await this.#store.revokeSession(record.id, now);
      }
      throw this.#authenticationRequired();
    }
    if (!record.user.isActive) {
      await this.#store.revokeSession(record.id, now);
      throw new AppError({
        code: "AUTH_ACCOUNT_DISABLED",
        message: "账号已停用，请联系管理员",
        statusCode: 403,
      });
    }

    if (now.getTime() - record.lastSeenAt.getTime() >= touchIntervalMs) {
      const idleExpiresAt = new Date(
        Math.min(now.getTime() + idleDurationMs, record.absoluteExpiresAt.getTime()),
      );
      await this.#store.touchSession(record.id, now, idleExpiresAt);
    }

    return {
      record,
      rawToken,
      view: this.#view(record.user, rawToken),
    };
  }

  verifyCsrf(rawToken: string, candidate: string | undefined): void {
    const expected = createCsrfToken(this.#csrfSecret, rawToken);
    if (candidate === undefined || !safeEqual(expected, candidate)) {
      throw new AppError({
        code: "AUTH_CSRF_INVALID",
        message: "安全校验已失效，请刷新页面后重试",
        statusCode: 403,
      });
    }
  }

  async changePassword(options: {
    session: AuthenticatedSession;
    currentPassword: string;
    newPassword: string;
    requestId: string;
    now?: Date;
  }): Promise<IssuedSession> {
    const now = options.now ?? new Date();
    const validCurrentPassword = await this.#hasher.verify(
      options.session.record.user.passwordHash,
      options.currentPassword,
    );
    if (!validCurrentPassword) {
      throw new AppError({
        code: "AUTH_INVALID_CREDENTIALS",
        message: "当前密码错误",
        statusCode: 401,
      });
    }

    assertPasswordPolicy(options.newPassword, options.session.record.user.normalizedUsername);
    const passwordHash = await this.#hasher.hash(options.newPassword);
    await this.#store.updatePasswordAndRevokeSessions(
      options.session.record.user.id,
      passwordHash,
      now,
      options.requestId,
    );

    const refreshedUser: AuthUserRecord = {
      ...options.session.record.user,
      passwordHash,
      mustChangePassword: false,
    };
    return this.#issueSession(refreshedUser, now);
  }

  async logout(session: AuthenticatedSession, now = new Date()): Promise<void> {
    await this.#store.revokeSession(session.record.id, now);
  }

  async #issueSession(user: AuthUserRecord, now: Date): Promise<IssuedSession> {
    const rawToken = createSessionToken();
    const absoluteExpiresAt = new Date(now.getTime() + absoluteDurationMs);
    await this.#store.createSession({
      tokenHash: hashSessionToken(rawToken, this.#currentSessionSecret),
      userId: user.id,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + idleDurationMs),
      absoluteExpiresAt,
    });

    return {
      rawToken,
      view: this.#view(user, rawToken),
      absoluteExpiresAt,
    };
  }

  #view(user: AuthUserRecord, rawToken: string): AuthSession {
    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
      csrfToken: createCsrfToken(this.#csrfSecret, rawToken),
      permissions: [...permissionsFor(user.role)],
    };
  }

  #authenticationRequired(): AppError {
    return new AppError({
      code: "AUTH_REQUIRED",
      message: "登录已失效，请重新登录",
      statusCode: 401,
    });
  }
}

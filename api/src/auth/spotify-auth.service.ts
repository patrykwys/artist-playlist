import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AppConfig } from '../config.js';
import { UpstreamError, fetchJson } from '../common/http.js';
import { SpotifyUser } from '../models.js';
import { Session, SessionService, SpotifyTokens } from './session.service.js';

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const PROFILE_URL = 'https://api.spotify.com/v1/me';
const SCOPES = ['playlist-modify-private', 'playlist-modify-public', 'playlist-read-private'];
const REFRESH_MARGIN_MS = 60_000;

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

interface MeResponse {
  id: string;
  display_name: string | null;
}

@Injectable()
export class SpotifyAuthService {
  private readonly logger = new Logger(SpotifyAuthService.name);
  /** Keyed by session; concurrent requests for one session share a single refresh. */
  readonly #refreshing = new Map<string, Promise<SpotifyTokens>>();

  constructor(
    private readonly config: AppConfig,
    private readonly sessions: SessionService,
  ) {}

  authorizeUrl(state: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.spotifyClientId,
      scope: SCOPES.join(' '),
      redirect_uri: this.config.spotifyRedirectUri,
      state,
    });
    return `${AUTHORIZE_URL}?${params}`;
  }

  async exchangeCode(code: string): Promise<SpotifyTokens> {
    const response = await this.#requestToken(
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.config.spotifyRedirectUri }),
    );
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? '',
      expiresAt: Date.now() + response.expires_in * 1000,
    };
  }

  /** Who just logged in. Used once at login, before a session exists. */
  async profile(accessToken: string): Promise<SpotifyUser> {
    const me = await fetchJson<MeResponse>('Spotify', PROFILE_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    return { id: me.id, displayName: me.display_name ?? me.id };
  }

  /** Returns a usable access token, refreshing (and saving) it first when it is about to expire. */
  async accessToken(session: Session): Promise<string> {
    if (session.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
      return session.accessToken;
    }

    let refresh = this.#refreshing.get(session.idHash);
    if (!refresh) {
      refresh = this.#refresh(session).finally(() => this.#refreshing.delete(session.idHash));
      this.#refreshing.set(session.idHash, refresh);
    }
    const tokens = await refresh;
    session.accessToken = tokens.accessToken;
    session.refreshToken = tokens.refreshToken;
    session.expiresAt = tokens.expiresAt;
    return session.accessToken;
  }

  async #refresh(session: Session): Promise<SpotifyTokens> {
    this.logger.log('Refreshing Spotify access token');
    let response: TokenResponse;
    try {
      response = await this.#requestToken(
        new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken }),
      );
    } catch (error) {
      // 400 invalid_grant: access was revoked in Spotify or the refresh token expired. Only a new login helps.
      if (error instanceof UpstreamError && (error.status === 400 || error.status === 401)) {
        this.sessions.deleteByIdHash(session.idHash);
        throw new UnauthorizedException('Your Spotify login has expired. Log in again.');
      }
      throw error;
    }

    const tokens: SpotifyTokens = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? session.refreshToken,
      expiresAt: Date.now() + response.expires_in * 1000,
    };
    this.sessions.saveTokens({ ...session, ...tokens });
    return tokens;
  }

  #requestToken(body: URLSearchParams): Promise<TokenResponse> {
    const credentials = Buffer.from(`${this.config.spotifyClientId}:${this.config.spotifyClientSecret}`).toString(
      'base64',
    );
    return fetchJson<TokenResponse>('Spotify accounts', TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }
}

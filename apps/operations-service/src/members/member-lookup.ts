import { API_PREFIX, CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from '@solmira/contracts';
import { ForbiddenError, ServiceUnavailableError, getRequestContext } from '@solmira/service-kit';

export interface OrganizationMember {
  readonly memberId: string;
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
  readonly status: 'active' | 'suspended';
}

/** Port to the identity service's member records. */
export interface MemberLookup {
  /** null when the member does not exist in that organization. */
  find(
    organizationId: string,
    memberId: string,
    bearerToken: string,
  ): Promise<OrganizationMember | null>;
}

const LOOKUP_TIMEOUT_MS = 3_000;

/**
 * Token relay: the caller's own access token is forwarded, so identity-service applies the same
 * tenant check (path organization must equal token organization) and the same permission check
 * (users.read) it applies to the caller directly. No service-level super-credential exists.
 */
export class HttpMemberLookup implements MemberLookup {
  constructor(private readonly identityBaseUrl: string) {}

  async find(
    organizationId: string,
    memberId: string,
    bearerToken: string,
  ): Promise<OrganizationMember | null> {
    const context = getRequestContext();
    const url = `${this.identityBaseUrl.replace(/\/+$/, '')}${API_PREFIX}/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(memberId)}`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          Accept: 'application/json',
          ...(context
            ? {
                [REQUEST_ID_HEADER]: context.requestId,
                [CORRELATION_ID_HEADER]: context.correlationId,
              }
            : {}),
        },
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      });
    } catch {
      throw new ServiceUnavailableError('Member directory is temporarily unavailable');
    }
    if (response.status === 404) return null;
    if (response.status === 403)
      throw new ForbiddenError('You need permission to view members to assign a manager');
    if (!response.ok)
      throw new ServiceUnavailableError('Member directory is temporarily unavailable');

    const body = (await response.json()) as {
      id: string;
      userId: string;
      fullName: string;
      email: string;
      status: string;
    };
    return {
      memberId: body.id,
      userId: body.userId,
      fullName: body.fullName,
      email: body.email,
      status: body.status === 'active' ? 'active' : 'suspended',
    };
  }
}

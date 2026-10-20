/** Binds a stored secret to its organization and endpoint (see SecretCipher). */
export const secretContext = (organizationId: string, endpointId: string): string =>
  organizationId + ':' + endpointId;

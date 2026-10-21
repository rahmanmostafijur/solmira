import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export interface DynamoOptions {
  readonly region: string;
  /** DynamoDB Local in development; unset in AWS. */
  readonly endpoint?: string;
}

/** The document client the attempt store uses; `undefined` values are dropped, not rejected. */
export function createDynamoClients(options: DynamoOptions): {
  raw: DynamoDBClient;
  documents: DynamoDBDocumentClient;
} {
  const raw = new DynamoDBClient({
    region: options.region,
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
  });
  const documents = DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true },
  });
  return { raw, documents };
}

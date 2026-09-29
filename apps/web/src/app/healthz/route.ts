// Container liveness probe for the web tier; does not depend on the backend services.
export function GET() {
  return Response.json({ status: 'ok' });
}

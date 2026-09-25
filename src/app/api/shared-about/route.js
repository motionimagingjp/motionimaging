import { SHARED_ABOUT } from '../../../lib/shared-about-data';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=3600',
};

export async function GET() {
  return Response.json(SHARED_ABOUT, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

import type { SubmissionsResponse, SubmissionDetailResponse } from '../types';

const API_BASE = '/apps/trade-in';

export async function fetchSubmissions(params: {
  page?: number;
  limit?: number;
  status?: string;
}): Promise<SubmissionsResponse> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', String(params.page));
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.status) searchParams.set('status', params.status);

  const response = await fetch(`${API_BASE}/my-submissions?${searchParams}`);
  if (!response.ok) {
    throw new Error('Failed to fetch submissions');
  }
  return response.json();
}

export async function fetchSubmissionDetail(
  submissionNumber: string
): Promise<SubmissionDetailResponse> {
  const response = await fetch(`${API_BASE}/my-submissions/${submissionNumber}`);
  if (!response.ok) {
    throw new Error('Failed to fetch submission');
  }
  return response.json();
}

export async function submitAction(
  submissionNumber: string,
  action: 'accept' | 'reject' | 'cancel',
  data?: { reason?: string; trackingNumber?: string }
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(
    `${API_BASE}/my-submissions/${submissionNumber}/action`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...data }),
    }
  );
  if (!response.ok) {
    throw new Error('Action failed');
  }
  return response.json();
}
